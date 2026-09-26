package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.infrastructure.mq.JobEventPayload;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.Reservation;
import com.bluewhale.billing.ledger.ReservationRepository;
import com.bluewhale.billing.pricing.CompiledRule;
import com.bluewhale.billing.pricing.DiscountResolver;
import com.bluewhale.billing.pricing.MediaPricingCalculator;
import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.billing.pricing.PricingRequest;
import com.bluewhale.billing.pricing.Usage;
import com.bluewhale.billing.pricing.UsageDim;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;

/**
 * 结算与返还（《计费逻辑详细设计》§4.3 / §4.4），由 MQ 事件触发。
 *
 * <h2>为什么结算必须用「冻结的规则 + 冻结的折扣」</h2>
 *
 * 结算发生在预扣之后几分钟到几十分钟，期间运营可能改了价、停了活动。
 * 若按**当前**的规则与折扣重算，就会出现「提交时看到 7 折、结算按原价扣」——
 * 用户认为被多扣了，而系统里没有任何一处记录能证明当时是 7 折。
 *
 * <p>三样东西在预扣时都已冻结在预留行上：
 * <ul>
 *   <li>{@code rule_snapshot} —— ★ 当时那条规则**本身**（唯一的价格来源）</li>
 *   <li>{@code discount_bp} —— 当时打了多少折</li>
 *   <li>{@code catalog_version} —— 当时的目录版本（只作追溯，见下）</li>
 * </ul>
 * 本类只负责把它们还原出来，**不做任何重新解析**。
 *
 * <h2>★ 规则只有一个来源：预留行上的快照</h2>
 *
 * 计价规则住在模型能力行（backend 的 {@code generation_model_capability.pricing}），
 * billing 读不到那个库（ADR-0114 不共享库），所以属主在 Hold 时把规则随请求送来、
 * 预扣时冻进预留行。结算**没有第二条来源**：不像折扣那样能按目录版本复现，
 * 因为规则本来就不在目录里了。
 *
 * <p>所以预留行上没有快照 = **这次算不出价**，抛出去让 MQ 重投（→ 死信 → 有人看得见），
 * **不静默按 0 结算**：钱少收比暂时不结算更难发现。{@code catalog_version} 那一列
 * 只剩追溯价值（日志里报出来，供「这笔当时按哪一版目录的换算率/折扣策略」查证）。
 *
 * <h2>actualCredits 从哪来</h2>
 *
 * 事件里带的是 worker 上报的**原始用量**（张数 / 秒数 / token），不是积分——
 * 价格是 billing 的事（{@code usage.proto} 的注释）。
 * 所以这里按事件里的用量逐条计价再求和。{@code partially_succeeded} 也走这条路：
 * 用量里的成功槽数就是这次**实际交付**的量，按它算而不是按整单算，
 * 这正是 {@code events.proto} 那句「{@code succeeded_slots} 决定 actualCredits
 * （按成功的 slot 计费，不是按 job）」。
 *
 * <p>用量为空是**降级路径**，只在 worker 报不出用量时走到（见 {@link #settle} 的注释）。
 */
@Service
public class SettlementService {

    private static final Logger log = LoggerFactory.getLogger(SettlementService.class);

    private final ReservationRepository reservations;
    private final CreditService credits;

    public SettlementService(ReservationRepository reservations, CreditService credits) {
        this.reservations = reservations;
        this.credits = credits;
    }

    /**
     * 结算一个已完成的任务。
     *
     * <p>无预留（任务没走过预扣）或预留已终结（重复投递）时是**无操作**，不是错误——
     * MQ 至少一次投递，重复到达是常态。
     *
     * @throws IllegalStateException     预留行上没有规则快照——**算不出价**，
     *         抛出去让 MQ 重投，不要静默按 0 结算：钱少收比暂时不结算更难发现
     * @throws CatalogCompiler.CompileException 预留行上的规则快照编不过（数据损坏）——
     *         同样抛出去重投，不静默按 0 结算
     */
    public void settle(JobEventPayload.JobCompleted event) {
        Reservation reservation = reservations.findByJobId(event.jobId()).orElse(null);
        if (reservation == null || !reservation.isPending()) {
            log.info("跳过结算：jobId={} 无待结算预留（未预扣，或已被结算/返还）", event.jobId());
            return;
        }

        FrozenRules frozen = rulesAtHoldTime(reservation);
        PricingEngine frozenEngine = engineAtHoldTime(frozen, reservation);
        Instant completedAt = Instant.now();

        long actualCredits;
        if (event.usage().isEmpty()) {
            // ⚠️ 事件没带用量 —— 无法重算，按**预扣额**结算。
            //
            // 为什么不能让它算成 0：初次实现是把用量逐条累加，没有用量就是 0，
            // 于是每一个媒介类任务都会被**免费结算**。测试 `结算_用量为空时价与预扣相同`
            // 就是钉这条的。
            //
            // 为什么也不做别的猜测：这是唯一一个「不比契约多收、也不比契约少收」的取值。
            //
            // ⚠️ worker 现在按 slot 上报用量（worker 侧 SettlementUsageLines），所以走到这里只剩两种情形：
            //    1. worker **报不出**用量 —— job.input 里取不到 model_id，它宁可发空数组也不猜一个
            //       模型（猜错就是按别人的价扣钱），并在自己那边打 WARN；
            //    2. 滚动发布期间已在 topic 里的**旧版 worker** 消息，会随消费自然消失。
            //
            // ⚠️ 残留缺口：情形 1 若落在 partially_succeeded 上，这条兜底就**偏平台**——
            //    worker 只成功了一部分却没报用量时，用户会被按全额结算。
            //    所以打 WARN 让漏报可观测，而不是默默多收。
            actualCredits = reservation.reservedCredits();
            // ⚠️ **只在部分成功时报警**。succeeded + 空用量是「契约用量即实际用量」那个合理取值
            //    （按次计费的模型本来就是全价），无条件 WARN 等于把所有按次结算都染上告警——
            //    真正该看的那条会被淹掉。
            //
            //    只有 partially_succeeded 才是注释里说的那个「偏平台」场景：
            //    只成功了一部分、却没报用量，用户会被按全额结算。
            if ("partially_succeeded".equals(event.status())) {
                log.warn("部分成功但结算事件未带用量，按全额预扣结算（偏平台）："
                                + "jobId={} 预扣={} 成功槽={}",
                        event.jobId(), actualCredits, event.succeededSlots());
            }
        } else {
            actualCredits = 0;
            for (JobEventPayload.UsageLine line : event.usage()) {
                Usage usage = line.toUsage();
                requireBaseUnitReported(frozen, line, usage);
                PricingRequest request = new PricingRequest(
                        event.userId(), line.modelId(), line.taskType(), line.specs(),
                        // tier 只在解析折扣时用，而折扣已冻结 —— 这里传什么都不影响结果
                        "free");
                actualCredits += frozenEngine.compute(request, usage, completedAt).credits();
            }
        }

        log.info("结算 jobId={}：预扣 {} 实际 {}（目录 v{}，折扣 {}bp，成功槽 {}，{} 条用量）",
                event.jobId(), reservation.reservedCredits(), actualCredits,
                reservation.catalogVersion(), reservation.discountBp(),
                event.succeededSlots(), event.usage().size());

        credits.settle(event.jobId(), actualCredits);
    }

    /**
     * 用量行必须**真的带了规则的基准维度**，否则拒绝计价。
     *
     * <p>引擎对取不到的维度一律取 0（{@code UsageDim.quantityOf}）——「worker 没上报」与
     * 「这个维度就是 0」在它眼里没有区别。这对 {@code dims} / {@code multipliers} 是正确的
     * （缺了就是不加权、不加价），但**基准维度缺了会被算成「一个单位都没有」**：
     * 一条按秒计费的规则收到只有槽数的用量，会算出 0 → 落到 {@code minCredits}，
     * 用户白用一次，而账面上没有任何一处异常。
     *
     * <p>所以这里把「没报基准维度」变成**拒绝**（抛出去让 MQ 重投 → 死信 → 红灯）：
     * 与 {@code BasePriceResolver} 查不到规格、{@code PricingEngine} 查不到规则同一个立场——
     * 上报与配置对不上时**吵出来**，不要静默按 0 计价。
     * {@code constant:1} 不受此限：它按次计费，语义上不依赖 worker 上报任何东西。
     *
     * @throws IllegalStateException 用量行没带规则的基准维度
     */
    private static void requireBaseUnitReported(FrozenRules frozen,
                                                JobEventPayload.UsageLine line, Usage usage) {
        CompiledRule rule = frozen.lookup(line.modelId(), line.taskType());
        if (rule == null) {
            // 规则缺失由引擎抛 RuleNotFoundException —— 同一个错误不在这里报第二遍
            return;
        }
        if (rule.baseUnit() == UsageDim.CONSTANT_ONE || usage.quantities().containsKey(rule.baseUnit())) {
            return;
        }
        throw new IllegalStateException("用量行缺少基准维度："
                + line.modelId() + "/" + line.taskType() + " 的规则以 " + rule.baseUnit().key()
                // 报**字面键**而不是枚举名：运维要拿这个串去 grep worker 的载荷与目录配置
                + " 为基准，而 worker 只报了 "
                + usage.quantities().keySet().stream().map(UsageDim::key).toList()
                + " —— 按 0 计价会让这次生成变成免费，故拒绝");
    }

    /**
     * 全额返还一个失败的任务。
     *
     * <p>不动 remaining、不新建批次——批次连同有效期原封不动回到可用。
     */
    public void refund(long jobId, String reason) {
        Reservation reservation = reservations.findByJobId(jobId).orElse(null);
        if (reservation == null || !reservation.isPending()) {
            log.info("跳过返还：jobId={} 无待结算预留", jobId);
            return;
        }
        log.info("返还 jobId={}：{} 积分（原因：{}）", jobId, reservation.reservedCredits(), reason);
        credits.refund(jobId, reason);
    }

    /**
     * 还原预扣时那份规则：**只认预留行上的快照**。
     *
     * <p>规则住在模型能力行，billing 读不到那个库（ADR-0114），所以它只在 Hold 时随请求
     * 来一次、被冻进预留行。结算**没有第二条来源**可回落——没有快照就是算不出价。
     *
     * <p>⚠️ 没有快照时抛而不是按预扣额结算：预扣额是**预估的上限**，
     * 拿它当实际额等于「预估即真实」，把估算误差变成真实收费误差
     * （《计费逻辑详细设计》§4.5 计费准确四规则）。抛出去 → MQ 重投 → 死信，
     * 有人看得见，钱也不会少收。
     *
     * @throws CatalogCompiler.CompileException 快照在库里存着却编不过（存进来之后没人改过它，
     *         所以这只可能是数据损坏）——抛出去让 MQ 重投，不要静默按 0 结算
     * @throws IllegalStateException 预留行上没有快照（本次预扣没带，或历史上是别的东西写的）
     */
    private FrozenRules rulesAtHoldTime(Reservation reservation) {
        String snapshotJson = reservation.ruleSnapshot();
        if (snapshotJson == null || snapshotJson.isBlank()) {
            throw new IllegalStateException(
                    "预留行上没有规则快照：jobId=" + reservation.jobId()
                            + "（catalog v" + reservation.catalogVersion() + "）"
                            + " —— 规则住在模型能力行、只在预扣时随请求冻一次，"
                            + "没有快照就无法复现定价，故拒绝结算（不按 0 也不按预扣额蒙）");
        }
        return new FrozenRules(CatalogCompiler.compileRuleSnapshot(snapshotJson));
    }

    /** 用冻结规则与冻结折扣装配引擎；**折扣是常数，不重新解析**（见类注释）。 */
    private static PricingEngine engineAtHoldTime(FrozenRules frozen, Reservation reservation) {
        DiscountResolver frozenDiscount = DiscountResolver.frozen(reservation.discountBp());
        return new PricingEngine(frozen, new MediaPricingCalculator(frozenDiscount));
    }

    /**
     * 本次结算用哪份规则 —— 只有一个来源：预留行上的快照。
     *
     * <p>为什么要有个类型，而不是把那条规则直接传下去：引擎要它
     * （{@link PricingEngine.CatalogLookup}），{@link #requireBaseUnitReported} 也要它
     * （判「用量行带没带基准维度」得先知道基准维度是什么）。两处各解析一遍就会分叉，
     * 而分叉的表现是「按 A 的规则判该不该拒、按 B 的规则算钱」。
     *
     * <p>⚠️ 它对任何 (modelId, taskType) 都返回同一条规则：预留行冻的就是「这个 job 的规则」，
     * 一个 job 一套规则（用量行上报的 {@code modelId/taskType} 是同一个 job 的属性，
     * 逐行同一把键）。
     */
    private record FrozenRules(CompiledRule snapshotRule) implements PricingEngine.CatalogLookup {

        @Override
        public CompiledRule lookup(String modelId, String taskType) {
            return snapshotRule;
        }
    }
}

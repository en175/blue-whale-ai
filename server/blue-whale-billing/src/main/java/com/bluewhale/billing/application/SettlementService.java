package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.catalog.CatalogRepository;
import com.bluewhale.billing.infrastructure.mq.JobEventPayload;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.Reservation;
import com.bluewhale.billing.ledger.ReservationRepository;
import com.bluewhale.billing.pricing.BasePriceResolver;
import com.bluewhale.billing.pricing.DiscountResolver;
import com.bluewhale.billing.pricing.MediaPricingCalculator;
import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.billing.pricing.PricingRequest;
import com.bluewhale.billing.pricing.Usage;
import com.bluewhale.billing.shadow.ShadowEntryRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Objects;

/**
 * 结算与返还（《计费逻辑详细设计》§4.3 / §4.4），由 MQ 事件触发。
 *
 * <h2>为什么结算必须用「冻结的版本 + 冻结的折扣」</h2>
 *
 * 结算发生在预扣之后几分钟到几十分钟，期间运营可能改了价、停了活动。
 * 若按**当前**的目录与折扣重算，就会出现「提交时看到 7 折、结算按原价扣」——
 * 用户认为被多扣了，而系统里没有任何一处记录能证明当时是 7 折。
 *
 * <p>两样东西在预扣时都已冻结在预留行上：
 * <ul>
 *   <li>{@code catalog_version} —— 用哪套计价规则</li>
 *   <li>{@code discount_bp} —— 当时打了多少折</li>
 * </ul>
 * 本类只负责把它们还原出来，**不做任何重新解析**。
 *
 * <h2>actualCredits 从哪来</h2>
 *
 * 事件里带的是 worker 上报的**原始用量**（token / 秒 / 张数），不是积分——
 * 价格是 billing 的事（{@code usage.proto} 的注释）。
 * 所以这里按事件里的用量逐条计价再求和。用量为空时价与预扣相同，
 * 那意味着契约用量就是实际用量（媒介类的常态）。
 */
@Service
public class SettlementService {

    private static final Logger log = LoggerFactory.getLogger(SettlementService.class);

    private final CatalogRepository catalogRepository;
    private final ReservationRepository reservations;
    private final CreditService credits;
    private final PricingEngine pricing;
    private final CatalogHolder catalog;
    private final ShadowEntryRepository shadowRepository;
    private final ObjectMapper json = new ObjectMapper();

    /**
     * @param shadowMode ★ **默认 true**。影子期只算不扣（runbook §3.2）。
     *                   默认值必须是「不扣」：反过来（默认就结算）在切换前部署一次，
     *                   就是每个任务被扣两遍——我们一遍、new-api 一遍。
     *                   切换窗口里显式设成 false 才是权威生效。
     */
    public SettlementService(CatalogRepository catalogRepository,
                             ReservationRepository reservations,
                             CreditService credits,
                             PricingEngine pricing,
                             CatalogHolder catalog,
                             ShadowEntryRepository shadowRepository,
                             @Value("${billing.shadow-mode:true}") boolean shadowMode) {
        this.catalogRepository = catalogRepository;
        this.reservations = reservations;
        this.credits = credits;
        this.pricing = pricing;
        this.catalog = catalog;
        this.shadowRepository = shadowRepository;
        this.shadowMode = shadowMode;
    }

    private final boolean shadowMode;

    /** 当前是否处于影子期（只算不扣）。 */
    public boolean isShadowMode() {
        return shadowMode;
    }

    /**
     * 结算一个已完成的任务。
     *
     * <p>无预留（任务没走过预扣）或预留已终结（重复投递）时是**无操作**，不是错误——
     * MQ 至少一次投递，重复到达是常态。
     *
     * @throws IllegalStateException 目录版本读不回来（数据被删）或计价规则缺失——
     *         **抛出去让 MQ 重投**，不要静默按 0 结算：钱少收比暂时不结算更难发现
     */
    public void settle(JobEventPayload.JobCompleted event) {
        if (shadowMode) {
            // ★ 影子期：算一遍、只记不扣。**这就是切换前敢跑整周的原因**——
            //   它对钱零影响，new-api 那边该扣扣它的，我们这边只攒数据。
            recordShadow(event);
            return;
        }

        Reservation reservation = reservations.findByJobId(event.jobId()).orElse(null);
        if (reservation == null || !reservation.isPending()) {
            log.info("跳过结算：jobId={} 无待结算预留（未预扣，或已被结算/返还）", event.jobId());
            return;
        }

        PricingEngine frozenEngine = engineAtHoldTime(reservation);
        Instant completedAt = Instant.now();

        long actualCredits;
        if (event.usage().isEmpty()) {
            // ⚠️ 事件没带用量 —— 无法重算，按**预扣额**结算（契约用量即实际用量）。
            //
            // 为什么不能让它算成 0：初次实现是把用量逐条累加，没有用量就是 0，
            // 于是每一个媒介类任务都会被**免费结算**。测试 `结算_用量为空时价与预扣相同`
            // 就是钉这条的。
            //
            // 为什么也不做别的猜测：这是唯一一个「不比契约多收、也不比契约少收」的取值。
            //
            // ⚠️ 残留缺口：对 partially_succeeded 而言这条兜底**偏平台**——
            //    worker 只成功了一部分却没报用量时，用户会被按全额结算。
            //    所以打 WARN 让漏报可观测，而不是默默多收。
            actualCredits = reservation.reservedCredits();
            log.warn("结算事件未带用量，按预扣额结算：jobId={} status={} 预扣={} 成功槽={}"
                            + " —— worker 侧可能漏报用量（部分成功时会导致按全额结算）",
                    event.jobId(), event.status(), actualCredits, event.succeededSlots());
        } else {
            actualCredits = 0;
            for (JobEventPayload.UsageLine line : event.usage()) {
                Usage usage = line.toUsage();
                PricingRequest request = new PricingRequest(
                        event.userId(), line.modelId(), line.taskType(), line.specs(),
                        // tier 只在解析折扣时用，而折扣已冻结 —— 这里传什么都不影响结果
                        "free");
                actualCredits += frozenEngine.compute(request, usage, completedAt).credits();
            }
        }

        log.info("结算 jobId={}：预扣 {} 实际 {}（目录 v{}，折扣 {}bp，{} 条用量）",
                event.jobId(), reservation.reservedCredits(), actualCredits,
                reservation.catalogVersion(), reservation.discountBp(), event.usage().size());

        credits.settle(event.jobId(), actualCredits);
    }

    /**
     * 影子期的一条记录（只算不扣）。
     *
     * <p>与 {@link #settle} 的三点不同：
     * <ul>
     *   <li><b>不要求有预留</b>——影子期 worker 直接用统一 key 调上游，根本没走 Hold</li>
     *   <li><b>用当前目录与当前折扣</b>，不用冻结值——影子期问的是「照现在这套规则，
     *       这单该收多少」，正是不扣钱才敢这么问</li>
     *   <li><b>算不出价不抛异常</b>，而是记一行 unpriceable——影子期的漏配清单必须被
     *       完整记录下来，抛出去重投只会让同一批漏配反复进 DLQ</li>
     * </ul>
     */
    private void recordShadow(JobEventPayload.JobCompleted event) {
        int catalogVersion = catalog.currentVersion();

        if (event.usage().isEmpty()) {
            // 没有用量就算不出价（连 model/task 都不知道）。影子期 worker 会上报用量，
            // 空的就是漏报——记下来，别让它悄悄跳过。
            shadowRepository.record(event.jobId(), event.userId(),
                    ShadowEntryRepository.STATUS_UNPRICEABLE, null, catalogVersion, null,
                    null, "[]", "事件未带用量，无法计价");
            log.warn("影子计价跳过：jobId={} 事件未带用量", event.jobId());
            return;
        }

        try {
            long computed = 0;
            for (JobEventPayload.UsageLine line : event.usage()) {
                PricingRequest request = new PricingRequest(
                        event.userId(), line.modelId(), line.taskType(), line.specs(), "free");
                computed += pricing.compute(request, line.toUsage(), Instant.now()).credits();
            }

            Long upstreamCost = event.usage().stream()
                    .map(JobEventPayload.UsageLine::upstreamCostCredits)
                    .filter(Objects::nonNull)
                    .findFirst()
                    .orElse(null);

            shadowRepository.record(event.jobId(), event.userId(),
                    ShadowEntryRepository.STATUS_PRICED, computed, catalogVersion,
                    null, upstreamCost, toJson(event.usage()), "");
        } catch (PricingEngine.RuleNotFoundException | BasePriceResolver.UnpriceableSpecException e) {
            // **成功记录的一种**：影子期跑出来的 unpriceable 就是切换前要修掉的漏配清单
            shadowRepository.record(event.jobId(), event.userId(),
                    ShadowEntryRepository.STATUS_UNPRICEABLE, null, catalogVersion, null,
                    null, toJson(event.usage()), e.getMessage());
            log.warn("影子计价算不出价：jobId={} —— {}", event.jobId(), e.getMessage());
        }
    }

    private String toJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            // 用量都是字符串与整数，序列化不可能失败；真失败说明是致命的编码问题
            throw new IllegalStateException("影子用量快照无法序列化", e);
        }
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
     * 还原预扣时的计价环境：**冻结的目录版本 + 冻结的折扣**。
     *
     * <p>{@code loadVersion} 对 retired 版本**必须仍可读**——这正是「改价不影响已提交任务」
     * 的落点。读不回来说明有人在清历史数据，属于严重问题，必须炸出来。
     */
    private PricingEngine engineAtHoldTime(Reservation reservation) {
        CatalogRepository.LoadedCatalog catalog = catalogRepository.loadVersion(reservation.catalogVersion());
        if (catalog == null) {
            throw new IllegalStateException(
                    "目录版本已不存在：v" + reservation.catalogVersion()
                            + "（jobId=" + reservation.jobId() + "）—— 历史版本被删，无法复现定价");
        }
        // 折扣用冻结系数，不重新解析；解析器在这里就只是一个常数
        DiscountResolver frozen = DiscountResolver.frozen(reservation.discountBp());
        return new PricingEngine(
                (modelId, taskType) -> catalog.index().get(CatalogCompiler.indexKey(modelId, taskType)),
                new MediaPricingCalculator(frozen));
    }
}

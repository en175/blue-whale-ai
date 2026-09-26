package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.ledger.Account;
import com.bluewhale.billing.ledger.CreditLotRepository;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.CreditSource;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.LedgerRepository;
import com.bluewhale.billing.ledger.ReservationRepository;
import com.bluewhale.billing.ledger.TransactionRepository;
import com.bluewhale.billing.pricing.AbstractPricingCalculator;
import com.bluewhale.billing.pricing.CompiledRule;
import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.billing.pricing.PricingRequest;
import com.bluewhale.billing.pricing.PricingResult;
import com.bluewhale.billing.pricing.Usage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;

/**
 * 计费的应用层 —— **传输层唯一该调的东西**。
 *
 * <p>gRPC 适配器与（将来的）管理端 HTTP 接口都调它。放在这一层是因为
 * 「计价 → 预扣」这个组合本身是业务语义，不该在任何一个适配器里各写一遍：
 * 两份就得同步维护，迟早分叉成「gRPC 走的扣费逻辑」与「HTTP 走的扣费逻辑」。
 *
 * <p>本层不含传输概念（没有 proto 类型、没有 HTTP 状态码），也不含持久化细节——
 * 它只说「算价、冻结、查余额」。
 */
@Service
public class BillingApplicationService {

    private static final Logger log = LoggerFactory.getLogger(BillingApplicationService.class);

    /**
     * 临期提醒的时间窗。
     *
     * <p>⚠️ <b>必须严格大于 {@link GrantPolicy#DEFAULT_GIFT_DAYS}</b>，不能相等：
     * 相等时，刚按默认策略发出的那批积分恰好压在窗口边界上——DATETIME 列会把小数秒
     * 四舍五入，而查询用的是执行那一刻的 {@code NOW()}，两者先后不定。
     * 结果就是同一批积分时而出现在「即将过期」里、时而消失。
     * 多留一天，边界就不再落在任何正常发放的批次上。
     */
    private static final int EXPIRING_WINDOW_DAYS = GrantPolicy.DEFAULT_GIFT_DAYS + 1;

    /** 最多提示几条。 */
    private static final int EXPIRING_LIMIT = 5;

    /**
     * 流水分页大小。缺省 20、上限 100——上限是**服务端**定的：
     * {@code PageRequest.page_size} 由调用方说，proto 注释也写了「上限由服务端钳制」。
     * 不钳制的话一次「给我全部」就能把这个读接口变成全表扫描。
     */
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final AbstractPricingCalculator calculator;
    private final CreditService credits;
    private final CreditLotRepository lots;
    private final LedgerRepository ledger;
    private final CatalogHolder catalog;
    private final GrantPolicy grantPolicy;
    private final TransactionRepository transactions;
    private final ReservationRepository reservations;

    public BillingApplicationService(AbstractPricingCalculator calculator,
                                     CreditService credits,
                                     CreditLotRepository lots,
                                     LedgerRepository ledger,
                                     CatalogHolder catalog,
                                     GrantPolicy grantPolicy,
                                     TransactionRepository transactions,
                                     ReservationRepository reservations) {
        this.calculator = calculator;
        this.credits = credits;
        this.lots = lots;
        this.ledger = ledger;
        this.catalog = catalog;
        this.grantPolicy = grantPolicy;
        this.transactions = transactions;
        this.reservations = reservations;
    }

    /**
     * 发放积分（运营 / 系统触发）。
     *
     * <p>有效期由 {@link GrantPolicy} 按来源决定——入口只传「发什么、发多少」。
     * 让每个入口各自决定有效期，就是同一来源在不同入口有不同有效期的开始。
     *
     * @param expiresAt 显式覆盖；null = 按来源的默认策略
     * @return 新建批次的 id
     * @throws org.springframework.dao.DuplicateKeyException 同一 grantKey 已发放过
     */
    public long grant(long userId, CreditSource source, long amount,
                      String bizType, String bizId, String grantKey, Instant expiresAt) {
        Instant effectiveExpiry = expiresAt != null
                ? expiresAt
                : grantPolicy.expiryFor(source, Instant.now());
        return credits.grant(userId, source, amount, effectiveExpiry, bizType, bizId, grantKey);
    }

    /**
     * 预扣：**先计价，再冻结**。
     *
     * <h2>为什么按「契约用量」计价</h2>
     *
     * 提交时刻还没有真实用量（token、实际帧数要等 worker 跑完才上报），能知道的只有
     * **契约用量**——它已经在 job 的规格快照里：张数写在 {@code expected_output_count}、
     * 时长写在 {@code duration}，随 specs 一起送进来（见 {@link Usage#contractFrom}）。
     * 所以这里的价是「按契约应当冻结多少」，不是「最终会花多少」；
     * **结算时按 worker 上报的真实用量重新计价**，差额退回。
     *
     * <p>这正是预扣存在的理由：用上限冻结、按实际扣款。
     *
     * <p>⚠️ 这里曾经传 {@code Usage.empty()}。它对 {@code constant:1}（按次）的规则没问题
     * ——该维度恒为 1，不看用量；但**按槽 / 按秒计价的规则会因此只冻到 {@code minCredits}**：
     * 基准量恒为 0，一路算到下限，而结算侧又把消耗截到预扣额
     * （{@link CreditService#settle}），差额**平台自己吃**，账面上没有任何异常。
     *
     * <h2>契约量取不到时</h2>
     *
     * 有些任务提交时刻**本来就没有**契约量：{@code edit} / {@code prolong} 的
     * {@code duration=-1}（自动时长，真实时长提交时才知道）。这类任务不能因为配了按秒价
     * 就变成 400：规则配了 {@code maxCredits} 时**按上限冻结**（上限正是为「真实量未知」
     * 准备的，结算按实际用量退回差额），没配上限才拒绝。判据与理由见 {@link #priceAtCap}。
     *
     * @throws PricingEngine.RuleNotFoundException 该 (model, taskType) 未配规则——**拒绝提交**
     * @throws com.bluewhale.billing.pricing.BasePriceResolver.UnpriceableSpecException
     *         该规格组合查不到价——同样拒绝（漏配不是免费），**契约量取不到也不豁免这一条**
     * @throws Usage.ContractQuantityUnavailableException 基准维度的契约量取不到、
     *         而规则又没配 {@code maxCredits}——没有上限可依，拒绝而不是冻下限
     * @throws CatalogCompiler.CompileException 请求没带规则快照，或带了却编不过——**拒绝提交**
     *         （规则快照是唯一的规则来源，见 {@link #requireSnapshot}）
     * @throws com.bluewhale.billing.ledger.InsufficientCreditsException 余额不足
     */
    public HoldResult hold(HoldCommand command) {
        PricingRequest request = new PricingRequest(
                command.userId(), command.modelId(), command.taskType(),
                command.specs(), command.tier());

        // ★ 规则只从快照来：计价规则住在模型能力行（billing 读不到那个库），
        //   属主在 Hold 时必须把它随请求送来。没带 = 算不出价 = 拒单。
        CompiledRule snapshot = requireSnapshot(command.ruleSnapshot());
        PricingEngine engine = engineFor(snapshot);

        PricingResult priced = priceAtSubmit(request, engine, snapshot, command.submittedAt());
        int catalogVersion = catalog.currentVersion();

        if (priced.credits() == 0) {
            // 明确配成 0 价的模型（免费额度）——没有钱要冻，也**不建预留**：
            // 建了反而会让结算侧去解冻一笔不存在的钱。漏配走的是上面那个异常，不会到这里。
            log.info("计价为 0，不冻结：user={} {}/{} specs={}",
                    command.userId(), command.modelId(), command.taskType(), command.specs());
            return HoldResult.fresh(0, catalogVersion);
        }

        return credits.hold(command.userId(), command.commandId(), command.jobId(),
                priced.credits(), catalogVersion, priced.discount().factorBp(),
                // 快照随预留一起冻下来：结算按它复现，**不必**再回读任何东西
                command.ruleSnapshot(), command.title());
    }

    /** 当前生效的目录版本；影子对账与价格预览要按它复现。 */
    public int catalogVersion() {
        return catalog.currentVersion();
    }

    /**
     * 计价 —— **只算不扣**（影子模式与价格预览）。
     *
     * <p>与 {@link #hold} 的差别只在「碰不碰钱」：同样进计价引擎、同样算折扣，
     * 但不校验余额、不冻结、不写账本、不建预留。**纯函数式的读取**。
     *
     * <p>⚠️ 刻意复用 {@link #hold} 的计价那一段而不是另写一份：影子模式的全部意义是
     * 「用同一套逻辑算一遍，看它和上游扣的对不对」。若 Quote 走另一条实现，
     * 对上了只能说明两条实现恰好一致，对不上则不知道信谁。
     *
     * <p>用量留空（{@link Usage#empty()}）＝**按契约用量报价**，与 {@link #hold} 走
     * 同一份 {@link #priceAtSubmit}（含「契约量取不到按上限」的兜底）。这一条是硬的：
     * 预览价与实扣价一旦分叉，用户看到的就是「预览一个价、实扣另一个价」。
     *
     * @throws PricingEngine.RuleNotFoundException 该组合未配规则——影子期这条异常
     *         就是**切换前要修掉的漏配清单**
     */
    public PricingResult quote(QuoteQuery query) {
        PricingRequest request = new PricingRequest(
                query.userId(), query.modelId(), query.taskType(), query.specs(), query.tier());
        // 与 hold 同一个规则来源：都只认快照——预览与实扣取到不同规则，
        // 用户看到的就是「预览一个价、实扣另一个价」
        CompiledRule snapshot = requireSnapshot(query.ruleSnapshot());
        PricingEngine engine = engineFor(snapshot);
        // 带了用量（结算 / 影子对账）就按真实用量算，不替它补契约量。
        if (!query.usage().quantities().isEmpty()) {
            return engine.compute(request, query.usage(), query.pricedAt());
        }
        // 留空 = 调用方还没有用量（提交前预览）：契约用量是此刻唯一已知的量。
        return priceAtSubmit(request, engine, snapshot, query.pricedAt());
    }

    /**
     * 取请求带来的规则快照并编译；**空快照直接拒**。
     *
     * <p>★ 快照是规则的**唯一**来源。计价规则按模型归属，住在模型能力行
     * （backend 的 {@code generation_model_capability.pricing}），而 billing 读不到那个库
     * （ADR-0114 不共享库）——所以属主在 Hold / Quote 时把规则随请求送来，
     * 预扣时冻进预留行、结算按它复现。没有快照 = 这次交易**算不出价**，只能拒。
     *
     * <p>⚠️ 拒绝（而不是「回落到某个缓存/默认值」）是刻意的：
     * <ul>
     *   <li>带上了却编不过，是「能力行里这条规则已经坏了」——放过去等于让这次按另一份价
     *       静默成交：钱照扣，谁都看不出用的不是能力行里那条规则。</li>
     *   <li>压根没带，是调用方漏了（billing 侧没有任何可回落的地方）——
     *       拒单会在调用方那一侧当场变成 UNPRICEABLE，比默认一个价强。</li>
     * </ul>
     * 写侧闸门（backend 保存能力行时校验）拦的是「脏配置存不进去」，
     * 这里拦的是「脏配置已经在库里了」——两者拦的不是同一件事，都要在。
     *
     * <p>两种拒绝都抛 {@link CatalogCompiler.CompileException}：gRPC 层把它映射成
     * INVALID_ARGUMENT / UNPRICEABLE，调用方据此 fail closed。
     */
    private static CompiledRule requireSnapshot(String ruleSnapshot) {
        if (ruleSnapshot == null || ruleSnapshot.isBlank()) {
            throw new CatalogCompiler.CompileException(
                    "缺少规则快照（rule_snapshot）：计价规则住在模型能力行里，"
                            + "billing 读不到那个库，没有快照就算不出价 —— 拒绝，不回落");
        }
        return CatalogCompiler.compileRuleSnapshot(ruleSnapshot);
    }

    /**
     * 装配本次计价的引擎：规则只认快照那一条。
     *
     * <p>⚠️ 算法（{@link AbstractPricingCalculator}）是**注入的同一个实例**，不另造——
     * 影子对账（拿 Quote 的结果比对上游实际扣费）要成立，报价与实扣就必须按同一套算法算。
     *
     * <p>快照那条 lookup 忽略 (modelId, taskType)：一次 Hold / Quote 只问一个 (model,
     * taskType)，而快照**就是**那一条规则的规则体——它没有携带自己的键
     * （形态与能力行的 {@code pricing} 列逐字相同，键在能力行上）。
     * 多行用量的 Quote 由调用方逐行筛过快照（见 {@code BillingGrpcService#quote}）。
     */
    private PricingEngine engineFor(CompiledRule snapshot) {
        return new PricingEngine((modelId, taskType) -> snapshot, calculator);
    }

    /**
     * 提交 / 预览时刻的价 —— **契约用量**；契约量取不到时按规则上限兜底。
     *
     * <p>{@link #hold} 与 {@link #quote} 共用这一段 —— 计价口径只写一份，两个入口就不会分叉。
     *
     * <p>规则缺失时不在这里报错：那是 {@link PricingEngine} 的职责
     * （抛 {@code RuleNotFoundException}），同一个错误不报第二遍。
     *
     * @param rule 本次请求带来的规则快照（已编译，**必非空**）。
     *             <p>⚠️ 这里与 {@code engine} 必须取到**同一条**规则：{@code rule}
     *             负责推契约量（基准维度是谁、token 怎么估），{@code engine} 负责按它算钱。
     *             两者错位就是「按 A 的契约量冻钱、按 B 的单价算」。
     */
    private PricingResult priceAtSubmit(PricingRequest request, PricingEngine engine,
                                        CompiledRule rule, Instant at) {
        try {
            return engine.compute(request, Usage.contractFrom(rule, request.specs()), at);
        } catch (Usage.ContractQuantityUnavailableException e) {
            if (e.baseUnit().contractSource() == null || rule.maxCredits() == null) {
                // ① 该维度**压根没有**契约量来源（如 TTS 的字符数）：那是结构性的推不出，
                //    不是这次传参的问题——冻上限只会掩盖它。
                // ② 规则没配上限：没有上限可依，冻下限就是静默少收。
                // 两条都照原样拒绝（见 Usage#contractFrom 的立场）。
                throw e;
            }
            return priceAtCap(request, engine, e, at);
        }
    }

    /**
     * 契约量取不到时的兜底：**按规则上限冻结**。
     *
     * <p>只对「本该推得出、只是这次的值不可用」开这个口子——判据是那个维度**登记了**
     * 契约量来源（{@code contractSource} 非 null）。典型情形是 {@code duration=-1}：
     * {@code edit} / {@code prolong} 的自动时长，真实时长提交时未知。这类任务今天能提交，
     * 不该因为配了按秒价就变成 400。上限正是为这种情形准备的——**用上限冻结、按实际扣款**：
     * 结算按 worker 上报的真实用量重算，多冻的退回。
     *
     * <p>⚠️ 只开这一个口子，别的推不出照原样拒绝：规格组合查不到价、未配规则都不在这里兜
     * （见 {@link #priceAtSubmit} 与 {@link PricingEngine#computeAtCap}）。
     *
     * <h2>这里为什么是 INFO 而不是 WARN</h2>
     *
     * <p><b>能走到这一行走的是「已配上限」的规则</b> —— 从 {@link #priceAtSubmit} 的判据
     * （{@code contractSource != null && maxCredits != null}）就能读出来。也就是说：
     * 运营**已经**就这个模型做过一次明确的决定（「这个量提交时取不到，那就冻上限、按实际收」）。
     * 把它打成 WARN，等于对一件**已经被批准的事**反复报警。
     *
     * <p>这条口径是音频按秒计价上线后才看清的（2026-09-26）：音频的时长**结构性**地取不到
     * （TTS 由文案决定，请求里没有 duration），于是**每一条**音频单都会走到这里。
     * 一天几千条 WARN 的效果不是「运营注意到异常」，而是**所有人学会忽略 WARN**——
     * 那会让真正该看的告警一起被忽略。日志级别的成本从来不是磁盘，是注意力。
     *
     * <p>真正该报警的是**另一件事**，而它已经是硬失败：没配上限的规则在这条路径上
     * 直接抛 {@code ContractQuantityUnavailableException}（提交被拒 + 4xx），
     * 不需要日志帮忙。所以这里只留 INFO + 完整上下文（模型 / 任务 / 基准维度 / 规格 / 冻了多少），
     * 排查时 grep 得到，平时不吵。
     *
     * <p>⚠️ 若将来出现「**不该走上限冻结的模型**也走到了这里」（例如某条按量规则本该读得到契约量，
     * 却因为上游少传一个字段而落到这里），那说明契约量的来源边界破了 —— 那时应当按
     * {@code baseUnit} 或按其来源**分档**报警，而不是把这条整体升回 WARN：
     * 音频这个常态会把信号再次淹掉。
     */
    private PricingResult priceAtCap(PricingRequest request, PricingEngine engine,
                                     Usage.ContractQuantityUnavailableException cause, Instant at) {
        PricingResult priced = engine.computeAtCap(request, at);
        log.info("契约用量取不到，改按规则上限冻结：{}/{} 的基准维度 {} 在本次规格里取不到"
                        + "（specs={}）→ 冻结上限 {} 积分。"
                        + "按实际上报用量结算、多冻的退回；未配上限的模型在这条路径上会直接拒绝提交",
                request.modelId(), request.taskType(), cause.baseUnit().key(),
                request.specs(), priced.credits());
        return priced;
    }

    /**
     * 余额、欠费与临期批次 —— **用户面与管理面共用的唯一取数处**。
     *
     * <p>哪些字段投影到哪个契约由适配器决定：{@code receivableCredits} 只进管理面
     * （用户面永远只出现一个金额，见 {@link BalanceView}）。
     */
    public BalanceView balance(long userId) {
        // 冻结总额取自账本账户，而不是再扫一遍批次表：
        // 账本本来就是「冻结了多少」的权威记录，多一处聚合就多一处可能对不上的地方。
        long frozen = ledger.balanceOf(userId, Account.FROZEN);

        // 欠费额同样取自账本，**不**去 SUM 预留行的 receivable_credits 列。
        // 理由是同一件事的另一面：预扣/结算/返还全部经过账本，账本才是权威；
        // 预留行那一列是给「按 job 追溯这笔怎么欠的」用的（见 V9 迁移），
        // 拿它聚合等于把一份派生数据当账根。
        //
        // ⚠️ 符号约定：RECEIVABLE 的自然方向是**借**（Account.normalDebit=true），
        // 超扣走的正是借方，所以这里读出来就是**正数 = 该用户欠多少**，不取绝对值。
        // 反过来取 abs 会把「贷方余额」（多收/已收）也变成正数，两件相反的事叠成一个数。
        long receivable = ledger.balanceOf(userId, Account.RECEIVABLE);

        var expiring = lots.listExpiring(userId, EXPIRING_WINDOW_DAYS, EXPIRING_LIMIT).stream()
                .map(lot -> new BalanceView.ExpiringLot(
                        lot.available(), lot.expiresAt(), lot.source().key()))
                .toList();
        return new BalanceView(lots.availableCredits(userId), frozen, receivable, expiring);
    }

    /**
     * 用户可见流水（**一个业务动作一行**，见 {@link TransactionView}）。
     *
     * <p>只做两件应用层的事，其余在持久化层：
     * <ol>
     *   <li><b>钳制页大小</b>——{@code page_size} 缺省 20、上限 100（服务端口径，
     *       proto 注释写明「上限由服务端钳制」）</li>
     *   <li><b>校验类型过滤</b>——未知类型当场拒绝。放它过去会返回空列表，
     *       而空列表与「真的没有」长得一模一样，调用方查的是 {@code "recharg"} 也发现不了</li>
     * </ol>
     *
     * @param userId     非空 = 只看该用户（用户面，{@code ListTransactions}）；{@code null} = 全站
     *                   （**管理面**，{@code BillingAdminService.AdminListTransactions}）
     * @param typeFilter 空串/null = 全部；否则必须是 {@link TransactionType} 的合法值
     * @param pageToken  上一页给的游标；空串/null = 首页
     * @throws IllegalArgumentException 类型过滤非法或游标损坏（gRPC 映射成 INVALID_ARGUMENT）
     */
    public TransactionView.Page listTransactions(Long userId, String typeFilter,
                                                 int pageSize, String pageToken) {
        String filter = typeFilter == null ? "" : typeFilter.trim();
        if (!filter.isEmpty()) {
            // 校验并归一：of() 抛异常即未知类型（gRPC 映射成 INVALID_ARGUMENT）
            filter = TransactionType.of(filter).key();
        }
        int size = pageSize <= 0 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE);
        return transactions.listPage(userId, filter, size, pageToken == null ? "" : pageToken);
    }

    /**
     * 区间内**已结算**的实际消耗积分合计（管理端仪表盘的「总使用积分」）。
     *
     * <p>为什么另开一个聚合，而不是让调用方翻 {@link #listTransactions} 自己累加：
     * 那条是游标分页、**没有总数**，累加就得把整个区间一页页拉完；更要命的是它**会静默算错**
     * ——翻到一半失败，前面几页已经加进去了，得到的「总消耗」偏小，而偏小的总数与真实
     * 总数在界面上长得一模一样。聚合在一条 SQL 里要么全对、要么报错。
     *
     * <p>只算 {@code settled} 的预留：{@code held} 的钱还冻着、{@code released} 的钱原样
     * 退回，两者都不是消耗。
     *
     * @param from 区间起点（含）
     * @param to   区间终点（**不含**）——半开区间，理由见 {@code CostReservationMapper}
     * @throws IllegalArgumentException 任一端为空、或起点不早于终点（反向区间求和得到 0，
     *         与「这段时间真的没有消耗」长得一模一样）
     */
    public long consumedCredits(Instant from, Instant to) {
        if (from == null || to == null) {
            throw new IllegalArgumentException("统计区间必须同时给出 from 与 to");
        }
        if (!from.isBefore(to)) {
            throw new IllegalArgumentException(
                    "统计区间的起点必须早于终点：from=" + from + " to=" + to);
        }
        // 瞬时 → 库内北京墙钟只走 DbTime 一处；与写入侧同一口径，比较才有意义
        return reservations.sumSettledActualCredits(DbTime.toDb(from), DbTime.toDb(to));
    }
}

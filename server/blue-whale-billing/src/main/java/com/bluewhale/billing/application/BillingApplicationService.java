package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.ledger.Account;
import com.bluewhale.billing.ledger.CreditLotRepository;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.CreditSource;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.LedgerRepository;
import com.bluewhale.billing.ledger.TransactionRepository;
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

    private final PricingEngine pricing;
    private final CreditService credits;
    private final CreditLotRepository lots;
    private final LedgerRepository ledger;
    private final CatalogHolder catalog;
    private final GrantPolicy grantPolicy;
    private final TransactionRepository transactions;

    public BillingApplicationService(PricingEngine pricing,
                                     CreditService credits,
                                     CreditLotRepository lots,
                                     LedgerRepository ledger,
                                     CatalogHolder catalog,
                                     GrantPolicy grantPolicy,
                                     TransactionRepository transactions) {
        this.pricing = pricing;
        this.credits = credits;
        this.lots = lots;
        this.ledger = ledger;
        this.catalog = catalog;
        this.grantPolicy = grantPolicy;
        this.transactions = transactions;
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
     * <h2>为什么用 {@code Usage.empty()} 计价</h2>
     *
     * 提交时刻只知道**契约用量**（时长、分辨率、张数——它们写在 specs 里，
     * 由定价规则的规格表取基准单价），真实用量（token、实际帧数）要等 worker 跑完才上报。
     * 所以这里的价是「按契约应当冻结多少」，不是「最终会花多少」；
     * **结算时按 worker 上报的真实用量重新计价**，差额退回。
     *
     * <p>这正是预扣存在的理由：用上限冻结、按实际扣款。
     *
     * @throws PricingEngine.RuleNotFoundException 该 (model, taskType) 未配规则——**拒绝提交**
     * @throws com.bluewhale.billing.pricing.BasePriceResolver.UnpriceableSpecException
     *         该规格组合查不到价——同样拒绝（漏配不是免费）
     * @throws com.bluewhale.billing.ledger.InsufficientCreditsException 余额不足
     */
    public HoldResult hold(HoldCommand command) {
        PricingRequest request = new PricingRequest(
                command.userId(), command.modelId(), command.taskType(),
                command.specs(), command.tier());

        PricingResult priced = pricing.compute(request, Usage.empty(), command.submittedAt());
        int catalogVersion = catalog.currentVersion();

        if (priced.credits() == 0) {
            // 明确配成 0 价的模型（免费额度）——没有钱要冻，也**不建预留**：
            // 建了反而会让结算侧去解冻一笔不存在的钱。漏配走的是上面两个异常，不会到这里。
            log.info("计价为 0，不冻结：user={} {}/{} specs={}",
                    command.userId(), command.modelId(), command.taskType(), command.specs());
            return HoldResult.fresh(0, catalogVersion);
        }

        return credits.hold(command.userId(), command.commandId(), command.jobId(),
                priced.credits(), catalogVersion, priced.discount().factorBp(), command.title());
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
     * @throws PricingEngine.RuleNotFoundException 该组合未配规则——影子期这条异常
     *         就是**切换前要修掉的漏配清单**
     */
    public PricingResult quote(QuoteQuery query) {
        PricingRequest request = new PricingRequest(
                query.userId(), query.modelId(), query.taskType(), query.specs(), query.tier());
        return pricing.compute(request, query.usage(), query.pricedAt());
    }

    /** 余额与临期批次（用户可见）。 */
    public BalanceView balance(long userId) {
        // 冻结总额取自账本账户，而不是再扫一遍批次表：
        // 账本本来就是「冻结了多少」的权威记录，多一处聚合就多一处可能对不上的地方。
        long frozen = ledger.balanceOf(userId, Account.FROZEN);
        var expiring = lots.listExpiring(userId, EXPIRING_WINDOW_DAYS, EXPIRING_LIMIT).stream()
                .map(lot -> new BalanceView.ExpiringLot(
                        lot.available(), lot.expiresAt(), lot.source().key()))
                .toList();
        return new BalanceView(lots.availableCredits(userId), frozen, expiring);
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
     * @param typeFilter 空串/null = 全部；否则必须是 {@link TransactionType} 的合法值
     * @param pageToken  上一页给的游标；空串/null = 首页
     * @throws IllegalArgumentException 类型过滤非法或游标损坏（gRPC 映射成 INVALID_ARGUMENT）
     */
    public TransactionView.Page listTransactions(long userId, String typeFilter,
                                                 int pageSize, String pageToken) {
        String filter = typeFilter == null ? "" : typeFilter.trim();
        if (!filter.isEmpty()) {
            // 校验并归一：of() 抛异常即未知类型（gRPC 映射成 INVALID_ARGUMENT）
            filter = TransactionType.of(filter).key();
        }
        int size = pageSize <= 0 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE);
        return transactions.listPage(userId, filter, size, pageToken == null ? "" : pageToken);
    }
}

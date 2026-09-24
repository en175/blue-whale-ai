package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.ledger.Account;
import com.bluewhale.billing.ledger.CreditLotRepository;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.LedgerRepository;
import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.billing.pricing.PricingRequest;
import com.bluewhale.billing.pricing.PricingResult;
import com.bluewhale.billing.pricing.Usage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

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

    /** 临期提醒的时间窗。太短用户来不及用，太长就成了天天见的噪音。 */
    private static final int EXPIRING_WINDOW_DAYS = 30;
    /** 最多提示几条。 */
    private static final int EXPIRING_LIMIT = 5;

    private final PricingEngine pricing;
    private final CreditService credits;
    private final CreditLotRepository lots;
    private final LedgerRepository ledger;
    private final CatalogHolder catalog;

    public BillingApplicationService(PricingEngine pricing,
                                     CreditService credits,
                                     CreditLotRepository lots,
                                     LedgerRepository ledger,
                                     CatalogHolder catalog) {
        this.pricing = pricing;
        this.credits = credits;
        this.lots = lots;
        this.ledger = ledger;
        this.catalog = catalog;
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
                priced.credits(), catalogVersion);
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
}

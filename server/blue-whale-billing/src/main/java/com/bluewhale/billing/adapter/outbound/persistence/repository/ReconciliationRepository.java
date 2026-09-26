package com.bluewhale.billing.adapter.outbound.persistence.repository;

import com.bluewhale.billing.adapter.outbound.persistence.mapper.ReconciliationMapper;
import com.bluewhale.billing.adapter.outbound.persistence.row.UserImbalanceRow;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 对账查询的搬运层（映射行 ⇄ 领域记录）。
 *
 * <h2>为什么这一层不并进 CreditLotRepository / LedgerRepository</h2>
 *
 * 它下面的查询横跨 {@code billing_credit_lots}（批次，余额的唯一权威）与
 * {@code billing_ledger_entries}（复式账本）——**两张分属不同仓库的表**。
 * 并进任一侧，都会让那一侧的读者以为「对账是我的职责」，而下一次改表结构的人
 * 只会翻自己那个仓库。见 {@link ReconciliationMapper} 的类注释。
 *
 * <p>本层只做行 → 记录的转换与差额计算，不判断「平不平」：判定属于
 * {@link com.bluewhale.billing.application.LedgerSelfCheck}（它才需要决定报什么、报成什么级别）。
 */
@Repository
public class ReconciliationRepository {

    private final ReconciliationMapper mapper;

    public ReconciliationRepository(ReconciliationMapper mapper) {
        this.mapper = mapper;
    }

    /** 全库两侧的合计（自检的判定依据）。 */
    public GlobalTotals globalTotals() {
        return new GlobalTotals(mapper.sumLotsRemaining(), mapper.sumLedgerBalance());
    }

    /** 按用户不平的清单，差额大的在前（最多 {@code limit} 条）。 */
    public List<UserImbalance> imbalancedUsers(int limit) {
        return mapper.imbalancedUsers(limit).stream()
                .map(ReconciliationRepository::toImbalance)
                .toList();
    }

    private static UserImbalance toImbalance(UserImbalanceRow row) {
        return new UserImbalance(row.getUserId(), row.getLotsRemaining(), row.getLedgerTotal());
    }

    /**
     * 全库两侧合计。
     *
     * @param lotsRemaining Σ 批次 remaining（**含已过期未核销**——见 Mapper 注释：
     *                      过期只是被查询条件排除，账本侧同样没减，两边口径对齐）
     * @param ledgerTotal   Σ 各用户 wallet + frozen 的最近余额快照
     */
    public record GlobalTotals(long lotsRemaining, long ledgerTotal) {

        /** 批次侧 − 账本侧。正数 = 批次多了（或账本少记），负数反之。 */
        public long diff() {
            return lotsRemaining - ledgerTotal;
        }

        public boolean balanced() {
            return diff() == 0;
        }
    }

    /** 某个用户的「批次总量 ≠ 账本余额」。 */
    public record UserImbalance(long userId, long lotsRemaining, long ledgerTotal) {

        public long diff() {
            return lotsRemaining - ledgerTotal;
        }
    }
}

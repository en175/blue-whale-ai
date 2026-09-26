package com.bluewhale.billing.adapter.outbound.persistence.row;

/**
 * 账本自检里「按用户不平」的读模型行（{@link com.bluewhale.billing.adapter.outbound.persistence.mapper.ReconciliationMapper#imbalancedUsers} 的返回）。
 *
 * <p>两列分别来自**两张归不同仓库管的表**：{@code lotsRemaining} 是批次侧
 * （余额的唯一权威），{@code ledgerTotal} 是账本侧。把它们折进一行，
 * 是为了让调用方直接看到差额，而不是自己拼两边。
 */
public class UserImbalanceRow {

    private Long userId;

    /** 该用户 Σ {@code billing_credit_lots.remaining}（含已过期未核销）。 */
    private Long lotsRemaining;

    /** 该用户账本侧 wallet + frozen 的最近余额快照之和。 */
    private Long ledgerTotal;

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getLotsRemaining() { return lotsRemaining; }
    public void setLotsRemaining(Long lotsRemaining) { this.lotsRemaining = lotsRemaining; }
    public Long getLedgerTotal() { return ledgerTotal; }
    public void setLedgerTotal(Long ledgerTotal) { this.ledgerTotal = ledgerTotal; }
}

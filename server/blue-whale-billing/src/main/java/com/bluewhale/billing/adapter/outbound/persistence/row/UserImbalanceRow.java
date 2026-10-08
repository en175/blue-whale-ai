package com.bluewhale.billing.adapter.outbound.persistence.row;

public class UserImbalanceRow {

    private Long userId;

    private Long lotsRemaining;

    private Long ledgerTotal;

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getLotsRemaining() { return lotsRemaining; }
    public void setLotsRemaining(Long lotsRemaining) { this.lotsRemaining = lotsRemaining; }
    public Long getLedgerTotal() { return ledgerTotal; }
    public void setLedgerTotal(Long ledgerTotal) { this.ledgerTotal = ledgerTotal; }
}

package com.bluewhale.billing.domain.ledger;

public enum Account {

    WALLET("wallet", false),

    REVENUE("revenue", false),

    COST("cost", true);

    private final String key;
    private final boolean normalDebit;

    Account(String key, boolean normalDebit) {
        this.key = key;
        this.normalDebit = normalDebit;
    }

    public String key() {
        return key;
    }

    public boolean normalDebit() {
        return normalDebit;
    }

    public long balanceDelta(LedgerEntry.Direction direction, long amount) {
        boolean isDebit = direction == LedgerEntry.Direction.DEBIT;
        return isDebit == normalDebit ? amount : -amount;
    }

    public static Account of(String key) {
        for (Account account : values()) {
            if (account.key.equals(key)) {
                return account;
            }
        }
        throw new IllegalArgumentException("未知的会计科目：" + key);
    }
}

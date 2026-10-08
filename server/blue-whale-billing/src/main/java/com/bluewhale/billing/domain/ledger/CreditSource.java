package com.bluewhale.billing.domain.ledger;

public enum CreditSource {

    COMPENSATION("compensation", 10),

    BONUS("bonus", 20),

    GIFT("gift", 30),

    DAILY("daily", 40),

    INVITE("invite", 50),

    REGISTER("register", 50),

    REDEEM("redeem", 60),

    SUBSCRIPTION("subscription", 70),

    PURCHASED("purchased", 80);

    private final String key;
    private final int priority;

    CreditSource(String key, int priority) {
        this.key = key;
        this.priority = priority;
    }

    public String key() {
        return key;
    }

    public int priority() {
        return priority;
    }

    public Account consumptionAccount() {
        return this == PURCHASED ? Account.REVENUE : Account.COST;
    }

    public static CreditSource of(String key) {
        for (CreditSource source : values()) {
            if (source.key.equals(key)) {
                return source;
            }
        }
        throw new IllegalArgumentException("未知的积分来源：" + key);
    }
}

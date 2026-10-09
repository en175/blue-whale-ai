package com.bluewhale.billing.domain.ledger;

public enum BizType {

    HOLD("hold"),

    SETTLE("settle"),

    REFUND("refund"),

    RECHARGE("recharge"),

    GRANT("grant"),

    EXPIRE("expire"),

    ADJUST("adjust");

    private final String key;

    BizType(String key) {
        this.key = key;
    }

    public String key() {
        return key;
    }

    public static BizType of(String key) {
        for (BizType type : values()) {
            if (type.key.equals(key)) {
                return type;
            }
        }
        throw new IllegalArgumentException("未知的业务类型：" + key);
    }
}

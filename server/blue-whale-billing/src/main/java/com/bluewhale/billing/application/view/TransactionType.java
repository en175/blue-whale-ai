package com.bluewhale.billing.application.view;

public enum TransactionType {

    CONSUME("consume"),

    RECHARGE("recharge"),

    BONUS("bonus"),

    DAILY("daily"),

    INVITE("invite"),

    REDEEM("redeem"),

    SUBSCRIPTION("subscription"),

    GIFT("gift"),

    COMPENSATION("compensation"),

    REFUND("refund"),

    EXPIRE("expire");

    private final String key;

    TransactionType(String key) {
        this.key = key;
    }

    public String key() {
        return key;
    }

    public static TransactionType of(String key) {
        for (TransactionType type : values()) {
            if (type.key.equals(key)) {
                return type;
            }
        }
        throw new IllegalArgumentException(
                "未知的流水类型：" + key + "（合法值：" + legalKeys() + "，空 = 全部）");
    }

    public static String legalKeys() {
        StringBuilder keys = new StringBuilder();
        for (TransactionType type : values()) {
            if (keys.length() > 0) {
                keys.append(" | ");
            }
            keys.append(type.key);
        }
        return keys.toString();
    }
}

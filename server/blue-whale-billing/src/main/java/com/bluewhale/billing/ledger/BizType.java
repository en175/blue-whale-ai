package com.bluewhale.billing.ledger;

/**
 * 账本分录的业务类型（《计费逻辑详细设计》§2.2 / §3）。
 *
 * <p>它同时是 {@code billing_ledger_entries.biz_type} 的取值域与 {@code idx_ledger__biz}
 * 的查询键。**用枚举而不是裸字符串**：拼错一个字母不会报错，只会让按 biz 查账时少几行，
 * 而「少几行」在对账场景里看起来就像「本来就没有」。
 */
public enum BizType {

    /** 提交预扣。 */
    HOLD("hold"),

    /** 结算。 */
    SETTLE("settle"),

    /** 返还（任务失败全额退）。 */
    REFUND("refund"),

    /** 充值到账。 */
    RECHARGE("recharge"),

    /** 各类发放（注册 / 每日 / 邀请 / 兑换 / 会员 / 补偿）。 */
    GRANT("grant"),

    /** 批次过期核销。 */
    EXPIRE("expire"),

    /** 人工调账。 */
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

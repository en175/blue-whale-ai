package com.bluewhale.billing.ledger;

/**
 * 积分来源（《计费逻辑详细设计》§2.1.1 / §7.2）。
 *
 * <p>它同时决定三件事：
 * <ol>
 *   <li><b>扣减优先级</b>——同到期时间时先扣哪个（{@link #priority}）</li>
 *   <li><b>财报口径</b>——被消耗时计收入还是成本（{@link #revenueAccount()}）</li>
 *   <li><b>默认有效期</b>——由发放方在插入批次时决定，不在本枚举里</li>
 * </ol>
 */
public enum CreditSource {

    /** 事故补偿。**最先扣**——平台欠用户的，越早还清越好。 */
    COMPENSATION("compensation", 10),

    /** 充值赠送。与 purchased 拆开：有效期不同、**退款只退本金**。 */
    BONUS("bonus", 20),

    /** 运营赠送。区别于 bonus（充值附带）——这是纯营销动作。 */
    GIFT("gift", 30),

    /** 每日登录赠送。当日 23:59:59 过期，天然最先到期。 */
    DAILY("daily", 40),

    /** 邀请奖励。 */
    INVITE("invite", 50),

    /** 注册赠送。与 invite 同档——都是拉新成本。 */
    REGISTER("register", 50),

    /** 兑换码。 */
    REDEEM("redeem", 60),

    /** 会员周期赠送。 */
    SUBSCRIPTION("subscription", 70),

    /** ★ 充值本金。**最后扣**——用户自己花钱买的，保住它的价值。 */
    PURCHASED("purchased", 80);

    private final String key;
    private final int priority;

    CreditSource(String key, int priority) {
        this.key = key;
        this.priority = priority;
    }

    /** 落库字面值。 */
    public String key() {
        return key;
    }

    /**
     * 扣减优先级，**数值小者先扣**。
     *
     * <p>语义：**先消耗平台赠送的，后消耗用户付费的。**
     *
     * <p>注意这只是三级 tie-break 的**第二级**——第一级永远是 {@code expires_at ASC}。
     * 在「赠送有期、购买永久」的常规配置下，第一级已经自动实现了「先花送的」；
     * 本优先级只处理有效期相同（尤其都是永久）时的退化情况，**必须显式定，不能靠默认顺序**。
     */
    public int priority() {
        return priority;
    }

    /**
     * 本来源的积分**被消耗时**记入哪个科目。
     *
     * <p>付费积分消耗 = 收入确认；赠送积分消耗 = 成本确认。
     * 结算时**按批次来源逐笔判定**，不能整单一个科目。
     */
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

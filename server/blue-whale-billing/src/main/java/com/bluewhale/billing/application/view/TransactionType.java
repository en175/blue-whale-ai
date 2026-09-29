package com.bluewhale.billing.application.view;

/**
 * {@code UserTransaction.type} 的取值域（契约见 {@code contracts/proto/billing/v1/billing.proto}）。
 *
 * <p>它是 proto 里一串**字面量**的 Java 镜像——proto 没有定义 enum，只写了注释。
 * 之所以还要一个枚举：{@code type_filter} 是客户端传进来的字符串，
 * 用它校验才拦得住「拼错一个字母」。
 *
 * <p>⚠️ 直接拿未知类型去查会**返回空列表**——不报错的错答案：
 * 调用方以为「这个用户没有充值记录」，而真相是它查的是 {@code "recharg"}。
 * 所以未知类型一律 {@link IllegalArgumentException}（gRPC 映射成 INVALID_ARGUMENT），
 * 与 {@code BizType} 不用裸字符串是同一个理由。
 *
 * <p>各值从哪来见 {@code TransactionRepository}：发放类由批次 {@code source} 映射，
 * 消费由预留投影，其余由账本凭证映射。
 */
public enum TransactionType {

    /** 生成消费（job 结算后定下的最终值）。 */
    CONSUME("consume"),

    /** 充值到账（{@code CreditSource.PURCHASED}）。 */
    RECHARGE("recharge"),

    /** 充值赠送（{@code CreditSource.BONUS}）。 */
    BONUS("bonus"),

    /** 每日登录赠送。 */
    DAILY("daily"),

    /** 邀请奖励。 */
    INVITE("invite"),

    /** 兑换码。 */
    REDEEM("redeem"),

    /** 会员周期赠送。 */
    SUBSCRIPTION("subscription"),

    /** 运营赠送。 */
    GIFT("gift"),

    /** 补偿（含人工调账）。 */
    COMPENSATION("compensation"),

    /**
     * 退款。
     *
     * <p>⚠️ 目前**没有产生者**：任务退回是那条 consume 行的「结算到 0」，不是另一种类型
     * （见 {@code TransactionMapper.xml} 的 ② 段）。这个词留着是因为它在契约里合法
     * ——运营端传 {@code type=refund} 应当得到一张空页，而不是 INVALID_ARGUMENT；
     * 将来充值退款一类的反向资金动作投影进用户流水时也用它。
     */
    REFUND("refund"),

    /** 批次过期核销。 */
    EXPIRE("expire");

    private final String key;

    TransactionType(String key) {
        this.key = key;
    }

    /** 落 proto 字段的字面值。 */
    public String key() {
        return key;
    }

    /**
     * @throws IllegalArgumentException 不是合法类型——**刻意不静默当成「没有」**：
     *         过滤条件写错时，空列表与「真的没有」长得一模一样
     */
    public static TransactionType of(String key) {
        for (TransactionType type : values()) {
            if (type.key.equals(key)) {
                return type;
            }
        }
        throw new IllegalArgumentException(
                "未知的流水类型：" + key + "（合法值：" + legalKeys() + "，空 = 全部）");
    }

    /** 合法值列表，用于错误信息（gRPC 的 INVALID_ARGUMENT 描述里会带上它）。 */
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

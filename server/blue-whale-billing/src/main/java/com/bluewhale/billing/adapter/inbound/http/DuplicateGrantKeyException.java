package com.bluewhale.billing.adapter.inbound.http;

/**
 * 发放时幂等键撞车，**且已知既有那一笔的归属**。
 *
 * <p>为什么要单独一个异常而不是复用 {@link org.springframework.dao.DuplicateKeyException}：
 * 那个异常只带上「撞了」，而调用方常常需要区分两件相反的事——
 *
 * <ul>
 *   <li><b>我自己之前发过</b>：重投/重放，业务上「已经做过了」，是好结果；</li>
 *   <li><b>别人先占了这个键</b>：这一次不该发，是另一回事。</li>
 * </ul>
 *
 * <p>两者在 wire 上都是 409，靠状态码分不出来；差别只在「这个键归谁」。
 * 所以把既有批次的 {@code biz_id}（即发起方自己的业务主键）带回去，让调用方自己判。
 *
 * <p>{@code existingBizId} 可以为 {@code null}：撞的是**别的**唯一索引（例如账本那条）
 * 时批次表里查不到这个键。此时调用方应当如实记「不知道」，不要猜——
 * 猜错会往审计列里写一个假事实。
 */
public class DuplicateGrantKeyException extends RuntimeException {

    private final String existingBizId;

    public DuplicateGrantKeyException(String existingBizId) {
        // 文案与 DuplicateKeyException 那条**逐字相同**：同一个原因在两个分支上给两套话，
        // 会让「按文案写告警」这件事失效。
        super("该幂等键已存在：这次操作之前已经成功过，未重复执行");
        this.existingBizId = existingBizId;
    }

    /** 该幂等键对应批次的 `biz_id`；查不到归属时为 {@code null}。 */
    public String existingBizId() {
        return existingBizId;
    }
}

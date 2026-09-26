package com.bluewhale.billing.infrastructure.mapper;

/**
 * 「持有超时仍未终态」的预留读模型行（{@link CostReservationMapper#listStaleHeld} 的返回）。
 *
 * <p>它不是 {@code billing_cost_reservations} 的完整实体：兜底扫描只关心
 * 「谁的、冻了多少、冻了多久」，把 {@code allocations}（JSON）、{@code rule_snapshot}
 * 这些大列一并取出来，只会让每轮扫描多读一批没人看的字节。
 *
 * <p>{@code heldSeconds} 由 SQL 的 {@code TIMESTAMPDIFF} 算，而不是在 Java 侧拿
 * {@code Instant.now()} 减去 {@code gmt_modified}：库的墙钟与会话的 {@code NOW()}
 * 是同一个时钟（{@code DbTime.ZONE} 钉住的也是它），而 JVM 的时钟是另一个。
 * 两个时钟混进同一个判定里，漂移时算出的「持有秒数」会**凭空变大或变小**，
 * 而这个数正是「要不要释放用户的钱」的唯一依据。
 */
public class StaleReservationRow {

    private Long id;

    private Long generationJobId;

    private Long userId;

    /** 预扣额（积分）。 */
    private Long reservedCredits;

    /** 已持有秒数（库内时钟计算）。 */
    private Long heldSeconds;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getReservedCredits() { return reservedCredits; }
    public void setReservedCredits(Long reservedCredits) { this.reservedCredits = reservedCredits; }
    public Long getHeldSeconds() { return heldSeconds; }
    public void setHeldSeconds(Long heldSeconds) { this.heldSeconds = heldSeconds; }
}

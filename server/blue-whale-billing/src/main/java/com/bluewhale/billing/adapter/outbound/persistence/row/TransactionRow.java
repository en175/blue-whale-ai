package com.bluewhale.billing.adapter.outbound.persistence.row;

import java.time.LocalDateTime;

/**
 * 用户流水的**读模型行**（{@link com.bluewhale.billing.adapter.outbound.persistence.mapper.TransactionMapper#selectPage} 的返回）。
 *
 * <p>它不是任何一张表的实体：一行可能来自批次表、预留表或账本凭证，
 * 列也已经被 SQL 折成展示所需的形状（类型、方向、文案、金额）。
 * 所以它落在 mapper 包而不是 {@code domain/entity}——那里是「哪张表长什么样」，
 * 这里是「这条查询返回什么」。
 *
 * <p>字段名与 SQL 的列别名一一对应（{@code map-underscore-to-camel-case} 打开，
 * {@code tx_id → txId}）。时间仍是库内墙钟的 {@link LocalDateTime}，
 * 换算成 {@code Instant} 由 Repository 经 {@code DbTime} 做——口径只有那一处。
 */
public class TransactionRow {

    /** 形如 {@code lot:12} / {@code res:7} / {@code led:expire:...}。 */
    private String txId;

    /**
     * 这行属于谁。
     *
     * <p>用户面（按 userId 过滤）时它恒等于入参，没有信息量；**管理面**（不过滤 userId）
     * 时它是唯一能回答「这行是谁的」的列——没有它的全站流水是一列无法归属的账。
     */
    private Long userId;

    /** 见 {@code TransactionType}。 */
    private String type;

    /** in | out。 */
    private String direction;

    private String title;

    /** 整数积分，恒正。 */
    private Long amount;

    /**
     * 这行预留**当初冻了多少**（整数积分，恒正）。
     *
     * <p>只有消费行（{@code kind='consume'}，id 形如 {@code res:7}）有值——那一行的身份
     * 就是 {@code billing_cost_reservations} 的一条预留，预扣额与结算额都在同一张表上。
     * 发放行与账本行没有「预扣」这回事，为 {@code null}（**不是 0**：0 是「冻了 0 分」）。
     *
     * <p>为什么要读出来：结算后 {@link #amount} 已换成实际值，预扣额就只剩这里能答；
     * 而用户余额先降后回的差额要靠它解释。
     */
    private Long reservedCredits;

    /**
     * 这行关联的生成任务（{@code billing_cost_reservations.generation_job_id}）。
     *
     * <p>只有消费行（{@code id} 形如 {@code res:7}）有值——那一行的身份就是一条预留，
     * 而预留上的 {@code generation_job_id} 是 NOT NULL 的。发放行与账本行没有任务，
     * 为 {@code null}（**不是 0**：本仓没有「任务 0」这种东西）。
     *
     * <p>⚠️ **它是给 backend 用的 join key，不是给人看的**：billing 只存 id，任务的类型 /
     * 模型 / 提示词都在 backend 自己的库（ADR-0114 不共享库，这里读不到）。管理面的
     * BFF 拿这批 id 回自己库批量查后合并进响应 —— 消费行在后台才答得出「这是什么任务」。
     */
    private Long generationJobId;

    /** pending | done。 */
    private String status;

    private LocalDateTime createdAt;

    /** 未结算为 NULL。 */
    private LocalDateTime settledAt;

    /** 排序键的第二段：consume | grant | ledger（游标要用，不展示）。 */
    private String kind;

    /** 排序键的第三段：该来源内的行 id（游标要用，不展示）。 */
    private Long srcId;

    public String getTxId() { return txId; }
    public void setTxId(String txId) { this.txId = txId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getDirection() { return direction; }
    public void setDirection(String direction) { this.direction = direction; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public Long getAmount() { return amount; }
    public void setAmount(Long amount) { this.amount = amount; }
    public Long getReservedCredits() { return reservedCredits; }
    public void setReservedCredits(Long reservedCredits) { this.reservedCredits = reservedCredits; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getSettledAt() { return settledAt; }
    public void setSettledAt(LocalDateTime settledAt) { this.settledAt = settledAt; }
    public String getKind() { return kind; }
    public void setKind(String kind) { this.kind = kind; }
    public Long getSrcId() { return srcId; }
    public void setSrcId(Long srcId) { this.srcId = srcId; }
}

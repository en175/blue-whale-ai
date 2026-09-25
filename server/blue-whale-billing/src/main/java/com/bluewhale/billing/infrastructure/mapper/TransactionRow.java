package com.bluewhale.billing.infrastructure.mapper;

import java.time.LocalDateTime;

/**
 * 用户流水的**读模型行**（{@link TransactionMapper#selectPage} 的返回）。
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

    /** 见 {@code TransactionType}。 */
    private String type;

    /** in | out。 */
    private String direction;

    private String title;

    /** 整数积分，恒正。 */
    private Long amount;

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
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getDirection() { return direction; }
    public void setDirection(String direction) { this.direction = direction; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public Long getAmount() { return amount; }
    public void setAmount(Long amount) { this.amount = amount; }
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

package com.bluewhale.billing.adapter.outbound.persistence.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 积分批次行（对应 Flyway {@code V3__ledger.sql} 的 {@code billing_credit_lots}）。
 *
 * <p>⚠️ 本类与迁移脚本必须同步演进。改字段先改迁移——schema 权威在 Flyway，
 * 实体只是它的映射（ADR-0113 数据主权）。
 *
 * <p>枚举列（{@code source}）在实体里用 String 承载，由 Repository 转成
 * {@link com.bluewhale.billing.domain.ledger.CreditSource}。**不给领域枚举挂 MyBatis 注解**：
 * 那会让「积分来源」这个领域概念反向依赖持久化框架。
 */
@TableName("billing_credit_lots")
public class CreditLotEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    /** 见 {@code CreditSource}。 */
    private String source;

    /** 扣减优先级的冗余列，专供 ORDER BY（见迁移脚本注释）。 */
    private Integer sourcePriority;

    /** 发放总量（mc），发放后不变。 */
    private Long amount;

    /** 剩余总量（mc），含冻结。 */
    private Long remaining;

    /** 冻结中（mc）。 */
    private Long frozen;

    /** NULL = 永久。 */
    private LocalDateTime expiresAt;

    private String bizType;

    private String bizId;

    /** 发放幂等键，唯一索引。 */
    private String grantKey;

    private LocalDateTime gmtCreate;

    private LocalDateTime gmtModified;

    private Integer version;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public Integer getSourcePriority() { return sourcePriority; }
    public void setSourcePriority(Integer sourcePriority) { this.sourcePriority = sourcePriority; }
    public Long getAmount() { return amount; }
    public void setAmount(Long amount) { this.amount = amount; }
    public Long getRemaining() { return remaining; }
    public void setRemaining(Long remaining) { this.remaining = remaining; }
    public Long getFrozen() { return frozen; }
    public void setFrozen(Long frozen) { this.frozen = frozen; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
    public String getBizType() { return bizType; }
    public void setBizType(String bizType) { this.bizType = bizType; }
    public String getBizId() { return bizId; }
    public void setBizId(String bizId) { this.bizId = bizId; }
    public String getGrantKey() { return grantKey; }
    public void setGrantKey(String grantKey) { this.grantKey = grantKey; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
}

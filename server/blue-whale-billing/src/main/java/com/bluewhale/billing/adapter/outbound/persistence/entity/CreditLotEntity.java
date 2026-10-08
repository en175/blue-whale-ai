package com.bluewhale.billing.adapter.outbound.persistence.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("billing_credit_lots")
public class CreditLotEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private String source;

    private Integer sourcePriority;

    private Long amount;

    private Long remaining;

    private Long frozen;

    private LocalDateTime expiresAt;

    private String bizType;

    private String bizId;

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

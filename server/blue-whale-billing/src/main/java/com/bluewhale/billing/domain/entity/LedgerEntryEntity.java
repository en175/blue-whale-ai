package com.bluewhale.billing.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 账本分录行（对应 Flyway {@code V3__ledger.sql} 的 {@code billing_ledger_entries}）。
 *
 * <p><b>append-only</b>：只有插入与查询，没有更新与删除。冲正靠反向分录。
 * 所以本实体虽由 MyBatis-Plus 管理，却从不走 {@code updateById}。
 */
@TableName("billing_ledger_entries")
public class LedgerEntryEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    /** 见 {@code Account}：wallet | frozen | revenue | cost | receivable。 */
    private String account;

    /** debit | credit。 */
    private String direction;

    /** 恒正；方向由 direction 表达。 */
    private Long amount;

    private String bizType;

    private String bizId;

    /** 幂等键，唯一索引。格式为「凭证基础键:科目名」（见 Voucher）。 */
    private String idempotencyKey;

    /** 该科目变动后余额快照——对账时逐笔可验证的依据。 */
    private Long balanceAfter;

    private String remark;

    private LocalDateTime gmtCreate;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getAccount() { return account; }
    public void setAccount(String account) { this.account = account; }
    public String getDirection() { return direction; }
    public void setDirection(String direction) { this.direction = direction; }
    public Long getAmount() { return amount; }
    public void setAmount(Long amount) { this.amount = amount; }
    public String getBizType() { return bizType; }
    public void setBizType(String bizType) { this.bizType = bizType; }
    public String getBizId() { return bizId; }
    public void setBizId(String bizId) { this.bizId = bizId; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }
    public Long getBalanceAfter() { return balanceAfter; }
    public void setBalanceAfter(Long balanceAfter) { this.balanceAfter = balanceAfter; }
    public String getRemark() { return remark; }
    public void setRemark(String remark) { this.remark = remark; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
}

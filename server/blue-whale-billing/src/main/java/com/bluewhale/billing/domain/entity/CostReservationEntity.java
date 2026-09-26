package com.bluewhale.billing.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 预扣预留行（对应 Flyway {@code V3__ledger.sql} 的 {@code billing_cost_reservations}）。
 *
 * <p>内部表，不暴露给用户端任何接口。
 */
@TableName("billing_cost_reservations")
public class CostReservationEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 预扣关联的生成任务。唯一索引——一个 job 至多一条预留。 */
    private Long generationJobId;

    private Long userId;

    /** 预扣额（mc）。 */
    private Long reservedCredits;

    /** 实际额（mc），结算后填；未结算为 NULL。 */
    private Long actualCredits;

    /** held | settled | released。 */
    private String status;

    /** 预扣分配明细的 JSON 文本：{@code [{"lotId":1,"take":3000}]}。 */
    private String allocations;

    /** 冻结的定价版本——改价不影响已提交任务。 */
    private Integer catalogVersion;

    /** 预扣时的折扣系数（万分比）——结算按它复现，不重新解析（见 V4 迁移）。 */
    private Integer discountBp;

    /**
     * 冻结的计价规则快照（JSON 文本，见 V8 迁移）。
     *
     * <p>{@code null} = 本次预扣没带快照 —— 结算**算不出价**（规则住在模型能力行，
     * 只有预扣这一次机会随请求冻下来），会抛出去让 MQ 重投。
     */
    private String ruleSnapshot;

    /** 提交时的展示文案快照（见 V6 迁移）；空串 = 提交方未提供。 */
    private String title;

    /** 释放原因；仅 released 时有值。 */
    private String releaseNote;

    private LocalDateTime gmtCreate;

    private LocalDateTime gmtModified;

    private Integer version;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getReservedCredits() { return reservedCredits; }
    public void setReservedCredits(Long reservedCredits) { this.reservedCredits = reservedCredits; }
    public Long getActualCredits() { return actualCredits; }
    public void setActualCredits(Long actualCredits) { this.actualCredits = actualCredits; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getAllocations() { return allocations; }
    public void setAllocations(String allocations) { this.allocations = allocations; }
    public Integer getCatalogVersion() { return catalogVersion; }
    public void setCatalogVersion(Integer catalogVersion) { this.catalogVersion = catalogVersion; }
    public Integer getDiscountBp() { return discountBp; }
    public void setDiscountBp(Integer discountBp) { this.discountBp = discountBp; }
    public String getRuleSnapshot() { return ruleSnapshot; }
    public void setRuleSnapshot(String ruleSnapshot) { this.ruleSnapshot = ruleSnapshot; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getReleaseNote() { return releaseNote; }
    public void setReleaseNote(String releaseNote) { this.releaseNote = releaseNote; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
}

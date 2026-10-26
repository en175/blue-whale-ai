package com.bluewhale.billing.infrastructure.persistence.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("billing_cost_reservations")
public class CostReservationEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long generationJobId;

    private Long userId;

    private Long reservedCredits;

    private Long actualCredits;

    private Long receivableCredits;

    private String status;

    private String allocations;

    private Integer catalogVersion;

    private Integer discountBp;

    private String ruleSnapshot;

    private String title;

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
    public Long getReceivableCredits() { return receivableCredits; }
    public void setReceivableCredits(Long receivableCredits) { this.receivableCredits = receivableCredits; }
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

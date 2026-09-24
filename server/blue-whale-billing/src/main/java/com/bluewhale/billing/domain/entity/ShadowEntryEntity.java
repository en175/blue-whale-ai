package com.bluewhale.billing.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 影子计价记录（对应 Flyway {@code V5__shadow_entries.sql}）。
 *
 * <p>影子期（切换前）用它记录「我们算出来的价」，与 new-api 实际扣的比对。
 * **不参与账本**——影子期的数字一分钱都没动过。
 */
@TableName("billing_shadow_entries")
public class ShadowEntryEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long generationJobId;

    private Long userId;

    /** priced | unpriceable —— 后者是**成功记录的一种**，即切换前要修掉的漏配清单。 */
    private String status;

    /** 我们算出来的价（整数积分）；unpriceable 时为 NULL。 */
    private Long computedCredits;

    private Integer catalogVersion;

    private Integer discountBp;

    /** 上游实际收**我们**的（mc，毛利分析原料）。 */
    private Long upstreamCostCredits;

    /** 上游实际收**用户**的（new-api quota）；由对账任务回填。 */
    private Long upstreamUserCredits;

    /** 用量与规格快照 JSON。 */
    private String usageJson;

    private String errorMessage;

    private LocalDateTime gmtCreate;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getComputedCredits() { return computedCredits; }
    public void setComputedCredits(Long computedCredits) { this.computedCredits = computedCredits; }
    public Integer getCatalogVersion() { return catalogVersion; }
    public void setCatalogVersion(Integer catalogVersion) { this.catalogVersion = catalogVersion; }
    public Integer getDiscountBp() { return discountBp; }
    public void setDiscountBp(Integer discountBp) { this.discountBp = discountBp; }
    public Long getUpstreamCostCredits() { return upstreamCostCredits; }
    public void setUpstreamCostCredits(Long upstreamCostCredits) { this.upstreamCostCredits = upstreamCostCredits; }
    public Long getUpstreamUserCredits() { return upstreamUserCredits; }
    public void setUpstreamUserCredits(Long upstreamUserCredits) { this.upstreamUserCredits = upstreamUserCredits; }
    public String getUsageJson() { return usageJson; }
    public void setUsageJson(String usageJson) { this.usageJson = usageJson; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
}

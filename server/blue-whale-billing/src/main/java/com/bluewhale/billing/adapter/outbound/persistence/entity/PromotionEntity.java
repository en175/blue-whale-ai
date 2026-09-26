package com.bluewhale.billing.adapter.outbound.persistence.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * 营销活动行（对应 Flyway {@code V2__discounts.sql} 的 {@code billing_promotions}）。
 *
 * <p><b>live 表，不版本化</b>：job 提交时把**命中结果**冻结进定价快照，结算只复现快照。
 * 所以活动改折扣、停活动，都不影响已提交任务。
 *
 * <p>{@code modelIds} / {@code taskTypes} / {@code tierScope} / {@code daysOfWeek}
 * 都是 JSON 数组列，实体里用 String 承载，解析在
 * {@code PromotionDiscountProvider}。
 */
@TableName("billing_promotions")
public class PromotionEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 活动标识，审计/排查用。 */
    private String code;

    /** 活动名称，前端展示。 */
    private String name;

    /** 折扣，万分比（7000 = 7 折）。 */
    private Integer discountBp;

    /** 模型集合 JSON，支持 {@code *} 与 {@code prefix-*} 通配。 */
    private String modelIds;

    /** 任务类型集合 JSON；NULL = 全部。 */
    private String taskTypes;

    /** 适用用户等级 JSON；NULL = 不限。 */
    private String tierScope;

    private LocalDateTime startAt;

    private LocalDateTime endAt;

    /** 每日时段起；与 end 同时为 NULL 表示全天。 */
    private LocalTime dailyTimeStart;

    /** 每日时段止，可跨天（22:00→06:00）。 */
    private LocalTime dailyTimeEnd;

    /** 生效星期 JSON [1..7]；NULL = 每天。 */
    private String daysOfWeek;

    /** 时区，默认 Asia/Shanghai。跨零点时段必须靠它算对。 */
    private String tz;

    /** draft | enabled | disabled | expired。 */
    private String status;

    private Integer priority;

    private String createdBy;

    private LocalDateTime gmtCreate;

    private LocalDateTime gmtModified;

    private Integer version;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Integer getDiscountBp() { return discountBp; }
    public void setDiscountBp(Integer discountBp) { this.discountBp = discountBp; }
    public String getModelIds() { return modelIds; }
    public void setModelIds(String modelIds) { this.modelIds = modelIds; }
    public String getTaskTypes() { return taskTypes; }
    public void setTaskTypes(String taskTypes) { this.taskTypes = taskTypes; }
    public String getTierScope() { return tierScope; }
    public void setTierScope(String tierScope) { this.tierScope = tierScope; }
    public LocalDateTime getStartAt() { return startAt; }
    public void setStartAt(LocalDateTime startAt) { this.startAt = startAt; }
    public LocalDateTime getEndAt() { return endAt; }
    public void setEndAt(LocalDateTime endAt) { this.endAt = endAt; }
    public LocalTime getDailyTimeStart() { return dailyTimeStart; }
    public void setDailyTimeStart(LocalTime dailyTimeStart) { this.dailyTimeStart = dailyTimeStart; }
    public LocalTime getDailyTimeEnd() { return dailyTimeEnd; }
    public void setDailyTimeEnd(LocalTime dailyTimeEnd) { this.dailyTimeEnd = dailyTimeEnd; }
    public String getDaysOfWeek() { return daysOfWeek; }
    public void setDaysOfWeek(String daysOfWeek) { this.daysOfWeek = daysOfWeek; }
    public String getTz() { return tz; }
    public void setTz(String tz) { this.tz = tz; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Integer getPriority() { return priority; }
    public void setPriority(Integer priority) { this.priority = priority; }
    public String getCreatedBy() { return createdBy; }
    public void setCreatedBy(String createdBy) { this.createdBy = createdBy; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
}

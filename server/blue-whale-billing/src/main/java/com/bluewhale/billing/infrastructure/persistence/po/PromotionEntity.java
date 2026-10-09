package com.bluewhale.billing.infrastructure.persistence.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;
import java.time.LocalTime;

@TableName("billing_promotions")
public class PromotionEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String code;

    private String name;

    private Integer discountBp;

    private String modelIds;

    private String taskTypes;

    private String tierScope;

    private LocalDateTime startAt;

    private LocalDateTime endAt;

    private LocalTime dailyTimeStart;

    private LocalTime dailyTimeEnd;

    private String daysOfWeek;

    private String tz;

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

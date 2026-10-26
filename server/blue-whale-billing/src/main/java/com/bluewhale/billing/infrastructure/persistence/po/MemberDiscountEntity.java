package com.bluewhale.billing.infrastructure.persistence.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("billing_member_discounts")
public class MemberDiscountEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String tier;

    private String modelPattern;

    private String taskPattern;

    private Integer discountBp;

    private Integer priority;

    private String status;

    private LocalDateTime gmtCreate;

    private LocalDateTime gmtModified;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTier() { return tier; }
    public void setTier(String tier) { this.tier = tier; }
    public String getModelPattern() { return modelPattern; }
    public void setModelPattern(String modelPattern) { this.modelPattern = modelPattern; }
    public String getTaskPattern() { return taskPattern; }
    public void setTaskPattern(String taskPattern) { this.taskPattern = taskPattern; }
    public Integer getDiscountBp() { return discountBp; }
    public void setDiscountBp(Integer discountBp) { this.discountBp = discountBp; }
    public Integer getPriority() { return priority; }
    public void setPriority(Integer priority) { this.priority = priority; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
}

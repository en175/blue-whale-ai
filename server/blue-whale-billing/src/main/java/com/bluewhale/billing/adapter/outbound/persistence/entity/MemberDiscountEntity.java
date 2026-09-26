package com.bluewhale.billing.adapter.outbound.persistence.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 会员等级折扣行（对应 Flyway {@code V2__discounts.sql} 的 {@code billing_member_discounts}）。
 *
 * <p>长期契约、低频变更。「同等级命中多条取最优惠」的裁决在
 * {@code DiscountProvider}，本实体只承载行数据。
 */
@TableName("billing_member_discounts")
public class MemberDiscountEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** free | basic | pro | max。 */
    private String tier;

    /** 模型匹配：{@code seedance-*} | {@code *} | {@code gpt-4o}。 */
    private String modelPattern;

    /** 任务匹配：{@code text2video} | {@code *}。 */
    private String taskPattern;

    /** 折扣，万分比（9000 = 9 折）。 */
    private Integer discountBp;

    private Integer priority;

    /** enabled | disabled。 */
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

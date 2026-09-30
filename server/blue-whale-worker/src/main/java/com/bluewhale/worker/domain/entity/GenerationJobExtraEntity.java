package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 生成任务的扩展位行（对应 Prisma model generation_job_extras，IKJCOE / ADR-0120）。
 * <p>
 * 键值形态：任务特有字段按 (generation_job_id, extra_key) 一行一个，extra_key
 * **沿用被迁移列的原字段名**（video_stage / charge_state / …），故读方不维护新旧名字映射。
 * <p>
 * 值列 {@code value_text} 按 {@code value_type} 解释：
 * <ul>
 *   <li>string → 原样</li>
 *   <li>number → 十进制字符串（Java 侧 Long.parseLong；TS 侧 Number()）</li>
 *   <li>boolean → 'true' / 'false'</li>
 *   <li>json → JSON 文本（用 Jackson 解析，同 input / output_asset_ids 的处理方式）</li>
 * </ul>
 * <p>
 * 表无 version / is_delete 列（跟随 generation_job_logs / generation_output_slots 的
 * 追加型子表惯例），故标 {@code @TableField(exist = false)} 占位。
 */
@TableName("generation_job_extras")
public class GenerationJobExtraEntity {
    @TableId(type = IdType.AUTO)
    /** 主键 */
    private Long id;

    @TableField("generation_job_id")
    /** 关联任务 */
    private Long generationJobId;

    @TableField("extra_key")
    /** 扩展位键名（沿用被迁移列的原字段名） */
    private String extraKey;

    @TableField("value_type")
    /** string / number / boolean / json */
    private String valueType;

    @TableField("value_text")
    /** 值本体（语义由 valueType 定） */
    private String valueText;

    @TableField("gmt_create")
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    private LocalDateTime gmtModified;

    @com.baomidou.mybatisplus.annotation.TableField(exist = false)
    private Integer version;

    @com.baomidou.mybatisplus.annotation.TableField(exist = false)
    private Boolean isDelete;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public String getExtraKey() { return extraKey; }
    public void setExtraKey(String extraKey) { this.extraKey = extraKey; }
    public String getValueType() { return valueType; }
    public void setValueType(String valueType) { this.valueType = valueType; }
    public String getValueText() { return valueText; }
    public void setValueText(String valueText) { this.valueText = valueText; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime v) { this.gmtCreate = v; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime v) { this.gmtModified = v; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public Boolean getIsDelete() { return isDelete; }
    public void setIsDelete(Boolean isDelete) { this.isDelete = isDelete; }
}

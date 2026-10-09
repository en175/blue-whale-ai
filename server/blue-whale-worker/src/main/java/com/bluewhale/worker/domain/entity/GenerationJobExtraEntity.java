package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("generation_job_extras")
public class GenerationJobExtraEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("generation_job_id")
    private Long generationJobId;

    @TableField("extra_key")
    private String extraKey;

    @TableField("value_type")
    private String valueType;

    @TableField("value_text")
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

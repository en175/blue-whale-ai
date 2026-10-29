package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("generation_output_slots")
public class GenerationOutputSlotEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("generation_job_id")
    private Long generationJobId;

    @TableField("slot_index")
    private Integer slotIndex;

    @TableField("status")
    private String status;

    @TableField("asset_id")
    private Long assetId;

    @TableField("retry_of_slot_id")
    private Long retryOfSlotId;

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
    public Integer getSlotIndex() { return slotIndex; }
    public void setSlotIndex(Integer slotIndex) { this.slotIndex = slotIndex; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getAssetId() { return assetId; }
    public void setAssetId(Long assetId) { this.assetId = assetId; }
    public Long getRetryOfSlotId() { return retryOfSlotId; }
    public void setRetryOfSlotId(Long retryOfSlotId) { this.retryOfSlotId = retryOfSlotId; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime v) { this.gmtCreate = v; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime v) { this.gmtModified = v; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public Boolean getIsDelete() { return isDelete; }
    public void setIsDelete(Boolean isDelete) { this.isDelete = isDelete; }
}

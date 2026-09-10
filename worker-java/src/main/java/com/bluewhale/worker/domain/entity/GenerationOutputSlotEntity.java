package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 生成输出槽行（对应 Prisma model generation_output_slots）。
 * <p>
 * 用于 completeJob 的槽位聚合（settle-ops.ts:79-121）——部分成功 → partially_succeeded。
 */
@TableName("generation_output_slots")
public class GenerationOutputSlotEntity {
    @TableId(type = IdType.AUTO)
    /** 主键 */
    private Long id;

    @TableField("generation_job_id")
    /** 关联任务 */
    private Long generationJobId;

    @TableField("slot_index")
    /** 槽位序号（0-based） */
    private Integer slotIndex;

    @TableField("status")
    /** 槽位状态：pending / succeeded / failed */
    private String status;

    @TableField("asset_id")
    /** 绑定资产 id（succeeded 时填充） */
    private Long assetId;

    @TableField("retry_of_slot_id")
    /** 重试来源槽 id */
    private Long retryOfSlotId;

    @TableField("scene_card_generation_record_id")
    /** 关联的场景卡生成记录 id（视频路径回写用） */
    private Long sceneCardGenerationRecordId;

    @TableField("gmt_create")
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    private LocalDateTime gmtModified;

    @TableField("version")
    private Integer version;

    @TableField("is_delete")
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
    public Long getSceneCardGenerationRecordId() { return sceneCardGenerationRecordId; }
    public void setSceneCardGenerationRecordId(Long id) { this.sceneCardGenerationRecordId = id; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime v) { this.gmtCreate = v; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime v) { this.gmtModified = v; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public Boolean getIsDelete() { return isDelete; }
    public void setIsDelete(Boolean isDelete) { this.isDelete = isDelete; }
}

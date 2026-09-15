package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 故事板预览行（对应 Prisma model storyboard_previews）。
 * <p>
 * syncStoryboardPreviewSummary 用：仅消费 id / project_id / summary_status / version。
 * 其余列由 NestJS 产品侧维护，Java worker 不读写。
 */
@TableName("storyboard_previews")
public class StoryboardPreviewEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("project_id")
    private Long projectId;

    /** 关联的首个生成任务 ID（图片路径反查键，IK67HF/T15）。 */
    @TableField("first_generation_job_id")
    private Long firstGenerationJobId;

    /** 聚合摘要状态：generating / partial / success / failed（spec §4.4）。 */
    @TableField("summary_status")
    private String summaryStatus;

    /** 软删标记（storyboard_previews 用 INT 0/1，与 assets 的 BOOLEAN 不同）。 */
    @TableField("is_delete")
    private Integer isDelete;

    @TableField("version")
    private Integer version;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public Long getFirstGenerationJobId() { return firstGenerationJobId; }
    public void setFirstGenerationJobId(Long v) { this.firstGenerationJobId = v; }
    public String getSummaryStatus() { return summaryStatus; }
    public void setSummaryStatus(String summaryStatus) { this.summaryStatus = summaryStatus; }
    public Integer getIsDelete() { return isDelete; }
    public void setIsDelete(Integer isDelete) { this.isDelete = isDelete; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
}

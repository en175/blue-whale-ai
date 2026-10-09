package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

@TableName("storyboard_previews")
public class StoryboardPreviewEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("project_id")
    private Long projectId;

    @TableField("first_generation_job_id")
    private Long firstGenerationJobId;

    @TableField("summary_status")
    private String summaryStatus;

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

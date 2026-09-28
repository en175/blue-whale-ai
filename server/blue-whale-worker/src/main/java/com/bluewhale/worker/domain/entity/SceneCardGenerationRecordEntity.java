package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 场景卡生成记录行（对应 Prisma model scene_card_generation_records）。
 * <p>
 * syncRecordSummary 用：仅消费 id / project_id / summary_status / version 四列。
 * 其余列由 NestJS 产品侧维护，Java worker 不读写。
 */
@TableName("scene_card_generation_records")
public class SceneCardGenerationRecordEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("project_id")
    private Long projectId;

    /** 聚合摘要状态：generating / partial / success / failed（spec §4.4）。 */
    @TableField("summary_status")
    private String summaryStatus;

    @TableField("version")
    private Integer version;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public String getSummaryStatus() { return summaryStatus; }
    public void setSummaryStatus(String summaryStatus) { this.summaryStatus = summaryStatus; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
}

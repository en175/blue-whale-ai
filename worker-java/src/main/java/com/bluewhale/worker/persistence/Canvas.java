package com.bluewhale.worker.persistence;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 画布快照行（对应 Prisma model canvas）。
 * <p>
 * 仅声明 media_extract canvas ops 所需字段（nodes_json / version / CAS 守卫）。
 * 移植自 media-extract-canvas-ops.ts:40-54（withCanvasUpdate）。
 */
@TableName("canvas")
public class Canvas {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("project_id")
    private Long projectId;

    @TableField("nodes_json")
    private String nodesJson;

    @TableField("version")
    private Integer version;

    @TableField("is_delete")
    private Integer isDelete;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public String getNodesJson() { return nodesJson; }
    public void setNodesJson(String nodesJson) { this.nodesJson = nodesJson; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public Integer getIsDelete() { return isDelete; }
    public void setIsDelete(Integer isDelete) { this.isDelete = isDelete; }
}

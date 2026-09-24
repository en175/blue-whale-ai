package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 资产行（对应 Prisma model assets）。
 */
@TableName("assets")
public class AssetEntity {
    @TableId(type = IdType.AUTO)
    /** 主键（BigInt，对外字符串化承载） */
    private Long id;

    @TableField("user_id")
    /** 归属用户 */
    private Long userId;

    @TableField("project_id")
    /** 归属项目（assets：0=全局素材） */
    private Long projectId;

    @TableField("generation_job_id")
    /** 产出该资产的任务 id；上传件为 null */
    private Long generationJobId;

    @TableField("type")
    /** 类型：image/video/audio（assets）；image/video/audio/media_extract（jobs，契约 §2） */
    private String type;

    @TableField("storage_key")
    /** TOS 对象键；null=上游直存 passthrough 残留行（源资产解析视为不可用） */
    private String storageKey;

    @TableField("content_sha256")
    /** 预留列：现行代码从不写入（契约 §2 死列，不参与对账） */
    private String contentSha256;

    @TableField("md5")
    /** 内容 md5 去重键（IKCNLS） */
    private String md5;

    @TableField("url")
    /** 公网访问 URL https://{bucket}.{endpoint}/{key} */
    private String url;

    @TableField("mime")
    /** MIME；生成音频恒 audio/mpeg（契约 §8） */
    private String mime;

    @TableField("size")
    /** 字节数（BigInt→Long） */
    private Long size;

    @TableField("width")
    /** 宽；解析失败为 null 且资产照常落库（契约 §8 等价标准） */
    private Integer width;

    @TableField("height")
    /** 高；同 width，round 正有限数否则 null */
    private Integer height;

    @TableField("duration_ms")
    /** 时长毫秒（对外展示 /1000 换算为秒） */
    private Integer durationMs;

    @TableField("source")
    /** uploaded/generated（jobs：入口来源，受领取白名单约束 契约 §2） */
    private String source;

    @TableField("status")
    /** 状态（jobs 六枚举见契约 §2；assets：normal/uploading） */
    private String status;

    @TableField("material_id")
    /** 素材库关联 id（IKDJNZ，命中走 asset://） */
    private String materialId;

    @TableField("material_group_id")
    /** 素材库分组 id（IKDJNZ） */
    private String materialGroupId;

    @TableField("gmt_create")
    /** 创建时间 */
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    /** 修改时间 */
    private LocalDateTime gmtModified;

    @TableField("version")
    /** 乐观锁版本（每次写 +1，契约 §3.1） */
    private Integer version;

    @TableField("is_delete")
    /** 软删标记（GC/领取均过滤） */
    private Boolean isDelete;

    @TableField("deleted_at")
    /** 软删时间（asset-GC cutoff 扫描依据，契约 §7） */
    private LocalDateTime deletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getStorageKey() { return storageKey; }
    public void setStorageKey(String storageKey) { this.storageKey = storageKey; }
    public String getContentSha256() { return contentSha256; }
    public void setContentSha256(String contentSha256) { this.contentSha256 = contentSha256; }
    public String getMd5() { return md5; }
    public void setMd5(String md5) { this.md5 = md5; }
    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }
    public String getMime() { return mime; }
    public void setMime(String mime) { this.mime = mime; }
    public Long getSize() { return size; }
    public void setSize(Long size) { this.size = size; }
    public Integer getWidth() { return width; }
    public void setWidth(Integer width) { this.width = width; }
    public Integer getHeight() { return height; }
    public void setHeight(Integer height) { this.height = height; }
    public Integer getDurationMs() { return durationMs; }
    public void setDurationMs(Integer durationMs) { this.durationMs = durationMs; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getMaterialId() { return materialId; }
    public void setMaterialId(String materialId) { this.materialId = materialId; }
    public String getMaterialGroupId() { return materialGroupId; }
    public void setMaterialGroupId(String materialGroupId) { this.materialGroupId = materialGroupId; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public Boolean getIsDelete() { return isDelete; }
    public void setIsDelete(Boolean isDelete) { this.isDelete = isDelete; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}

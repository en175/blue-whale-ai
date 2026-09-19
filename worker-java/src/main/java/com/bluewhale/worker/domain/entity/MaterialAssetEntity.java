package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 素材校验状态镜像行（对应 Prisma model material_assets；ADR-0087）。
 * <p>
 * 本表是「该素材能否用作视频生成参考」的判据，不是缓存：{@code Active} 放行，
 * {@code Failed} 拒绝，{@code Processing} / 无行由拦截点实时查上游裁定。
 * 写入口径见 ADR-0087 决策 4——本 worker 只负责 Processing 行的定时跟进。
 */
@TableName("material_assets")
public class MaterialAssetEntity {
    @TableId(type = IdType.AUTO)
    /** 主键（BigInt，对外不暴露） */
    private Long id;

    @TableField("material_id")
    /** 上游素材 id（asset-...）；全局唯一键 */
    private String materialId;

    @TableField("user_id")
    /** 归属用户（new-api 用户 id） */
    private Long userId;

    @TableField("material_group_id")
    /** 上游组 id（group-...） */
    private String materialGroupId;

    @TableField("status")
    /** Processing | Active | Failed（认不出的值一律按 Processing 继续跟进） */
    private String status;

    @TableField("error_code")
    /** 上游失败码原文（不解释、不映射，仅留痕） */
    private String errorCode;

    @TableField("error_message")
    /** 上游失败描述原文 */
    private String errorMessage;

    @TableField("status_checked_at")
    /** 最近一次问到上游状态的时刻 */
    private LocalDateTime statusCheckedAt;

    @TableField("gmt_create")
    /** 创建时间（跟进窗口 = 本列 + 10 分钟） */
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    private LocalDateTime gmtModified;

    @TableField("version")
    /** 乐观锁版本（每次写 +1） */
    private Integer version;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getMaterialId() { return materialId; }
    public void setMaterialId(String materialId) { this.materialId = materialId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getMaterialGroupId() { return materialGroupId; }
    public void setMaterialGroupId(String materialGroupId) { this.materialGroupId = materialGroupId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getErrorCode() { return errorCode; }
    public void setErrorCode(String errorCode) { this.errorCode = errorCode; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public LocalDateTime getStatusCheckedAt() { return statusCheckedAt; }
    public void setStatusCheckedAt(LocalDateTime statusCheckedAt) { this.statusCheckedAt = statusCheckedAt; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
}

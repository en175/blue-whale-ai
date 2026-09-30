package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 生成作业行（对应 Prisma model generation_jobs）。
 * <p>
 * 字段名与 schema.prisma 完全一致（snake_case），MyBatis-Plus 自动驼峰转换。
 * <p>
 * IKJCOE：任务特有字段已搬到 {@code generation_job_extras}（键值表，见
 * {@link GenerationJobExtraEntity} 与 ADR-0120）。本实体只剩「所有 type 共用」的列与
 * 「必须在领取/终态 CAS 的 SQL 里用」的列。原先落在这里的 video_stage / final_job_id /
 * upstream_created_at_ms / finalize_deadline_ms / charge_state / actual_credits /
 * strategy_version 已改为在 {@code JobClaimService} 投影时读扩展位、
 * 由 {@code JobFinalizer} 在终态事务里写扩展位。
 */
@TableName("generation_jobs")
public class GenerationJobEntity {
    @TableId(type = IdType.AUTO)
    /** 主键（BigInt，对外字符串化承载） */
    private Long id;

    @TableField("project_id")
    /** 归属项目（assets：0=全局素材） */
    private Long projectId;

    @TableField("user_id")
    /** 归属用户 */
    private Long userId;

    @TableField("retry_of_job_id")
    /** 重试来源 job id（IKEA26 父任务复用依据） */
    private Long retryOfJobId;

    @TableField("type")
    /** 类型：image/video/audio（assets）；image/video/audio/media_extract（jobs，契约 §2） */
    private String type;

    @TableField("source")
    /** uploaded/generated（jobs：入口来源，受领取白名单约束 契约 §2） */
    private String source;

    @TableField("status")
    /** 状态（jobs 六枚举见契约 §2；assets：normal/uploading） */
    private String status;

    @TableField("progress")
    /** 进度 0-100（media_extract 期间兼心跳语义，契约 §3.2） */
    private Integer progress;

    @TableField("output_asset_ids")
    /** 产物资产 id 数组 JSON */
    private String outputAssetIds; // JSON

    @TableField("provider")
    /** 上游供应商标识（写在 markProviderSubmitted 的守卫 UPDATE 里，故留在本行） */
    private String provider;

    @TableField("provider_task_id")
    /** 上游任务 id；null=未提交（video 分相判据，契约 §3.2/§3.3） */
    private String providerTaskId;

    @TableField("poll_count")
    /** 轮询累计（上限 720→provider_timeout，契约 §3.2） */
    private Integer pollCount;

    @TableField("retry_count")
    /** image 瞬态重试次数（<3 才可回 queued，契约 §6） */
    private Integer retryCount;

    @TableField("last_polled_at")
    /** 最近领取/心跳时间 */
    private LocalDateTime lastPolledAt;

    @TableField("error")
    /** 失败详情 JSON {code,message,details?}；details 禁展示用户（ADR-0078） */
    private String error; // JSON

    @TableField("lease_owner")
    /** 当前租约持有者 workerId（写围栏三条件之一，契约 §3.1） */
    private String leaseOwner;

    @TableField("lease_expires_at")
    /** 租约到期（默认 120s；过期行可被孤儿接管，契约 §3.2） */
    private LocalDateTime leaseExpiresAt;

    @TableField("fencing_token")
    /** 单调递增围栏令牌：领取发放值，CAS 与一切写路径守卫（契约 §3.1） */
    private Long fencingToken;

    @TableField("execution_deadline_at")
    /** 执行截止：长任务（audio_mix / audio_video_mux）的超时预算输入，
     *  由 {@code JobClaimService} 投影进 ClaimedJob —— **不是死列**（IKEL4A 契约文档
     *  那份「死列」清单在这一点上已过期，见 ADR-0120）。 */
    private LocalDateTime executionDeadlineAt;

    @TableField("next_action_at")
    /** 下一次可执行时间：领取条件 & recovery 扫描依据（契约 §3/§7） */
    private LocalDateTime nextActionAt;

    @TableField("cancel_requested_at")
    /** 取消请求时间：仅派发前生效（契约 §3.3） */
    private LocalDateTime cancelRequestedAt;

    @TableField("gmt_create")
    /** 创建时间 */
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    /** 修改时间 */
    private LocalDateTime gmtModified;

    @TableField("version")
    /** 每次写 +1；**不是**并发控制（CAS 全走 fencing_token），只作事件 aggregate_version */
    private Integer version;

    @TableField("is_delete")
    /** 软删标记（GC/领取均过滤） */
    private Boolean isDelete;

    @TableField("input")
    /** 创建时冻结参数 JSON（media_extract 含 source_asset_id） */
    private String input; // JSON

    @TableField("source_sample_job_id")
    /** 成片指向来源样片任务（仅 final 非空）。
     *  ⚠️ **留在主表**：它扛着唯一索引 {@code uk_generation_jobs__source_sample_job_id}，
     *  是并发裁决点；扩展表的唯一索引只能是 (generation_job_id, extra_key)（IKJCOE）。 */
    private Long sourceSampleJobId;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getRetryOfJobId() { return retryOfJobId; }
    public void setRetryOfJobId(Long retryOfJobId) { this.retryOfJobId = retryOfJobId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Integer getProgress() { return progress; }
    public void setProgress(Integer progress) { this.progress = progress; }
    public String getOutputAssetIds() { return outputAssetIds; }
    public void setOutputAssetIds(String outputAssetIds) { this.outputAssetIds = outputAssetIds; }
    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }
    public String getProviderTaskId() { return providerTaskId; }
    public void setProviderTaskId(String providerTaskId) { this.providerTaskId = providerTaskId; }
    public Integer getPollCount() { return pollCount; }
    public void setPollCount(Integer pollCount) { this.pollCount = pollCount; }
    public Integer getRetryCount() { return retryCount; }
    public void setRetryCount(Integer retryCount) { this.retryCount = retryCount; }
    public LocalDateTime getLastPolledAt() { return lastPolledAt; }
    public void setLastPolledAt(LocalDateTime lastPolledAt) { this.lastPolledAt = lastPolledAt; }
    public String getError() { return error; }
    public void setError(String error) { this.error = error; }
    public String getLeaseOwner() { return leaseOwner; }
    public void setLeaseOwner(String leaseOwner) { this.leaseOwner = leaseOwner; }
    public LocalDateTime getLeaseExpiresAt() { return leaseExpiresAt; }
    public void setLeaseExpiresAt(LocalDateTime leaseExpiresAt) { this.leaseExpiresAt = leaseExpiresAt; }
    public Long getFencingToken() { return fencingToken; }
    public void setFencingToken(Long fencingToken) { this.fencingToken = fencingToken; }
    public LocalDateTime getExecutionDeadlineAt() { return executionDeadlineAt; }
    public void setExecutionDeadlineAt(LocalDateTime executionDeadlineAt) { this.executionDeadlineAt = executionDeadlineAt; }
    public LocalDateTime getNextActionAt() { return nextActionAt; }
    public void setNextActionAt(LocalDateTime nextActionAt) { this.nextActionAt = nextActionAt; }
    public LocalDateTime getCancelRequestedAt() { return cancelRequestedAt; }
    public void setCancelRequestedAt(LocalDateTime cancelRequestedAt) { this.cancelRequestedAt = cancelRequestedAt; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public Boolean getIsDelete() { return isDelete; }
    public void setIsDelete(Boolean isDelete) { this.isDelete = isDelete; }
    public String getInput() { return input; }
    public void setInput(String input) { this.input = input; }
    public Long getSourceSampleJobId() { return sourceSampleJobId; }
    public void setSourceSampleJobId(Long sourceSampleJobId) { this.sourceSampleJobId = sourceSampleJobId; }
}

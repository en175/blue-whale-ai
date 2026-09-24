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

    @TableField("agent_run_id")
    /** 关联 agent run（提取链路不用） */
    private Long agentRunId;

    @TableField("action_identity")
    /** 动作幂等标识 */
    private String actionIdentity;

    @TableField("project_action_identity")
    /** 项目内动作幂等标识 */
    private String projectActionIdentity;

    @TableField("expected_output_count")
    /** 预期产物数（slot 聚合基准，契约 §3.3） */
    private Integer expectedOutputCount;

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
    /** 上游供应商标识 */
    private String provider;

    @TableField("provider_task_id")
    /** 上游任务 id；null=未提交（video 分相判据，契约 §3.2/§3.3） */
    private String providerTaskId;

    @TableField("poll_count")
    /** 轮询累计（上限 720→provider_timeout，契约 §3.2） */
    private Integer pollCount;

    @TableField("next_poll_at")
    /** 遗留列：领取路径实际用 nextActionAt（契约 §2 死列候选） */
    private LocalDateTime nextPollAt;

    @TableField("retry_count")
    /** image 瞬态重试次数（<3 才可回 queued，契约 §6） */
    private Integer retryCount;

    @TableField("last_polled_at")
    /** 最近领取/心跳时间 */
    private LocalDateTime lastPolledAt;

    @TableField("error")
    /** 失败详情 JSON {code,message,details?}；details 禁展示用户（ADR-0078） */
    private String error; // JSON

    @TableField("stage_id")
    /** 阶段 id（生成流水线扩展位） */
    private String stageId;

    @TableField("lease_owner")
    /** 当前租约持有者 workerId（写围栏三条件之一，契约 §3.1） */
    private String leaseOwner;

    @TableField("lease_expires_at")
    /** 租约到期（默认 120s；过期行可被孤儿接管，契约 §3.2） */
    private LocalDateTime leaseExpiresAt;

    @TableField("fencing_token")
    /** 单调递增围栏令牌：领取发放值，CAS 与一切写路径守卫（契约 §3.1） */
    private Long fencingToken;

    @TableField("strategy_version")
    /** 策略版本（扩展位） */
    private String strategyVersion;

    @TableField("execution_deadline_at")
    /** 死列：全仓无读写（契约 §2，不迁移） */
    private LocalDateTime executionDeadlineAt;

    @TableField("evidence_reconcile_until")
    /** 死列：全仓无读写（契约 §2，不迁移） */
    private LocalDateTime evidenceReconcileUntil;

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
    /** 乐观锁版本（每次写 +1，契约 §3.1） */
    private Integer version;

    @TableField("is_delete")
    /** 软删标记（GC/领取均过滤） */
    private Boolean isDelete;

    @TableField("input")
    /** 创建时冻结参数 JSON（media_extract 含 source_asset_id） */
    private String input; // JSON

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getAgentRunId() { return agentRunId; }
    public void setAgentRunId(Long agentRunId) { this.agentRunId = agentRunId; }
    public String getActionIdentity() { return actionIdentity; }
    public void setActionIdentity(String actionIdentity) { this.actionIdentity = actionIdentity; }
    public String getProjectActionIdentity() { return projectActionIdentity; }
    public void setProjectActionIdentity(String projectActionIdentity) { this.projectActionIdentity = projectActionIdentity; }
    public Integer getExpectedOutputCount() { return expectedOutputCount; }
    public void setExpectedOutputCount(Integer expectedOutputCount) { this.expectedOutputCount = expectedOutputCount; }
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
    public LocalDateTime getNextPollAt() { return nextPollAt; }
    public void setNextPollAt(LocalDateTime nextPollAt) { this.nextPollAt = nextPollAt; }
    public Integer getRetryCount() { return retryCount; }
    public void setRetryCount(Integer retryCount) { this.retryCount = retryCount; }
    public LocalDateTime getLastPolledAt() { return lastPolledAt; }
    public void setLastPolledAt(LocalDateTime lastPolledAt) { this.lastPolledAt = lastPolledAt; }
    public String getError() { return error; }
    public void setError(String error) { this.error = error; }
    public String getStageId() { return stageId; }
    public void setStageId(String stageId) { this.stageId = stageId; }
    public String getLeaseOwner() { return leaseOwner; }
    public void setLeaseOwner(String leaseOwner) { this.leaseOwner = leaseOwner; }
    public LocalDateTime getLeaseExpiresAt() { return leaseExpiresAt; }
    public void setLeaseExpiresAt(LocalDateTime leaseExpiresAt) { this.leaseExpiresAt = leaseExpiresAt; }
    public Long getFencingToken() { return fencingToken; }
    public void setFencingToken(Long fencingToken) { this.fencingToken = fencingToken; }
    public String getStrategyVersion() { return strategyVersion; }
    public void setStrategyVersion(String strategyVersion) { this.strategyVersion = strategyVersion; }
    public LocalDateTime getExecutionDeadlineAt() { return executionDeadlineAt; }
    public void setExecutionDeadlineAt(LocalDateTime executionDeadlineAt) { this.executionDeadlineAt = executionDeadlineAt; }
    public LocalDateTime getEvidenceReconcileUntil() { return evidenceReconcileUntil; }
    public void setEvidenceReconcileUntil(LocalDateTime evidenceReconcileUntil) { this.evidenceReconcileUntil = evidenceReconcileUntil; }
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
}

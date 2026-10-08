package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("generation_jobs")
public class GenerationJobEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("project_id")
    private Long projectId;

    @TableField("user_id")
    private Long userId;

    @TableField("retry_of_job_id")
    private Long retryOfJobId;

    @TableField("type")
    private String type;

    @TableField("source")
    private String source;

    @TableField("status")
    private String status;

    @TableField("progress")
    private Integer progress;

    @TableField("output_asset_ids")
    private String outputAssetIds;

    @TableField("provider")
    private String provider;

    @TableField("provider_task_id")
    private String providerTaskId;

    @TableField("poll_count")
    private Integer pollCount;

    @TableField("retry_count")
    private Integer retryCount;

    @TableField("last_polled_at")
    private LocalDateTime lastPolledAt;

    @TableField("error")
    private String error;

    @TableField("lease_owner")
    private String leaseOwner;

    @TableField("lease_expires_at")
    private LocalDateTime leaseExpiresAt;

    @TableField("fencing_token")
    private Long fencingToken;

    @TableField("execution_deadline_at")
    private LocalDateTime executionDeadlineAt;

    @TableField("next_action_at")
    private LocalDateTime nextActionAt;

    @TableField("cancel_requested_at")
    private LocalDateTime cancelRequestedAt;

    @TableField("gmt_create")
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    private LocalDateTime gmtModified;

    @TableField("version")
    private Integer version;

    @TableField("is_delete")
    private Boolean isDelete;

    @TableField("input")
    private String input;

    @TableField("source_sample_job_id")
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

package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("agent_runs")
public class AgentRun extends BaseEntity {
    public static final String STATUS_QUEUED = "queued";
    public static final String STATUS_RUNNING = "running";
    public static final String STATUS_AWAITING_JOB = "awaiting_job";
    public static final String STATUS_AWAITING_INPUT = "awaiting_input";
    public static final String STATUS_COMPLETED = "completed";
    public static final String STATUS_RECOVERY_FAILED = "recovery_failed";
    // IK3BG2（ADR-0043）：Run 三种规范化收场——completed（无动作收尾轮）、superseded（被同
    // Conversation 新目标取代）、failed（Worker 错误 commit 接纳为终态）。recovery_failed 为
    // checkpoint 损坏隔离终态，同属「终态不可重开」。
    public static final String STATUS_SUPERSEDED = "superseded";
    public static final String STATUS_FAILED = "failed";
    private Long projectId;
    private Long conversationId;
    private Long userId;
    private String status;
    private String stage;
    private String engine;
    private String engineVersion;
    private Integer adapterSchemaVersion;
    private String bundleVersionId;
    private String manifestDigest;
    private String modelProfileId;
    private String modelProfileVersion;
    private String activatedCreativeSkillVersions;
    private String autoCreativeSkillCandidates;
    private String toolGrants;
    private Long currentCheckpointId;
    private Long confirmedInputRequestId;
    private String leaseOwner;
    private java.time.LocalDateTime leaseExpiresAt;
    private Long fencingToken;
    // IK3BG2（ADR-0043）：failed 终态的规范化错误码与脱敏消息（V15 新增可空列）。
    private String errorCode;
    private String errorMessage;
}

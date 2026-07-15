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
    public static final String STATUS_COMPLETED = "completed";
    public static final String STATUS_RECOVERY_FAILED = "recovery_failed";
    private Long projectId;
    private Long conversationId;
    private Long userId;
    private String status;
    private String stage;
    private String engine;
    private String engineVersion;
    private Integer adapterSchemaVersion;
    private Long currentCheckpointId;
    private String leaseOwner;
    private java.time.LocalDateTime leaseExpiresAt;
    private Long fencingToken;
}

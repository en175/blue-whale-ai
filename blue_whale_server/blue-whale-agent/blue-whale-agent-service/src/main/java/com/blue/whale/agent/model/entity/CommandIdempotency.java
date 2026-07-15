package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("command_idempotency")
public class CommandIdempotency extends BaseEntity {
    private Long projectId;
    private String operation;
    private String idempotencyKey;
    private String requestHash;
    private Long messageId;
    private Long agentRunId;
    private Long generationJobId;
    private Long acceptedCursor;
}

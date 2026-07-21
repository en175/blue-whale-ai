package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("assistant_message_streams")
public class AssistantMessageStream extends BaseEntity {
    public static final String STATUS_STREAMING = "streaming";
    public static final String STATUS_COMPLETED = "completed";
    public static final String STATUS_REJECTED = "rejected";
    public static final String STATUS_REVIEW_FAILED = "review_failed";

    private String streamId;
    private Long agentRunId;
    private Long projectId;
    private Long conversationId;
    private Long userId;
    private Long messageId;
    private String status;
    private Integer lastSequenceNo;
    private Integer releasedSequenceNo;
    private String startIdempotencyKey;
    private String completeIdempotencyKey;
    private String contentDigest;
}

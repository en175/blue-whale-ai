package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("conversation_messages")
public class ConversationMessage extends BaseEntity {
    public static final String ROLE_USER = "user";
    public static final String ROLE_ASSISTANT = "assistant";

    private Long conversationId;
    private Long projectId;
    private Long agentRunId;
    private String clientMessageId;
    private String role;
    private String content;
    private Integer sequenceNo;
}

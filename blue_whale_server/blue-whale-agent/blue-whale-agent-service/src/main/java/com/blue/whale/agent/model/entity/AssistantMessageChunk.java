package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("assistant_message_chunks")
public class AssistantMessageChunk extends BaseEntity {
    private Long assistantMessageStreamId;
    private Integer sequenceNo;
    private String idempotencyKey;
    private String content;
    private String contentDigest;
    private Boolean released;
}

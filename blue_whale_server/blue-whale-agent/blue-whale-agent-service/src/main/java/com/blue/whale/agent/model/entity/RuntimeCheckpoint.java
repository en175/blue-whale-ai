package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.util.Map;

@Getter
@Setter
@Accessors(chain = true)
@TableName(value = "runtime_checkpoints", autoResultMap = true)
public class RuntimeCheckpoint extends BaseEntity {
    private Long agentRunId;
    private Integer sequenceNo;
    private Integer runVersion;
    private String engine;
    private String engineVersion;
    private Integer adapterSchemaVersion;
    private String payloadDigest;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> opaquePayload;
}

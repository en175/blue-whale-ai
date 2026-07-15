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
@TableName(value = "seedance_callback_inbox", autoResultMap = true)
public class SeedanceCallbackInbox extends BaseEntity {

    private Long generationJobId;
    private String provider;
    private String accountId;
    private String providerTaskId;
    private String dedupKey;
    private String payloadHash;
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> payload;
}

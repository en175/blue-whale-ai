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
@TableName(value = "generation_job_outputs", autoResultMap = true)
public class GenerationJobOutput extends BaseEntity {

    public static final String STATUS_PENDING = "pending";
    public static final String STATUS_SUCCEEDED = "succeeded";
    public static final String STATUS_FAILED = "failed";

    private Long generationJobId;
    private Integer slotIndex;
    private Long assetId;
    private String deliveryId;
    private String contentSha256;
    private String status;
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> error;
}

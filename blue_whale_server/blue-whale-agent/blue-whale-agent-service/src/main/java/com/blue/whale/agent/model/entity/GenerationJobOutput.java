package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("generation_job_outputs")
public class GenerationJobOutput extends BaseEntity {

    private Long generationJobId;
    private Integer slotIndex;
    private Long assetId;
    private String deliveryId;
    private String contentSha256;
}

package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("generation_result_conflicts")
public class GenerationResultConflict extends BaseEntity {

    private Long generationJobId;
    private Integer slotIndex;
    private String attemptedDeliveryId;
    private String expectedContentSha256;
    private String actualContentSha256;
    private String reason;
}

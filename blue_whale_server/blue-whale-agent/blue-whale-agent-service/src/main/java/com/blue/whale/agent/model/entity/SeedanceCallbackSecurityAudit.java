package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("seedance_callback_security_audits")
public class SeedanceCallbackSecurityAudit extends BaseEntity {

    private Long generationJobId;
    private String accountId;
    private String providerTaskId;
    private String reason;
    private String payloadHash;
}

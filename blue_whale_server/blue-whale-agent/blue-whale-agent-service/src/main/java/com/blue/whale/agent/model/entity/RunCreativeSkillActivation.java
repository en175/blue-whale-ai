package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * Creative Skill auto 激活幂等记账（IK3NPF）。
 *
 * <p>Worker→Java 激活命令的幂等事实源：同 {@code (agent_run_id, idempotency_key)} 同载重放首次接纳响应
 * （契约 §4.4），{@code response_json} 存完整 {@code ActivateCreativeSkillResponse} 供逐字节回放；
 * {@code run_version} 记接纳后的新 Run version，便于审计。不绑 admin 写入路径。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("run_creative_skill_activations")
public class RunCreativeSkillActivation extends BaseEntity {
    private Long agentRunId;
    private String idempotencyKey;
    private String requestHash;
    private String responseJson;
    private Integer runVersion;
    private String creativeSkillId;
    private String creativeSkillVersionId;
}

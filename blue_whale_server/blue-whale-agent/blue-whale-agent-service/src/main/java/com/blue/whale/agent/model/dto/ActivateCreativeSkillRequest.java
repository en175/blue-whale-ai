package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import javax.validation.Valid;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import java.util.List;

/**
 * Worker→Java 自动激活 Creative Skill 命令请求体（契约 §5，IK3NPF）。
 *
 * <p>snake_case 经 {@code @JsonProperty} 锁定（全局 SNAKE_CASE 策略下双重保险）。{@code reason}
 * 为判别式 {@code agent_match}——{@code type} 非 {@code agent_match}、{@code matched_fields} 非法枚举
 * 或重复均由服务端 PARAM 校验拒。请求<b>不携带</b> {@code resource_digest}：digest 由 Java 从冻结
 * 候选权威回写（契约 §5）。
 */
public record ActivateCreativeSkillRequest(
        @JsonProperty("idempotency_key") @NotBlank @Size(min = 1, max = 64) String idempotencyKey,
        @JsonProperty("expected_run_version") @NotNull @Min(1) Integer expectedRunVersion,
        @JsonProperty("creative_skill_id") @NotBlank String creativeSkillId,
        @JsonProperty("creative_skill_version_id") @NotBlank String creativeSkillVersionId,
        @JsonProperty("reason") @Valid @NotNull Reason reason
) {

    public record Reason(
            @JsonProperty("type") @NotBlank String type,
            @JsonProperty("detail") @Valid @NotNull Detail detail
    ) {

        public record Detail(
                @JsonProperty("matched_fields") @NotNull @Size(min = 1) List<String> matchedFields
        ) {
        }
    }
}

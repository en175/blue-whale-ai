package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Worker→Java 自动激活 Creative Skill 命令接纳响应（契约 §5，IK3NPF）。
 *
 * <p>{@code accepted} 恒 {@code true}（拒绝走标准错误通道）；{@code activation} 为已固定的完整
 * 激活记录（Java 回写权威 {@code resource_digest}）；{@code run_version} 为固定后的新 Run version。
 * 全嵌套 record（非 Map）保证两次序列化字节稳定，满足同键同载逐字节回放（契约 §4.4）。
 */
public record ActivateCreativeSkillResponse(
        @JsonProperty("accepted") boolean accepted,
        @JsonProperty("activation") CreativeSkillActivationView activation,
        @JsonProperty("run_version") int runVersion
) {

    public record CreativeSkillActivationView(
            @JsonProperty("creative_skill_id") String creativeSkillId,
            @JsonProperty("creative_skill_version_id") String creativeSkillVersionId,
            @JsonProperty("source") String source,
            @JsonProperty("reason") Reason reason,
            @JsonProperty("resource_digest") String resourceDigest
    ) {

        public record Reason(
                @JsonProperty("type") String type,
                @JsonProperty("detail") Detail detail
        ) {

            public record Detail(
                    @JsonProperty("matched_fields") List<String> matchedFields
            ) {
            }
        }
    }
}

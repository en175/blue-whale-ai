import { describe, expect, it } from "vitest";

import {
  agentRunPinSchema,
  agentRunPublicProjectionSchema,
  agentRuntimeManifestSchema,
  autoCreativeSkillCandidateSchema,
  creativeSkillActivationSchema,
} from "./agent-runtime.js";

const digest = `sha256:${"a".repeat(64)}`;

describe("Node Agent Runtime Contract v1", () => {
  it("接受完整 Manifest，并拒绝候选和公开投影携带 Skill 正文", () => {
    const manifest = agentRuntimeManifestSchema.parse({
      schema_version: 1,
      manifest_id: "blue_whale_default",
      manifest_version: "1.0.0",
      manifest_digest: digest,
      resources: [
        {
          resource_id: "role.default",
          resource_version: "1.0.0",
          kind: "role",
          load_mode: "always_on",
          media_type: "text/markdown",
          content: "You are Blue Whale.",
          content_digest: digest,
        },
      ],
      role_resource_id: "role.default",
      rule_resource_ids: [],
      runtime_skill_resource_ids: [],
      model_profiles: [
        {
          model_profile_id: "fake.default",
          provider: "fake",
          model: "deterministic-v1",
          context_window_tokens: 8192,
          tokenizer: "fake-v1",
        },
      ],
      selected_model_profile_id: "fake.default",
      runtime_budget_policy: {
        max_provider_calls: 1,
        max_input_characters: 16000,
        max_output_characters: 4000,
        protocol_repair_attempts: 0,
      },
      tool_grants: [],
    });

    expect(manifest.role_resource_id).toBe("role.default");
    expect(
      autoCreativeSkillCandidateSchema.parse({
        creative_skill_id: "poster_copy",
        creative_skill_version_id: "7d344f0e-9f52-4d46-87c0-337990f94b70",
        name: "海报文案",
        description: null,
        display_version: "1.0.0",
        resource_digest: digest,
      }).creative_skill_version_id,
    ).toBe("7d344f0e-9f52-4d46-87c0-337990f94b70");
    expect(() =>
      autoCreativeSkillCandidateSchema.parse({
        creative_skill_id: "poster_copy",
        creative_skill_version_id: "poster_copy_v1",
        name: "海报文案",
        description: "生成海报文案",
        display_version: "1.0.0",
        resource_digest: digest,
        body: "private",
      }),
    ).toThrow();
    expect(() =>
      agentRunPublicProjectionSchema.parse({
        agent_run_id: "1",
        status: "completed",
        stage: "completed",
        version: 2,
        activated_creative_skill_versions: [],
        reasoning_summary: "已完成回答。",
        run_pin: {},
      }),
    ).toThrow();
  });

  it("把 RunPin 的激活数量固定为零或一", () => {
    const activation = creativeSkillActivationSchema.parse({
      creative_skill_id: "poster_copy",
      creative_skill_version_id: "poster_copy_v1",
      name: "海报文案",
      display_version: "1.0.0",
      resource_digest: digest,
      source: "forced_use",
      reason: { type: "user_use" },
    });

    expect(() =>
      agentRunPinSchema.parse({
        schema_version: 1,
        manifest_id: "blue_whale_default",
        manifest_version: "1.0.0",
        manifest_digest: digest,
        pin_digest: digest,
        resources: [
          {
            resource_id: "role.default",
            resource_version: "1.0.0",
            kind: "role",
            load_mode: "always_on",
            media_type: "text/markdown",
            content: "You are Blue Whale.",
            content_digest: digest,
          },
        ],
        role_resource_id: "role.default",
        rule_resource_ids: [],
        runtime_skill_resource_ids: [],
        model_profile: {
          model_profile_id: "fake.default",
          provider: "fake",
          model: "deterministic-v1",
          context_window_tokens: 8192,
          tokenizer: "fake-v1",
        },
        runtime_budget_policy: {
          max_provider_calls: 1,
          max_input_characters: 16000,
          max_output_characters: 4000,
          protocol_repair_attempts: 0,
        },
        tool_grants: [],
        auto_creative_skill_candidates: [],
        activated_creative_skill_versions: [activation, activation],
        creative_skill_resources: [],
      }),
    ).toThrow();
  });
});

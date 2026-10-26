import { describe, expect, it } from "vitest";

import {
  agentRunPinSchema,
  autoCreativeSkillCandidateSchema,
  creativeSkillActivationSchema,
} from "./agent-runtime.js";

const digest = `sha256:${"a".repeat(64)}`;

describe("Node Agent Runtime Contract v1", () => {
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

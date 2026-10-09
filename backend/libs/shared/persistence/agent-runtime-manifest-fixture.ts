import { createHash } from "node:crypto";
import { canonicalizeJsonValue } from "@lib/contracts";

const base = {
  schema_version: 1,
  manifest_id: "blue_whale_default",
  manifest_version: "1.0.0",
  resources: [
    {
      resource_id: "role.default",
      resource_version: "1.0.0",
      kind: "role",
      load_mode: "always_on",
      media_type: "text/markdown",
      content: "# Blue Whale Agent",
      content_digest: "",
    },
    {
      resource_id: "rule.ordinary_conversation",
      resource_version: "1.0.0",
      kind: "rule",
      load_mode: "always_on",
      media_type: "text/markdown",
      content: "# Ordinary Conversation",
      content_digest: "",
    },
  ],
  role_resource_id: "role.default",
  rule_resource_ids: ["rule.ordinary_conversation"],
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
    max_input_characters: 16_000,
    max_output_characters: 4_000,
    protocol_repair_attempts: 0,
  },
} as const;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const resources = base.resources.map((resource) => ({
  ...resource,
  content_digest: sha256(resource.content),
}));

export const bundledAgentRuntimeManifest = {
  ...base,
  resources,
  manifest_digest: sha256(
    JSON.stringify(
      canonicalizeJsonValue({
        schema_version: base.schema_version,
        manifest_id: base.manifest_id,
        manifest_version: base.manifest_version,
        resources,
        role_resource_id: base.role_resource_id,
        rule_resource_ids: base.rule_resource_ids,
        runtime_skill_resource_ids: base.runtime_skill_resource_ids,
        model_profiles: base.model_profiles,
        selected_model_profile_id: base.selected_model_profile_id,
        runtime_budget_policy: base.runtime_budget_policy,
      }),
    ),
  ),
};

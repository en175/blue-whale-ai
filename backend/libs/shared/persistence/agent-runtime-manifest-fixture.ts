// IKD1T2：packages/agent-runtime 退役后，原 runtime-manifest.ts 的 bundledAgentRuntimeManifest
// 测试夹具随包删除。skill-repo 与 agent-run-pin 的用例仍需要一个合法 RunPin 的 manifest 素材，
// 这里以最小内联夹具取代，仅供 RunPin **形状**校验（agentRunPinSchema.parse）使用——
// 不做 validateAgentRuntimeManifest 的跨字段完整性校验（该函数已随包删除）。
// 注意：这不是运行时权威配置。Agent 运行能力已迁往独立 Mastra 服务（决策日志 2026-08-11），
// 蓝鲸侧不再装配自研 agent manifest。
// 命名 *_fixture.ts：被 vitest 默认排除（不匹配 *.test.*），仅由 *.test.* 用例 import。
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

/** 资源 content_digest 补全（保持 fixture 内容自洽；跨字段完整性校验已随包删除，这里只为诚实）。 */
const resources = base.resources.map((resource) => ({
  ...resource,
  content_digest: sha256(resource.content),
}));

/** 与原 bundledAgentRuntimeManifest 同构的最小夹具（不含 tool_grants 派生）。 */
export const bundledAgentRuntimeManifest = {
  ...base,
  resources,
  // manifest_digest 由源码派生：sha256(canonicalize(base 去掉 digest 字段))（对齐原实现）。
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

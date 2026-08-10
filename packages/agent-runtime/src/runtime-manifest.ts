import {
  agentRuntimeManifestSchema,
  type AgentRuntimeManifest,
} from "@blue-whale/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";

import { READ_ASSET_TOOL } from "./read-asset-tool.js";
import { WRITE_PLAN_CARDS_TOOL } from "./write-plan-cards-tool.js";

const ROLE_CONTENT =
  "# Blue Whale Agent\n\nYou are Blue Whale, a creative collaborator. Answer the user's current request clearly and safely.";
const ORDINARY_CONVERSATION_RULE =
  "# Ordinary Conversation\n\nReturn one complete assistant message. Provide a short ReasoningSummary without revealing chain of thought.";
const REAL_AGENT_OUTPUT_PROTOCOL = `# 输出协议（必须遵守）

你的每次回复必须且只能是一个 JSON 对象，不要输出 JSON 以外的任何文本、解释或代码围栏。结构：

{
  "content": "给用户看的正式回复文本",
  "reasoning_summary": "一句话概述本轮处理结论（不暴露思维链）",
  "action": <动作>
}

action 四选一：
1. {"kind": "respond"} —— 普通问答。
2. {"kind": "clarify", "question": "追问内容", "stage": "alignment" | "awaiting_final_confirmation"} —— 需求未对齐时逐项追问；需求已齐、等待最终确认时 stage 取 "awaiting_final_confirmation"，并在 content 中复述需求。
3. {"kind": "cancel"} —— 用户要求停止或取消创作。
4. {"kind": "submit_plan", "cards": [...]} —— 用户明确确认后正式提交计划卡。

计划卡字段：
- application_kind："image_generate"（生成图片）| "scene_card_create"（新建场景卡）| "scene_card_replace"（覆盖既有场景卡）。scene_card_replace 必须独占整个 cards 批次，且必须填写十进制 target_scene_card_mention_id，取值来自可用引用投影中 type=scene_card 的 mention_id
- title：卡标题
- content_markdown：卡正文（Markdown）；引用素材用 asset://<mention_id> 内联
- summary：可选，一句话摘要
- sequence_label_noun：可选，多卡序列名词（如「分镜」）
- parameter_overrides：可选，生成参数覆盖 {"size", "aspect_ratio", "format", "duration", "count", "first_frame_mention_seq", "last_frame_mention_seq"}；duration/count 必须为正整数，mention_seq 从 0 开始；不确定的参数不要填，由系统默认补齐

创作/修改类请求先对齐需求：创作需明确主体与预期结果，修改需明确目标与变化；未对齐用 clarify 追问，对齐并经用户确认后才 submit_plan。`;

const MODEL_REGISTRY = new Set([
  "fake:deterministic-v1:fake-v1",
  // IK7EU4：经 new-api 网关的真实文本模型（种子 MiniMax-M3）。
  "newapi:MiniMax-M3:openai-compatible-v1",
]);

/** 模型注册表命中判断（IK7EU4）：manifest 校验与 worker RunPin 校验共用同一份
 *  注册表，替代此前硬编码的 fake 三元组。 */
export function isRegisteredAgentModelProfile(profile: {
  provider: string;
  model: string;
  tokenizer: string;
}): boolean {
  return MODEL_REGISTRY.has(
    `${profile.provider}:${profile.model}:${profile.tokenizer}`,
  );
}

/** Agent 产品工具注册表（T08，IK67H3）：限定工具表面只允许 read_asset 与
 *  write_plan_cards（AC#6）。每项带入参/出参校验 schema。 */
interface ToolRegistryEntry {
  tool_id: string;
  registry_version: number;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}
const TOOL_REGISTRY: readonly ToolRegistryEntry[] = [
  READ_ASSET_TOOL,
  WRITE_PLAN_CARDS_TOOL,
];
/** Agent 产品工具表面键集合（T08，AC#6）：`tool_id:registry_version`。
 *  manifest 校验与 worker 的 RunPin 工具闸共用同一份。 */
export const AGENT_TOOL_SURFACE_KEYS: ReadonlySet<string> = new Set(
  TOOL_REGISTRY.map((tool) => `${tool.tool_id}:${tool.registry_version}`),
);

const bundledManifestBase = {
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
      content: ROLE_CONTENT,
      content_digest:
        "sha256:bb6b109327164994aaa053ca52fa0c7018c8a1cb9fbd6b1178c58a0a18dca4b0",
    },
    {
      resource_id: "rule.ordinary_conversation",
      resource_version: "1.0.0",
      kind: "rule",
      load_mode: "always_on",
      media_type: "text/markdown",
      content: ORDINARY_CONVERSATION_RULE,
      content_digest:
        "sha256:057fba21ffd34d8f1ac70b21e77dc3e14f804ed209c04e03a8b4428b0b58932e",
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
    {
      // IK7EU4：经 new-api 网关的真实文本模型 profile（默认不选中，
      // 由 resolveAgentRuntimeManifest 按 AGENT_RUNTIME_MODE=real 切换）。
      model_profile_id: "newapi.minimax_m3",
      provider: "newapi",
      model: "MiniMax-M3",
      context_window_tokens: 8192,
      tokenizer: "openai-compatible-v1",
    },
  ],
  selected_model_profile_id: "fake.default",
  runtime_budget_policy: {
    max_provider_calls: 1,
    max_input_characters: 16_000,
    max_output_characters: 4_000,
    protocol_repair_attempts: 0,
  },
  tool_grants: TOOL_REGISTRY.map((tool) => ({
    tool_id: tool.tool_id,
    registry_version: tool.registry_version,
  })),
} as const;

/** manifest_digest 由源码派生（IK7EU4：双 profile 后不再手工维护硬编码摘要，
 *  改动 manifest 内容不必同步改摘要字符串）；validate 仍保证 digest 与内容自洽。
 *  sha256/canonicalize 为 function 声明，提升后可在模块初始化期调用。 */
function withManifestDigest<T extends object>(
  base: T,
): T & { manifest_digest: string } {
  return {
    ...base,
    manifest_digest: sha256(JSON.stringify(canonicalize(base))),
  };
}

const bundledManifestSource = withManifestDigest(bundledManifestBase);

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`invalid AgentRuntimeManifest: duplicate ${label}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

export function validateAgentRuntimeManifest(
  input: unknown,
): AgentRuntimeManifest {
  const parsed = agentRuntimeManifestSchema.parse(input);
  requireUnique(
    parsed.resources.map((resource) => resource.resource_id),
    "resource identity",
  );
  requireUnique(
    parsed.model_profiles.map((profile) => profile.model_profile_id),
    "model profile identity",
  );
  requireUnique(parsed.rule_resource_ids, "rule resource reference");
  requireUnique(
    parsed.runtime_skill_resource_ids,
    "runtime skill resource reference",
  );
  requireUnique(
    parsed.tool_grants.map(
      (grant) => `${grant.tool_id}:${grant.registry_version}`,
    ),
    "tool grant",
  );

  const resources = new Map(
    parsed.resources.map((resource) => [resource.resource_id, resource]),
  );
  for (const resource of parsed.resources) {
    if (sha256(resource.content) !== resource.content_digest) {
      throw new Error(
        `invalid AgentRuntimeManifest: resource digest mismatch (${resource.resource_id})`,
      );
    }
  }

  const roleResources = parsed.resources.filter(
    (resource) => resource.kind === "role",
  );
  const role = resources.get(parsed.role_resource_id);
  if (
    roleResources.length !== 1 ||
    !role ||
    role.kind !== "role" ||
    role.load_mode !== "always_on"
  ) {
    throw new Error("invalid AgentRuntimeManifest: role resource reference");
  }
  for (const resourceId of parsed.rule_resource_ids) {
    if (resources.get(resourceId)?.kind !== "rule") {
      throw new Error("invalid AgentRuntimeManifest: rule resource reference");
    }
  }
  for (const resourceId of parsed.runtime_skill_resource_ids) {
    if (resources.get(resourceId)?.kind !== "runtime_skill") {
      throw new Error(
        "invalid AgentRuntimeManifest: runtime skill resource reference",
      );
    }
  }
  const referencedResources = new Set([
    parsed.role_resource_id,
    ...parsed.rule_resource_ids,
    ...parsed.runtime_skill_resource_ids,
  ]);
  if (referencedResources.size !== parsed.resources.length) {
    throw new Error("invalid AgentRuntimeManifest: unreferenced resource");
  }

  const selectedProfile = parsed.model_profiles.find(
    (profile) =>
      profile.model_profile_id === parsed.selected_model_profile_id,
  );
  if (!selectedProfile) {
    throw new Error("invalid AgentRuntimeManifest: model profile reference");
  }
  for (const profile of parsed.model_profiles) {
    if (!isRegisteredAgentModelProfile(profile)) {
      throw new Error("invalid AgentRuntimeManifest: model registry reference");
    }
  }
  for (const grant of parsed.tool_grants) {
    if (!AGENT_TOOL_SURFACE_KEYS.has(`${grant.tool_id}:${grant.registry_version}`)) {
      throw new Error("invalid AgentRuntimeManifest: tool registry reference");
    }
  }

  const { manifest_digest: manifestDigest, ...digestSource } = parsed;
  if (sha256(JSON.stringify(canonicalize(digestSource))) !== manifestDigest) {
    throw new Error("invalid AgentRuntimeManifest: manifest digest mismatch");
  }

  return deepFreeze(structuredClone(parsed));
}

export const bundledAgentRuntimeManifest = validateAgentRuntimeManifest(
  bundledManifestSource,
);

export type AgentRuntimeEnv = Record<string, string | undefined>;

let cachedRealManifest: AgentRuntimeManifest | null = null;

/** 按 AGENT_RUNTIME_MODE 选择运行时 manifest（IK7EU4）：
 *  - fake（默认/缺省）：返回 bundled manifest 本体，行为与 Slice 0 完全一致；
 *  - real：返回选中 newapi.minimax_m3 的变体（digest 重算、完整校验）；
 *  - 其它取值：拒绝启动。
 *  BFF（conversation/generation-inbox deps、instrumentation）与 agent-worker
 *  共用本函数，保证 RunPin 的 model_profile 与 worker 装配的适配器一致。 */
export function resolveAgentRuntimeManifest(
  env: AgentRuntimeEnv = process.env,
): AgentRuntimeManifest {
  const mode = env.AGENT_RUNTIME_MODE?.trim() || "fake";
  if (mode === "fake") return bundledAgentRuntimeManifest;
  if (mode !== "real") {
    throw new Error(`unsupported AGENT_RUNTIME_MODE=${mode}`);
  }
  if (!cachedRealManifest) {
    cachedRealManifest = validateAgentRuntimeManifest(
      withManifestDigest({
        ...bundledManifestBase,
        resources: [
          ...bundledManifestBase.resources,
          {
            resource_id: "rule.real_agent_output_protocol",
            resource_version: "1.0.0",
            kind: "rule",
            load_mode: "always_on",
            media_type: "text/markdown",
            content: REAL_AGENT_OUTPUT_PROTOCOL,
            content_digest: sha256(REAL_AGENT_OUTPUT_PROTOCOL),
          },
        ],
        rule_resource_ids: [
          ...bundledManifestBase.rule_resource_ids,
          "rule.real_agent_output_protocol",
        ],
        selected_model_profile_id: "newapi.minimax_m3",
      }),
    );
  }
  return cachedRealManifest;
}

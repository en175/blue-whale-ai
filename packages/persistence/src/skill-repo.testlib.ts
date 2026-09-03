// IK74V8：SkillRepo 用例的共享夹具（从 skill-repo.test.ts 拆出）。
// 命名 *.testlib.ts：tsconfig 排除编译、vitest 不当作用例文件收集。
import {expect, vi} from "vitest";
import {bundledAgentRuntimeManifest} from "../../agent-runtime/src/runtime-manifest.js";
import {canonicalAgentRunPinDigestInput, type AgentRunPin} from "@blue-whale/contracts";
import {createHash} from "node:crypto";

// SkillRepo 资产边界（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§3/§6/§11）：
// wire 主键一律 creative_skill_id；自增 id/skill_id、content/body/prompt 永不出库；
// mine = 官方引用（official）∪ 名下个人技能（personal）；个人技能跨用户按不存在处理；
// library v2（IK60WT）：分类过滤、featured/most_used/newest 排序、zh/en 语言解析、
// keyword 命中解析语言 name/description + search_keywords（绝不匹配 content）、
// usage_count = creative_skill_activation COUNT(DISTINCT user_id)。

export const FORBIDDEN_KEYS = ["content", "body", "prompt", "id", "skill_id"];

export function expectWhitelistOnly(records: Record<string, unknown>[]) {
  for (const record of records) {
    for (const key of Object.keys(record)) {
      expect(FORBIDDEN_KEYS).not.toContain(key);
    }
  }
}

// deletePersonal 交互事务 mock（先例：createPersonalSkill 的 $transaction(async cb => cb(tx))）。
export function withTransaction(
  tx: Record<string, unknown>,
): { $transaction: ReturnType<typeof vi.fn> } {
  return {
    $transaction: vi.fn(
      async (cb: (t: Record<string, unknown>) => Promise<unknown>) => cb(tx),
    ),
  };
}

// RunPin fixture（IKCKOW：原 agent-run-repo.test.ts 已删，保留 fixture 供 skill-repo 用例）。
export const runPinSource: Omit<AgentRunPin, "pin_digest"> = {
  schema_version: 1 as const,
  manifest_id: bundledAgentRuntimeManifest.manifest_id,
  manifest_version: bundledAgentRuntimeManifest.manifest_version,
  manifest_digest: bundledAgentRuntimeManifest.manifest_digest,
  resources: structuredClone(bundledAgentRuntimeManifest.resources),
  role_resource_id: bundledAgentRuntimeManifest.role_resource_id,
  rule_resource_ids: structuredClone(
    bundledAgentRuntimeManifest.rule_resource_ids,
  ),
  runtime_skill_resource_ids: structuredClone(
    bundledAgentRuntimeManifest.runtime_skill_resource_ids,
  ),
  model_profile: structuredClone(
    bundledAgentRuntimeManifest.model_profiles[0]!,
  ),
  runtime_budget_policy: bundledAgentRuntimeManifest.runtime_budget_policy,
  tool_grants: [],
  auto_creative_skill_candidates: [],
  activated_creative_skill_versions: [],
  creative_skill_resources: [],
};

export function signRunPin(source: Omit<AgentRunPin, "pin_digest">): AgentRunPin {
  return {
    ...source,
    pin_digest: `sha256:${createHash("sha256")
      .update(canonicalAgentRunPinDigestInput(source))
      .digest("hex")}`,
  };
}

export function resourceOf(
  creativeSkillId: string,
  name: string,
  body: string,
): AgentRunPin["creative_skill_resources"][number] {
  return {
    creative_skill_id: creativeSkillId,
    creative_skill_version_id: `version.${creativeSkillId}.1`,
    name,
    description: `${name}简介`,
    display_version: "1.0.0",
    resource_digest: `sha256:${"a".repeat(64)}`,
    media_type: "text/markdown",
    body,
    content_digest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
  };
}

export function candidateOf(
  resource: AgentRunPin["creative_skill_resources"][number],
): AgentRunPin["auto_creative_skill_candidates"][number] {
  const {
    media_type: _mediaType,
    body: _body,
    content_digest: _contentDigest,
    ...candidate
  } = resource;
  return candidate;
}

export function activationOf(
  resource: AgentRunPin["creative_skill_resources"][number],
): AgentRunPin["activated_creative_skill_versions"][number] {
  return {
    creative_skill_id: resource.creative_skill_id,
    creative_skill_version_id: resource.creative_skill_version_id,
    name: resource.name,
    display_version: resource.display_version,
    resource_digest: resource.resource_digest,
    source: "auto",
    reason: {
      type: "agent_match",
      detail: { matched_fields: ["conversation_messages"] },
    },
  };
}

export const TARGET_BODY = "# 故事板助手\n\n分镜规划正文";
export const TARGET_RESOURCE = resourceOf("story_board", "故事板助手", TARGET_BODY);
export const OTHER_RESOURCE = resourceOf(
  "poster_expert",
  "海报专家",
  "# 海报专家\n\n海报设计正文",
);

export function pinWithSkills(
  resources: AgentRunPin["creative_skill_resources"],
): AgentRunPin {
  return signRunPin({
    ...runPinSource,
    auto_creative_skill_candidates: resources.map(candidateOf),
    // schema 约束 activated_creative_skill_versions 至多 1 个（确定性 auto 激活），fixture 对齐
    activated_creative_skill_versions: resources
      .slice(0, 1)
      .map(activationOf),
    creative_skill_resources: resources,
  });
}

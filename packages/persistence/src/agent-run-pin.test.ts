import { describe, expect, it } from "vitest";
import { bundledAgentRuntimeManifest } from "../../agent-runtime/src/runtime-manifest.js";
import {
  agentRunPinSchema,
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
} from "@blue-whale/contracts";
import { createHash } from "node:crypto";

import { scrubCreativeSkillFromRunPin } from "./agent-run-pin.js";

const runPinSource: Omit<AgentRunPin, "pin_digest"> = {
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

function signRunPin(source: Omit<AgentRunPin, "pin_digest">): AgentRunPin {
  return {
    ...source,
    pin_digest: `sha256:${createHash("sha256")
      .update(canonicalAgentRunPinDigestInput(source))
      .digest("hex")}`,
  };
}

const TARGET_ID = "story_board";
const OTHER_ID = "poster_expert";

function resourceOf(
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

function candidateOf(
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

function activationOf(
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

const TARGET_BODY = "# 故事板助手\n\n分镜规划正文";
const OTHER_BODY = "# 海报专家\n\n海报设计正文";
const TARGET_RESOURCE = resourceOf(TARGET_ID, "故事板助手", TARGET_BODY);
const OTHER_RESOURCE = resourceOf(OTHER_ID, "海报专家", OTHER_BODY);

// schema 约束 activated_creative_skill_versions 至多 1 个（确定性 auto 激活），fixture 对齐。
const TARGET_PIN = signRunPin({
  ...runPinSource,
  auto_creative_skill_candidates: [
    candidateOf(TARGET_RESOURCE),
    candidateOf(OTHER_RESOURCE),
  ],
  activated_creative_skill_versions: [activationOf(TARGET_RESOURCE)],
  creative_skill_resources: [TARGET_RESOURCE, OTHER_RESOURCE],
});

// 仅含 OTHER 技能的 pin（用于幂等/无目标断言）。
const OTHER_ONLY_PIN = signRunPin({
  ...runPinSource,
  auto_creative_skill_candidates: [candidateOf(OTHER_RESOURCE)],
  activated_creative_skill_versions: [activationOf(OTHER_RESOURCE)],
  creative_skill_resources: [OTHER_RESOURCE],
});

describe("scrubCreativeSkillFromRunPin", () => {
  it("移除目标技能正文供应（candidates/resources），保留其他技能含 body 条目", () => {
    const scrubbed = scrubCreativeSkillFromRunPin(TARGET_PIN, TARGET_ID);
    expect(scrubbed.auto_creative_skill_candidates).toEqual([
      candidateOf(OTHER_RESOURCE),
    ]);
    expect(scrubbed.creative_skill_resources).toEqual([OTHER_RESOURCE]);
    expect(scrubbed.creative_skill_resources[0]!.body).toBe(OTHER_BODY);
  });

  it("保留 activated_creative_skill_versions（不含 body 的「曾使用」最小事实）", () => {
    const scrubbed = scrubCreativeSkillFromRunPin(TARGET_PIN, TARGET_ID);
    expect(scrubbed.activated_creative_skill_versions).toEqual(
      TARGET_PIN.activated_creative_skill_versions,
    );
  });

  it("重算 pin_digest 且与契约规范化输入同构（可被 signRunPin 复验）", () => {
    const scrubbed = scrubCreativeSkillFromRunPin(TARGET_PIN, TARGET_ID);
    const { pin_digest: _pinDigest, ...scrubbedSource } = scrubbed;
    expect(scrubbed.pin_digest).toBe(
      signRunPin(scrubbedSource).pin_digest,
    );
  });

  it("输出通过 agentRunPinSchema 自检（含 .strict()）", () => {
    const scrubbed = scrubCreativeSkillFromRunPin(TARGET_PIN, TARGET_ID);
    expect(agentRunPinSchema.safeParse(scrubbed).success).toBe(true);
  });

  it("幂等：两次 scrub 结果一致", () => {
    const once = scrubCreativeSkillFromRunPin(TARGET_PIN, TARGET_ID);
    const twice = scrubCreativeSkillFromRunPin(once, TARGET_ID);
    expect(twice).toStrictEqual(once);
  });

  it("无目标技能时输出与输入等价（含 digest）", () => {
    const scrubbed = scrubCreativeSkillFromRunPin(OTHER_ONLY_PIN, TARGET_ID);
    expect(scrubbed).toStrictEqual(OTHER_ONLY_PIN);
  });
});

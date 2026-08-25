import {
  agentRunPinSchema,
  canonicalAgentRunPinDigestInput,
  type AgentRuntimeManifest,
  type AgentRunPin,
  type CreativeSkillActivation,
  type CreativeSkillResource,
} from "@blue-whale/contracts";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

export type BuildAgentRunPinResult =
  { kind: "ready"; pin: AgentRunPin } | { kind: "creative_skill_unavailable" };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function toResource(
  skill: {
    creative_skill_id: string;
    name: string;
    description: string | null;
  },
  version: {
    creative_skill_version_id: string;
    display_version: string;
    body: string;
    content_digest: string;
    resource_digest: string;
    media_type: string;
  },
): CreativeSkillResource | null {
  if (
    version.media_type !== "text/markdown" ||
    sha256(version.body) !== version.content_digest ||
    version.resource_digest !== version.content_digest
  ) {
    return null;
  }
  return {
    creative_skill_id: skill.creative_skill_id,
    creative_skill_version_id: version.creative_skill_version_id,
    name: skill.name,
    description: skill.description,
    display_version: version.display_version,
    resource_digest: version.resource_digest,
    media_type: "text/markdown",
    body: version.body,
    content_digest: version.content_digest,
  };
}

async function resolveForcedSkill(
  tx: Prisma.TransactionClient,
  userId: bigint,
  creativeSkillId: string,
): Promise<{
  activation: CreativeSkillActivation;
  resource: CreativeSkillResource;
} | null> {
  const skill = await tx.creative_skill.findFirst({
    where: {
      creative_skill_id: creativeSkillId,
      active_version_id: { not: null },
      OR: [
        { asset_domain: "official", owner_user_id: 0n },
        { asset_domain: "personal", owner_user_id: userId },
      ],
    },
  });
  if (!skill?.active_version_id) return null;
  const version = await tx.creative_skill_version.findFirst({
    where: {
      creative_skill_version_id: skill.active_version_id,
      creative_skill_id: skill.creative_skill_id,
    },
  });
  if (!version) return null;
  const resource = toResource(skill, version);
  if (!resource) return null;
  return {
    resource,
    activation: {
      creative_skill_id: resource.creative_skill_id,
      creative_skill_version_id: resource.creative_skill_version_id,
      name: resource.name,
      display_version: resource.display_version,
      resource_digest: resource.resource_digest,
      source: "forced_use",
      reason: { type: "user_use" },
    },
  };
}

/** 从 RunPin 移除指定个人技能的正文供应（契约 §13.2，IK6B2H）：
 *  从 auto_creative_skill_candidates / creative_skill_resources 移除该
 *  creative_skill_id 的全部条目（正文供应随之消失），保留
 *  activated_creative_skill_versions（不含 body，天然是「曾使用」最小事实）；
 *  重算 pin_digest 保持快照内部自洽。幂等：pin 中无该技能时输出与输入等价。 */
export function scrubCreativeSkillFromRunPin(
  pin: AgentRunPin,
  creativeSkillId: string,
): AgentRunPin {
  const { pin_digest: _pinDigest, ...pinSource } = pin;
  const scrubbed: Omit<AgentRunPin, "pin_digest"> = {
    ...pinSource,
    auto_creative_skill_candidates: pinSource.auto_creative_skill_candidates.filter(
      (candidate) => candidate.creative_skill_id !== creativeSkillId,
    ),
    creative_skill_resources: pinSource.creative_skill_resources.filter(
      (resource) => resource.creative_skill_id !== creativeSkillId,
    ),
  };
  const result: AgentRunPin = {
    ...scrubbed,
    pin_digest: sha256(canonicalAgentRunPinDigestInput(scrubbed)),
  };
  // parse 仅校验；返回值不取自 parse——zod 按 schema 定义序重建 key（pin_digest
  // 提前），会使「无变化 scrub」的 JSON 字符串与原始值不等价，破坏调用方 no-op 判断。
  agentRunPinSchema.parse(result);
  return result;
}

export async function buildAgentRunPin(
  tx: Prisma.TransactionClient,
  userId: bigint,
  forcedCreativeSkillId: string | null,
  manifest: AgentRuntimeManifest,
): Promise<BuildAgentRunPinResult> {
  const modelProfile = manifest.model_profiles.find(
    (profile) =>
      profile.model_profile_id === manifest.selected_model_profile_id,
  );
  if (!modelProfile)
    throw new Error("validated manifest is missing its selected model");

  const forced = forcedCreativeSkillId
    ? await resolveForcedSkill(tx, userId, forcedCreativeSkillId)
    : null;
  if (forcedCreativeSkillId && !forced) {
    return { kind: "creative_skill_unavailable" };
  }
  // 技能只在用户显式点选时生效（IKB1WA）：服务端不再按 user_skill.auto /
  // creative_skill.auto_match 挑候选，无 forced 指定时不激活任何技能。
  // pin 的两个 auto 字段保留为空数组——契约结构不变，存量 pin 仍可解析。
  const activations = forced ? [forced.activation] : [];

  const pinSource: Omit<AgentRunPin, "pin_digest"> = {
    schema_version: 1,
    manifest_id: manifest.manifest_id,
    manifest_version: manifest.manifest_version,
    manifest_digest: manifest.manifest_digest,
    resources: structuredClone(manifest.resources),
    role_resource_id: manifest.role_resource_id,
    rule_resource_ids: structuredClone(manifest.rule_resource_ids),
    runtime_skill_resource_ids: structuredClone(
      manifest.runtime_skill_resource_ids,
    ),
    model_profile: structuredClone(modelProfile),
    runtime_budget_policy: structuredClone(manifest.runtime_budget_policy),
    tool_grants: structuredClone(manifest.tool_grants),
    auto_creative_skill_candidates: [],
    activated_creative_skill_versions: activations,
    creative_skill_resources: forced ? [forced.resource] : [],
  };
  const pin = agentRunPinSchema.parse({
    ...pinSource,
    pin_digest: sha256(canonicalAgentRunPinDigestInput(pinSource)),
  });
  return { kind: "ready", pin };
}

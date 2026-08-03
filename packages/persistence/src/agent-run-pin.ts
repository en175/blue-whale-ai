import {
  agentRunPinSchema,
  canonicalAgentRunPinDigestInput,
  type AgentRuntimeManifest,
  type AgentRunPin,
  type AutoCreativeSkillCandidate,
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

function toCandidate(
  resource: CreativeSkillResource,
): AutoCreativeSkillCandidate {
  const {
    media_type: _mediaType,
    body: _body,
    content_digest: _contentDigest,
    ...candidate
  } = resource;
  return candidate;
}

/** 服务端确定性 auto 激活（资产契约 §16.2，IK60X2）：无 forced 时取排序后首个候选，
 *  reason 对齐激活契约 §4.3 的 agent_match 结构（schema 锁定）。 */
function toAutoActivation(
  resource: CreativeSkillResource,
): CreativeSkillActivation {
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

async function resolveAutoSkills(
  tx: Prisma.TransactionClient,
  userId: bigint,
): Promise<{
  candidates: AutoCreativeSkillCandidate[];
  resources: CreativeSkillResource[];
} | null> {
  const enabled = await tx.user_skill.findMany({
    where: { user_id: userId, auto: 1, is_delete: 0 },
    select: { skill_id: true },
  });
  const officialSkills =
    enabled.length === 0
      ? []
      : await tx.creative_skill.findMany({
          where: {
            source_skill_id: { in: enabled.map((entry) => entry.skill_id) },
            asset_domain: "official",
            owner_user_id: 0n,
            active_version_id: { not: null },
          },
        });
  // 个人技能本体开关（资产契约 §16.2，IK60X2）：与官方引用候选并入同一资格池。
  const personalSkills = await tx.creative_skill.findMany({
    where: {
      asset_domain: "personal",
      owner_user_id: userId,
      auto_match: 1,
      active_version_id: { not: null },
    },
  });
  const skills = [...officialSkills, ...personalSkills];
  if (skills.length === 0) return { candidates: [], resources: [] };
  const versionIds = skills.flatMap((skill) =>
    skill.active_version_id ? [skill.active_version_id] : [],
  );
  const versions = await tx.creative_skill_version.findMany({
    where: { creative_skill_version_id: { in: versionIds } },
  });
  const versionsById = new Map(
    versions.map((version) => [version.creative_skill_version_id, version]),
  );
  const resources: CreativeSkillResource[] = [];
  for (const skill of skills) {
    const version = skill.active_version_id
      ? versionsById.get(skill.active_version_id)
      : undefined;
    if (!version || version.creative_skill_id !== skill.creative_skill_id)
      return null;
    const resource = toResource(skill, version);
    if (!resource) return null;
    resources.push(resource);
  }
  // 码位序（ID 字符集 ^[a-z][a-z0-9_]{2,79}$），跨运行环境严格确定性（§16.2）。
  resources.sort((left, right) =>
    left.creative_skill_id < right.creative_skill_id
      ? -1
      : left.creative_skill_id > right.creative_skill_id
        ? 1
        : 0,
  );
  return { candidates: resources.map(toCandidate), resources };
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
  const auto = forced
    ? { candidates: [], resources: [] }
    : await resolveAutoSkills(tx, userId);
  if (!auto) return { kind: "creative_skill_unavailable" };
  // 直接指定始终覆盖自动匹配；无 forced 且候选非空时确定性激活至多一个（§16.2）。
  const firstAutoResource = auto.resources[0];
  const autoActivation =
    !forced && firstAutoResource ? toAutoActivation(firstAutoResource) : null;
  const activations = forced
    ? [forced.activation]
    : autoActivation
      ? [autoActivation]
      : [];

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
    auto_creative_skill_candidates: auto.candidates,
    activated_creative_skill_versions: activations,
    creative_skill_resources: forced ? [forced.resource] : auto.resources,
  };
  const pin = agentRunPinSchema.parse({
    ...pinSource,
    pin_digest: sha256(canonicalAgentRunPinDigestInput(pinSource)),
  });
  return { kind: "ready", pin };
}

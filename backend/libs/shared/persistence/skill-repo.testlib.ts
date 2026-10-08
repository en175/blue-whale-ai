import {expect, vi} from "vitest";
import {bundledAgentRuntimeManifest} from "./agent-runtime-manifest-fixture.js";
import {canonicalAgentRunPinDigestInput, type AgentRunPin} from "@lib/contracts";
import {createHash} from "node:crypto";


export const FORBIDDEN_KEYS = ["content", "body", "prompt", "id", "skill_id"];

export function expectWhitelistOnly(records: Record<string, unknown>[]) {
  for (const record of records) {
    for (const key of Object.keys(record)) {
      expect(FORBIDDEN_KEYS).not.toContain(key);
    }
  }
}

export function withTransaction(
  tx: Record<string, unknown>,
): { $transaction: ReturnType<typeof vi.fn> } {
  return {
    $transaction: vi.fn(
      async (cb: (t: Record<string, unknown>) => Promise<unknown>) => cb(tx),
    ),
  };
}

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
    activated_creative_skill_versions: resources
      .slice(0, 1)
      .map(activationOf),
    creative_skill_resources: resources,
  });
}

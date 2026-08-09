// IK74V8：从 worker-loop.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// RunPin 校验与运行时请求装配：摘要计算、资源唯一性、工具面与提示词构造。
import { createHash } from "node:crypto";

import {
  AGENT_TOOL_SURFACE_KEYS,
} from "@blue-whale/agent-runtime";
import type { AgentAdapter } from "@blue-whale/core";
import {
  agentRunWorkSchema,
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
  type AutoCreativeSkillActivation,
} from "@blue-whale/contracts";
import type { AgentRunWork } from "@blue-whale/persistence";

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function commitDigest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`runtime_pin_duplicate_${label}`);
  }
}

export function validateRunPin(pin: AgentRunPin, prompt: string): string[] {
  const { pin_digest: pinDigest, ...pinSource } = pin;
  if (sha256(canonicalAgentRunPinDigestInput(pinSource)) !== pinDigest) {
    throw new Error("runtime_pin_digest_mismatch");
  }

  requireUnique(
    pin.resources.map((resource) => resource.resource_id),
    "resource",
  );
  requireUnique(pin.rule_resource_ids, "rule_reference");
  requireUnique(pin.runtime_skill_resource_ids, "runtime_skill_reference");
  const resources = new Map(
    pin.resources.map((resource) => [resource.resource_id, resource]),
  );
  for (const resource of pin.resources) {
    if (sha256(resource.content) !== resource.content_digest) {
      throw new Error(
        `runtime_resource_digest_mismatch:${resource.resource_id}`,
      );
    }
  }

  const role = resources.get(pin.role_resource_id);
  if (
    pin.resources.filter((resource) => resource.kind === "role").length !== 1 ||
    role?.kind !== "role" ||
    role.load_mode !== "always_on"
  ) {
    throw new Error("runtime_pin_role_reference_invalid");
  }
  for (const resourceId of pin.rule_resource_ids) {
    if (resources.get(resourceId)?.kind !== "rule") {
      throw new Error(`runtime_pin_rule_reference_invalid:${resourceId}`);
    }
  }
  for (const resourceId of pin.runtime_skill_resource_ids) {
    if (resources.get(resourceId)?.kind !== "runtime_skill") {
      throw new Error(
        `runtime_pin_runtime_skill_reference_invalid:${resourceId}`,
      );
    }
  }
  const instructionResourceIds = [
    pin.role_resource_id,
    ...pin.rule_resource_ids,
    ...pin.runtime_skill_resource_ids,
  ];
  if (new Set(instructionResourceIds).size !== pin.resources.length) {
    throw new Error("runtime_pin_unreferenced_resource");
  }

  const profile = pin.model_profile;
  if (
    profile.provider !== "fake" ||
    profile.model !== "deterministic-v1" ||
    profile.tokenizer !== "fake-v1"
  ) {
    throw new Error("runtime_pin_model_reference_invalid");
  }
  // 工具表面限定（T08，AC#6）：放开 read_asset/write_plan_cards 两道闸，但禁止
  // 任何其它工具（数据库、任意 HTTP、SceneCard 写、生成、Canvas 写等）。
  for (const grant of pin.tool_grants) {
    if (
      !AGENT_TOOL_SURFACE_KEYS.has(
        `${grant.tool_id}:${grant.registry_version}`,
      )
    ) {
      throw new Error("runtime_pin_tool_reference_invalid");
    }
  }
  if (
    pin.runtime_budget_policy.max_provider_calls !== 1 ||
    pin.runtime_budget_policy.protocol_repair_attempts !== 0
  ) {
    throw new Error("runtime_pin_budget_invalid");
  }
  if (prompt.length > pin.runtime_budget_policy.max_input_characters) {
    throw new Error("runtime_input_budget_exceeded");
  }
  return instructionResourceIds.map((resourceId) => {
    const resource = resources.get(resourceId);
    if (!resource)
      throw new Error(`runtime_pin_resource_missing:${resourceId}`);
    return resource.content;
  });
}

export function runtimeRequest(work: AgentRunWork): {
  request: Parameters<AgentAdapter["invoke"]>[0];
  autoActivation: AutoCreativeSkillActivation | null;
  maxOutputCharacters: number;
} {
  const {
    conversationId: _conversationId,
    userId: _userId,
    skillSummarize: _skillSummarize,
    ...contractWork
  } = work;
  const parsed = agentRunWorkSchema.parse(contractWork);
  if (
    JSON.stringify(parsed.auto_creative_skill_candidates) !==
      JSON.stringify(parsed.run_pin.auto_creative_skill_candidates) ||
    JSON.stringify(parsed.activated_creative_skill_versions) !==
      JSON.stringify(parsed.run_pin.activated_creative_skill_versions)
  ) {
    throw new Error("agent_work_run_pin_projection_mismatch");
  }
  const runtimeInstructions = validateRunPin(parsed.run_pin, parsed.prompt);
  for (const resource of parsed.run_pin.creative_skill_resources) {
    if (
      sha256(resource.body) !== resource.content_digest ||
      resource.resource_digest !== resource.content_digest
    ) {
      throw new Error(
        `creative_skill_digest_mismatch:${resource.creative_skill_version_id}`,
      );
    }
  }

  const forced = parsed.run_pin.activated_creative_skill_versions[0] ?? null;
  const matchedCandidate = forced
    ? null
    : (parsed.run_pin.auto_creative_skill_candidates.find(
        (candidate) =>
          parsed.prompt.trim() === candidate.name ||
          parsed.prompt.trim() === candidate.creative_skill_id,
      ) ?? null);
  const autoActivation: AutoCreativeSkillActivation | null = matchedCandidate
    ? {
        creative_skill_id: matchedCandidate.creative_skill_id,
        creative_skill_version_id: matchedCandidate.creative_skill_version_id,
        name: matchedCandidate.name,
        display_version: matchedCandidate.display_version,
        resource_digest: matchedCandidate.resource_digest,
        source: "auto",
        reason: {
          type: "agent_match",
          detail: { matched_fields: ["conversation_messages"] },
        },
      }
    : null;
  const activation = forced ?? autoActivation;
  const skillResource = activation
    ? parsed.run_pin.creative_skill_resources.find(
        (resource) =>
          resource.creative_skill_id === activation.creative_skill_id &&
          resource.creative_skill_version_id ===
            activation.creative_skill_version_id &&
          resource.resource_digest === activation.resource_digest,
      )
    : null;
  if (activation && !skillResource) {
    throw new Error(
      `creative_skill_resource_missing:${activation.creative_skill_version_id}`,
    );
  }
  return {
    request: {
      prompt: parsed.prompt,
      historyMessages: parsed.history_messages,
      runtimeInstructions,
      creativeSkill: skillResource
        ? {
            creativeSkillId: skillResource.creative_skill_id,
            creativeSkillVersionId: skillResource.creative_skill_version_id,
            name: skillResource.name,
            resourceDigest: skillResource.resource_digest,
            body: skillResource.body,
          }
        : null,
      // 本轮受限投影（T08）：只把 available/stale 条目传给 runtime 作为上下文，
      // unavailable 的内容不进入。模型只看到 mention identity + 投影，看不到存储身份。
      mentionProjections: parsed.mention_input_snapshot.entries.flatMap(
        (entry) =>
          entry.availability === "unavailable"
            ? []
            : [
                {
                  mention_id: entry.mention_id,
                  type: entry.type,
                  availability: entry.availability,
                  projection: entry.projection,
                },
              ],
      ),
    },
    autoActivation,
    maxOutputCharacters:
      parsed.run_pin.runtime_budget_policy.max_output_characters,
  };
}

/** 供应商调用记录槽位（契约 §8.4）：T07 基线每 Advance 恰好一次物理调用。 */

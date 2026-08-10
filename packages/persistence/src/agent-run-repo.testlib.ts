// IK74V8：agent-run-repo 用例的共享夹具（从 agent-run-repo.test.ts 拆出）。
// 命名 *.testlib.ts：tsconfig 排除编译、vitest 不当作用例文件收集。
import { vi } from "vitest";
import { bundledAgentRuntimeManifest } from "../../agent-runtime/src/runtime-manifest.js";

export { bundledAgentRuntimeManifest };
import {
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
} from "@blue-whale/contracts";
import { createHash } from "node:crypto";

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

export const runPin = signRunPin(runPinSource);
export const requestDigest = `sha256:${"d".repeat(64)}`;

/** claimNext 冻结 MentionInputSnapshot 时读取的 mention 事实表（T08）。
 *  默认无 mention —— freezeMentionInputSnapshot 产出空快照。 */
export function emptyMentionTables() {
  return {
    conversation_message_mentions: { findMany: vi.fn().mockResolvedValue([]) },
    assets: { findMany: vi.fn().mockResolvedValue([]) },
    scene_cards: { findMany: vi.fn().mockResolvedValue([]) },
  };
}
export const emptyMentionSnapshot = { capability_snapshot_version: 1, entries: [] };
export const forcedActivation = {
  creative_skill_id: "official.poster",
  creative_skill_version_id: "version.poster.1",
  name: "海报专家",
  display_version: "1.0.0",
  resource_digest: `sha256:${"a".repeat(64)}`,
  source: "forced_use" as const,
  reason: { type: "user_use" as const },
};

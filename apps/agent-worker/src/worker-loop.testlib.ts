// IK74V8：runAgentWorkerOnce 用例的共享夹具（从 worker-loop.test.ts 拆出）。
// 命名 *.testlib.ts：tsconfig 排除编译、vitest 不当作用例文件收集。
import { vi } from "vitest";
import { bundledAgentRuntimeManifest } from "../../../packages/agent-runtime/src/runtime-manifest.js";
import { createHash } from "node:crypto";
import {
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
} from "@blue-whale/contracts";

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

export function patchRunPin(
  pin: AgentRunPin,
  patch: Partial<Omit<AgentRunPin, "pin_digest">>,
): AgentRunPin {
  const { pin_digest: _pinDigest, ...source } = pin;
  return signRunPin({ ...source, ...patch });
}

export const runPin = signRunPin(runPinSource);

export function work(prompt = "生成蓝鲸海报") {
  return {
    schema_version: 1 as const,
    agent_run_id: "9",
    advance_id: "30",
    fencing_token: "3",
    run_version: 4,
    input_high_watermark_sequence_no: 2,
    input_messages: [
      {
        message_id: "20",
        sequence_no: 2,
        role: "user" as const,
        content: prompt,
      },
    ],
    prompt,
    run_pin: runPin,
    auto_creative_skill_candidates: [],
    activated_creative_skill_versions: [],
    mention_input_snapshot: { capability_snapshot_version: 1, entries: [] },
    conversationId: "7",
    userId: "100",
    skillSummarize: false,
  };
}

/** T07（契约 §8.1/§8.4）：调用记录与临时交付的默认 mock，无既有记录、追加成功。
 *  T08：硬权限闸门实时重查默认放行（authoritative: true）。 */
export function providerCallMocks(overrides: Record<string, unknown> = {}) {
  return {
    loadProviderCall: vi.fn().mockResolvedValue(null),
    openProviderCall: vi.fn().mockResolvedValue({}),
    settleProviderCall: vi.fn().mockResolvedValue(true),
    markProviderCallOutcomeUnknown: vi.fn().mockResolvedValue(true),
    recheckMentionAuthority: vi.fn().mockResolvedValue({ authoritative: true }),
    appendProvisionalChunks: vi.fn().mockResolvedValue({
      kind: "appended",
      deliveryId: "77",
      startIndex: 0,
    }),
    ...overrides,
  };
}

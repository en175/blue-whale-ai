import type { AgentAdapter } from "@blue-whale/core";
import type { SkillSummarizePipeline } from "@blue-whale/agent-runtime";
import {
  agentRunWorkSchema,
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
  type AutoCreativeSkillActivation,
} from "@blue-whale/contracts";
import type {
  AgentRunRepo,
  AgentRunWork,
  CommitAgentRunResult,
} from "@blue-whale/persistence";
import { createHash } from "node:crypto";

export type AgentWorkerOnceResult = CommitAgentRunResult | { kind: "idle" };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function commitDigest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`runtime_pin_duplicate_${label}`);
  }
}

function validateRunPin(pin: AgentRunPin, prompt: string): string[] {
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
  if (pin.tool_grants.length !== 0) {
    throw new Error("runtime_pin_tool_reference_invalid");
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

function runtimeRequest(work: AgentRunWork): {
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
    },
    autoActivation,
    maxOutputCharacters:
      parsed.run_pin.runtime_budget_policy.max_output_characters,
  };
}

export async function runAgentWorkerOnce(input: {
  repo: AgentRunRepo;
  runtime: AgentAdapter;
  workerId: string;
  /** 对话总结管道（IK60X1，契约 §15.2）：claim 到带 skill_summarize 标记的 Run
   *  或会话存在 pending 待确认记录时分流；确认模式判定无关 → pass_through 回退 runtime。 */
  summarize?: SkillSummarizePipeline;
  leaseMs?: number;
  heartbeatIntervalMs?: number;
}): Promise<AgentWorkerOnceResult> {
  const leaseMs = input.leaseMs ?? 30_000;
  const work = await input.repo.claimNext({
    workerId: input.workerId,
    leaseMs,
  });
  if (!work) return { kind: "idle" };

  const heartbeatAbort = new AbortController();
  const heartbeat = maintainLease({
    repo: input.repo,
    workerId: input.workerId,
    work,
    leaseMs,
    intervalMs: input.heartbeatIntervalMs ?? Math.max(1_000, leaseMs / 3),
    signal: heartbeatAbort.signal,
  });
  let result: Awaited<ReturnType<typeof produceResult>>;
  try {
    result = await produceResult(input, work);
  } catch (error) {
    heartbeatAbort.abort();
    await heartbeat;
    return input.repo.commitFailure({
      workerId: input.workerId,
      agentRunId: work.agent_run_id,
      advanceId: work.advance_id,
      fence: work.fencing_token,
      runVersion: work.run_version,
      requestDigest: commitDigest({
        outcome: "failed",
        code: "runtime_error",
        message: error instanceof Error ? error.message : "unknown",
      }),
      failureCode: "runtime_error",
      failureMessage: error instanceof Error ? error.message : "unknown",
    });
  }
  heartbeatAbort.abort();
  if (!(await heartbeat)) return { kind: "conflict" };
  return input.repo.commitSuccess({
    workerId: input.workerId,
    agentRunId: work.agent_run_id,
    advanceId: work.advance_id,
    fence: work.fencing_token,
    runVersion: work.run_version,
    requestDigest: commitDigest({
      outcome: "completed",
      content: result.content,
      reasoning_summary: result.reasoningSummary,
      auto_creative_skill_activation: result.autoActivation,
    }),
    content: result.content,
    reasoningSummary: result.reasoningSummary,
    autoCreativeSkillActivation: result.autoActivation,
  });
}

/** Run 正文产出路由（契约 §15.2/§15.4）：
 *  带总结意图或存在 pending 待确认 → 总结管道；管道 pass_through 或无管道 → 既有 runtime。
 *  总结管道内部自行消化 AI 失败（产出失败说明文案），抛出的异常按 runtime_error 处理。 */
async function produceResult(
  input: {
    runtime: AgentAdapter;
    summarize?: SkillSummarizePipeline;
  },
  work: AgentRunWork,
): Promise<{
  content: string;
  reasoningSummary: string;
  autoActivation: AutoCreativeSkillActivation | null;
}> {
  const prepared = runtimeRequest(work);
  if (
    input.summarize &&
    (work.skillSummarize || (await input.summarize.hasPending(work)))
  ) {
    const outcome = await input.summarize.run(work);
    if (outcome.kind === "handled") {
      if (outcome.content.length > prepared.maxOutputCharacters) {
        throw new Error("runtime_output_budget_exceeded");
      }
      return {
        content: outcome.content,
        reasoningSummary: "已处理个人技能总结请求。",
        autoActivation: null,
      };
    }
  }
  const result = await input.runtime.invoke(prepared.request);
  if (result.content.length > prepared.maxOutputCharacters) {
    throw new Error("runtime_output_budget_exceeded");
  }
  return {
    content: result.content,
    reasoningSummary: result.reasoningSummary,
    autoActivation: prepared.autoActivation,
  };
}

async function maintainLease(input: {
  repo: AgentRunRepo;
  workerId: string;
  work: AgentRunWork;
  leaseMs: number;
  intervalMs: number;
  signal: AbortSignal;
}): Promise<boolean> {
  while (!input.signal.aborted) {
    await delay(input.intervalMs, input.signal);
    if (input.signal.aborted) return true;
    try {
      const renewed = await input.repo.renewLease({
        workerId: input.workerId,
        agentRunId: input.work.agent_run_id,
        fence: input.work.fencing_token,
        runVersion: input.work.run_version,
        leaseMs: input.leaseMs,
      });
      if (!renewed) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runAgentWorkerLoop(input: {
  repo: AgentRunRepo;
  runtime: AgentAdapter;
  workerId: string;
  summarize?: SkillSummarizePipeline;
  signal: AbortSignal;
  idleDelayMs?: number;
  leaseMs?: number;
}): Promise<void> {
  while (!input.signal.aborted) {
    try {
      const result = await runAgentWorkerOnce(input);
      if (result.kind === "idle" || result.kind === "conflict") {
        await delay(input.idleDelayMs ?? 250, input.signal);
      }
    } catch (error) {
      console.error(
        "[agent-worker] iteration failed:",
        error instanceof Error ? error.message : "unknown",
      );
      await delay(input.idleDelayMs ?? 250, input.signal);
    }
  }
}

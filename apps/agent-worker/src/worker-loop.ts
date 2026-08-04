import type { AgentAction, AgentAdapter } from "@blue-whale/core";
import type { SkillSummarizePipeline } from "@blue-whale/agent-runtime";
import {
  agentRunWorkSchema,
  autoCreativeSkillActivationSchema,
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
    },
    autoActivation,
    maxOutputCharacters:
      parsed.run_pin.runtime_budget_policy.max_output_characters,
  };
}

/** 供应商调用记录槽位（契约 §8.4）：T07 基线每 Advance 恰好一次物理调用。 */
const PROVIDER_CALL_SLOT = 0;
/** 验收标记（契约 §8.5）：结果落库后、RunCommit 前睡眠 N ms，构造可接管窗口。 */
const HOLD_RESULT_MARKER = /fake:hold-result:(\d+)/;
/** 临时交付分片长度：把完整结果切成小片按序上报（契约 §8.1）。 */
const PROVISIONAL_CHUNK_SIZE = 16;

class ProviderOutcomeUnknownError extends Error {
  constructor() {
    super("provider_outcome_unknown");
  }
}

class ReplayedProviderFailureError extends Error {
  readonly failureCode: string;
  constructor(failureCode: string, failureMessage: string) {
    super(failureMessage);
    this.failureCode = failureCode;
  }
}

interface ProducedResult {
  content: string;
  reasoningSummary: string;
  autoActivation: AutoCreativeSkillActivation | null;
  action: AgentAction;
}

function chunkContent(content: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += PROVISIONAL_CHUNK_SIZE) {
    chunks.push(content.slice(index, index + PROVISIONAL_CHUNK_SIZE));
  }
  return chunks.length > 0 ? chunks : [""];
}

function parseReplayedAction(value: unknown): AgentAction | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "respond") return { kind: "respond" };
  if (candidate.kind === "cancel") return { kind: "cancel" };
  if (
    candidate.kind === "clarify" &&
    typeof candidate.question === "string" &&
    candidate.question.length > 0 &&
    (candidate.stage === "alignment" ||
      candidate.stage === "awaiting_final_confirmation")
  ) {
    return { kind: "clarify", question: candidate.question, stage: candidate.stage };
  }
  return null;
}

/** 重放载荷校验（契约 §8.4）：形状不完整视为不可重放，进入结果不明路径。 */
function parseReplayedProviderResult(payload: unknown): ProducedResult | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.content !== "string" ||
    candidate.content.length === 0 ||
    typeof candidate.reasoning_summary !== "string"
  ) {
    return null;
  }
  const action = parseReplayedAction(candidate.action);
  if (!action) return null;
  let autoActivation: AutoCreativeSkillActivation | null = null;
  if (candidate.auto_activation !== null && candidate.auto_activation !== undefined) {
    const parsed = autoCreativeSkillActivationSchema.safeParse(
      candidate.auto_activation,
    );
    if (!parsed.success) return null;
    autoActivation = parsed.data;
  }
  return {
    content: candidate.content,
    reasoningSummary: candidate.reasoning_summary,
    autoActivation,
    action,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 调用记录驱动的推进执行（契约 §8.4）：
 *  succeeded → 重放不再调用；failed_definitive → 重放失败；
 *  in_flight/outcome_unknown → 置未知并失败（手动重试）；无记录 → 开记录、调用、结算。 */
async function executeAdvance(
  input: {
    repo: AgentRunRepo;
    runtime: AgentAdapter;
    summarize?: SkillSummarizePipeline;
  },
  work: AgentRunWork,
): Promise<ProducedResult> {
  if (
    input.summarize &&
    (work.skillSummarize || (await input.summarize.hasPending(work)))
  ) {
    return produceResult(input, work);
  }
  const existing = await input.repo.loadProviderCall(
    work.advance_id,
    PROVIDER_CALL_SLOT,
  );
  if (existing) {
    if (existing.status === "succeeded") {
      const replayed = parseReplayedProviderResult(existing.resultPayload);
      if (replayed) return replayed;
      throw new ProviderOutcomeUnknownError();
    }
    if (existing.status === "failed_definitive") {
      throw new ReplayedProviderFailureError(
        existing.failureCode ?? "runtime_error",
        existing.failureMessage ?? "provider failed",
      );
    }
    await input.repo.markProviderCallOutcomeUnknown(
      work.advance_id,
      PROVIDER_CALL_SLOT,
    );
    throw new ProviderOutcomeUnknownError();
  }
  await input.repo.openProviderCall({
    agentRunId: work.agent_run_id,
    advanceId: work.advance_id,
    callSlot: PROVIDER_CALL_SLOT,
    fence: work.fencing_token,
    requestDigest: commitDigest({
      advance_id: work.advance_id,
      call_slot: PROVIDER_CALL_SLOT,
      prompt: work.prompt,
    }),
  });
  let produced: ProducedResult;
  try {
    produced = await produceResult(input, work);
  } catch (error) {
    await input.repo.settleProviderCall({
      advanceId: work.advance_id,
      callSlot: PROVIDER_CALL_SLOT,
      fence: work.fencing_token,
      status: "failed_definitive",
      failureCode: "runtime_error",
      failureMessage: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
  await input.repo.settleProviderCall({
    advanceId: work.advance_id,
    callSlot: PROVIDER_CALL_SLOT,
    fence: work.fencing_token,
    status: "succeeded",
    resultPayload: {
      content: produced.content,
      reasoning_summary: produced.reasoningSummary,
      action: produced.action,
      auto_activation: produced.autoActivation,
    },
  });
  const holdMatch = HOLD_RESULT_MARKER.exec(work.prompt);
  if (holdMatch) await sleep(Number(holdMatch[1]));
  return produced;
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
  let result: ProducedResult;
  try {
    result = await executeAdvance(input, work);
  } catch (error) {
    heartbeatAbort.abort();
    await heartbeat;
    if (error instanceof ProviderOutcomeUnknownError) {
      return input.repo.commitFailure({
        workerId: input.workerId,
        agentRunId: work.agent_run_id,
        advanceId: work.advance_id,
        fence: work.fencing_token,
        runVersion: work.run_version,
        requestDigest: commitDigest({
          outcome: "failed",
          code: "provider_outcome_unknown",
          message: "provider result unknown after takeover",
        }),
        failureCode: "provider_outcome_unknown",
        failureMessage: "provider result unknown after takeover",
      });
    }
    if (error instanceof ReplayedProviderFailureError) {
      return input.repo.commitFailure({
        workerId: input.workerId,
        agentRunId: work.agent_run_id,
        advanceId: work.advance_id,
        fence: work.fencing_token,
        runVersion: work.run_version,
        requestDigest: commitDigest({
          outcome: "failed",
          code: error.failureCode,
          message: error.message,
        }),
        failureCode: error.failureCode,
        failureMessage: error.message,
      });
    }
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
  // 临时交付（契约 §8.1）：chunk 先落短期投影，RunCommit 才提升为正式消息。
  const appended = await input.repo.appendProvisionalChunks({
    workerId: input.workerId,
    agentRunId: work.agent_run_id,
    advanceId: work.advance_id,
    fence: work.fencing_token,
    chunks: chunkContent(result.content),
  });
  if (appended.kind === "conflict") return { kind: "conflict" };
  const commitBase = {
    workerId: input.workerId,
    agentRunId: work.agent_run_id,
    advanceId: work.advance_id,
    fence: work.fencing_token,
    runVersion: work.run_version,
  };
  if (result.action.kind === "clarify") {
    return input.repo.commitAwaitingInput({
      ...commitBase,
      requestDigest: commitDigest({
        outcome: "awaiting_input",
        content: result.content,
        reasoning_summary: result.reasoningSummary,
        question: result.action.question,
        stage: result.action.stage,
      }),
      content: result.content,
      reasoningSummary: result.reasoningSummary,
      question: result.action.question,
      stage: result.action.stage,
    });
  }
  if (result.action.kind === "cancel") {
    return input.repo.commitCancelled({
      ...commitBase,
      requestDigest: commitDigest({
        outcome: "cancelled",
        content: result.content,
      }),
      content: result.content,
      reasoningSummary: result.reasoningSummary,
    });
  }
  return input.repo.commitSuccess({
    ...commitBase,
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
  action: AgentAction;
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
        action: { kind: "respond" },
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
    action: result.action,
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

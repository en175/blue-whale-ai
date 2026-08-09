// Agent Worker 主循环。RunPin 校验与 Advance 支撑拆分到同目录子模块（IK74V8，≤800 行硬线）；
// 本文件保留领取→执行→提交的编排主线，对外导出面保持不变。
import type {AgentAdapter} from "@blue-whale/core";
import {createLogger, getOrCreateTraceId, runWithTraceId} from "@blue-whale/core/logging";
import {type SkillSummarizePipeline} from "@blue-whale/agent-runtime";
import {planCardCandidateSchema, type PlanCardCandidate} from "@blue-whale/contracts";
import type {AgentRunRepo, AgentRunWork, CommitAgentRunResult} from "@blue-whale/persistence";

const logger = createLogger("agent-worker");
import {commitDigest, runtimeRequest} from "./worker-run-pin.js";
import {HOLD_RESULT_MARKER, PROVIDER_CALL_SLOT, ProviderOutcomeUnknownError, ReplayedProviderFailureError, SnapshotNotAuthoritativeError, assertMentionAuthority, chunkContent, corePlanCardsToContract, mentionUnavailableFailure, parseReplayedProviderResult, sleep, type ProducedResult} from "./worker-advance-support.js";

export type AgentWorkerOnceResult = CommitAgentRunResult | { kind: "idle" };

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
      // 结果复用前硬校验（T08，AC#5）：接管重放前实时重查本轮引用授权。
      await assertMentionAuthority(input.repo, work);
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
  // 供应商调用前硬校验（T08，AC#5）：开记录前实时重查本轮引用授权，
  // 授权失效的推进一律不产生物理调用、不接纳结果。
  await assertMentionAuthority(input.repo, work);
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
      ...(produced.planCards !== null
        ? { plan_cards: produced.planCards }
        : {}),
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
    if (error instanceof SnapshotNotAuthoritativeError) {
      return input.repo.commitFailure(
        mentionUnavailableFailure(input.workerId, work),
      );
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
  // RunCommit 前硬校验（T08，AC#5）：提交正式消息/状态前实时重查本轮引用授权，
  // 失败不接纳结果。此处已过 executeAdvance 的 try/catch，直接返回 commitFailure
  // 以免未捕获异常触发重试循环（覆盖 summarize 等不经供应商调用的产出路径）。
  // 闸门在临时交付之前：避免为失效推进写入任何 provisional chunk。
  const authority = await input.repo.recheckMentionAuthority({
    agentRunId: work.agent_run_id,
    snapshot: work.mention_input_snapshot,
  });
  if (!authority.authoritative) {
    return input.repo.commitFailure(
      mentionUnavailableFailure(input.workerId, work),
    );
  }
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
  if (result.action.kind === "submit_plan" && result.planCards !== null) {
    // 正式消息即 plan_cards（不带 assistant_message）；确认文本已作为临时交付，
    // 由 commitPlanMessages.closeStreamingDelivery 闭合，不提升为正式消息（契约 §9）。
    // requestDigest 必须纳入完整 cards，接管重放相同 cards → 相同 digest → replay（AC#8）。
    return input.repo.commitPlanMessages({
      ...commitBase,
      requestDigest: commitDigest({
        outcome: "completed_with_plan",
        reasoning_summary: result.reasoningSummary,
        plan_cards: result.planCards,
      }),
      reasoningSummary: result.reasoningSummary,
      planCards: result.planCards,
      capabilitySnapshotVersion: 1,
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
): Promise<ProducedResult> {
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
        planCards: null,
      };
    }
  }
  const result = await input.runtime.invoke(prepared.request);
  if (result.content.length > prepared.maxOutputCharacters) {
    throw new Error("runtime_output_budget_exceeded");
  }
  // submit_plan：把 core camelCase 候选转成 contracts 线缆形态并校验；
  // 校验失败视为适配器产出非法候选，按 runtime_error 抛出（不进入重放/接纳）。
  let planCards: PlanCardCandidate[] | null = null;
  if (result.action.kind === "submit_plan") {
    const converted = corePlanCardsToContract(result.action.cards);
    const parsed = planCardCandidateSchema.array().min(1).safeParse(converted);
    if (!parsed.success) {
      throw new Error("adapter produced invalid plan cards");
    }
    planCards = parsed.data;
  }
  return {
    content: result.content,
    reasoningSummary: result.reasoningSummary,
    autoActivation: prepared.autoActivation,
    action: result.action,
    planCards,
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
      // 每次循环迭代一段链路，日志 trace_id 随上下文传递（IK6KQQ）。
      const result = await runWithTraceId(getOrCreateTraceId(), () =>
        runAgentWorkerOnce(input),
      );
      if (result.kind === "idle" || result.kind === "conflict") {
        await delay(input.idleDelayMs ?? 250, input.signal);
      }
    } catch (error) {
      logger.error(
        `iteration failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
      await delay(input.idleDelayMs ?? 250, input.signal);
    }
  }
}

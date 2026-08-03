import type { AgentAdapter } from "@blue-whale/core";
import type { SkillSummarizePipeline } from "@blue-whale/agent-runtime";
import type {
  AgentRunRepo,
  AgentRunWork,
  CommitAgentRunResult,
} from "@blue-whale/persistence";

export type AgentWorkerOnceResult = CommitAgentRunResult | { kind: "idle" };

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
  let content: string;
  try {
    content = await produceContent(input, work);
  } catch (error) {
    heartbeatAbort.abort();
    await heartbeat;
    return input.repo.commitFailure({
      workerId: input.workerId,
      agentRunId: work.agentRunId,
      fence: work.fence,
      runVersion: work.runVersion,
      failureCode: "runtime_error",
      failureMessage: error instanceof Error ? error.message : "unknown",
    });
  }
  heartbeatAbort.abort();
  if (!(await heartbeat)) return { kind: "conflict" };
  return input.repo.commitSuccess({
    workerId: input.workerId,
    agentRunId: work.agentRunId,
    fence: work.fence,
    runVersion: work.runVersion,
    inputSequenceNo: work.inputSequenceNo,
    content,
  });
}

/** Run 正文产出路由（契约 §15.2/§15.4）：
 *  带总结意图或存在 pending 待确认 → 总结管道；管道 pass_through 或无管道 → 既有 runtime。
 *  总结管道内部自行消化 AI 失败（产出失败说明文案），抛出的异常按 runtime_error 处理。 */
async function produceContent(
  input: {
    runtime: AgentAdapter;
    summarize?: SkillSummarizePipeline;
  },
  work: AgentRunWork,
): Promise<string> {
  if (
    input.summarize &&
    (work.skillSummarize || (await input.summarize.hasPending(work)))
  ) {
    const outcome = await input.summarize.run(work);
    if (outcome.kind === "handled") return outcome.content;
  }
  const result = await input.runtime.invoke({ prompt: work.prompt });
  return result.content;
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
        agentRunId: input.work.agentRunId,
        fence: input.work.fence,
        runVersion: input.work.runVersion,
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

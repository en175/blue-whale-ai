import type { AgentAdapter } from "@blue-whale/core";
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
  let result;
  try {
    result = await input.runtime.invoke({ prompt: work.prompt });
  } finally {
    heartbeatAbort.abort();
  }
  if (!(await heartbeat)) return { kind: "conflict" };
  return input.repo.commitSuccess({
    workerId: input.workerId,
    agentRunId: work.agentRunId,
    fence: work.fence,
    runVersion: work.runVersion,
    inputSequenceNo: work.inputSequenceNo,
    content: result.content,
  });
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
  signal: AbortSignal;
  idleDelayMs?: number;
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

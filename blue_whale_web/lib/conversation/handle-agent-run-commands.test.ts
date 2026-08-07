import {
  AGENT_RUN_ALREADY_TERMINAL_CODE,
  AGENT_RUN_NOT_RETRYABLE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
} from "@blue-whale/contracts";
import type { AgentRunRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  handleRetryAgentRun,
  handleStopAgentRun,
} from "./handle-agent-run-commands";

function stopDeps(result: unknown): AgentRunRepo {
  return {
    acceptUserStop: vi.fn().mockResolvedValue(result),
  } as unknown as AgentRunRepo;
}

function retryDeps(result: unknown): AgentRunRepo {
  return {
    acceptUserRetry: vi.fn().mockResolvedValue(result),
  } as unknown as AgentRunRepo;
}

describe("handleStopAgentRun（契约 §8.2）", () => {
  it("缺少 Idempotency-Key 返回 100000", async () => {
    const result = await handleStopAgentRun("9", "7", "11", null, stopDeps({}));
    expect(result.code).toBe(PARAM_MISSING_CODE);
  });

  it("成功停止返回 agent_run_id/status/cursor", async () => {
    const deps = stopDeps({
      kind: "stopped",
      cursor: "500",
      status: "cancelled",
    });
    const result = await handleStopAgentRun("9", "7", "11", "key-1", deps);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({
      agent_run_id: 11,
      status: "cancelled",
      cursor: 500,
    });
    expect(deps.acceptUserStop).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "9",
        projectId: "7",
        agentRunId: "11",
      }),
    );
  });

  it("已终态返回 100307，不可停止返回 100303", async () => {
    const terminal = await handleStopAgentRun(
      "9",
      "7",
      "11",
      "key-1",
      stopDeps({ kind: "already_terminal" }),
    );
    expect(terminal.code).toBe(AGENT_RUN_ALREADY_TERMINAL_CODE);
    const notStoppable = await handleStopAgentRun(
      "9",
      "7",
      "11",
      "key-1",
      stopDeps({ kind: "not_stoppable" }),
    );
    expect(notStoppable.code).toBe(100303);
  });

  it("幂等冲突与资源不存在映射", async () => {
    const conflict = await handleStopAgentRun(
      "9",
      "7",
      "11",
      "key-1",
      stopDeps({ kind: "idempotency_conflict" }),
    );
    expect(conflict.code).toBe(IDEMPOTENCY_KEY_REUSED_CODE);
    const missing = await handleStopAgentRun(
      "9",
      "7",
      "11",
      "key-1",
      stopDeps({ kind: "not_found" }),
    );
    expect(missing.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });
});

describe("handleRetryAgentRun（契约 §8.3）", () => {
  it("成功重试返回 retry_count", async () => {
    const deps = retryDeps({
      kind: "retried",
      cursor: "600",
      status: "queued",
      retryCount: 1,
    });
    const result = await handleRetryAgentRun("9", "7", "11", "key-2", deps);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({
      agent_run_id: 11,
      status: "queued",
      retry_count: 1,
      cursor: 600,
    });
  });

  it("非 failed 状态返回 100308", async () => {
    const result = await handleRetryAgentRun(
      "9",
      "7",
      "11",
      "key-2",
      retryDeps({ kind: "not_retryable" }),
    );
    expect(result.code).toBe(AGENT_RUN_NOT_RETRYABLE_CODE);
  });

  it("非法 runId 返回资源不存在且不触库", async () => {
    const deps = retryDeps({});
    const result = await handleRetryAgentRun("9", "7", "abc", "key-2", deps);
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
    expect(deps.acceptUserRetry).not.toHaveBeenCalled();
  });
});

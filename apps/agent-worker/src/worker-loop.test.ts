import { describe, expect, it, vi } from "vitest";

import { runAgentWorkerOnce } from "./worker-loop.js";

describe("runAgentWorkerOnce", () => {
  it("invokes the runtime outside persistence and commits with the claimed fence", async () => {
    const claimNext = vi.fn().mockResolvedValue({
      agentRunId: "9",
      projectId: "42",
      conversationId: "7",
      userId: "100",
      fence: "3",
      runVersion: 4,
      inputSequenceNo: 2,
      prompt: "生成蓝鲸海报",
    });
    const commitSuccess = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    const commitFailure = vi.fn().mockResolvedValue({ kind: "conflict" });
    const renewLease = vi.fn().mockResolvedValue(true);
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "已完成",
    });
    await expect(
      runAgentWorkerOnce({
        repo: { claimNext, renewLease, commitSuccess, commitFailure },
        runtime: { name: "fake", ready: async () => true, invoke },
        workerId: "worker-1",
      }),
    ).resolves.toEqual({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    expect(invoke).toHaveBeenCalledWith({ prompt: "生成蓝鲸海报" });
    expect(commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-1",
        agentRunId: "9",
        fence: "3",
        runVersion: 4,
        inputSequenceNo: 2,
        content: "已完成",
      }),
    );
  });

  it("renews the database lease while the runtime call is still active", async () => {
    vi.useFakeTimers();
    let finishInvoke!: (value: { provider: string; content: string }) => void;
    const invoke = vi.fn(
      () =>
        new Promise<{ provider: string; content: string }>((resolve) => {
          finishInvoke = resolve;
        }),
    );
    const renewLease = vi.fn().mockResolvedValue(true);
    const commitSuccess = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    const task = runAgentWorkerOnce({
      repo: {
        claimNext: vi.fn().mockResolvedValue({
          agentRunId: "9",
          projectId: "42",
          conversationId: "7",
          userId: "100",
          fence: "3",
          runVersion: 4,
          inputSequenceNo: 2,
          prompt: "生成蓝鲸海报",
        }),
        renewLease,
        commitSuccess,
        commitFailure: vi.fn().mockResolvedValue({ kind: "conflict" }),
      },
      runtime: { name: "slow", ready: async () => true, invoke },
      workerId: "worker-1",
      leaseMs: 30,
      heartbeatIntervalMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(renewLease).toHaveBeenCalledWith({
      workerId: "worker-1",
      agentRunId: "9",
      fence: "3",
      runVersion: 4,
      leaseMs: 30,
    });
    finishInvoke({ provider: "fake", content: "已完成" });
    await expect(task).resolves.toEqual({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    vi.useRealTimers();
  });

  it("commits a terminal failure when the runtime throws instead of re-claiming", async () => {
    const commitSuccess = vi.fn();
    const commitFailure = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });
    const invoke = vi
      .fn()
      .mockRejectedValue(new Error("fake agent explicit failure"));
    await expect(
      runAgentWorkerOnce({
        repo: {
          claimNext: vi.fn().mockResolvedValue({
            agentRunId: "9",
            projectId: "42",
            conversationId: "7",
            userId: "100",
            fence: "3",
            runVersion: 4,
            inputSequenceNo: 2,
            prompt: "请失败 fake:failure",
          }),
          renewLease: vi.fn().mockResolvedValue(true),
          commitSuccess,
          commitFailure,
        },
        runtime: { name: "fake", ready: async () => true, invoke },
        workerId: "worker-1",
      }),
    ).resolves.toEqual({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });
    expect(commitFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-1",
        agentRunId: "9",
        fence: "3",
        runVersion: 4,
        failureCode: "runtime_error",
        failureMessage: "fake agent explicit failure",
      }),
    );
    expect(commitSuccess).not.toHaveBeenCalled();
  });
});

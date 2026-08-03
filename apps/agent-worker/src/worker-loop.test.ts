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
      skillSummarize: false,
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
          skillSummarize: false,
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
            skillSummarize: false,
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

// 总结管道分流（IK60X1，契约 §15.2/§15.4）：带 skill_summarize 标记的 Run → 总结模式；
// 无标记但会话存在 pending 待确认 → 确认模式；确认判定无关 → pass_through 回退 runtime。
describe("runAgentWorkerOnce 总结分流", () => {
  function makeRepo(work: Record<string, unknown>) {
    return {
      claimNext: vi.fn().mockResolvedValue(work),
      renewLease: vi.fn().mockResolvedValue(true),
      commitSuccess: vi.fn().mockResolvedValue({
        kind: "committed",
        cursor: "8",
        status: "completed",
      }),
      commitFailure: vi.fn().mockResolvedValue({ kind: "conflict" }),
    };
  }
  const BASE_WORK = {
    agentRunId: "9",
    projectId: "42",
    conversationId: "7",
    userId: "100",
    fence: "3",
    runVersion: 4,
    inputSequenceNo: 2,
    prompt: "总结当前对话并保存为我的技能",
  };

  it("skillSummarize=true → 走总结管道，不调 runtime", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: true });
    const invoke = vi.fn();
    const summarize = {
      hasPending: vi.fn(),
      run: vi.fn().mockResolvedValue({
        kind: "handled",
        content: "已总结当前对话并保存为个人技能「周报生成」",
      }),
    };

    const result = await runAgentWorkerOnce({
      repo,
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });

    expect(result).toEqual({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    expect(summarize.run).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "7", userId: "100" }),
    );
    expect(summarize.hasPending).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(repo.commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "已总结当前对话并保存为个人技能「周报生成」",
      }),
    );
  });

  it("skillSummarize=false 但会话有 pending → 确认模式，不调 runtime", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: false });
    const invoke = vi.fn();
    const summarize = {
      hasPending: vi.fn().mockResolvedValue(true),
      run: vi.fn().mockResolvedValue({
        kind: "handled",
        content: "已保存为个人技能「周报小助手」",
      }),
    };

    await runAgentWorkerOnce({
      repo,
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });

    expect(summarize.hasPending).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "7", userId: "100" }),
    );
    expect(summarize.run).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("确认模式判定无关 → pass_through 回退 runtime.invoke", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: false });
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "runtime 回复",
    });
    const summarize = {
      hasPending: vi.fn().mockResolvedValue(true),
      run: vi.fn().mockResolvedValue({ kind: "pass_through" }),
    };

    await runAgentWorkerOnce({
      repo,
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });

    expect(invoke).toHaveBeenCalledWith({ prompt: BASE_WORK.prompt });
    expect(repo.commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ content: "runtime 回复" }),
    );
  });

  it("无 pending 且无总结意图 → 正常 runtime（不调管道 run）", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: false });
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "runtime 回复",
    });
    const summarize = {
      hasPending: vi.fn().mockResolvedValue(false),
      run: vi.fn(),
    };

    await runAgentWorkerOnce({
      repo,
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });

    expect(summarize.run).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalled();
  });
});

// IK74V8：从 worker-loop.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import {describe, expect, it, vi} from "vitest";
import {runAgentWorkerOnce} from "./worker-loop.js";
import {patchRunPin, providerCallMocks, runPin, work} from "./worker-loop.testlib.js";

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
      ...providerCallMocks(),
    };
  }
  const BASE_WORK = work("总结当前对话并保存为我的技能");

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
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
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

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: BASE_WORK.prompt }),
    );
    expect(repo.commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ content: "runtime 回复" }),
    );
  });

  it("无 pending 且无总结意图 → 正常 runtime（不调管道 run）", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: false });
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "runtime 回复",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
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

  /** AC#5 实时重查：冻结快照全部 available（冻结时授权有效），
   *  重查返回非权威即模拟「冻结后删除/撤权」——三闸门必须拦截。 */
  const frozenAvailableSnapshot = {
    capability_snapshot_version: 1,
    entries: [
      {
        mention_id: "501",
        mention_seq: 0,
        type: "asset",
        availability: "available",
        reason: null,
        projection: {
          asset_type: "image",
          mime: "image/png",
          size: "1024",
          width: 1200,
          height: 800,
          duration_ms: null,
          content_sha256: "a".repeat(64),
        },
      },
    ],
  };
  const revokedRecheck = () => ({
    recheckMentionAuthority: vi
      .fn()
      .mockResolvedValue({ authoritative: false }),
  });

  it("blocks the provider call when the live authority recheck fails (AC#5 供应商调用前)", async () => {
    const invoke = vi.fn();
    const commitFailure = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });
    const openProviderCall = vi.fn().mockResolvedValue({});
    await runAgentWorkerOnce({
      repo: {
        claimNext: vi
          .fn()
          .mockResolvedValue({
            ...work(),
            mention_input_snapshot: frozenAvailableSnapshot,
          }),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess: vi.fn(),
        commitFailure,
        ...providerCallMocks({ openProviderCall, ...revokedRecheck() }),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(openProviderCall).not.toHaveBeenCalled();
    expect(commitFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "mention_input_unavailable" }),
    );
  });

  it("blocks replay of a persisted succeeded result when the live authority recheck fails (AC#5 结果复用前)", async () => {
    const invoke = vi.fn();
    const commitFailure = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });
    await runAgentWorkerOnce({
      repo: {
        claimNext: vi
          .fn()
          .mockResolvedValue({
            ...work(),
            mention_input_snapshot: frozenAvailableSnapshot,
          }),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess: vi.fn(),
        commitFailure,
        ...providerCallMocks({
          loadProviderCall: vi.fn().mockResolvedValue({
            status: "succeeded",
            resultPayload: {
              content: "旧结果",
              reasoning_summary: "说明",
              action: { kind: "respond" },
            },
          }),
          ...revokedRecheck(),
        }),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(commitFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "mention_input_unavailable" }),
    );
  });

  it("blocks RunCommit after a summarize-path result when the live authority recheck fails (AC#5 RunCommit 前)", async () => {
    const invoke = vi.fn();
    const commitFailure = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });
    const commitSuccess = vi.fn();
    const summarize = {
      hasPending: vi.fn().mockResolvedValue(true),
      run: vi.fn().mockResolvedValue({ kind: "handled", content: "已处理总结" }),
    };
    await runAgentWorkerOnce({
      repo: {
        claimNext: vi.fn().mockResolvedValue({
          ...work(),
          skillSummarize: true,
          mention_input_snapshot: frozenAvailableSnapshot,
        }),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess,
        commitFailure,
        ...providerCallMocks(revokedRecheck()),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });
    expect(commitSuccess).not.toHaveBeenCalled();
    expect(commitFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "mention_input_unavailable" }),
    );
  });

  it("accepts a RunPin that grants only read_asset and write_plan_cards (AC#6)", async () => {
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "已完成",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });
    const commitSuccess = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    const surfacePin = patchRunPin(runPin, {
      tool_grants: [
        { tool_id: "read_asset", registry_version: 1 },
        { tool_id: "write_plan_cards", registry_version: 1 },
      ],
    });
    await runAgentWorkerOnce({
      repo: {
        claimNext: vi.fn().mockResolvedValue({ ...work(), run_pin: surfacePin }),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess,
        commitFailure: vi.fn(),
        ...providerCallMocks(),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(commitSuccess).toHaveBeenCalledTimes(1);
  });
});

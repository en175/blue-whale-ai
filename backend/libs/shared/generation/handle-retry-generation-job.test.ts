import { describe, expect, it, vi } from "vitest";

import { handleRetryGenerationJob } from "./handle-retry-generation-job.js";

// IKF YHJ（ADR-0087 决策 7）：重试期的素材状态门在 repo 内、幂等重放之后触发；
// 这里只钉住握手——门的拒绝原因必须以 invalid_reference（1034）信封返回，不落成 404/500。

function makeDeps(overrides: {
  retryResult: unknown;
  materialGate?: { assertInputUsable: ReturnType<typeof vi.fn> };
}) {
  const retryJob = vi.fn().mockResolvedValue(overrides.retryResult);
  return {
    retryJob,
    deps: {
      projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "55" }) },
      command: { retryJob },
      ...(overrides.materialGate ? { materialGate: overrides.materialGate } : {}),
    },
  };
}

const CREATED = {
  generation_job_id: "302",
  cursor: 7,
  type: "video" as const,
};

describe("handleRetryGenerationJob 素材状态门（IKF YHJ）", () => {
  it("门拒绝 → 1034 invalid_reference，原因原文外显", async () => {
    const { deps } = makeDeps({
      retryResult: {
        kind: "material_blocked",
        reason: "该素材未审核通过，不能用于视频生成",
      },
      materialGate: { assertInputUsable: vi.fn() },
    });

    const result = await handleRetryGenerationJob(
      "9",
      "55",
      "300",
      "retry-1",
      "",
      deps as never,
    );

    expect(result).toEqual({
      code: 1034,
      msg: "该素材未审核通过，不能用于视频生成",
      data: { code: "invalid_reference" },
    });
  });

  it("把门的调用包成 guardInput 交给 repo（而不是自己先查）", async () => {
    const assertInputUsable = vi.fn().mockResolvedValue(null);
    const { retryJob, deps } = makeDeps({
      retryResult: CREATED,
      materialGate: { assertInputUsable },
    });

    const result = await handleRetryGenerationJob(
      "9",
      "55",
      "300",
      "retry-2",
      "",
      deps as never,
    );

    expect(result).toEqual({ code: 200, msg: null, data: CREATED });
    // 第三参起是 guardInput：由 repo 决定何时调（幂等重放不调），并把原 job 的类型一并带过来。
    const guardInput = retryJob.mock.calls[0]![5];
    expect(guardInput).toBeTypeOf("function");

    const jobInput = { references: [{ material_id: "asset-abc" }] };
    await expect(guardInput(jobInput, "video")).resolves.toBeNull();
    expect(assertInputUsable).toHaveBeenCalledWith({
      userId: "9",
      jobInput,
      jobType: "video",
    });
  });

  it("未接线时不传 guardInput（repo 走改造前老路）", async () => {
    const { retryJob, deps } = makeDeps({ retryResult: CREATED });

    await handleRetryGenerationJob("9", "55", "300", "retry-3", "", deps);

    expect(retryJob.mock.calls[0]![5]).toBeUndefined();
  });

  it("幂等键冲突仍是 409 口径，不被素材门改写", async () => {
    const { deps } = makeDeps({
      retryResult: { kind: "idempotency_conflict" },
      materialGate: { assertInputUsable: vi.fn() },
    });

    const result = await handleRetryGenerationJob(
      "9",
      "55",
      "300",
      "retry-4",
      "",
      deps as never,
    );

    expect(result.code).toBe(100409);
  });
});

// IKIPWU：同为「点重试失败」必须可区分真实原因；任务存在但不可重试不再并成「资源不存在」。
describe("handleRetryGenerationJob 不可重试原因外显（IKIPWU）", () => {
  it("任务存在但状态不可重试 → 1054 + 专用文案", async () => {
    const { deps } = makeDeps({
      retryResult: { kind: "not_retryable_status" },
    });

    const result = await handleRetryGenerationJob(
      "9",
      "55",
      "300",
      "retry-5",
      "",
      deps as never,
    );

    expect(result).toEqual({
      code: 1054,
      msg: "当前状态不允许重试，仅失败或部分成功的任务可重试",
      data: null,
    });
  });

  it("失败项已全部重试（无可补槽）→ 1055 + 专用文案", async () => {
    const { deps } = makeDeps({
      retryResult: { kind: "already_retried" },
    });

    const result = await handleRetryGenerationJob(
      "9",
      "55",
      "300",
      "retry-6",
      "",
      deps as never,
    );

    expect(result).toEqual({
      code: 1055,
      msg: "该任务的失败项已全部重试，无需再次重试",
      data: null,
    });
  });

  it("任务不存在/非本人 → 仍是「资源不存在」口径，不泄露存在性", async () => {
    const { deps } = makeDeps({ retryResult: null });

    const result = await handleRetryGenerationJob(
      "9",
      "55",
      "300",
      "retry-7",
      "",
      deps as never,
    );

    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
  });
});

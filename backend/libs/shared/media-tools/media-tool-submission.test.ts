import { beforeEach, describe, expect, it, vi } from "vitest";

const { markFailedQueued } = vi.hoisted(() => ({
  markFailedQueued: vi.fn(),
}));

vi.mock("@lib/shared/persistence/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/persistence/index.js")>();
  return {
    ...actual,
    createGenerationCommandRepo: () => ({ markFailedQueued }),
  };
});

vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { submitMediaToolJob } from "./media-tool-submission.js";

function makeArgs(overrides: Record<string, unknown> = {}) {
  const charge = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn().mockResolvedValue(undefined);
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    generation_jobs: { create: vi.fn().mockResolvedValue({ id: 400n }) },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const args = {
    prisma,
    billing: {
      jobBilling: vi.fn().mockResolvedValue({ charge, release }),
      release,
    },
    toolType: "image_erase",
    userId: "9",
    projectId: "55",
    input: { source_asset_id: "88" },
    recovery: null,
    createJob: async (db: { generation_jobs: { create: unknown } }) => {
      const job = await (
        db.generation_jobs.create as () => Promise<{ id: bigint }>
      )();
      return { jobId: job.id.toString(), status: "queued" };
    },
    enqueue,
    ...overrides,
  };
  return { args, charge, release, enqueue, prisma };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("submitMediaToolJob（共享提交管线）", () => {
  it("扣款后建任务并入队，返回统一信封", async () => {
    markFailedQueued.mockResolvedValue(true);
    const { args, charge, enqueue, release } = makeArgs();
    const result = await submitMediaToolJob(args as never);
    expect(result).toMatchObject({ code: 200, data: { job_id: "400", status: "queued" } });
    expect(charge).toHaveBeenCalledWith(400);
    expect(enqueue).toHaveBeenCalledWith("400");
    expect(release).not.toHaveBeenCalled();
  });

  it("入队失败 → 标记任务失败并按已扣费退款", async () => {
    markFailedQueued.mockResolvedValue(true);
    const { args, release, enqueue } = makeArgs();
    enqueue.mockRejectedValue(new Error("rocketmq down"));
    const result = await submitMediaToolJob(args as never);
    expect(result.code).toBe(200);
    expect(markFailedQueued).toHaveBeenCalledWith(
      "400",
      "enqueue_failed",
      "任务入队失败",
      { raw: "RocketMQ 入队失败" },
    );
    expect(release).toHaveBeenCalledWith("9", 400, "任务入队失败");
  });

  it("任务已不是 queued → 不退款", async () => {
    markFailedQueued.mockResolvedValue(false);
    const { args, release, enqueue } = makeArgs();
    enqueue.mockRejectedValue(new Error("rocketmq down"));
    await submitMediaToolJob(args as never);
    expect(release).not.toHaveBeenCalled();
  });

  it("关闭收费的工具不扣款", async () => {
    const { args, charge, enqueue } = makeArgs({
      billing: { jobBilling: vi.fn().mockResolvedValue(undefined), release: vi.fn() },
    });
    const result = await submitMediaToolJob(args as never);
    expect(result.code).toBe(200);
    expect(charge).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith("400");
  });

  it("免费工具入队失败 → 仍上报失败，由 Billing 判定无扣款不退款", async () => {
    markFailedQueued.mockResolvedValue(true);
    const release = vi.fn();
    const { args, enqueue } = makeArgs({
      billing: { jobBilling: vi.fn().mockResolvedValue(undefined), release },
    });
    enqueue.mockRejectedValue(new Error("rocketmq down"));
    await submitMediaToolJob(args as never);
    expect(markFailedQueued).toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith("9", 400, "任务入队失败");
  });
});

import { describe, expect, it, vi } from "vitest";

import { GenerationCommandService } from "./generation-command.service.js";

function serviceWithQueuedUpdateCount(count: number) {
  const updateMany = vi.fn().mockResolvedValue({ count });
  const createOutbox = vi.fn().mockResolvedValue({});
  const tx = {
    generation_jobs: {
      updateMany,
      findUniqueOrThrow: vi.fn().mockResolvedValue({ user_id: 9n }),
    },
    generation_outbox: { create: createOutbox },
  };
  const service = new GenerationCommandService({
    client: { $transaction: (run: (client: typeof tx) => Promise<boolean>) => run(tx) },
  } as never);
  return { service, updateMany, createOutbox };
}

describe("GenerationCommandService.markFailed", () => {
  it("queued 任务置 failed（含 error code/message/details 与清 next_action_at）", async () => {
    const { service, updateMany, createOutbox } = serviceWithQueuedUpdateCount(1);

    await service.markFailed("301", "ENQUEUE_FAILED", "任务入队失败", {
      raw: "RocketMQ 入队失败",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: BigInt("301"), status: "queued" },
      data: {
        status: "failed",
        error: {
          code: "ENQUEUE_FAILED",
          message: "任务入队失败",
          details: { raw: "RocketMQ 入队失败" },
        },
        next_action_at: null,
        version: { increment: 1 },
      },
    });
    expect(createOutbox).toHaveBeenCalledWith({ data: {
      job_id: 301n,
      user_id: 9n,
      terminal_status: "failed",
      reason: "任务入队失败",
    } });
  });

  it("非 queued 状态不被误置 failed（where 限定 status=queued）", async () => {
    const { service, updateMany, createOutbox } = serviceWithQueuedUpdateCount(0);

    await service.markFailed("301", "ENQUEUE_FAILED", "任务入队失败");

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 301n, status: "queued" },
    }));
    expect(createOutbox).not.toHaveBeenCalled();
  });
});

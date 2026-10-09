import { describe, expect, it, vi } from "vitest";

import { GenerationCommandService } from "./generation-command.service.js";

describe("GenerationCommandService.markFailed", () => {
  it("queued 任务置 failed（含 error code/message/details 与清 next_action_at）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new GenerationCommandService({
      client: { generation_jobs: { updateMany } },
    } as never);

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
  });

  it("非 queued 状态不被误置 failed（where 限定 status=queued）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = new GenerationCommandService({
      client: { generation_jobs: { updateMany } },
    } as never);

    await service.markFailed("301", "ENQUEUE_FAILED", "任务入队失败");

    const arg = updateMany.mock.calls[0]![0] as {
      where: { status?: string };
    };
    expect(arg.where.status).toBe("queued");
  });
});

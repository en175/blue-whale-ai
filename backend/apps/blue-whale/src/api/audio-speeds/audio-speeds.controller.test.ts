// IKHW59：调速创建入口 controller 单测——凭证密封透传 + MQ 发送断言 + 入队失败回拨。
// audio-trims（IKHB6N）未建 controller 测试；本票按任务口径（MQ 发送断言）对齐
// image-cutouts.controller.test.ts 接缝（IKGXM1 先例，零新增测试设施：vi.mock + 直接构造）。
// service 复核矩阵见 libs/shared/audio-speeds/audio-speeds.service.test.ts。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ERROR_ENQUEUE_FAILED, ok } from "@lib/contracts";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueAudioSpeedJob: vi.fn(),
}));
vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { error: vi.fn() },
}));

const { enqueueAudioSpeedJob } = await import("@lib/shared/generation/generation-queue.js");
const { AudioSpeedsController } = await import("./audio-speeds.controller.js");

function makeController(serviceOverrides: { create?: unknown; markFailed?: unknown } = {}) {
  const service = {
    create:
      serviceOverrides.create ??
      vi.fn().mockResolvedValue(ok({ job_id: "400", status: "queued" })),
    markFailed: serviceOverrides.markFailed ?? vi.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new AudioSpeedsController(service as never),
    service,
  };
}

describe("AudioSpeedsController.create", () => {
  beforeEach(() => {
    vi.mocked(enqueueAudioSpeedJob).mockReset();
  });
  it("enqueues the created job (tag=type 由 enqueueAudioSpeedJob 常量保证) and returns the result unchanged", async () => {
    const { controller, service } = makeController();
    vi.mocked(enqueueAudioSpeedJob).mockResolvedValue(undefined);
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(enqueueAudioSpeedJob).toHaveBeenCalledWith("400");
    expect(result.code).toBe(200);
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it("does not enqueue when the service rejects the request", async () => {
    const { controller } = makeController({
      create: vi.fn().mockResolvedValue({ code: 400, msg: "bad", data: null }),
    });
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(result.code).toBe(400);
    expect(enqueueAudioSpeedJob).not.toHaveBeenCalled();
  });

  it("marks the job failed (enqueue_failed) when the queue rejects the message", async () => {
    const { controller, service } = makeController();
    vi.mocked(enqueueAudioSpeedJob).mockRejectedValue(new Error("rocketmq down"));
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    // 回拨失败不影响响应形状（任务已建，失败态由 GET /api/jobs/:id 呈现）。
    expect(result.code).toBe(200);
    expect(service.markFailed).toHaveBeenCalledWith(
      "400",
      ERROR_ENQUEUE_FAILED,
      "任务入队失败",
      { raw: "RocketMQ 入队失败" },
    );
  });
});

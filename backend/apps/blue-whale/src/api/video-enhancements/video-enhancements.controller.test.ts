// IKH3VE：视频 HD 高清创建入口 controller 单测——凭证密封透传 + 入队失败回拨
// （先例：video-subtitle-erasures.controller.test.ts 直接构造）。
// service 复核矩阵见 libs/shared/video-enhancements/video-enhancements.service.test.ts。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ERROR_ENQUEUE_FAILED, ok } from "@lib/contracts";

vi.mock("@lib/shared/generation/video-queue.js", () => ({
  enqueueVideoEnhanceJob: vi.fn(),
}));
vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { error: vi.fn() },
}));

const { enqueueVideoEnhanceJob } = await import("@lib/shared/generation/video-queue.js");
const { VideoEnhancementsController } = await import("./video-enhancements.controller.js");

function makeController(serviceOverrides: { create?: unknown; markFailed?: unknown } = {}) {
  const service = {
    create:
      serviceOverrides.create ??
      vi.fn().mockResolvedValue(ok({ job_id: "400", status: "queued" })),
    markFailed: serviceOverrides.markFailed ?? vi.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new VideoEnhancementsController(service as never),
    service,
  };
}

describe("VideoEnhancementsController.create", () => {
  beforeEach(() => {
    vi.mocked(enqueueVideoEnhanceJob).mockReset();
  });

  it("seals the requester sk- token and passes it to the service as internal", async () => {
    const { controller, service } = makeController();
    const result = await controller.create(
      { userId: "9" } as never,
      "55",
      { source_asset_id: "88", target_node_id: "node-1", resolution: "1080p" },
      "Bearer sk-live-token",
    );
    expect(result.code).toBe(200);
    expect(service.create).toHaveBeenCalledWith("9", "55", {
      source_asset_id: "88",
      target_node_id: "node-1",
      resolution: "1080p",
    }, {
      providerCredential: "sk-live-token",
    });
  });

  it("enqueues the created job and returns the result unchanged", async () => {
    const { controller, service } = makeController();
    vi.mocked(enqueueVideoEnhanceJob).mockResolvedValue(undefined);
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(enqueueVideoEnhanceJob).toHaveBeenCalledWith("400");
    expect(result.code).toBe(200);
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it("does not enqueue when the service rejects the request", async () => {
    const { controller } = makeController({
      create: vi.fn().mockResolvedValue({ code: 400, msg: "bad", data: null }),
    });
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(result.code).toBe(400);
    expect(enqueueVideoEnhanceJob).not.toHaveBeenCalled();
  });

  it("marks the job failed (enqueue_failed) when the queue rejects the message", async () => {
    const { controller, service } = makeController();
    vi.mocked(enqueueVideoEnhanceJob).mockRejectedValue(new Error("rocketmq down"));
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

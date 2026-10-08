import { describe, expect, it, vi, beforeEach } from "vitest";
import { ERROR_ENQUEUE_FAILED, ok } from "@lib/contracts";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueImageEraseJob: vi.fn(),
}));
vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { error: vi.fn() },
}));

const { enqueueImageEraseJob } = await import("@lib/shared/generation/generation-queue.js");
const { ImageErasuresController } = await import("./image-erasures.controller.js");

function makeController(serviceOverrides: { create?: unknown; markFailed?: unknown } = {}) {
  const service = {
    create:
      serviceOverrides.create ??
      vi.fn().mockResolvedValue(ok({ job_id: "400", status: "queued" })),
    markFailed: serviceOverrides.markFailed ?? vi.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new ImageErasuresController(service as never),
    service,
  };
}

describe("ImageErasuresController.create", () => {
  beforeEach(() => {
    vi.mocked(enqueueImageEraseJob).mockReset();
  });
  it("enqueues the created job and returns the result unchanged", async () => {
    const { controller, service } = makeController();
    vi.mocked(enqueueImageEraseJob).mockResolvedValue(undefined);
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(enqueueImageEraseJob).toHaveBeenCalledWith("400");
    expect(result.code).toBe(200);
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it("does not enqueue when the service rejects the request", async () => {
    const { controller } = makeController({
      create: vi.fn().mockResolvedValue({ code: 400, msg: "bad", data: null }),
    });
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(result.code).toBe(400);
    expect(enqueueImageEraseJob).not.toHaveBeenCalled();
  });

  it("marks the job failed (enqueue_failed) when the queue rejects the message", async () => {
    const { controller, service } = makeController();
    vi.mocked(enqueueImageEraseJob).mockRejectedValue(new Error("rocketmq down"));
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(result.code).toBe(200);
    expect(service.markFailed).toHaveBeenCalledWith(
      "400",
      ERROR_ENQUEUE_FAILED,
      "任务入队失败",
      { raw: "RocketMQ 入队失败" },
    );
  });
});

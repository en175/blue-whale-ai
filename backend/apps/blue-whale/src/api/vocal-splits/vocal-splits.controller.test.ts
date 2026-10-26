import { describe, expect, it, vi } from "vitest";
import { ok } from "@lib/contracts";
import { VocalSplitsController } from "./vocal-splits.controller.js";

function makeController(serviceOverrides: { create?: unknown } = {}) {
  const service = {
    create:
      serviceOverrides.create ??
      vi.fn().mockResolvedValue(ok({ job_id: "400", status: "queued" })),
  };
  return {
    controller: new VocalSplitsController(service as never),
    service,
  };
}

describe("VocalSplitsController.create", () => {
  it("delegates to the service and returns its envelope unchanged", async () => {
    const { controller, service } = makeController();
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(service.create).toHaveBeenCalledWith("9", "55", {}, undefined);
    expect(result.code).toBe(200);
  });

  it("passes through a service rejection", async () => {
    const { controller } = makeController({
      create: vi.fn().mockResolvedValue({ code: 400, msg: "bad", data: null }),
    });
    const result = await controller.create({ userId: "9" } as never, "55", {}, undefined);
    expect(result.code).toBe(400);
  });
});

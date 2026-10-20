import { describe, expect, it, vi } from "vitest";
import { ok } from "@lib/contracts";

const { VideoMattingsController } = await import("./video-mattings.controller.js");

function makeController(create: unknown) {
  return new VideoMattingsController({ create } as never);
}

describe("VideoMattingsController.create", () => {
  it("returns the service result unchanged", async () => {
    const create = vi.fn().mockResolvedValue(ok({ job_id: "400", status: "queued" }));
    const result = await makeController(create).create({ userId: "9" } as never, "55", {});
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith("9", "55", {});
  });

  it("returns rejection envelopes without enqueueing", async () => {
    const result = await makeController(
      vi.fn().mockResolvedValue({ code: 400, msg: "bad", data: null }),
    ).create({ userId: "9" } as never, "55", {});
    expect(result).toEqual({ code: 400, msg: "bad", data: null });
  });
});

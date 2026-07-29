import { describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

describe("WorkerRepo.resolveInputAssets", () => {
  it("accepts an owner-scoped uploaded Asset before it is attached to a project", async () => {
    const assets = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: BigInt(41),
          type: "image",
          url: "https://tos.test/uploads/9/image/source.png",
          mime: "image/png",
        },
      ]),
    };
    const repo = createWorkerRepo({ assets } as never);

    await repo.resolveInputAssets(["41"], "9", "55");

    expect(assets.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [BigInt(41)] },
        user_id: BigInt(9),
        OR: [{ project_id: BigInt(55) }, { project_id: BigInt(0) }],
        status: "normal",
        is_delete: false,
      },
      select: { id: true, type: true, url: true, mime: true },
    });
  });
});

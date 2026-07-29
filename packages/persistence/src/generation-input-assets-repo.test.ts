import { describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

describe("WorkerRepo.resolveInputAssets", () => {
  it("accepts an owner-scoped uploaded Asset before it is attached to a project", async () => {
    const assets = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: BigInt(41),
          type: "video",
          url: "https://tos.test/uploads/9/video/source.mov",
          mime: "video/quicktime",
          size: BigInt(1234),
          width: 1920,
          height: 1080,
          duration: 7,
          duration_ms: 6500,
        },
      ]),
    };
    const repo = createWorkerRepo({ assets } as never);

    await expect(repo.resolveInputAssets(["41"], "9", "55")).resolves.toEqual([
      {
        id: "41",
        type: "video",
        url: "https://tos.test/uploads/9/video/source.mov",
        mime: "video/quicktime",
        size: 1234,
        width: 1920,
        height: 1080,
        duration: 6.5,
      },
    ]);

    expect(assets.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [BigInt(41)] },
        user_id: BigInt(9),
        OR: [{ project_id: BigInt(55) }, { project_id: BigInt(0) }],
        status: "normal",
        is_delete: false,
      },
      select: {
        id: true,
        type: true,
        url: true,
        mime: true,
        size: true,
        width: true,
        height: true,
        duration: true,
        duration_ms: true,
      },
    });
  });
});

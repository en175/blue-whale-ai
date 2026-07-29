import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSnapshotRepo } from "./snapshot-repo.js";

describe("SnapshotRepo.loadJobsAndAssets", () => {
  it("does not expose the encrypted provider credential in snapshot input", async () => {
    const prisma = {
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 300n,
            type: "video",
            source: "bottom_dock",
            status: "processing",
            progress: 10,
            input: {
              prompt: "鲸鱼游动",
              provider_credential: "sealed-token",
            },
            output_asset_ids: [],
            error: null,
          },
        ]),
      },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets("55");

    expect(result.generation_jobs[0]?.input).toEqual({ prompt: "鲸鱼游动" });
  });

  it("returns normal uploaded project assets even when no generation job produced them", async () => {
    const findJobs = vi.fn().mockResolvedValue([]);
    const findAssets = vi.fn().mockResolvedValue([
      {
        id: 200n,
        project_id: 55n,
        type: "image",
        url: "tos://project/55/200.png",
      },
      {
        id: 201n,
        project_id: 55n,
        type: "image",
        url: "tos://project/55/201.png",
      },
    ]);
    const prisma = {
      generation_jobs: { findMany: findJobs },
      assets: { findMany: findAssets },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets("55");

    expect(findAssets).toHaveBeenCalledTimes(1);
    expect(findAssets).toHaveBeenCalledWith({
      where: { project_id: 55n, status: "normal", is_delete: false },
    });
    expect(result.assets).toEqual([
      {
        id: "200",
        project_id: "55",
        type: "image",
        url: "tos://project/55/200.png",
      },
      {
        id: "201",
        project_id: "55",
        type: "image",
        url: "tos://project/55/201.png",
      },
    ]);
  });
});

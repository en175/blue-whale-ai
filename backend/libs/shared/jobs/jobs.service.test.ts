import { describe, expect, it, vi } from "vitest";

import { JobsService } from "./jobs.service.js";

function serviceOf(jobsFindMany = vi.fn().mockResolvedValue([])): {
  service: JobsService;
  jobsFindMany: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    client: {
      generation_jobs: { findMany: jobsFindMany },
      catalog_models: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };
  return { service: new JobsService(prisma as never, {} as never), jobsFindMany };
}

describe("JobsService.loadTaskSummaries", () => {
  it("非法 id 被滤掉，不会带着 BigInt() 抛出去", async () => {
    const { service, jobsFindMany } = serviceOf();

    await service.loadTaskSummaries(["7", "abc", "-1", "0", "", "1.5e3", "8"]);

    expect(jobsFindMany).toHaveBeenCalledWith({
      where: { id: { in: [7n, 8n] } },
      select: { id: true, type: true, input: true },
    });
  });

  it("全是非法 id → 不发查询", async () => {
    const { service, jobsFindMany } = serviceOf();

    const map = await service.loadTaskSummaries(["abc", ""]);

    expect(map.size).toBe(0);
    expect(jobsFindMany).not.toHaveBeenCalled();
  });

  it("空列表 → 不发查询", async () => {
    const { service, jobsFindMany } = serviceOf();

    const map = await service.loadTaskSummaries([]);

    expect(map.size).toBe(0);
    expect(jobsFindMany).not.toHaveBeenCalled();
  });

  it("重复 id 只查一次", async () => {
    const { service, jobsFindMany } = serviceOf();

    await service.loadTaskSummaries(["7", "7", "7"]);

    expect(jobsFindMany).toHaveBeenCalledTimes(1);
    expect(jobsFindMany).toHaveBeenCalledWith({
      where: { id: { in: [7n] } },
      select: { id: true, type: true, input: true },
    });
  });
});

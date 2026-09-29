import { describe, expect, it, vi } from "vitest";

import { JobsService } from "./jobs.service.js";

/**
 * `loadTaskSummaries` 的边界：它是**积分记录页**那条 enrich 链路的入口守卫。
 *
 * <p>为什么不测正常路径：查什么、怎么投影由 `createJobRepo.loadChargeTaskSummaries`
 * 的单测钉住（job-repo.test.ts），这里只钉住本层**多出来的**那件事——把 id 洗一遍，
 * 让一条脏 id 不至于把整页带塌。
 */
function serviceOf(jobsFindMany = vi.fn().mockResolvedValue([])): {
  service: JobsService;
  jobsFindMany: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    client: {
      generation_jobs: { findMany: jobsFindMany },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };
  // repo 是懒建的（getter），只要 prisma.client 的 shape 对，两个依赖都到不了
  return { service: new JobsService(prisma as never, {} as never), jobsFindMany };
}

describe("JobsService.loadTaskSummaries", () => {
  it("非法 id 被滤掉，不会带着 BigInt() 抛出去", async () => {
    const { service, jobsFindMany } = serviceOf();

    await service.loadTaskSummaries(["7", "abc", "-1", "0", "", "1.5e3", "8"]);

    // 一条脏 id 只该让那一行少个提示词，不该让整页 500
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

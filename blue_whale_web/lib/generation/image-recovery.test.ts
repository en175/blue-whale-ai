import { beforeEach, describe, expect, it, vi } from "vitest";

const { processNextImageJob } = vi.hoisted(() => ({
  processNextImageJob: vi.fn(),
}));

vi.mock("./worker/generation-worker", () => ({
  processNextImageJob,
}));

// eslint-disable-next-line import/first
import { recoverDueImageJobs } from "./image-recovery";

beforeEach(() => {
  processNextImageJob.mockReset();
});

describe("recoverDueImageJobs", () => {
  it("先重置孤儿再循环处理到点任务，直到没有到点任务", async () => {
    processNextImageJob
      .mockResolvedValueOnce("301")
      .mockResolvedValueOnce("302")
      .mockResolvedValue(null);
    const resetStalledImageJobs = vi.fn().mockResolvedValue(2);

    const result = await recoverDueImageJobs({
      repo: { resetStalledImageJobs },
      workerId: "recover-1",
    } as never);

    expect(result).toEqual({ reset: 2, processed: 2 });
    expect(resetStalledImageJobs).toHaveBeenCalledTimes(1);
    expect(processNextImageJob).toHaveBeenCalledTimes(3);
  });

  it("没有到点任务时只重置、不处理", async () => {
    processNextImageJob.mockResolvedValue(null);
    const resetStalledImageJobs = vi.fn().mockResolvedValue(0);

    const result = await recoverDueImageJobs({
      repo: { resetStalledImageJobs },
      workerId: "recover-2",
    } as never);

    expect(result).toEqual({ reset: 0, processed: 0 });
    expect(processNextImageJob).toHaveBeenCalledTimes(1);
  });
});

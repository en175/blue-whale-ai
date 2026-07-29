import { describe, expect, it, vi } from "vitest";

import {
  createVideoJobProcessor,
  recoverDueVideoJobs,
} from "./video-worker.js";

describe("BullMQ video generation worker", () => {
  it("processes only the generation job id carried by the BullMQ message", async () => {
    const runStep = vi.fn().mockResolvedValue("300");
    const process = createVideoJobProcessor({ runStep });

    await process({ data: { jobId: "300" } });

    expect(runStep).toHaveBeenCalledOnce();
    expect(runStep).toHaveBeenCalledWith("300");
  });

  it("re-enqueues due database jobs as low-frequency recovery", async () => {
    const repo = {
      listDueVideoJobIds: vi.fn().mockResolvedValue(["300", "301"]),
    };
    const producer = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };

    await expect(recoverDueVideoJobs(repo, producer, 100)).resolves.toBe(2);

    expect(repo.listDueVideoJobIds).toHaveBeenCalledWith(100);
    expect(producer.enqueue).toHaveBeenNthCalledWith(1, "300");
    expect(producer.enqueue).toHaveBeenNthCalledWith(2, "301");
  });
});

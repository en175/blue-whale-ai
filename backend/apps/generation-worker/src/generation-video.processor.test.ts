import { describe, expect, it, vi } from "vitest";

import { GenerationVideoProcessor } from "./generation-video.processor.js";
import { IMAGE_GENERATION_TAG } from "@lib/shared/generation/queue.constants.js";

/** IKBGKA review #4：BullMQ 回退路径显式拒绝 image job，不静默丢给视频 worker。 */
describe("GenerationVideoProcessor bullmq 回退", () => {
  it("image job 显式抛错（不静默当作视频处理）", async () => {
    const videoRun = vi.fn().mockResolvedValue("300");
    const extractRun = vi.fn().mockResolvedValue("300");
    const processor = new GenerationVideoProcessor(
      { runStep: videoRun } as never,
      { runStep: extractRun } as never,
    );

    await expect(
      processor.process({ name: IMAGE_GENERATION_TAG, data: { jobId: "301" } } as never),
    ).rejects.toThrow(/BullMQ 回退路径不支持图片任务/);
    expect(videoRun).not.toHaveBeenCalled();
  });

  it("media_extract 仍走提取 worker", async () => {
    const videoRun = vi.fn().mockResolvedValue("300");
    const extractRun = vi.fn().mockResolvedValue("301");
    const processor = new GenerationVideoProcessor(
      { runStep: videoRun } as never,
      { runStep: extractRun } as never,
    );

    await expect(
      processor.process({ name: "media_extract", data: { jobId: "301" } } as never),
    ).resolves.toBe("301");
    expect(extractRun).toHaveBeenCalledWith("301");
  });
});

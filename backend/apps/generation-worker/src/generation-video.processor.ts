import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import {
  AUDIO_GENERATION_TAG,
  IMAGE_GENERATION_TAG,
  MEDIA_EXTRACT_TAG,
  VIDEO_GENERATION_QUEUE,
} from "@lib/shared/generation/queue.constants.js";
import { VideoWorkerService } from "./video-worker.service.js";
import { MediaExtractWorkerService } from "./media-extract-worker.service.js";
import { AudioWorkerService } from "./audio-worker.service.js";
import { createLogger } from "@blue-whale/core/logging";

const logger = createLogger("generation-worker");

/** BullMQ 回退路径：同队列按 job.name 分发（step=视频 / media_extract=媒体提取）。 */
@Processor(VIDEO_GENERATION_QUEUE)
export class GenerationVideoProcessor extends WorkerHost {
  constructor(
    private readonly videoWorker: VideoWorkerService,
    private readonly mediaExtractWorker: MediaExtractWorkerService,
    private readonly audioWorker: AudioWorkerService,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<string | null> {
    if (job.name === MEDIA_EXTRACT_TAG) {
      return this.mediaExtractWorker.runStep(job.data.jobId);
    }
    if (job.name === IMAGE_GENERATION_TAG) {
      // IKBGKA review #4：BullMQ 回退路径无图片 consumer——若走到这里（enqueueImageGenerationJob
      // 在 bullmq 驱动下投了 image job），显式抛错让 BullMQ 重试/标记失败，而不是丢给视频 worker
      // 静默 claim null → 图片任务无声丢失。
      throw new Error(
        "BullMQ 回退路径不支持图片任务：请使用 VIDEO_QUEUE_DRIVER=rocketmq 或提供图片 BullMQ consumer",
      );
    }
    if (job.name === AUDIO_GENERATION_TAG) {
      // IKCR78：BullMQ 回退路径同样无音频 consumer——显式抛错，不静默丢给视频 worker。
      throw new Error(
        "BullMQ 回退路径不支持音频任务：请使用 VIDEO_QUEUE_DRIVER=rocketmq 或提供音频 BullMQ consumer",
      );
    }
    return this.videoWorker.runStep(job.data.jobId);
  }
}

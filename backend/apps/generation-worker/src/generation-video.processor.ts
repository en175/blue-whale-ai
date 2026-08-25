import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import {
  MEDIA_EXTRACT_TAG,
  VIDEO_GENERATION_QUEUE,
} from "@lib/shared/generation/queue.constants.js";
import { VideoWorkerService } from "./video-worker.service.js";
import { MediaExtractWorkerService } from "./media-extract-worker.service.js";

/** BullMQ 回退路径：同队列按 job.name 分发（step=视频 / media_extract=媒体提取）。 */
@Processor(VIDEO_GENERATION_QUEUE)
export class GenerationVideoProcessor extends WorkerHost {
  constructor(
    private readonly videoWorker: VideoWorkerService,
    private readonly mediaExtractWorker: MediaExtractWorkerService,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<string | null> {
    if (job.name === MEDIA_EXTRACT_TAG) {
      return this.mediaExtractWorker.runStep(job.data.jobId);
    }
    return this.videoWorker.runStep(job.data.jobId);
  }
}

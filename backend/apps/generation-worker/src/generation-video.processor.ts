import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { VIDEO_GENERATION_QUEUE } from "@lib/shared/generation/queue.constants.js";
import { VideoWorkerService } from "./video-worker.service.js";

@Processor(VIDEO_GENERATION_QUEUE)
export class GenerationVideoProcessor extends WorkerHost {
  constructor(private readonly videoWorker: VideoWorkerService) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<string | null> {
    return this.videoWorker.runStep(job.data.jobId);
  }
}

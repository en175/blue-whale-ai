import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { enqueueVideoGenerationJob } from "@lib/shared/generation/video-queue.js";
import { VideoWorkerService } from "./video-worker.service.js";

/** 低频恢复扫描：DB 事实源里到点未入队的视频 job 补入队（Redis 故障兜底）。 */
@Injectable()
export class RecoveryService implements OnModuleInit {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(private readonly videoWorker: VideoWorkerService) {}

  async onModuleInit(): Promise<void> {
    await this.recover();
  }

  @Interval(
    Number.parseInt(process.env.GENERATION_RECOVERY_INTERVAL_MS ?? "60000", 10),
  )
  async recover(): Promise<void> {
    try {
      const jobIds = await this.videoWorker.repo.listDueVideoJobIds(100);
      for (const jobId of jobIds) await enqueueVideoGenerationJob(jobId);
    } catch (error) {
      this.logger.error(
        "recovery scan failed",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

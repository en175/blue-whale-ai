import { Injectable, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { createLogger } from "@blue-whale/core/logging";
import {
  enqueueImageGenerationJob,
  enqueueVideoGenerationJob,
} from "@lib/shared/generation/video-queue.js";
import { VideoWorkerService } from "./video-worker.service.js";
import { ImageWorkerService } from "./image-worker.service.js";

const logger = createLogger("generation-worker");

/** 低频恢复扫描：DB 事实源里到点未入队的视频 job 补入队（Redis 故障兜底）。
 *  IKBGKA（review 2 轮）：图片同构——孤儿/漏入队的图片 job 补入队到 RocketMQ，
 *  由 MQ 消费端（Semaphore 背压）统一处理，不在本进程 inline 跑（封死无背压后门）。 */
@Injectable()
export class RecoveryService implements OnModuleInit {
  constructor(
    private readonly videoWorker: VideoWorkerService,
    private readonly imageWorker: ImageWorkerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recover();
  }

  @Interval(
    Number.parseInt(process.env.GENERATION_RECOVERY_INTERVAL_MS ?? "60000", 10),
  )
  async recover(): Promise<void> {
    try {
      const videoIds = await this.videoWorker.repo.listDueVideoJobIds(100);
      for (const jobId of videoIds) await enqueueVideoGenerationJob(jobId);
      // IKBGKA：图片补入队（与视频同批扫描；enqueue 失败只 log，下轮扫描再试）。
      const imageIds = await this.imageWorker.deps.repo.listDueImageJobIds(100);
      for (const jobId of imageIds) {
        await enqueueImageGenerationJob(jobId).catch((error) => {
          logger.error(
            `recovery enqueue image job ${jobId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
    } catch (error) {
      logger.error(
        `recovery scan failed${
          error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
        }`,
      );
    }
  }
}

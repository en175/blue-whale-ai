import { Injectable, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { createLogger } from "@blue-whale/core/logging";
import {
  enqueueAudioGenerationJob,
  enqueueImageGenerationJob,
  enqueueMediaExtractJob,
  enqueueVideoGenerationJob,
} from "@lib/shared/generation/video-queue.js";
import { VideoWorkerService } from "./video-worker.service.js";
import { ImageWorkerService } from "./image-worker.service.js";
import { MediaExtractWorkerService } from "./media-extract-worker.service.js";
import { AudioWorkerService } from "./audio-worker.service.js";

const logger = createLogger("generation-worker");

/** 低频恢复扫描：DB 事实源里到点未入队的视频 job 补入队（Redis 故障兜底）。
 *  IKBGKA（review 2 轮）：图片同构——孤儿/漏入队的图片 job 补入队到 RocketMQ，
 *  由 MQ 消费端（Semaphore 背压）统一处理，不在本进程 inline 跑（封死无背压后门）。
 *  IKC9EJ：media_extract 同构——创建时同步入队失败/消息丢失会永久卡 queued，低频扫描补入队。
 *  IKCR78：音频同构——音频生成改走 RocketMQ 异步后，孤儿/漏入队的音频 job 同样补入队。 */
@Injectable()
export class RecoveryService implements OnModuleInit {
  constructor(
    private readonly videoWorker: VideoWorkerService,
    private readonly imageWorker: ImageWorkerService,
    private readonly mediaExtractWorker: MediaExtractWorkerService,
    private readonly audioWorker: AudioWorkerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recover();
  }

  @Interval(
    Number.parseInt(process.env.GENERATION_RECOVERY_INTERVAL_MS ?? "60000", 10),
  )
  async recover(): Promise<void> {
    try {
      // IKC9EJ：恢复补入队均记 info 日志——卡 queued 的 job 被救活/持续重放时留可观测信号，
      // 否则「job 永久 queued」是唯一信号，recovery 悄悄救活/救不活都不可见。
      const videoIds = await this.videoWorker.repo.listDueVideoJobIds(100);
      for (const jobId of videoIds) {
        logger.info(`recovery re-enqueue stuck video job ${jobId}`);
        // IKC9EJ：视频补入队同样逐条 catch——任一 job 失败只记 error 下轮再试，
        // 不 throw 跳过本轮后续 image/media_extract 扫描（与 image/media 三段一致）。
        await enqueueVideoGenerationJob(jobId).catch((error) => {
          logger.error(
            `recovery enqueue video job ${jobId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
      // IKBGKA：图片补入队（与视频同批扫描；enqueue 失败只 log，下轮扫描再试）。
      const imageIds = await this.imageWorker.deps.repo.listDueImageJobIds(100);
      for (const jobId of imageIds) {
        logger.info(`recovery re-enqueue stuck image job ${jobId}`);
        await enqueueImageGenerationJob(jobId).catch((error) => {
          logger.error(
            `recovery enqueue image job ${jobId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
      // IKC9EJ：media_extract 补入队（与图片同构；enqueue 失败只 log，下轮扫描再试）。
      // 分工：enqueue 抛异常由创建端控制器 markFailed 置 failed（fail-fast，用户可见失败）；
      // 本扫描兜「发送成功但消息丢失」的永久卡 queued 场景，只捞 queued/processing+lease 过期，failed 不在此列。
      const mediaExtractIds =
        await this.mediaExtractWorker.repo.listDueMediaExtractJobIds(100);
      for (const jobId of mediaExtractIds) {
        logger.info(`recovery re-enqueue stuck media_extract job ${jobId}`);
        await enqueueMediaExtractJob(jobId).catch((error) => {
          logger.error(
            `recovery enqueue media_extract job ${jobId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
      // IKCR78：音频补入队（与图片同构；enqueue 失败只 log，下轮扫描再试）。
      // 分工：enqueue 抛异常由创建端控制器 markFailed 置 failed（fail-fast，用户可见失败）；
      // 本扫描兜「发送成功但消息丢失」的永久卡 queued 场景，只捞 queued/processing+lease 过期，failed 不在此列。
      const audioIds = await this.audioWorker.deps.repo.listDueAudioJobIds(100);
      for (const jobId of audioIds) {
        logger.info(`recovery re-enqueue stuck audio job ${jobId}`);
        await enqueueAudioGenerationJob(jobId).catch((error) => {
          logger.error(
            `recovery enqueue audio job ${jobId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
      // 注：对已入队未消费的 queued 任务，每轮扫描会重复补入队（放大重投，图片/视频同款）。
      // 安全兜底：消费者 claim-by-id CAS + null-claim ack 幂等，重复消息不产生重复结果。
    } catch (error) {
      logger.error(
        `recovery scan failed${
          error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
        }`,
      );
    }
  }
}

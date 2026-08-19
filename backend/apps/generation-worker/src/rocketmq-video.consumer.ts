import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SimpleConsumer, type MessageView } from "rocketmq-client-nodejs";
import { createLogger } from "@blue-whale/core/logging";

import { loadRocketMqConfig } from "@lib/shared/generation/video-queue.js";
import { VideoWorkerService } from "./video-worker.service.js";

const logger = createLogger("generation-worker");

/** RocketMQ 视频唤醒消费者：SimpleConsumer 长轮询，成功才 ack（失败不 ack → 不可见期后重投）。
 *  正确性仍由 MySQL 权威队列兜底：claimVideoJobById 带 fencing，重复唤醒无害；
 *  已失败 job claim 返回 null → runStep 快速返回 → ack，不会空转。 */
@Injectable()
export class RocketMqVideoConsumer implements OnModuleInit, OnModuleDestroy {
  private consumer: SimpleConsumer | null = null;
  private running = false;

  constructor(private readonly videoWorker: VideoWorkerService) {}

  async onModuleInit(): Promise<void> {
    const config = loadRocketMqConfig();
    if (!config.endpoints) {
      logger.error(
        "未配置 ROCKETMQ_ENDPOINTS，RocketMQ 视频消费者未启动",
      );
      return;
    }
    const consumerGroup =
      process.env.ROCKETMQ_CONSUMER_GROUP ?? "generation-video-worker";
    this.consumer = new SimpleConsumer({
      endpoints: config.endpoints,
      namespace: "",
      sslEnabled: config.sslEnabled,
      ...(config.accessKey && config.accessSecret
        ? {
            sessionCredentials: {
              accessKey: config.accessKey,
              accessSecret: config.accessSecret,
            },
          }
        : {}),
      consumerGroup,
      subscriptions: new Map().set(config.topic, config.tag),
    });
    await this.consumer.startup();
    this.running = true;
    logger.info(
      `RocketMQ 视频消费者已启动: ${config.endpoints} topic=${config.topic} group=${consumerGroup}`,
    );
    void this.loop().catch((error) => {
      logger.error(
        `消费循环异常退出${
          error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
        }`,
      );
    });
  }

  /** receive 长轮询循环。单条消息顺序处理（runStep 是短步骤：submit/poll + DB 写）。 */
  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.consumer!.receive(10, 30_000);
        for (const message of messages) {
          await this.processMessage(message);
        }
      } catch (error) {
        logger.error(
          `receive 失败，1s 后重试: ${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  private async processMessage(message: MessageView): Promise<void> {
    let jobId: string | null = null;
    try {
      const body = JSON.parse(message.body.toString()) as { jobId?: unknown };
      jobId = typeof body.jobId === "string" ? body.jobId : null;
    } catch {
      // 消息体不是合法 {jobId} JSON：丢弃（ack），不让坏消息阻塞队列
    }
    if (!jobId) {
      await this.consumer!.ack(message);
      return;
    }
    try {
      await this.videoWorker.runStep(jobId);
      await this.consumer!.ack(message);
    } catch (error) {
      // runStep 瞬时失败（如 new-api 不可达）：不 ack → 不可见期后重投。
      // 重投自愈：job 在 DB 里一旦失败/到期不可领，claim 返回 null → runStep 快速返回 → ack，
      // 消息不再空转；DB 恢复扫描/lease 过期兜底最终推进 job 状态。
      logger.warn(
        `runStep 失败，等待重投 jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.consumer) {
      try {
        await this.consumer.shutdown();
      } catch {
        // 关闭失败可忽略
      }
      this.consumer = null;
    }
  }
}

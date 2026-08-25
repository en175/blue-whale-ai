// IKARDY：RocketMQ 媒体提取唤醒消费者（tag=media_extract）。与视频消费者同 topic 不同 tag，独立 consumer group。
// 多视频并行：receive 拉到的消息经 Semaphore 并发派发（默认 2，对齐 2 核容器部署），每个提取任务独立 ffmpeg 进程吃一个核。
// SimpleConsumer 长轮询，成功才 ack；claim-by-id fencing 兜底重复唤醒。
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SimpleConsumer, type MessageView } from "rocketmq-client-nodejs";
import { createLogger } from "@blue-whale/core/logging";

import { loadRocketMqConfig } from "@lib/shared/generation/video-queue.js";
import { MEDIA_EXTRACT_TAG } from "@lib/shared/generation/queue.constants.js";
import { MediaExtractWorkerService } from "./media-extract-worker.service.js";

const logger = createLogger("generation-worker");

/** 提取并发度：MEDIA_EXTRACT_CONCURRENCY 显式指定优先（1-16）；缺省 2（对齐当前容器 2 核部署）。
 *  确定性优于依赖 os.availableParallelism()——容器未设 CPU 限额时会误读宿主机核数导致超订。 */
export function loadMediaExtractConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.MEDIA_EXTRACT_CONCURRENCY;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 16) return n;
  }
  return 2;
}

/** 极简信号量：限制并发提取任务数。 */
class Semaphore {
  private queue: Array<() => void> = [];
  private count: number;

  constructor(private readonly limit: number) {
    this.count = limit;
  }

  acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.count++;
  }
}

@Injectable()
export class RocketMqMediaExtractConsumer implements OnModuleInit, OnModuleDestroy {
  private consumer: SimpleConsumer | null = null;
  private running = false;
  private semaphore = new Semaphore(loadMediaExtractConcurrency());

  constructor(private readonly mediaExtractWorker: MediaExtractWorkerService) {}

  async onModuleInit(): Promise<void> {
    const config = loadRocketMqConfig();
    if (!config.endpoints) {
      logger.error("未配置 ROCKETMQ_ENDPOINTS，RocketMQ 媒体提取消费者未启动");
      return;
    }
    const consumerGroup =
      process.env.ROCKETMQ_MEDIA_EXTRACT_CONSUMER_GROUP ??
      "generation-extract-worker";
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
      subscriptions: new Map().set(config.topic, MEDIA_EXTRACT_TAG),
    });
    await this.consumer.startup();
    this.running = true;
    logger.info(
      `RocketMQ 媒体提取消费者已启动: ${config.endpoints} topic=${config.topic} tag=${MEDIA_EXTRACT_TAG} group=${consumerGroup} concurrency=${loadMediaExtractConcurrency()}`,
    );
    void this.loop().catch((error) => {
      logger.error(
        `媒体提取消费循环异常退出${
          error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
        }`,
      );
    });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.consumer!.receive(10, 30_000);
        for (const message of messages) {
          await this.semaphore.acquire();
          if (!this.running) {
            // 停机：不再派发新任务，释放信号量，已领取消息交给不可见期重投。
            this.semaphore.release();
            return;
          }
          // 并发派发；processMessage 内部捕获异常并自行 ack/重投。
          void this.dispatch(message);
        }
      } catch (error) {
        logger.error(
          `receive 失败，1s 后重试: ${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  private async dispatch(message: MessageView): Promise<void> {
    try {
      await this.processMessage(message);
    } catch (error) {
      logger.error(
        `媒体提取消息处理异常: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.semaphore.release();
    }
  }

  private async processMessage(message: MessageView): Promise<void> {
    let jobId: string | null = null;
    try {
      const body = JSON.parse(message.body.toString()) as { jobId?: unknown };
      jobId = typeof body.jobId === "string" ? body.jobId : null;
    } catch {
      // 非法消息：ack 丢弃，不让坏消息阻塞队列
    }
    if (!jobId) {
      await this.consumer!.ack(message);
      return;
    }
    try {
      await this.mediaExtractWorker.runStep(jobId);
      await this.consumer!.ack(message);
    } catch (error) {
      // 瞬时失败：不 ack → 不可见期后重投。claim 失败返回 null 后 ack，不空转。
      logger.warn(
        `mediaExtract runStep 失败，等待重投 jobId=${jobId}: ${
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

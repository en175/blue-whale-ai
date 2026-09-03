// IKCR78：RocketMQ 音频生成唤醒消费者（tag=audio）。与视频/提取/图片消费者同 topic 不同 tag，独立 consumer group。
// 音频是一次长调用（调 new-api TTS 出音 + 写 TOS）；Semaphore(AUDIO_CONCURRENCY，默认 5) 给消费端压并发，
// 提供当前音频路径缺失的背压——超出 N 的消息在消费端等信号量，避免把 N 个长调用同时打向 new-api。
// 正确性仍由 claim-by-id fencing 兜底：重复唤醒无害；已失败 job claim 返回 null → runStep 快速返回 → ack。
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SimpleConsumer, type MessageView } from "rocketmq-client-nodejs";
import { createLogger } from "@blue-whale/core/logging";

import { loadRocketMqConfig } from "@lib/shared/generation/video-queue.js";
import { AUDIO_GENERATION_TAG } from "@lib/shared/generation/queue.constants.js";
import { AudioWorkerService } from "./audio-worker.service.js";

const logger = createLogger("generation-worker");

/** 音频消费并发度：AUDIO_CONCURRENCY 显式指定优先（1-64）；缺省 5。
 *  音频是网络 I/O 长调用（TTS + 写 TOS），5 是保守默认，env 可调——具体水线以上线压测为准。 */
export function loadAudioConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.AUDIO_CONCURRENCY;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 64) return n;
  }
  return 5;
}

/** 极简信号量：限制并发音频生成任务数。 */
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
export class RocketMqAudioConsumer implements OnModuleInit, OnModuleDestroy {
  private consumer: SimpleConsumer | null = null;
  private running = false;
  private semaphore = new Semaphore(loadAudioConcurrency());

  constructor(private readonly audioWorker: AudioWorkerService) {}

  async onModuleInit(): Promise<void> {
    const config = loadRocketMqConfig();
    if (!config.endpoints) {
      throw new Error(
        "未配置 ROCKETMQ_ENDPOINTS：RocketMQ 音频消费者无法启动。请配置 endpoints（如 115.190.244.91:8081）",
      );
    }
    const consumerGroup =
      process.env.ROCKETMQ_AUDIO_CONSUMER_GROUP ?? "generation-audio-worker";
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
      subscriptions: new Map().set(config.topic, AUDIO_GENERATION_TAG),
    });
    await this.consumer.startup();
    this.running = true;
    logger.info(
      `RocketMQ 音频消费者已启动: ${config.endpoints} topic=${config.topic} tag=${AUDIO_GENERATION_TAG} group=${consumerGroup} concurrency=${loadAudioConcurrency()}`,
    );
    void this.loop().catch((error) => {
      logger.error(
        `音频消费循环异常退出${
          error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
        }`,
      );
    });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.consumer!.receive(10, 30_000);
        // IKBGKA review #6：把「领取 N 条」与「派发」分离——先领一批并放入待办，
        // 再逐条 acquire 信号量派发，避免消费者饿死：纯 acquire 先到先得，
        // 慢任务占据信号量时新消息永远排不进 acquire 队列（已领取的也不释放）。
        const pending: MessageView[] = [];
        for (const message of messages) {
          if (!this.running) return;
          pending.push(message);
        }
        for (const message of pending) {
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
          `音频 receive 失败，1s 后重试: ${error instanceof Error ? error.message : String(error)}`,
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
        `音频消息处理异常: ${error instanceof Error ? error.message : String(error)}`,
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
    // IKBGKA review #5：jobId 必须纯数字（generation_jobs.id 为 BigInt）。
    // 非数字（脏数据/上游手写消息）直接 ack 丢弃——否则 BigInt(jobId) 在 claim 处抛错
    // → runStep 走 catch → 永不 ack → 无限重投（毒消息无限循环）。
    if (!jobId || !/^\d+$/.test(jobId)) {
      logger.warn(`丢弃非法音频消息 jobId=${String(jobId)}`);
      await this.consumer!.ack(message);
      return;
    }
    try {
      await this.audioWorker.runStep(jobId);
      await this.consumer!.ack(message);
    } catch (error) {
      // 瞬时失败：不 ack → 不可见期后重投。claim 失败返回 null 后 runStep 快速返回 → ack，不空转。
      logger.warn(
        `audio runStep 失败，等待重投 jobId=${jobId}: ${
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

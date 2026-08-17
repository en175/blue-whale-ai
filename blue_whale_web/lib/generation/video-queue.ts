import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

import type { QueueDepthReading } from "@blue-whale/core/logging";

export const VIDEO_GENERATION_QUEUE = "generation-video";

type QueuePort = {
  add(
    name: string,
    data: { jobId: string },
    options: JobsOptions,
  ): Promise<unknown>;
};

export type VideoQueueProducer = {
  enqueue(jobId: string, options?: { delayMs?: number }): Promise<void>;
};

export function loadRedisConnection(
  env: Readonly<Record<string, string | undefined>> = process.env,
  worker = false,
): ConnectionOptions {
  // 优先显式 REDIS_HOST/PORT/DB/PASSWORD；缺失时回退解析 REDIS_CONN_STRING（redis://[:pw@]host[:port][/db]）。
  // prod 容器常只给 REDIS_CONN_STRING，不回退会默认 127.0.0.1 → enqueue/消费都连不上。
  let { REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PASSWORD } = env;
  if (!REDIS_HOST && env.REDIS_CONN_STRING) {
    try {
      const u = new URL(env.REDIS_CONN_STRING);
      REDIS_HOST = u.hostname;
      REDIS_PORT = u.port;
      REDIS_DB = u.pathname.replace(/^\//, "");
      if (u.password) REDIS_PASSWORD = decodeURIComponent(u.password);
    } catch {
      // 解析失败则走下面的默认（127.0.0.1）
    }
  }
  return {
    host: REDIS_HOST ?? "127.0.0.1",
    port: Number.parseInt(REDIS_PORT ?? "6379", 10),
    db: Number.parseInt(REDIS_DB ?? "0", 10),
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    // 远端 Redis 会杀空闲阻塞连接；keepAlive 让 ioredis 探活到静默断连后自动重连，
    // BullMQ 随之重建阻塞消费者——否则 worker 看似 /ready 却不再消费，job 全成孤儿（假失败）。
    keepAlive: 30_000,
  };
}

export function createVideoQueueProducer(
  queue: QueuePort,
  now: () => number = Date.now,
): VideoQueueProducer {
  return {
    async enqueue(jobId, options = {}) {
      const delay = Math.max(0, options.delayMs ?? 0);
      const runAt = now() + delay;
      await queue.add(
        "step",
        { jobId },
        {
          jobId: `video-${jobId}-${runAt}`,
          delay,
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      );
    },
  };
}

let queue: Queue<{ jobId: string }> | null = null;

function getQueue(): Queue<{ jobId: string }> {
  queue ??= new Queue(VIDEO_GENERATION_QUEUE, {
    connection: loadRedisConnection(),
  });
  return queue;
}

/** 采样用：进程级惰性 Queue 单例（与 enqueue 共用同一连接配置）。 */
export function getVideoGenerationQueue(): Queue<{ jobId: string }> {
  return getQueue();
}

/** BullMQ getJobCounts() → 队列深度读数（IK7G9Y）：只取积压/在途态
 *  （waiting/waiting-children/delayed/active）；completed/failed 等终态
 *  计数随时间无界增长，不属于积压，由 task_finished 事件承担。 */
export function bullMqDepthReadings(
  counts: Record<string, number>,
): QueueDepthReading[] {
  const backlogStates = ["waiting", "waiting-children", "delayed", "active"];
  return backlogStates
    .filter((status) => typeof counts[status] === "number")
    .map((status) => ({
      queue: "video_bullmq",
      status,
      depth: counts[status]!,
    }));
}

export async function enqueueVideoGenerationJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  await createVideoQueueProducer(getQueue()).enqueue(jobId, options);
}

export async function closeVideoGenerationQueue(): Promise<void> {
  const current = queue;
  queue = null;
  await current?.close();
}

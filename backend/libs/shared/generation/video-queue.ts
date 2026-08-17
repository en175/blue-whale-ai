import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

export type VideoQueueProducer = {
  enqueue(jobId: string, options?: { delayMs?: number }): Promise<void>;
};

type QueuePort = {
  add(
    name: string,
    data: { jobId: string },
    options: JobsOptions,
  ): Promise<unknown>;
};

/** Redis 连接配置：显式 REDIS_HOST/PORT/DB/PASSWORD 优先，缺失回退解析 REDIS_CONN_STRING。 */
export function loadRedisConnection(
  env: Readonly<Record<string, string | undefined>> = process.env,
  worker = false,
): ConnectionOptions {
  let { REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PASSWORD } = env;
  if (!REDIS_HOST && env.REDIS_CONN_STRING) {
    try {
      const u = new URL(env.REDIS_CONN_STRING);
      REDIS_HOST = u.hostname;
      REDIS_PORT = u.port;
      REDIS_DB = u.pathname.replace(/^\//, "");
      if (u.password) REDIS_PASSWORD = decodeURIComponent(u.password);
    } catch {
      // 解析失败走默认（127.0.0.1）
    }
  }
  return {
    host: REDIS_HOST ?? "127.0.0.1",
    port: Number.parseInt(REDIS_PORT ?? "6379", 10),
    db: Number.parseInt(REDIS_DB ?? "0", 10),
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    keepAlive: 30_000,
  };
}

/** BullMQ 适配器：把 Queue 包成 VideoQueueProducer 端口（后续换 RocketMQ 时替换此适配器）。 */
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
  queue ??= new Queue("generation-video", {
    connection: loadRedisConnection(),
  });
  return queue;
}

/** 视频 job 入队（producer 侧入口）。 */
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

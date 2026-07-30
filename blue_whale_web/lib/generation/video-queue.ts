import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

export const VIDEO_GENERATION_QUEUE = "generation-video";

type QueuePort = {
  add(name: string, data: { jobId: string }, options: JobsOptions): Promise<unknown>;
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
      await queue.add("step", { jobId }, {
        jobId: `video-${jobId}-${runAt}`,
        delay,
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
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

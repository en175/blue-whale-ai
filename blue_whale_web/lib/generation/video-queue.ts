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
  return {
    host: env.REDIS_HOST ?? "127.0.0.1",
    port: Number.parseInt(env.REDIS_PORT ?? "6379", 10),
    db: Number.parseInt(env.REDIS_DB ?? "0", 10),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
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

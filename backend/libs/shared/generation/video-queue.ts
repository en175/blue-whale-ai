import { Producer } from "rocketmq-client-nodejs";
import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

import {
  MEDIA_EXTRACT_TAG,
  VIDEO_GENERATION_QUEUE,
} from "./queue.constants.js";

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

/** BullMQ 适配器：把 Queue 包成 VideoQueueProducer 端口（VIDEO_QUEUE_DRIVER=bullmq 回退路径）。jobName 区分任务类型（step=视频 / extract=媒体提取）。 */
export function createVideoQueueProducer(
  queue: QueuePort,
  jobName = "step",
  now: () => number = Date.now,
): VideoQueueProducer {
  return {
    async enqueue(jobId, options = {}) {
      const delay = Math.max(0, options.delayMs ?? 0);
      const runAt = now() + delay;
      await queue.add(
        jobName,
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

export type RocketMqConfig = {
  /** gRPC proxy 端点（如 115.190.244.91:8081）。 */
  endpoints: string;
  sslEnabled: boolean;
  accessKey?: string;
  accessSecret?: string;
  topic: string;
  tag: string;
};

/** 加载 RocketMQ 连接配置。生产火山实例：AK/SK + sslEnabled=false（5.x 不支持 SSL）；测试环境裸连。 */
export function loadRocketMqConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RocketMqConfig {
  const accessKey = env.ROCKETMQ_ACCESS_KEY;
  const accessSecret = env.ROCKETMQ_SECRET_KEY;
  return {
    endpoints: env.ROCKETMQ_ENDPOINTS ?? "",
    sslEnabled: env.ROCKETMQ_SSL_ENABLED === "true",
    ...(accessKey && accessSecret ? { accessKey, accessSecret } : {}),
    topic: env.ROCKETMQ_TOPIC ?? VIDEO_GENERATION_QUEUE,
    tag: env.ROCKETMQ_TAG ?? "step",
  };
}

/** RocketMQ 适配器：把 Producer 包成 VideoQueueProducer 端口。delay 单位 ms（客户端 delay → 投递时间戳 now+delay）。 */
export function createRocketMqVideoProducer(
  producer: Pick<Producer, "send">,
  config: Pick<RocketMqConfig, "topic" | "tag">,
): VideoQueueProducer {
  return {
    async enqueue(jobId, options = {}) {
      const delay = Math.max(0, options.delayMs ?? 0);
      await producer.send({
        topic: config.topic,
        tag: config.tag,
        body: Buffer.from(JSON.stringify({ jobId })),
        ...(delay > 0 ? { delay } : {}),
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

let rocketMqProducer: Producer | null = null;
let rocketMqStartup: Promise<Producer> | null = null;

/** 懒建 + 懒启动的 RocketMQ Producer 单例；启动失败重置，下次调用重试。 */
async function getStartedRocketMqProducer(
  config: RocketMqConfig,
): Promise<Producer> {
  if (!config.endpoints) {
    throw new Error(
      "VIDEO_QUEUE_DRIVER=rocketmq 但未配置 ROCKETMQ_ENDPOINTS（测试环境 gRPC 端点，如 115.190.244.91:8081）",
    );
  }
  if (!rocketMqStartup) {
    const producer = new Producer({
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
    });
    rocketMqProducer = producer;
    rocketMqStartup = producer
      .startup()
      .then(() => producer)
      .catch((error) => {
        rocketMqProducer = null;
        rocketMqStartup = null;
        throw error;
      });
  }
  return rocketMqStartup;
}

/** 视频 job 入队（producer 侧入口）。driver 默认 rocketmq；VIDEO_QUEUE_DRIVER=bullmq 回退 Redis 队列。 */
export async function enqueueVideoGenerationJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const driver = process.env.VIDEO_QUEUE_DRIVER ?? "rocketmq";
  if (driver === "rocketmq") {
    const config = loadRocketMqConfig();
    const producer = await getStartedRocketMqProducer(config);
    await createRocketMqVideoProducer(producer, {
      topic: config.topic,
      tag: config.tag,
    }).enqueue(jobId, options);
    return;
  }
  await createVideoQueueProducer(getQueue()).enqueue(jobId, options);
}

/** 媒体提取（视频→音频）job 入队（IKARDY）：复用视频 topic/queue，用独立 tag/jobName「extract」区分任务类型。 */
export async function enqueueMediaExtractJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const driver = process.env.VIDEO_QUEUE_DRIVER ?? "rocketmq";
  if (driver === "rocketmq") {
    const config = loadRocketMqConfig();
    const producer = await getStartedRocketMqProducer(config);
    await createRocketMqVideoProducer(producer, {
      topic: config.topic,
      tag: MEDIA_EXTRACT_TAG,
    }).enqueue(jobId, options);
    return;
  }
  await createVideoQueueProducer(getQueue(), MEDIA_EXTRACT_TAG).enqueue(
    jobId,
    options,
  );
}

export async function closeVideoGenerationQueue(): Promise<void> {
  const current = queue;
  queue = null;
  await current?.close();
  const startup = rocketMqStartup;
  rocketMqProducer = null;
  rocketMqStartup = null;
  if (startup) {
    try {
      const producer = await startup;
      await producer.shutdown();
    } catch {
      // 启动失败则无连接可关
    }
  }
}

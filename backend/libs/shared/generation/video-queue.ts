import { Producer } from "rocketmq-client-nodejs";

import {
  AUDIO_GENERATION_TAG,
  IMAGE_ENHANCE_TAG,
  IMAGE_GENERATION_TAG,
  IMAGE_OUTPAINT_TAG,
  MEDIA_EXTRACT_TAG,
  VIDEO_GENERATION_QUEUE,
} from "./queue.constants.js";

/** 唤醒消费者统一走 RocketMQ：RocketMqVideoConsumer（tag=step）+ RocketMqMediaExtractConsumer（tag=media_extract）
 *  + RocketMqImageConsumer（tag=image，IKBGKA，Semaphore(IMAGE_CONCURRENCY)）
 *  + RocketMqAudioConsumer（tag=audio，IKCR78，Semaphore(AUDIO_CONCURRENCY)）
 *  producer 侧 enqueueVideoGenerationJob / enqueueMediaExtractJob / enqueueImageGenerationJob
 *  / enqueueAudioGenerationJob / enqueueImageEnhanceJob（tag=image_enhance，IKGM99）
 *  / enqueueImageOutpaintJob（tag=image_outpaint，IKGOQV）
 *  同走 RocketMQ（IKDZJK：收敛为 rocketmq 唯一驱动）。 */

/** IKBBXH：RocketMQ producer 延时下限（ms）。topic 只收 DELAY 消息，delay≤0 也落到该值，保证消息判为 DELAY。 */
export const VIDEO_MIN_DELAY_MS = 1_000;

export type VideoQueueProducer = {
  enqueue(jobId: string, options?: { delayMs?: number }): Promise<void>;
};

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
        delay: delay > 0 ? delay : VIDEO_MIN_DELAY_MS,
      });
    },
  };
}

let rocketMqProducer: Producer | null = null;
let rocketMqStartup: Promise<Producer> | null = null;

/** 懒建 + 懒启动的 RocketMQ Producer 单例；启动失败重置，下次调用重试。 */
async function getStartedRocketMqProducer(
  config: RocketMqConfig,
): Promise<Producer> {
  if (!config.endpoints) {
    throw new Error(
      "未配置 ROCKETMQ_ENDPOINTS（测试环境 gRPC 端点，如 115.190.244.91:8081）",
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

/** 视频 job 入队（producer 侧入口）。rocketmq 唯一驱动。 */
export async function enqueueVideoGenerationJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqVideoProducer(producer, {
    topic: config.topic,
    tag: config.tag,
  }).enqueue(jobId, options);
}

/** 媒体提取（视频→音频）job 入队（IKARDY）：复用视频 topic/queue，用独立 tag/jobName「extract」区分任务类型。 */
export async function enqueueMediaExtractJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqVideoProducer(producer, {
    topic: config.topic,
    tag: MEDIA_EXTRACT_TAG,
  }).enqueue(jobId, options);
}

/** 图片生成 job 入队（IKBGKA）：复用视频 topic/queue，用独立 tag「image」区分任务类型。 */
export async function enqueueImageGenerationJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqVideoProducer(producer, {
    topic: config.topic,
    tag: IMAGE_GENERATION_TAG,
  }).enqueue(jobId, options);
}

/** 音频生成 job 入队（IKCR78）：复用视频 topic/queue，用独立 tag「audio」区分任务类型。 */
export async function enqueueAudioGenerationJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqVideoProducer(producer, {
    topic: config.topic,
    tag: AUDIO_GENERATION_TAG,
  }).enqueue(jobId, options);
}

/** 高清放大 job 入队（IKGM99，契约 §14.1）：复用视频 topic/queue，用独立 tag「image_enhance」区分任务类型。 */
export async function enqueueImageEnhanceJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqVideoProducer(producer, {
    topic: config.topic,
    tag: IMAGE_ENHANCE_TAG,
  }).enqueue(jobId, options);
}

/** 扩图 job 入队（IKGOQV，契约 image-outpaint.ts）：复用视频 topic/queue，用独立 tag「image_outpaint」区分任务类型。 */
export async function enqueueImageOutpaintJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqVideoProducer(producer, {
    topic: config.topic,
    tag: IMAGE_OUTPAINT_TAG,
  }).enqueue(jobId, options);
}

export async function closeVideoGenerationQueue(): Promise<void> {
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

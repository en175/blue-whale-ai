import { Producer } from "rocketmq-client-nodejs";

import {
  AUDIO_GENERATION_TAG,
  AUDIO_TRIM_TAG,
  GENERATION_TASK_QUEUE,
  IMAGE_CUTOUT_TAG,
  IMAGE_ENHANCE_TAG,
  IMAGE_ERASE_TAG,
  IMAGE_GENERATION_TAG,
  IMAGE_OUTPAINT_TAG,
  MEDIA_EXTRACT_TAG,
  VIDEO_ENHANCE_TAG,
  VIDEO_FRAME_INTERPOLATION_TAG,
  VIDEO_GENERATION_TAG,
  VIDEO_MATTING_TAG,
  VIDEO_SCENE_SPLIT_TAG,
  VIDEO_SUBTITLE_ERASE_TAG,
  VOCAL_SPLIT_TAG,
} from "./queue.constants.js";
import type { GenerationTag } from "./queue.constants.js";

/** 唤醒消费者统一走 RocketMQ：RocketMqVideoConsumer（tag=video）+ RocketMqMediaExtractConsumer（tag=media_extract）
 *  + RocketMqImageConsumer（tag=image，IKBGKA，Semaphore(IMAGE_CONCURRENCY)）
 *  + RocketMqAudioConsumer（tag=audio，IKCR78，Semaphore(AUDIO_CONCURRENCY)）
 *  producer 侧 enqueueVideoGenerationJob / enqueueMediaExtractJob / enqueueImageGenerationJob
 *  / enqueueAudioGenerationJob / enqueueImageEnhanceJob（tag=image_enhance，IKGM99）
 *  / enqueueImageEraseJob（tag=image_erase，IKGOT4）
 *  / enqueueImageCutoutJob（tag=image_cutout，IKGXM1）
 *  / enqueueImageOutpaintJob（tag=image_outpaint，IKGOQV）
 *  / enqueueVideoSubtitleEraseJob（tag=video_subtitle_erase，IKGZ80）
 *  / enqueueVideoEnhanceJob（tag=video_enhance，IKH3VE）
 *  / enqueueVocalSplitJob（tag=vocal_split，IKHA2I）
 *  / enqueueAudioTrimJob（tag=audio_trim，IKHB6N）
 *  / enqueueVideoSceneSplitJob（tag=video_scene_split，IKH8BO）
 *  / enqueueVideoMattingJob（tag=video_matting，IKHK98）
 *  / enqueueVideoFrameInterpolationJob（tag=video_frame_interpolation，IKHLK3）
 *  同走 RocketMQ（IKDZJK：收敛为 rocketmq 唯一驱动）。 */

/** IKBBXH：RocketMQ producer 延时下限（ms）。topic 只收 DELAY 消息，delay≤0 也落到该值，保证消息判为 DELAY。 */
export const GENERATION_MIN_DELAY_MS = 1_000;

export type GenerationQueueProducer = {
  enqueue(jobId: string, options?: { delayMs?: number }): Promise<void>;
};

/** 只含连接参数：topic / tag **不是配置项**，两侧都无 env 覆盖——它们是
 *  `queue.constants.ts` 的编译期常量（与 worker-java `GenerationMqRoute` 同值），
 *  故部署环境里残留的 `ROCKETMQ_TOPIC` / `ROCKETMQ_TAG` 静默忽略（无绑定目标）。 */
export type RocketMqConfig = {
  /** gRPC proxy 端点（如 115.190.244.91:8081）。 */
  endpoints: string;
  sslEnabled: boolean;
  accessKey?: string;
  accessSecret?: string;
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
  };
}

/** RocketMQ 适配器：把 Producer 包成 GenerationQueueProducer 端口。
 *  topic 恒为 {@link GENERATION_TASK_QUEUE}（编译期常量，读自本模块，不接受覆盖）；
 *  tag 由调用方传入本类任务的常量（六类任务各一）。
 *  delay 单位 ms（客户端 delay → 投递时间戳 now+delay）。 */
export function createRocketMqGenerationProducer(
  producer: Pick<Producer, "send">,
  tag: GenerationTag,
): GenerationQueueProducer {
  return {
    async enqueue(jobId, options = {}) {
      const delay = Math.max(0, options.delayMs ?? 0);
      await producer.send({
        topic: GENERATION_TASK_QUEUE,
        tag,
        body: Buffer.from(JSON.stringify({ jobId })),
        delay: delay > 0 ? delay : GENERATION_MIN_DELAY_MS,
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
  await createRocketMqGenerationProducer(
    producer,
    VIDEO_GENERATION_TAG,
  ).enqueue(jobId, options);
}

/** 媒体提取（视频→音频）job 入队（IKARDY）：复用生成任务 topic/queue，用独立 tag/jobName「extract」区分任务类型。 */
export async function enqueueMediaExtractJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    MEDIA_EXTRACT_TAG,
  ).enqueue(jobId, options);
}

/** 音频截取 job 入队（IKHB6N，契约 = @lib/contracts/audio-trim）：复用生成任务 topic/queue，
 *  用独立 tag「audio_trim」区分任务类型。 */
export async function enqueueAudioTrimJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    AUDIO_TRIM_TAG,
  ).enqueue(jobId, options);
}

/** 图片生成 job 入队（IKBGKA）：复用生成任务 topic/queue，用独立 tag「image」区分任务类型。 */
export async function enqueueImageGenerationJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    IMAGE_GENERATION_TAG,
  ).enqueue(jobId, options);
}

/** 音频生成 job 入队（IKCR78）：复用生成任务 topic/queue，用独立 tag「audio」区分任务类型。 */
export async function enqueueAudioGenerationJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    AUDIO_GENERATION_TAG,
  ).enqueue(jobId, options);
}

/** 高清放大 job 入队（IKGM99，契约 §14.1）：复用生成任务 topic/queue，用独立 tag「image_enhance」区分任务类型。 */
export async function enqueueImageEnhanceJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    IMAGE_ENHANCE_TAG,
  ).enqueue(jobId, options);
}

/** 图片擦除 job 入队（IKGOT4，契约 §15）：复用生成任务 topic/queue，用独立 tag「image_erase」区分任务类型。 */
export async function enqueueImageEraseJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    IMAGE_ERASE_TAG,
  ).enqueue(jobId, options);
}

/** 图片抠图 job 入队（IKGXM1，契约 image-cutout 章节）：复用生成任务 topic/queue，用独立 tag「image_cutout」区分任务类型。 */
export async function enqueueImageCutoutJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    IMAGE_CUTOUT_TAG,
  ).enqueue(jobId, options);
}

/** 扩图 job 入队（IKGOQV，契约 image-outpaint.ts）：复用生成任务 topic/queue，用独立 tag「image_outpaint」区分任务类型。 */
export async function enqueueImageOutpaintJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    IMAGE_OUTPAINT_TAG,
  ).enqueue(jobId, options);
}

/** 视频智能去字幕 job 入队（IKGZ80，迁移契约 §17，契约 @lib/contracts/video-subtitle-erase）：
 *  复用生成任务 topic/queue，用独立 tag「video_subtitle_erase」区分任务类型。 */
export async function enqueueVideoSubtitleEraseJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    VIDEO_SUBTITLE_ERASE_TAG,
  ).enqueue(jobId, options);
}

/** 视频 HD 高清 job 入队（IKH3VE，契约 @lib/contracts/video-enhance）：
 *  复用生成任务 topic/queue，用独立 tag「video_enhance」区分任务类型。 */
export async function enqueueVideoEnhanceJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    VIDEO_ENHANCE_TAG,
  ).enqueue(jobId, options);
}

/** 人声背景分离 job 入队（IKHA2I，契约 @lib/contracts/vocal-split）：
 *  复用生成任务 topic/queue，用独立 tag「vocal_split」区分任务类型。 */
export async function enqueueVocalSplitJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    VOCAL_SPLIT_TAG,
  ).enqueue(jobId, options);
}

/** 视频场景切分 job 入队（IKH8BO，契约 @lib/contracts/video-scene-split）：
 *  复用生成任务 topic/queue，用独立 tag「video_scene_split」区分任务类型
 *  （tag 常量 IKH8BH 已建，本函数补齐发布侧先例位）。 */
export async function enqueueVideoSceneSplitJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    VIDEO_SCENE_SPLIT_TAG,
  ).enqueue(jobId, options);
}

/** 智能抠像 job 入队（IKHK98，契约 @lib/contracts/video-matting）：复用生成任务
 *  topic/queue，用独立 tag「video_matting」区分任务类型（tag 常量 IKHK7F 已建，
 *  本函数补齐发布侧先例位；producer 工厂随 IKHKMK 模板收敛统一走 createRocketMqGenerationProducer）。 */
export async function enqueueVideoMattingJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    VIDEO_MATTING_TAG,
  ).enqueue(jobId, options);
}

/** 视频插帧 job 入队（IKHLK3，父需求 IKHLES，契约 @lib/contracts/video-frame-interpolation）：
 *  复用生成任务 topic/queue，用独立 tag「video_frame_interpolation」区分任务类型
 *  （tag 与 type 同值，worker 侧 GenerationMqRoute 同款入口，错配即静默滞留）。 */
export async function enqueueVideoFrameInterpolationJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    VIDEO_FRAME_INTERPOLATION_TAG,
  ).enqueue(jobId, options);
}

export async function closeGenerationQueue(): Promise<void> {
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

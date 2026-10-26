import { Producer } from "rocketmq-client-nodejs";

import {
  closeRocketMqProducer,
  getStartedRocketMqProducer,
  loadRocketMqConfig,
} from "@lib/infra/mq/rocketmq-producer.js";

import {
  AUDIO_GENERATION_TAG,
  AUDIO_MIX_TAG,
  AUDIO_VIDEO_MUX_TAG,
  AUDIO_SPEED_TAG,
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


export const GENERATION_MIN_DELAY_MS = 1_000;

export type GenerationQueueProducer = {
  enqueue(jobId: string, options?: { delayMs?: number }): Promise<void>;
};

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

export async function enqueueAudioMixJob(jobId: string): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(producer, AUDIO_MIX_TAG).enqueue(jobId);
}

export async function enqueueAudioVideoMuxJob(jobId: string): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(producer, AUDIO_VIDEO_MUX_TAG).enqueue(jobId);
}

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

export async function enqueueAudioSpeedJob(
  jobId: string,
  options?: { delayMs?: number },
): Promise<void> {
  const config = loadRocketMqConfig();
  const producer = await getStartedRocketMqProducer(config);
  await createRocketMqGenerationProducer(
    producer,
    AUDIO_SPEED_TAG,
  ).enqueue(jobId, options);
}

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

export const closeGenerationQueue = closeRocketMqProducer;

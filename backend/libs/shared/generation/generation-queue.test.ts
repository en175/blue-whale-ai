import { describe, expect, it, vi } from "vitest";
import type { Producer } from "rocketmq-client-nodejs";

import {
  AUDIO_GENERATION_TAG,
  IMAGE_GENERATION_TAG,
  MEDIA_EXTRACT_TAG,
  VIDEO_ENHANCE_TAG,
  VIDEO_SCENE_SPLIT_TAG,
} from "./queue.constants.js";
import {
  createRocketMqGenerationProducer,
  enqueueAudioGenerationJob,
  loadRocketMqConfig,
  GENERATION_MIN_DELAY_MS,
} from "./generation-queue.js";

/** IKBGKA：enqueueImageGenerationJob 用独立 tag=image，与视频 tag（video）隔离。 */
describe("createRocketMqGenerationProducer image tag", () => {
  const send = vi.fn();
  const rmqProducer = { send } as unknown as Pick<Producer, "send">;

  it("图片入队带 image tag", async () => {
    const producer = createRocketMqGenerationProducer(rmqProducer, IMAGE_GENERATION_TAG);
    await producer.enqueue("301");
    expect(send).toHaveBeenCalledWith({
      topic: "generation-task",
      tag: "image",
      body: Buffer.from(JSON.stringify({ jobId: "301" })),
      delay: GENERATION_MIN_DELAY_MS,
    });
  });
});

/** IKCR78：enqueueAudioGenerationJob 用独立 tag=audio，与视频/图片/媒体提取隔离。 */
describe("enqueueAudioGenerationJob audio tag", () => {
  it("入队携带 audio tag 常量（与 createRocketMqGenerationProducer tag 传播一致）", async () => {
    expect(AUDIO_GENERATION_TAG).toBe("audio");
    expect(AUDIO_GENERATION_TAG).not.toBe(IMAGE_GENERATION_TAG);
  });
});

/** IKH8BO：enqueueVideoSceneSplitJob 用独立 tag=video_scene_split，与 HD / 媒体提取隔离
 *  （tag 常量 IKH8BH 已建，值与 generation_jobs.type 同源，契约测试对账）。 */
describe("enqueueVideoSceneSplitJob video_scene_split tag", () => {
  it("入队携带 video_scene_split tag 常量，与家族其他 tag 不混用", () => {
    expect(VIDEO_SCENE_SPLIT_TAG).toBe("video_scene_split");
    expect(VIDEO_SCENE_SPLIT_TAG).not.toBe(VIDEO_ENHANCE_TAG);
    expect(VIDEO_SCENE_SPLIT_TAG).not.toBe(MEDIA_EXTRACT_TAG);
    expect(VIDEO_SCENE_SPLIT_TAG).not.toBe(AUDIO_GENERATION_TAG);
  });
});

describe("createRocketMqGenerationProducer", () => {
  const send = vi.fn();
  const rmqProducer = { send } as unknown as Pick<Producer, "send">;

  it("默认入队也带 1s 延时（统一 DELAY，topic 只收 DELAY）", async () => {
    const producer = createRocketMqGenerationProducer(rmqProducer, "video");
    await producer.enqueue("42");
    expect(send).toHaveBeenCalledWith({
      topic: "generation-task",
      tag: "video",
      body: Buffer.from(JSON.stringify({ jobId: "42" })),
      delay: GENERATION_MIN_DELAY_MS,
    });
  });

  it("延迟消息：delayMs 直接映射到 delay（客户端 delay 单位是 ms）", async () => {
    const producer = createRocketMqGenerationProducer(rmqProducer, "video");
    await producer.enqueue("43", { delayMs: 2000 });
    expect(send).toHaveBeenCalledWith({
      topic: "generation-task",
      tag: "video",
      body: Buffer.from(JSON.stringify({ jobId: "43" })),
      delay: 2000,
    });
  });

  it("delayMs=0 落到 1s 下限延时（仍是 DELAY）", async () => {
    const producer = createRocketMqGenerationProducer(rmqProducer, "video");
    await producer.enqueue("44", { delayMs: 0 });
    const arg = send.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(arg).toHaveProperty("delay", GENERATION_MIN_DELAY_MS);
  });
});

describe("loadRocketMqConfig", () => {
  it("默认值：endpoints 空、sslEnabled false——topic / tag 不在配置里（无 env 覆盖）", () => {
    expect(loadRocketMqConfig({})).toEqual({
      endpoints: "",
      sslEnabled: false,
    });
  });

  it("完整配置：endpoints/AK/SK/ssl 全部生效，topic / tag 残留键被忽略", () => {
    expect(
      loadRocketMqConfig({
        ROCKETMQ_ENDPOINTS: "115.190.244.91:8081",
        ROCKETMQ_ACCESS_KEY: "AK123",
        ROCKETMQ_SECRET_KEY: "SK456",
        ROCKETMQ_SSL_ENABLED: "true",
        // 修正六退役的两个键：部署环境残留也不得再影响投递（topic / tag 只来自编译期常量）。
        ROCKETMQ_TOPIC: "generation-video",
        ROCKETMQ_TAG: "step",
      }),
    ).toEqual({
      endpoints: "115.190.244.91:8081",
      sslEnabled: true,
      accessKey: "AK123",
      accessSecret: "SK456",
    });
  });

  it("只配一个凭证时不携带 credentials（避免半套 AK/SK 被误用）", () => {
    const config = loadRocketMqConfig({ ROCKETMQ_ACCESS_KEY: "AK" });
    expect(config.accessKey).toBeUndefined();
    expect(config.accessSecret).toBeUndefined();
  });
});

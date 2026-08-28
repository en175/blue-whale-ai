import { describe, expect, it, vi } from "vitest";
import type { Producer } from "rocketmq-client-nodejs";

import { IMAGE_GENERATION_TAG } from "./queue.constants.js";
import {
  createRocketMqVideoProducer,
  loadRocketMqConfig,
  VIDEO_MIN_DELAY_MS,
} from "./video-queue.js";

/** IKBGKA：enqueueImageGenerationJob 用独立 tag=image，与视频 step 隔离。 */
describe("createRocketMqVideoProducer image tag", () => {
  const send = vi.fn();
  const rmqProducer = { send } as unknown as Pick<Producer, "send">;

  it("图片入队带 image tag", async () => {
    const producer = createRocketMqVideoProducer(rmqProducer, {
      topic: "generation-video",
      tag: IMAGE_GENERATION_TAG,
    });
    await producer.enqueue("301");
    expect(send).toHaveBeenCalledWith({
      topic: "generation-video",
      tag: "image",
      body: Buffer.from(JSON.stringify({ jobId: "301" })),
      delay: VIDEO_MIN_DELAY_MS,
    });
  });
});

describe("createRocketMqVideoProducer", () => {
  const send = vi.fn();
  const rmqProducer = { send } as unknown as Pick<Producer, "send">;

  it("默认入队也带 1s 延时（统一 DELAY，topic 只收 DELAY）", async () => {
    const producer = createRocketMqVideoProducer(rmqProducer, {
      topic: "generation-video",
      tag: "step",
    });
    await producer.enqueue("42");
    expect(send).toHaveBeenCalledWith({
      topic: "generation-video",
      tag: "step",
      body: Buffer.from(JSON.stringify({ jobId: "42" })),
      delay: VIDEO_MIN_DELAY_MS,
    });
  });

  it("延迟消息：delayMs 直接映射到 delay（客户端 delay 单位是 ms）", async () => {
    const producer = createRocketMqVideoProducer(rmqProducer, {
      topic: "generation-video",
      tag: "step",
    });
    await producer.enqueue("43", { delayMs: 2000 });
    expect(send).toHaveBeenCalledWith({
      topic: "generation-video",
      tag: "step",
      body: Buffer.from(JSON.stringify({ jobId: "43" })),
      delay: 2000,
    });
  });

  it("delayMs=0 落到 1s 下限延时（仍是 DELAY）", async () => {
    const producer = createRocketMqVideoProducer(rmqProducer, {
      topic: "t",
      tag: "step",
    });
    await producer.enqueue("44", { delayMs: 0 });
    const arg = send.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(arg).toHaveProperty("delay", VIDEO_MIN_DELAY_MS);
  });
});

describe("loadRocketMqConfig", () => {
  it("默认值：endpoints 空、sslEnabled false、topic 沿用常量、tag=step", () => {
    expect(loadRocketMqConfig({})).toEqual({
      endpoints: "",
      sslEnabled: false,
      topic: "generation-video",
      tag: "step",
    });
  });

  it("完整配置：endpoints/AK/SK/ssl/topic 全部生效", () => {
    expect(
      loadRocketMqConfig({
        ROCKETMQ_ENDPOINTS: "115.190.244.91:8081",
        ROCKETMQ_ACCESS_KEY: "AK123",
        ROCKETMQ_SECRET_KEY: "SK456",
        ROCKETMQ_SSL_ENABLED: "true",
        ROCKETMQ_TOPIC: "custom-video",
      }),
    ).toEqual({
      endpoints: "115.190.244.91:8081",
      sslEnabled: true,
      accessKey: "AK123",
      accessSecret: "SK456",
      topic: "custom-video",
      tag: "step",
    });
  });

  it("只配一个凭证时不携带 credentials（避免半套 AK/SK 被误用）", () => {
    const config = loadRocketMqConfig({ ROCKETMQ_ACCESS_KEY: "AK" });
    expect(config.accessKey).toBeUndefined();
    expect(config.accessSecret).toBeUndefined();
  });
});

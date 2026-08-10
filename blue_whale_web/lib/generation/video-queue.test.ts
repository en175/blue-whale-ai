import { describe, expect, it, vi } from "vitest";

import {
  bullMqDepthReadings,
  createVideoQueueProducer,
  loadRedisConnection,
} from "./video-queue.js";

describe("video generation queue producer", () => {
  it("enqueues an immediate BullMQ step keyed by the generation job id", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const producer = createVideoQueueProducer({ add }, () => 100_000);

    await producer.enqueue("300");

    expect(add).toHaveBeenCalledWith(
      "step",
      { jobId: "300" },
      expect.objectContaining({
        jobId: "video-300-100000",
        delay: 0,
        attempts: 3,
      }),
    );
  });

  it("uses a delayed BullMQ job instead of polling the database", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const producer = createVideoQueueProducer({ add }, () => 100_000);

    await producer.enqueue("300", { delayMs: 2_000 });

    expect(add).toHaveBeenCalledWith(
      "step",
      { jobId: "300" },
      expect.objectContaining({
        jobId: "video-300-102000",
        delay: 2_000,
      }),
    );
  });

  it("uses finite producer retries and a blocking worker connection", () => {
    const env = {
      REDIS_HOST: "redis",
      REDIS_PORT: "6380",
      REDIS_DB: "2",
      REDIS_PASSWORD: "secret",
    };

    expect(loadRedisConnection(env)).toMatchObject({
      host: "redis",
      port: 6380,
      db: 2,
      password: "secret",
      maxRetriesPerRequest: 1,
    });
    expect(loadRedisConnection(env, true)).toMatchObject({
      maxRetriesPerRequest: null,
      keepAlive: 30_000,
    });
  });

  it("falls back to REDIS_CONN_STRING when REDIS_HOST is absent (prod env)", () => {
    const env = { REDIS_CONN_STRING: "redis://:pw@redis-host:6380/3" };
    expect(loadRedisConnection(env)).toMatchObject({
      host: "redis-host",
      port: 6380,
      db: 3,
      password: "pw",
    });
  });

  it("prefers explicit REDIS_HOST over REDIS_CONN_STRING", () => {
    const env = {
      REDIS_HOST: "explicit-host",
      REDIS_CONN_STRING: "redis://other-host:6379/0",
    };
    expect(loadRedisConnection(env)).toMatchObject({ host: "explicit-host" });
  });
});

describe("bullMqDepthReadings —— 队列深度读数映射（IK7G9Y）", () => {
  it("只保留积压/在途态，映射为 queue=video_bullmq 读数", () => {
    const readings = bullMqDepthReadings({
      waiting: 3,
      "waiting-children": 1,
      delayed: 2,
      active: 4,
      completed: 5_000,
      failed: 12,
      paused: 0,
    });

    expect(readings).toEqual([
      { queue: "video_bullmq", status: "waiting", depth: 3 },
      { queue: "video_bullmq", status: "waiting-children", depth: 1 },
      { queue: "video_bullmq", status: "delayed", depth: 2 },
      { queue: "video_bullmq", status: "active", depth: 4 },
    ]);
  });

  it("深度为 0 的积压态也出读数（告警恢复需要归零曲线）", () => {
    const readings = bullMqDepthReadings({ waiting: 0, active: 0 });
    expect(readings).toEqual([
      { queue: "video_bullmq", status: "waiting", depth: 0 },
      { queue: "video_bullmq", status: "active", depth: 0 },
    ]);
  });

  it("缺省状态不出读数", () => {
    expect(bullMqDepthReadings({})).toEqual([]);
  });
});

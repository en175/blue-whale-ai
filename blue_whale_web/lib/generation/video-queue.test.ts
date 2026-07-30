import { describe, expect, it, vi } from "vitest";

import {
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

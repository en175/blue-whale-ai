import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_CAPABILITY_CACHE_TTL_SECONDS,
  getModelCapabilityList,
  invalidateModelCapabilityCache,
  setModelCapabilityList,
} from "./model-capability-cache.js";

/** 未配 Redis 的进程（单测 / 本地裸跑）必须完全旁路：不建连、不抛、当未命中。
 *  这条是生成链路的保险——缓存挂了不能让建任务跟着挂。 */
describe("model-capability-cache：未配 Redis 时旁路", () => {
  const savedHost = process.env.REDIS_HOST;
  const savedConn = process.env.REDIS_CONN_STRING;

  beforeEach(() => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_CONN_STRING;
  });

  afterEach(() => {
    if (savedHost !== undefined) process.env.REDIS_HOST = savedHost;
    if (savedConn !== undefined) process.env.REDIS_CONN_STRING = savedConn;
  });

  it("读 → null，调用方回源查库", async () => {
    await expect(getModelCapabilityList("image")).resolves.toBeNull();
  });

  it("写与失效都不抛", async () => {
    await expect(setModelCapabilityList("image", [])).resolves.toBeUndefined();
    await expect(invalidateModelCapabilityCache()).resolves.toBeUndefined();
  });

  it("TTL 为 5 分钟（300 秒）", () => {
    expect(MODEL_CAPABILITY_CACHE_TTL_SECONDS).toBe(300);
  });
});

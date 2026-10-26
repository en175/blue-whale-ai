import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakeRedis, state } = vi.hoisted(() => {
  const state = {
    store: new Map<string, string>(),
    lastSetArgs: [] as unknown[],
    failGet: false,
    failSet: false,
    failScan: false,
  };
  class FakeRedis {
    status = "ready";
    on() {
      return this;
    }
    once() {
      return this;
    }
    off() {
      return this;
    }
    async get(k: string) {
      if (state.failGet) throw new Error("get boom");
      return state.store.get(k) ?? null;
    }
    async set(k: string, v: string, ...rest: unknown[]) {
      if (state.failSet) throw new Error("set boom");
      state.lastSetArgs = [k, v, ...rest];
      state.store.set(k, v);
      return "OK";
    }
    async scan(_cursor: string, _m: string, pattern: string) {
      if (state.failScan) throw new Error("scan boom");
      const re = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
      return ["0", [...state.store.keys()].filter((k) => re.test(k))];
    }
    async del(...keys: string[]) {
      for (const k of keys) state.store.delete(k);
      return keys.length;
    }
    async quit() {
      return "OK";
    }
    disconnect() {}
  }
  return { FakeRedis, state };
});

vi.mock("ioredis", () => ({ Redis: FakeRedis }));

import {
  MODEL_CAPABILITY_CACHE_TTL_SECONDS,
  __resetModelCapabilityCacheForTest,
  getModelCapabilityList,
  invalidateModelCapabilityCache,
  setModelCapabilityList,
} from "./model-capability-cache.js";

const view = (modelId: string) => ({ model_id: modelId }) as never;

beforeEach(() => {
  vi.stubEnv("REDIS_HOST", "127.0.0.1");
  vi.stubEnv("REDIS_CONN_STRING", "");
  vi.stubEnv("NODE_ENV", "production");
  state.store.clear();
  state.lastSetArgs = [];
  state.failGet = state.failSet = state.failScan = false;
});

afterEach(async () => {
  await __resetModelCapabilityCacheForTest();
  vi.unstubAllEnvs();
});

describe("model-capability-cache：命中与回填", () => {
  it("回填后能命中，且带 5 分钟 TTL", async () => {
    await setModelCapabilityList("video", [view("a"), view("b")]);

    expect(state.lastSetArgs[0]).toBe("cap:list:video");
    expect(state.lastSetArgs).toContain("EX");
    expect(state.lastSetArgs).toContain(MODEL_CAPABILITY_CACHE_TTL_SECONDS);

    await expect(getModelCapabilityList("video")).resolves.toEqual([
      view("a"),
      view("b"),
    ]);
  });

  it("未命中 → null（调用方回源查库）", async () => {
    await expect(getModelCapabilityList("audio")).resolves.toBeNull();
  });

  it("缓存里是脏 JSON / 非数组 → 当未命中，不抛", async () => {
    state.store.set("cap:list:image", "{not json");
    await expect(getModelCapabilityList("image")).resolves.toBeNull();
    state.store.set("cap:list:image", '{"matrix":{}}');
    await expect(getModelCapabilityList("image")).resolves.toBeNull();
  });

  it("各能力类型互不串味", async () => {
    await setModelCapabilityList("video", [view("v")]);
    await setModelCapabilityList("image", [view("i")]);
    await expect(getModelCapabilityList("video")).resolves.toEqual([view("v")]);
    await expect(getModelCapabilityList("image")).resolves.toEqual([view("i")]);
  });
});

describe("model-capability-cache：失效", () => {
  it("按前缀整片删，不误伤非本模块的 key", async () => {
    await setModelCapabilityList("video", [view("v")]);
    await setModelCapabilityList("image", [view("i")]);
    state.store.set("session:someone", "keep-me");

    await invalidateModelCapabilityCache();

    await expect(getModelCapabilityList("video")).resolves.toBeNull();
    await expect(getModelCapabilityList("image")).resolves.toBeNull();
    expect(state.store.get("session:someone")).toBe("keep-me");
  });
});

describe("model-capability-cache：故障降级（缓存挂了不能带走生成链路）", () => {
  it("读失败 → 当未命中，不抛", async () => {
    state.failGet = true;
    await expect(getModelCapabilityList("video")).resolves.toBeNull();
  });

  it("写失败 → 不抛（本次不回填）", async () => {
    state.failSet = true;
    await expect(
      setModelCapabilityList("video", [view("v")]),
    ).resolves.toBeUndefined();
  });

  it("失效失败 → 不抛（等 TTL 收敛）", async () => {
    state.failScan = true;
    await expect(invalidateModelCapabilityCache()).resolves.toBeUndefined();
  });
});

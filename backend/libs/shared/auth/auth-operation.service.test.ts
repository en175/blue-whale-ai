import { describe, expect, it, vi } from "vitest";

const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    store = new Map<string, { value: string; ttlMs: number }>();

    constructor(_options?: unknown) {}

    async set(
      key: string,
      value: string,
      mode?: string,
      ttl?: number,
      nx?: string,
    ): Promise<"OK" | null> {
      if (nx === "NX" && this.store.has(key)) return null;
      const ttlMs = mode === "PX" && ttl != null ? ttl : -1;
      this.store.set(key, { value, ttlMs });
      return "OK";
    }

    async get(key: string): Promise<string | null> {
      return this.store.get(key)?.value ?? null;
    }

    async quit(): Promise<"OK"> {
      return "OK";
    }
  }
  return { FakeRedis };
});

vi.mock("ioredis", () => ({ Redis: FakeRedis }));

import { AuthOperationService, maskPhone } from "./auth-operation.service.js";

describe("AuthOperationService", () => {
  it("同一 request_id 重复 begin 返回同一条记录并标记 duplicate", async () => {
    const service = new AuthOperationService();
    const first = await service.begin({ type: "login", requestId: "req-1" });
    const second = await service.begin({ type: "login", requestId: "req-1" });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.operation.id).toBe(first.operation.id);
    await service.onModuleDestroy();
  });

  it("succeed 后记录终态与结果，可按 id 读回", async () => {
    const service = new AuthOperationService();
    const { operation } = await service.begin({ type: "nickname", userId: 42 });
    await service.succeed(operation.id, { nickname: "新昵称" });

    const stored = await service.get(operation.id);
    expect(stored).toMatchObject({
      id: operation.id,
      type: "nickname",
      userId: 42,
      status: "succeeded",
      result: { nickname: "新昵称" },
    });
    await service.onModuleDestroy();
  });

  it("查询令牌只对签发时的那条操作有效", async () => {
    const service = new AuthOperationService();
    const token = await service.issueQueryToken("op_1", 42);

    await expect(service.verifyQueryToken(token, "op_1")).resolves.toBe(true);
    await expect(service.verifyQueryToken(token, "op_2")).resolves.toBe(false);
    await expect(service.verifyQueryToken("unknown", "op_1")).resolves.toBe(false);
    await service.onModuleDestroy();
  });

  it("手机号脱敏保留前 3 后 4", () => {
    expect(maskPhone("13800001234")).toBe("138****1234");
    expect(maskPhone(null)).toBe("");
  });
});

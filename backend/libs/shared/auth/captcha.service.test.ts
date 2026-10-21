import { describe, expect, it, vi } from "vitest";

const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    store = new Map<string, string>();

    constructor(_options?: unknown) {}

    async set(key: string, value: string): Promise<"OK"> {
      this.store.set(key, value);
      return "OK";
    }

    async get(key: string): Promise<string | null> {
      return this.store.get(key) ?? null;
    }

    async del(key: string): Promise<number> {
      return this.store.delete(key) ? 1 : 0;
    }

    async quit(): Promise<"OK"> {
      return "OK";
    }
  }
  return { FakeRedis };
});

vi.mock("ioredis", () => ({ Redis: FakeRedis }));

import { CaptchaService } from "./captcha.service.js";

async function issued(service: CaptchaService, phone = "13800001234", purpose = "login") {
  const challenge = await service.issue(phone, purpose);
  const stored = JSON.parse(
    (service as unknown as { redis: InstanceType<typeof FakeRedis> }).redis.store.get(
      `captcha:${challenge.id}`,
    )!,
  ) as { x: number };
  return { challenge, expectedX: stored.x };
}

describe("CaptchaService", () => {
  it("签发返回背景/拼图/纵坐标，挑战只存缺口横坐标", async () => {
    const service = new CaptchaService();
    const challenge = await service.issue("13800001234", "login");

    expect(challenge.background.startsWith("data:image/png;base64,")).toBe(true);
    expect(challenge.piece.startsWith("data:image/png;base64,")).toBe(true);
    expect(challenge.piece_y).toBeGreaterThanOrEqual(0);
    expect(challenge.expires_in).toBe(60);
    expect(challenge).not.toHaveProperty("x");
    await service.onModuleDestroy();
  });

  it("对准通过，且挑战一次使用", async () => {
    const service = new CaptchaService();
    const { challenge, expectedX } = await issued(service);

    await expect(
      service.verify({
        id: challenge.id,
        x: expectedX,
        phone: "13800001234",
        purpose: "login",
      }),
    ).resolves.toBe("ok");
    await expect(
      service.verify({
        id: challenge.id,
        x: expectedX,
        phone: "13800001234",
        purpose: "login",
      }),
    ).resolves.toBe("expired");
    await service.onModuleDestroy();
  });

  it("拖偏判失败", async () => {
    const service = new CaptchaService();
    const { challenge, expectedX } = await issued(service);
    await expect(
      service.verify({
        id: challenge.id,
        x: expectedX + 30,
        phone: "13800001234",
        purpose: "login",
      }),
    ).resolves.toBe("invalid");
    await service.onModuleDestroy();
  });

  it("号码或用途对不上判失败（挑战绑定号码+用途）", async () => {
    const service = new CaptchaService();
    const first = await issued(service);
    await expect(
      service.verify({
        id: first.challenge.id,
        x: first.expectedX,
        phone: "13900000000",
        purpose: "login",
      }),
    ).resolves.toBe("invalid");

    const second = await issued(service);
    await expect(
      service.verify({
        id: second.challenge.id,
        x: second.expectedX,
        phone: "13800001234",
        purpose: "bind",
      }),
    ).resolves.toBe("invalid");
    await service.onModuleDestroy();
  });

  it("未知挑战判过期", async () => {
    const service = new CaptchaService();
    await expect(
      service.verify({
        id: "cap_unknown",
        x: 100,
        phone: "13800001234",
        purpose: "login",
      }),
    ).resolves.toBe("expired");
    await service.onModuleDestroy();
  });
});

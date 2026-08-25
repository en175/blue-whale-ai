import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionService } from "./session.service.js";

const SECRET = "test-session-secret-1234567890";
const TTL_SECONDS = 7 * 24 * 60 * 60;

/** 内存版 ioredis（按 key 存字符串，记录 expire 调用）。vi.hoisted 保证 mock 提升时可见。 */
const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    store = new Map<string, string>();
    expiredKeys: string[] = [];

    constructor(_options?: unknown) {}

    async set(
      key: string,
      value: string,
      _mode?: string,
      _ttl?: number,
    ): Promise<"OK"> {
      this.store.set(key, value);
      return "OK";
    }

    async get(key: string): Promise<string | null> {
      return this.store.get(key) ?? null;
    }

    async del(key: string): Promise<number> {
      return this.store.delete(key) ? 1 : 0;
    }

    async expire(key: string, _ttl: number): Promise<number> {
      this.expiredKeys.push(key);
      return 1;
    }

    async quit(): Promise<"OK"> {
      return "OK";
    }
  }
  return { FakeRedis };
});

vi.mock("ioredis", () => ({ Redis: FakeRedis }));

const BASE = {
  userId: 8,
  username: "alice",
  role: 1,
  status: 1,
  email: "alice@example.com",
  sk: "sk-upstream-secret",
};

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

describe("SessionService（登录态凭证分层，Redis 存储，ADR-0062 #19）", () => {
  let service: SessionService;
  let redis: FakeRedis;

  beforeEach(() => {
    process.env.GENERATION_CREDENTIAL_SECRET = SECRET;
    service = new SessionService();
    redis = (service as unknown as { redis: FakeRedis }).redis;
    redis.store.clear();
    redis.expiredKeys = [];
  });

  afterEach(() => {
    delete process.env.GENERATION_CREDENTIAL_SECRET;
  });

  it("createSession 签发 sess_ 令牌、密封 sk- 写入（明文 sk 不出 Redis）", async () => {
    const token = await service.createSession(BASE);
    expect(token).toMatch(/^sess_[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("sk-upstream-secret");
    const raw = [...redis.store.values()][0];
    expect(raw).toContain("sealedSk");
    expect(raw).not.toContain("sk-upstream-secret");
    expect(redis.store.size).toBe(1);
  });

  it("resolveSession 解出身份与真实 sk-（round-trip）", async () => {
    const token = await service.createSession(BASE);
    const session = await service.resolveSession(token);
    expect(session).toMatchObject({
      userId: 8,
      username: "alice",
      role: 1,
      status: 1,
      email: "alice@example.com",
      sk: "sk-upstream-secret",
    });
    expect(session?.needsRecheck).toBe(false);
  });

  it("resolveSession 对未知令牌返回 null", async () => {
    expect(await service.resolveSession("sess_unknown")).toBeNull();
  });

  it("resolveSession 每次访问滑动续期（调用 EXPIRE）", async () => {
    const token = await service.createSession(BASE);
    await service.resolveSession(token);
    expect(redis.expiredKeys).toContain(`session:${hash(token)}`);
  });

  it("verifiedAt 超时后 needsRecheck=true", async () => {
    const token = await service.createSession(BASE);
    const key = `session:${hash(token)}`;
    const data = JSON.parse(redis.store.get(key)!);
    data.verifiedAt = Date.now() - 6 * 60 * 1000; // 超过 5 分钟
    redis.store.set(key, JSON.stringify(data));
    expect((await service.resolveSession(token))?.needsRecheck).toBe(true);
  });

  it("updateSessionIdentity 回写 role/status 并重置 verifiedAt", async () => {
    const token = await service.createSession(BASE);
    const key = `session:${hash(token)}`;
    const data = JSON.parse(redis.store.get(key)!);
    data.verifiedAt = Date.now() - 6 * 60 * 1000;
    redis.store.set(key, JSON.stringify(data));

    await service.updateSessionIdentity(token, { role: 10, status: 0 });
    const after = await service.resolveSession(token);
    expect(after?.role).toBe(10);
    expect(after?.status).toBe(0);
    expect(after?.needsRecheck).toBe(false);
  });

  it("密封 sk- 损坏 → 返回 null 并删会话（不 503）", async () => {
    const token = await service.createSession(BASE);
    const key = `session:${hash(token)}`;
    const data = JSON.parse(redis.store.get(key)!);
    data.sealedSk = "v1.invalid.invalid.invalid";
    redis.store.set(key, JSON.stringify(data));
    expect(await service.resolveSession(token)).toBeNull();
    expect(redis.store.has(key)).toBe(false);
  });

  it("revoke 删除会话（登出吊销，上游 sk- 不动）", async () => {
    const token = await service.createSession(BASE);
    await service.revoke(token);
    expect(await service.resolveSession(token)).toBeNull();
    expect(redis.store.has(`session:${hash(token)}`)).toBe(false);
  });
});

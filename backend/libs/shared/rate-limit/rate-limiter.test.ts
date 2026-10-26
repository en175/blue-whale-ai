import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    store = new Map<string, string>();
    zsets = new Map<string, Map<string, number>>();
    ttlMs = new Map<string, number>();
    failNext = false;

    constructor(_options?: unknown) {}

    private fail(): void {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("redis unavailable");
      }
    }

    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      nowRaw: string,
      windowRaw: string,
      limitRaw: string,
      member: string,
    ): Promise<[number, number]> {
      this.fail();
      const now = Number(nowRaw);
      const window = Number(windowRaw);
      const limit = Number(limitRaw);
      const zset = this.zsets.get(key) ?? new Map<string, number>();
      for (const [item, score] of zset) {
        if (score <= now - window) zset.delete(item);
      }
      if (zset.size >= limit) {
        const oldest = Math.min(...zset.values());
        return [0, window - (now - oldest)];
      }
      zset.set(member, now);
      this.zsets.set(key, zset);
      this.ttlMs.set(key, window);
      return [1, 0];
    }

    async pttl(key: string): Promise<number> {
      this.fail();
      if (!this.zsets.has(key) && !this.store.has(key)) return -2;
      return this.ttlMs.get(key) ?? -1;
    }

    async del(...keys: string[]): Promise<number> {
      this.fail();
      let n = 0;
      for (const key of keys) {
        const removed = this.store.delete(key) || this.zsets.delete(key);
        if (removed) n += 1;
        this.ttlMs.delete(key);
      }
      return n;
    }

    async set(key: string, value: string, _ex: "EX", ttlSec: number): Promise<"OK"> {
      this.fail();
      this.store.set(key, value);
      this.ttlMs.set(key, ttlSec * 1000);
      return "OK";
    }

    async exists(key: string): Promise<number> {
      this.fail();
      return this.store.has(key) || this.zsets.has(key) ? 1 : 0;
    }

    async quit(): Promise<"OK"> {
      return "OK";
    }
  }
  return { FakeRedis };
});

vi.mock("ioredis", () => ({
  Redis: FakeRedis,
}));

import { LOGIN_LOCK_SCOPE, LoginFailureTracker } from "./login-failure-tracker.js";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  afterEach(async () => {
    await limiter.onModuleDestroy();
  });

  it("allows takes until the limit then returns retryAfter", async () => {
    const bucket = { scope: "login", key: "1.1.1.1", limit: 2, windowMs: 1000 };
    await expect(limiter.take(bucket)).resolves.toEqual({ allowed: true });
    await expect(limiter.take(bucket)).resolves.toEqual({ allowed: true });
    await expect(limiter.take(bucket)).resolves.toEqual({
      allowed: false,
      retryAfter: 1,
    });
  });

  it("reset clears the current window so the next take is allowed", async () => {
    const bucket = { scope: "login", key: "acct", limit: 1, windowMs: 1000 };
    await limiter.take(bucket);
    await expect(limiter.take(bucket)).resolves.toMatchObject({ allowed: false });
    await limiter.reset("login", "acct", 1000);
    await expect(limiter.take(bucket)).resolves.toEqual({ allowed: true });
  });

  it("reset does not clear a different identity even if it looks like a glob", async () => {
    const foo = { scope: "login", key: "foo", limit: 1, windowMs: 1000 };
    const glob = { scope: "login", key: "foo*", limit: 1, windowMs: 1000 };
    await limiter.take(foo);
    await limiter.take(glob);
    await limiter.reset("login", "foo", 1000);
    await expect(limiter.take(foo)).resolves.toEqual({ allowed: true });
    await expect(limiter.take(glob)).resolves.toMatchObject({ allowed: false });
  });

  it("block makes isBlocked true until reset", async () => {
    await expect(limiter.isBlocked("login", "acct")).resolves.toBe(false);
    await limiter.block("login", "acct", 15_000);
    await expect(limiter.isBlocked("login", "acct")).resolves.toBe(true);
    await expect(
      limiter.take({ scope: "login", key: "acct", limit: 10, windowMs: 1000 }),
    ).resolves.toEqual({ allowed: false, retryAfter: 15 });
    await limiter.reset("login", "acct");
    await expect(limiter.isBlocked("login", "acct")).resolves.toBe(false);
  });

  it("LoginFailureTracker locks on the Nth failure", async () => {
    const tracker = new LoginFailureTracker(limiter);
    tracker.configure({ threshold: 3, windowMs: 1000, blockMs: 5000 });
    await expect(tracker.recordFailure("alice")).resolves.toEqual({ locked: false });
    await expect(tracker.recordFailure("alice")).resolves.toEqual({ locked: false });
    await expect(tracker.recordFailure("alice")).resolves.toEqual({ locked: true });
    await expect(limiter.isBlocked(LOGIN_LOCK_SCOPE, "alice")).resolves.toBe(true);
  });

  it("fails open when Redis is unavailable", async () => {
    const redis = limiter as unknown as { redis: { failNext: boolean } };
    redis.redis.failNext = true;
    await expect(
      limiter.take({ scope: "login", key: "x", limit: 1, windowMs: 1000 }),
    ).resolves.toEqual({ allowed: true });
    redis.redis.failNext = true;
    await expect(limiter.isBlocked("login", "x")).resolves.toBe(false);
  });
});

describe("RateLimiter 滚动窗口", () => {
  it("窗口滑过之后额度恢复（不是固定窗口边界重置）", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
      const limiter = new RateLimiter();
      const bucket = { scope: "sms", key: "13800001234", limit: 1, windowMs: 60_000 };
      await expect(limiter.take(bucket)).resolves.toEqual({ allowed: true });
      await expect(limiter.take(bucket)).resolves.toMatchObject({ allowed: false });

      vi.setSystemTime(new Date("2026-10-21T12:00:30.000Z"));
      await expect(limiter.take(bucket)).resolves.toMatchObject({ allowed: false });

      vi.setSystemTime(new Date("2026-10-21T12:01:01.000Z"));
      await expect(limiter.take(bucket)).resolves.toEqual({ allowed: true });
      await limiter.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

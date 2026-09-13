import { describe, expect, it, vi } from "vitest";

const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    store = new Map<string, string>();
    ttlMs = new Map<string, number>();

    constructor(_options?: unknown) {}

    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      ttlSec: string,
    ): Promise<number> {
      const n = Number(this.store.get(key) ?? 0) + 1;
      this.store.set(key, String(n));
      if (n === 1) this.ttlMs.set(key, Number(ttlSec) * 1000);
      return n;
    }

    async pttl(key: string): Promise<number> {
      if (!this.store.has(key)) return -2;
      return this.ttlMs.get(key) ?? -1;
    }

    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const key of keys) {
        if (this.store.delete(key)) n += 1;
        this.ttlMs.delete(key);
      }
      return n;
    }

    async set(key: string, value: string, _ex: "EX", ttlSec: number): Promise<"OK"> {
      this.store.set(key, value);
      this.ttlMs.set(key, ttlSec * 1000);
      return "OK";
    }

    async exists(key: string): Promise<number> {
      return this.store.has(key) ? 1 : 0;
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

import { Reflector } from "@nestjs/core";
import { NewApiError, type NewApiLoginResult } from "@lib/core";
import { ACCOUNT_LOCKED } from "@lib/contracts";
import type { Response } from "express";
import type { AccountService } from "@lib/shared/account/account.service.js";
import type { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { SessionService } from "@lib/shared/session/session.service.js";
import {
  RATE_LIMIT_KEY,
  type RateLimitBucket,
} from "@lib/shared/rate-limit/decorators/rate-limit.decorator.js";
import { LoginFailureTracker } from "@lib/shared/rate-limit/login-failure-tracker.js";
import { RateLimiter } from "@lib/shared/rate-limit/rate-limiter.js";
import { AuthController } from "./auth.controller.js";

/** 上游 new-api 账密错误的真实形状：HTTP 200 + success:false → NewApiError(status=200)。 */
function credentialFailure(): NewApiError {
  return new NewApiError("用户名或密码错误", 200, "account_error");
}

function loginResult(): NewApiLoginResult {
  return {
    token: "sk-test",
    userId: 42,
    username: "alice",
    email: null,
    role: 1,
    status: 1,
  };
}

function setup() {
  const limiter = new RateLimiter();
  const tracker = new LoginFailureTracker(limiter);
  const account = { login: vi.fn(), register: vi.fn() };
  const sessions = { createSession: vi.fn(async () => "session-token") };
  const prisma = { client: {} };
  const controller = new AuthController(
    account as unknown as AccountService,
    prisma as unknown as PrismaService,
    sessions as unknown as SessionService,
    limiter,
    tracker,
  );
  const res = { cookie: vi.fn() } as unknown as Response;
  return { controller, account, sessions, res, limiter, tracker };
}

const LOGIN_BODY = { username: "alice", password: "wrong-pass" };

describe("AuthController 登录失败锁定（IKDR4J）", () => {
  it("连续 5 次密码失败后锁定：第 6 次 429 account_locked 且跳过 new-api 调用", async () => {
    const { controller, account, res } = setup();
    account.login.mockRejectedValue(credentialFailure());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        name: "NewApiError",
        status: 401,
      });
    }
    expect(account.login).toHaveBeenCalledTimes(5);

    await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
      name: "NewApiError",
      status: 429,
      code: ACCOUNT_LOCKED,
    });
    // 锁定期内不再打 new-api
    expect(account.login).toHaveBeenCalledTimes(5);
  });

  it("登录成功清零失败计数：成功前后各自的失败不累计到锁定", async () => {
    const { controller, account, res } = setup();
    account.login
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure())
      .mockResolvedValueOnce(loginResult())
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure());

    for (const attempt of [1, 2, 3]) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        status: 401,
      });
    }

    const success = await controller.login(
      { username: "alice", password: "right-pass" },
      res,
    );
    expect(success).toMatchObject({ data: { username: "alice", is_new_user: false } });
    expect(res.cookie).toHaveBeenCalledTimes(1);

    // 成功后再连败 4 次（未达阈值 5）：全部 401，不得出现 429
    for (const attempt of [1, 2, 3, 4]) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        status: 401,
      });
    }
    expect(account.login).toHaveBeenCalledTimes(8);
  });

  it("上游 5xx 等非账密错误不计入锁定：连败 6 次仍逐次透传且不锁账号", async () => {
    const { controller, account, res } = setup();
    account.login.mockRejectedValue(
      new NewApiError("账户服务暂不可用", 503, "account_service_unavailable"),
    );

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        name: "NewApiError",
        status: 503,
      });
    }
    // 每次都要真实打到上游（未被锁定跳过）
    expect(account.login).toHaveBeenCalledTimes(6);
  });
});

describe("AuthController 限流声明（IKDR4J）", () => {
  const reflector = new Reflector();

  function bucketsOf(handler: (...args: never[]) => unknown): RateLimitBucket[] {
    const options = reflector.get<{ buckets?: RateLimitBucket[] } | undefined>(
      RATE_LIMIT_KEY,
      handler,
    );
    return options?.buckets ?? [];
  }

  it("login 声明 IP 20 次/分 + 账号 5 次/分限流桶", () => {
    const buckets = bucketsOf(
      AuthController.prototype.login as (...args: never[]) => unknown,
    );
    expect(buckets.find((b) => b.key === "ip")).toMatchObject({
      limit: 20,
      windowMs: 60_000,
    });
    expect(buckets.find((b) => b.key === "account")).toMatchObject({
      limit: 5,
      windowMs: 60_000,
    });
  });

  it("register 声明 IP 20 次/分 + 账号 5 次/分限流桶", () => {
    const buckets = bucketsOf(
      AuthController.prototype.register as (...args: never[]) => unknown,
    );
    expect(buckets.find((b) => b.key === "ip")).toMatchObject({
      limit: 20,
      windowMs: 60_000,
    });
    expect(buckets.find((b) => b.key === "account")).toMatchObject({
      limit: 5,
      windowMs: 60_000,
    });
  });
});

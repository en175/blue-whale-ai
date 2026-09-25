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
import { NewApiError } from "@lib/core";
import { afterEach, beforeEach } from "vitest";
import { ACCOUNT_LOCKED } from "@lib/contracts";
import type { Response } from "express";
import type { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { SessionService } from "@lib/shared/session/session.service.js";
import {
  InvalidCredentialsError,
  type IdentityService,
  type LocalLoginResult,
} from "@lib/shared/identity/identity.service.js";
import { UPSTREAM_KEY_ENV } from "@lib/shared/account/upstream-credential.js";
import {
  RATE_LIMIT_KEY,
  type RateLimitBucket,
} from "@lib/shared/rate-limit/decorators/rate-limit.decorator.js";
import { LoginFailureTracker } from "@lib/shared/rate-limit/login-failure-tracker.js";
import { RateLimiter } from "@lib/shared/rate-limit/rate-limiter.js";
import { AuthController } from "./auth.controller.js";

/** 口令校验失败。登录已经切到我们自己的库，所以不再是「上游 200 + success:false」那种形状。 */
function credentialFailure(): InvalidCredentialsError {
  return new InvalidCredentialsError();
}

function loginResult(): LocalLoginResult {
  return {
    userId: 42,
    username: "alice",
    email: null,
    role: 1,
    status: 1,
  };
}

/** 项目级统一的上游 key —— 登录成功后它进会话，不再是每个用户自己的 sk-。 */
const UPSTREAM_KEY = "sk-unified-upstream";

beforeEach(() => {
  process.env[UPSTREAM_KEY_ENV] = UPSTREAM_KEY;
});

afterEach(() => {
  delete process.env[UPSTREAM_KEY_ENV];
});

function setup() {
  const limiter = new RateLimiter();
  const tracker = new LoginFailureTracker(limiter);
  const sessions = { createSession: vi.fn(async () => "session-token") };
  // IKF YHJ：登录成功后写 user_info（执行凭证）；缺 mock 时旁路抛错被吞，不影响登录。
  const prisma = { client: { user_info: { upsert: vi.fn(async () => ({})) } } };
  // 登录日志同样走旁路（写失败不阻断登录），所以它必须是**可注入的 mock**——
  // 否则「日志到底写没写」这件事在测试里永远看不出来。
  const identity = {
    recordLogin: vi.fn(async () => undefined),
    // ★ 口令校验现在在这里，不在 account 上
    login: vi.fn(),
    register: vi.fn(),
  };
  const controller = new AuthController(
    prisma as unknown as PrismaService,
    sessions as unknown as SessionService,
    limiter,
    tracker,
    identity as unknown as IdentityService,
  );
  const res = { cookie: vi.fn() } as unknown as Response;
  return { controller, identity, sessions, res, limiter, tracker, prisma };
}

const LOGIN_BODY = { username: "alice", password: "wrong-pass" };

describe("AuthController 登录失败锁定（IKDR4J）", () => {
  it("连续 5 次密码失败后锁定：第 6 次 429 account_locked 且跳过 new-api 调用", async () => {
    const { controller, identity, res } = setup();
    identity.login.mockRejectedValue(credentialFailure());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        name: "NewApiError",
        status: 401,
      });
    }
    expect(identity.login).toHaveBeenCalledTimes(5);

    await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
      name: "NewApiError",
      status: 429,
      code: ACCOUNT_LOCKED,
    });
    // 锁定期内不再打 new-api
    expect(identity.login).toHaveBeenCalledTimes(5);
  });

  it("登录成功清零失败计数：成功前后各自的失败不累计到锁定", async () => {
    const { controller, identity, res } = setup();
    identity.login
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure())
      .mockResolvedValueOnce(loginResult())
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure())
      .mockRejectedValueOnce(credentialFailure());

    for (const _ of [1, 2, 3]) {
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
    for (const _ of [1, 2, 3, 4]) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        status: 401,
      });
    }
    expect(identity.login).toHaveBeenCalledTimes(8);
  });

  it("非账密错误（DB 挂了等）不计入锁定：连败 6 次仍逐次透传且不锁账号", async () => {
    const { controller, identity, res } = setup();
    identity.login.mockRejectedValue(
      new NewApiError("账户服务暂不可用", 503, "account_service_unavailable"),
    );

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        name: "NewApiError",
        status: 503,
      });
    }
    // 每次都要真实打到上游（未被锁定跳过）
    expect(identity.login).toHaveBeenCalledTimes(6);
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

describe("AuthController IKF YHJ 执行凭证落库", () => {
  it("登录成功：把**项目统一 key**按 userId 写入 user_info", async () => {
    const { controller, identity, prisma, res } = setup();
    identity.login.mockResolvedValue(loginResult());

    await controller.login(LOGIN_BODY, res);

    expect(prisma.client.user_info.upsert).toHaveBeenCalledWith({
      where: { user_id: BigInt(42) },
      update: expect.objectContaining({ provider_credential: UPSTREAM_KEY }),
      create: { user_id: BigInt(42), provider_credential: UPSTREAM_KEY },
    });
  });

  it("落库失败：只告警，不阻断登录（会话 cookie 照发）", async () => {
    const { controller, identity, prisma, res } = setup();
    identity.login.mockResolvedValue(loginResult());
    prisma.client.user_info.upsert.mockRejectedValue(new Error("db down"));

    await controller.login(LOGIN_BODY, res);

    expect(res.cookie).toHaveBeenCalled();
  });
});

describe("AuthController 登录日志", () => {
  it("登录成功记一条 success=true，并带上 userId", async () => {
    const { controller, identity, res } = setup();
    identity.login.mockResolvedValue(loginResult());

    await controller.login(LOGIN_BODY, res, "203.0.113.9", "vitest-agent");

    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "42",
        username: "alice",
        ip: "203.0.113.9",
        userAgent: "vitest-agent",
        success: true,
      }),
    );
  });

  it("账密错误记一条 success=false 并带原因", async () => {
    const { controller, identity, res } = setup();
    // ⚠️ status 必须是 200：上游「HTTP 200 + success:false」才算业务失败
    // （projectAccountBusinessFailure 判的就是这个），401 会被归到「服务异常」分支，
    // 那条路径不记失败日志——上游挂了不是撞库信号。
    identity.login.mockRejectedValue(
      new NewApiError("用户名或密码错误", 200, "invalid_credentials"),
    );

    await controller.login(LOGIN_BODY, res, "203.0.113.9").catch(() => undefined);

    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, reason: "账密错误" }),
    );
  });

  it("非账密错误不记为账密错误——服务问题不是撞库信号", async () => {
    const { controller, identity, res } = setup();
    identity.login.mockRejectedValue(
      new NewApiError("账户服务暂不可用", 503, "account_service_unavailable"),
    );

    await controller.login(LOGIN_BODY, res, "203.0.113.9").catch(() => undefined);

    expect(identity.recordLogin).not.toHaveBeenCalled();
  });

  it("空凭据也留痕——撞库脚本同样会发空请求", async () => {
    const { controller, identity, res } = setup();

    await controller.login({ username: "", password: "" }, res, "203.0.113.9");

    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, reason: "凭据为空" }),
    );
  });

  it("x-forwarded-for 有多跳时只取第一跳", async () => {
    const { controller, identity, res } = setup();
    identity.login.mockResolvedValue(loginResult());

    await controller.login(LOGIN_BODY, res, "203.0.113.9, 10.0.0.1, 10.0.0.2");

    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "203.0.113.9" }),
    );
  });

  it("日志写失败不阻断登录", async () => {
    // 日志是旁路：一个坏掉的日志表不该让所有人都登不上。
    const { controller, identity, res } = setup();
    identity.login.mockResolvedValue(loginResult());
    identity.recordLogin.mockRejectedValue(new Error("db down"));

    await expect(controller.login(LOGIN_BODY, res)).resolves.toMatchObject({ data: expect.anything() });
    expect(res.cookie).toHaveBeenCalled();
  });
});

describe("AuthController capabilities（本地常量）", () => {
  it("口令登录/注册恒支持、邮箱验证恒不支持——不再探测上游开关", async () => {
    // 这两种能力现在都由我们自己的库承载，上游挂了也不该让登录入口从页面消失。
    const { controller } = setup();
    await expect(controller.capabilities()).resolves.toEqual({
      code: 200,
      msg: null,
      data: {
        password_login: true,
        password_register: true,
        email_verification: false,
      },
    });
  });
});

describe("AuthController 上游凭证缺失", () => {
  it("★ 缺 NEW_API_UPSTREAM_KEY 时报出**变量名**，而不是被兜底文案吃掉", async () => {
    // toAuthError 会把所有 503 压成「账户服务暂不可用」。那句文案对「凭证没配」
    // 毫无帮助——运维看到它只会去查上游健康，而真正原因是少了一个环境变量。
    const saved = process.env[UPSTREAM_KEY_ENV];
    delete process.env[UPSTREAM_KEY_ENV];

    try {
      const { controller, identity, res } = setup();
      identity.login.mockResolvedValue(loginResult());

      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        status: 503,
        code: "upstream_credential_missing",
      });
      // 变量名必须在文案里，否则这条错误和「上游挂了」在运维眼里没有区别
      await expect(controller.login(LOGIN_BODY, res)).rejects.toThrow(UPSTREAM_KEY_ENV);
    } finally {
      if (saved !== undefined) process.env[UPSTREAM_KEY_ENV] = saved;
    }
  });
});

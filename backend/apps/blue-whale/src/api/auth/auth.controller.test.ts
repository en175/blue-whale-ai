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
import { InvalidVerificationCodeError, NewApiError } from "@lib/core";
import { afterEach, beforeEach } from "vitest";
import { ACCOUNT_LOCKED, FAILURE_CODE } from "@lib/contracts";
import type { Response } from "express";
import type { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { SessionService } from "@lib/shared/session/session.service.js";
import {
  InvalidCredentialsError,
  type IdentityService,
  type LocalLoginResult,
} from "@lib/shared/identity/index.js";
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
    phone: null,
    hasPassword: true,
    role: 1,
    status: 1,
  };
}

function setup() {
  const limiter = new RateLimiter();
  const tracker = new LoginFailureTracker(limiter);
  const sessions = { createSession: vi.fn(async () => "session-token") };
  const prisma = { client: {} };
  // 登录日志同样走旁路（写失败不阻断登录），所以它必须是**可注入的 mock**——
  // 否则「日志到底写没写」这件事在测试里永远看不出来。
  const identity = {
    recordLogin: vi.fn(async () => undefined),
    // ★ 口令校验现在在这里，不在 account 上
    login: vi.fn(),
    register: vi.fn(),
    loginWithPhoneCode: vi.fn(),
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

  it("★ login-by-code 的账号桶用 phone 维度，不是 account", () => {
    // `account` 维度写死读 `body.username`，而这条路由的入参是 `body.phone`。
    // 配成 account 不会报错，只会**静默跳过**——看着有撞码防护，实际为零。
    const buckets = bucketsOf(
      AuthController.prototype.loginByCode as (...args: never[]) => unknown,
    );
    expect(buckets.find((b) => b.key === "phone")).toMatchObject({
      limit: 5,
      windowMs: 60_000,
    });
    expect(buckets.some((b) => b.key === "account")).toBe(false);
  });

  it("send-code 声明短信四个桶：号/分、号/天、IP/分、IP/天", () => {
    // 短信按条计费，四个桶缺一不可——只按 IP 挡不住换 IP 刷同一个号，
    // 只按号码挡不住换号刷爆账单。日上限就是真正兜住账单的那两条。
    const buckets = bucketsOf(
      AuthController.prototype.sendCode as (...args: never[]) => unknown,
    );
    expect(buckets.filter((b) => b.key === "phone")).toHaveLength(2);
    expect(buckets.filter((b) => b.key === "ip")).toHaveLength(2);
    expect(Math.max(...buckets.map((b) => b.windowMs))).toBe(86_400_000);
  });
});

describe("AuthController 手机号验证码登录（IKJA4Q）", () => {
  const CODE_BODY = { phone: "13800001234", code: "123456" };

  function phoneResult(over: Partial<LocalLoginResult> = {}): LocalLoginResult {
    return { ...loginResult(), phone: "13800001234", hasPassword: false, ...over };
  }

  it("没绑过的手机号：建号登录，is_new_user=true，phone/has_password 是真值", async () => {
    const { controller, identity, sessions, res } = setup();
    identity.loginWithPhoneCode.mockResolvedValue({
      result: phoneResult(),
      isNewUser: true,
    });

    const out = await controller.loginByCode(CODE_BODY, res);

    expect(out).toMatchObject({
      code: 200,
      data: {
        user_id: 42,
        phone: "13800001234",
        is_new_user: true,
        has_password: false,
      },
    });
    // ★ 走的是我们自己的会话签发（`sess_` + HttpOnly cookie），
    //   不是 `loginWithCode` 那支没人认的 JWT——接错了用户点完登录立刻 401。
    expect(sessions.createSession).toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalled();
  });

  it("已存在的账号：is_new_user=false，has_password 跟着账号走", async () => {
    const { controller, identity, res } = setup();
    identity.loginWithPhoneCode.mockResolvedValue({
      result: phoneResult({ hasPassword: true }),
      isNewUser: false,
    });

    const out = await controller.loginByCode(CODE_BODY, res);

    expect(out).toMatchObject({
      code: 200,
      data: { is_new_user: false, has_password: true },
    });
  });

  it("验证码错误 → 401，不签发会话，且留一条失败登录日志", async () => {
    const { controller, identity, sessions, res } = setup();
    identity.loginWithPhoneCode.mockRejectedValue(
      new InvalidVerificationCodeError("验证码错误或已过期"),
    );

    await expect(controller.loginByCode(CODE_BODY, res)).rejects.toMatchObject({
      name: "NewApiError",
      status: 401,
    });
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        reason: "验证码错误",
        username: "13800001234",
      }),
    );
  });

  it("手机号格式不对 / 验证码为空 → 失败信封，不碰 identity", async () => {
    const { controller, identity, res } = setup();
    for (const body of [
      { phone: "12345", code: "123456" },
      { phone: "13800001234", code: "   " },
      { phone: "", code: "" },
      {},
      { phone: 13800001234, code: "123456" },
    ]) {
      const out = await controller.loginByCode(body, res);
      expect(out).toMatchObject({ code: FAILURE_CODE });
    }
    expect(identity.loginWithPhoneCode).not.toHaveBeenCalled();
  });
});

describe("AuthController 会话内容（凭证已移出会话）", () => {
  it("★ 会话只记身份，**不带**上游 key —— 带上就是一份 7 天不过期的密钥副本", async () => {
    const { controller, identity, sessions, res } = setup();
    identity.login.mockResolvedValue(loginResult());

    await controller.login(LOGIN_BODY, res);

    expect(sessions.createSession).toHaveBeenCalledWith({
      userId: 42,
      username: "alice",
      role: 1,
      status: 1,
      email: null,
    });
    // 断言的是「没有任何额外的密钥字段」：createSession 的入参就是上面那五个，
    // 上游 key 由 AuthGuard 按当前配置回注（见 auth.guard.test.ts）。
    expect(Object.keys(sessions.createSession.mock.calls[0]![0])).toEqual([
      "userId",
      "username",
      "role",
      "status",
      "email",
    ]);
  });

  it("★ 登录**不依赖**上游配置 —— 否则「还没配 key」就把要进去配它的人挡在门外", async () => {
    // 以前缺 key 时这里抛 503：key 要在管理端填，管理端要先登得进来，而登录又要求先有 key，
    // 新部署谁也进不去。凭证缺失的 fail-closed 现在落在真正打上游的地方。
    const { controller, identity, res } = setup();
    identity.login.mockResolvedValue(loginResult());
    const before = process.env.NEW_API_UPSTREAM_KEY;
    delete process.env.NEW_API_UPSTREAM_KEY;

    try {
      await expect(controller.login(LOGIN_BODY, res)).resolves.toBeDefined();
      expect(res.cookie).toHaveBeenCalled();
    } finally {
      if (before !== undefined) process.env.NEW_API_UPSTREAM_KEY = before;
    }
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
  it("★ 再没人写 user_info 凭证行 —— 全仓零读取者的写入已随本轮删除", async () => {
    // 那行是「登录即把统一 key 按 userId 写一份」的遗留：全项目共用一把 key 之后它
    // 只是把同一个密文抄 N 份，而且 **Java 侧从来不读 user_info**（迁移后素材跟进走
    // job 凭证 + 配置表）。没有读取者的密钥副本不该继续产生。
    const { controller, identity, prisma, res } = setup();
    identity.login.mockResolvedValue(loginResult());

    await controller.login(LOGIN_BODY, res);

    expect(prisma.client.user_info?.upsert).toBeUndefined();
  });
});

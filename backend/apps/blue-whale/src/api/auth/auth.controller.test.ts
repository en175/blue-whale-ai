import { describe, expect, it, vi } from "vitest";

const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    store = new Map<string, string>();
    zsets = new Map<string, Map<string, number>>();
    ttlMs = new Map<string, number>();

    constructor(_options?: unknown) {}

    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      nowRaw: string,
      windowRaw: string,
      limitRaw: string,
      member: string,
    ): Promise<[number, number]> {
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
      if (!this.zsets.has(key) && !this.store.has(key)) return -2;
      return this.ttlMs.get(key) ?? -1;
    }

    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const key of keys) {
        const removed = this.store.delete(key) || this.zsets.delete(key);
        if (removed) n += 1;
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

import { Reflector } from "@nestjs/core";
import { ApiError } from "@lib/core";
import {
  ACCOUNT_ERROR_CODE_WRONG,
  ACCOUNT_ERROR_SMS_SEND_FAILED,
  ACCOUNT_ERROR_TERMS_REQUIRED,
  ACCOUNT_LOCKED,
  FAILURE_CODE,
} from "@lib/contracts";
import type { Response } from "express";
import { LoginEntryService } from "@lib/shared/session/login-entry.service.js";
import type { SessionService } from "@lib/shared/session/session.service.js";
import {
  CodeWrongError,
  InvalidCredentialsError,
  MigrationIneligibleError,
  type IdentityService,
  type LocalLoginResult,
} from "@lib/shared/identity/index.js";
import {
  RATE_LIMIT_KEY,
  type RateLimitBucket,
} from "@lib/shared/rate-limit/decorators/rate-limit.decorator.js";
import { LoginFailureTracker } from "@lib/shared/rate-limit/login-failure-tracker.js";
import { RateLimiter } from "@lib/shared/rate-limit/rate-limiter.js";
import { SmsUpstreamError } from "@lib/shared/auth/sms.js";
import { AuthController } from "./auth.controller.js";

function credentialFailure(): InvalidCredentialsError {
  return new InvalidCredentialsError();
}

function loginResult(): LocalLoginResult {
  return {
    userId: 42,
    username: "alice",
    nickname: null,
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
  const sessions = {
    issueToken: vi.fn(async () => "jwt-token"),
    createSession: vi.fn(async () => undefined),
    resolveSession: vi.fn(async () => null),
    revokeAllForUser: vi.fn(async () => 0),
  };
  const prisma = { client: {} };
  const verification = { issue: vi.fn(async () => undefined) };
  const identity = {
    recordLogin: vi.fn(async () => undefined),
    login: vi.fn(),
    register: vi.fn(),
    loginWithPhoneCode: vi.fn(),
    getLoginResult: vi.fn(),
    verifyMigrationCandidate: vi.fn(),
    commitMigrationBind: vi.fn(),
    consumeRecoveryCode: vi.fn(),
  };
  const phoneActions = {
    issue: vi.fn(async () => "pa_token"),
    resolve: vi.fn(async () => null),
    revoke: vi.fn(async () => undefined),
  };
  const captcha = {
    issue: vi.fn(async () => ({
      id: "cap_test",
      image: "data:image/png;base64,AA==",
      expires_in: 60,
    })),
    verify: vi.fn(async () => "ok"),
  };
  const loginEntry = new LoginEntryService(
    sessions as unknown as SessionService,
    identity as never,
  );
  const allowlist = { isAllowed: vi.fn(() => false) };
  const operationLog = {
    record: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    findByRef: vi.fn(async () => null),
  };
  const controller = new AuthController(
    verification as never,
    sessions as unknown as SessionService,
    limiter,
    tracker,
    identity as unknown as IdentityService,
    identity as never,
    phoneActions as never,
    captcha as never,
    loginEntry,
    allowlist as never,
    operationLog as never,
  );
  const res = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
  return {
    controller,
    identity,
    sessions,
    res,
    limiter,
    tracker,
    prisma,
    verification,
    phoneActions,
    captcha,
    allowlist,
    operationLog,
  };
}

const LOGIN_BODY = { username: "alice", password: "wrong-pass" };

describe("AuthController 登录失败锁定（IKDR4J）", () => {
  it("连续 5 次密码失败后锁定：第 6 次 429 account_locked 且跳过 new-api 调用", async () => {
    const { controller, identity, res } = setup();
    identity.login.mockRejectedValue(credentialFailure());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        name: "ApiError",
        status: 401,
      });
    }
    expect(identity.login).toHaveBeenCalledTimes(5);

    await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
      name: "ApiError",
      status: 429,
      code: ACCOUNT_LOCKED,
    });
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
      new ApiError("账户服务暂不可用", 503, "account_service_unavailable"),
    );

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(controller.login(LOGIN_BODY, res)).rejects.toMatchObject({
        name: "ApiError",
        status: 503,
      });
    }
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
    const buckets = bucketsOf(
      AuthController.prototype.loginByCode as (...args: never[]) => unknown,
    );
    expect(buckets.find((b) => b.key === "phone")).toMatchObject({
      limit: 5,
      windowMs: 60_000,
    });
    expect(buckets.some((b) => b.key === "account")).toBe(false);
  });

  it("send-code 装饰器只声明 IP 两桶；号码两桶移到拼图校验之后（防止刷错拼图锁死别人号码）", () => {
    const buckets = bucketsOf(
      AuthController.prototype.sendCode as (...args: never[]) => unknown,
    );
    expect(buckets.filter((b) => b.key === "phone")).toHaveLength(0);
    expect(buckets.filter((b) => b.key === "ip")).toHaveLength(2);
    expect(Math.max(...buckets.map((b) => b.windowMs))).toBe(86_400_000);
  });
});

describe("AuthController 手机号验证码登录（IKJA4Q）", () => {
  const CODE_BODY = { phone: "13800001234", code: "123456", agreed_terms: true };

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

  it("验证码错误 → 400 code_wrong，不签发会话，且留一条失败登录日志", async () => {
    const { controller, identity, sessions, res } = setup();
    identity.loginWithPhoneCode.mockRejectedValue(new CodeWrongError(4));

    await expect(controller.loginByCode(CODE_BODY, res)).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: ACCOUNT_ERROR_CODE_WRONG,
    });
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        reason: "验证码错误，请重新输入（还可尝试4次）",
        username: "13800001234",
      }),
    );
  });

  it("未勾协议 → 400 terms_required，不碰 identity", async () => {
    const { controller, identity, res } = setup();

    await expect(
      controller.loginByCode({ phone: "13800001234", code: "123456" }, res),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: ACCOUNT_ERROR_TERMS_REQUIRED,
    });
    expect(identity.loginWithPhoneCode).not.toHaveBeenCalled();
  });

  it("client_id 透传进会话：同浏览器重登替换旧会话靠它", async () => {
    const { controller, identity, sessions, res } = setup();
    identity.loginWithPhoneCode.mockResolvedValue({
      result: phoneResult(),
      isNewUser: false,
    });

    await controller.loginByCode(
      { ...CODE_BODY, client_id: "browser-client-id-123" },
      res,
    );

    expect(sessions.createSession).toHaveBeenCalledWith(
      "jwt-token",
      expect.objectContaining({ clientId: "browser-client-id-123" }),
    );
  });

  it("client_id 原样交给会话层，长度策略由 SessionService 统一决定", async () => {
    const { controller, identity, sessions, res } = setup();
    identity.loginWithPhoneCode.mockResolvedValue({
      result: phoneResult(),
      isNewUser: false,
    });

    await controller.loginByCode({ ...CODE_BODY, client_id: "short" }, res);

    expect(sessions.createSession).toHaveBeenCalledWith(
      "jwt-token",
      expect.objectContaining({ clientId: "short" }),
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

    expect(sessions.createSession).toHaveBeenCalledWith("jwt-token", {
      userId: 42,
      username: "alice",
      role: 1,
      status: 1,
      email: null,
    });
    expect(Object.keys(sessions.createSession.mock.calls[0]![1])).toEqual([
      "userId",
      "username",
      "role",
      "status",
      "email",
    ]);
  });

  it("★ 令牌随响应体下发（IKJAZL：前端持有，不再只藏在 cookie 里）", async () => {
    const { controller, identity, res } = setup();
    identity.login.mockResolvedValue(loginResult());

    const out = await controller.login(LOGIN_BODY, res);

    expect(out).toMatchObject({ code: 200, data: { token: "jwt-token" } });
    expect(res.cookie).toHaveBeenCalled();
  });

  it("★ 登录**不依赖**上游配置 —— 否则「还没配 key」就把要进去配它的人挡在门外", async () => {
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
    identity.login.mockRejectedValue(credentialFailure());

    await controller.login(LOGIN_BODY, res, "203.0.113.9").catch(() => undefined);

    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, reason: "账密错误" }),
    );
  });

  it("非账密错误不记为账密错误——服务问题不是撞库信号", async () => {
    const { controller, identity, res } = setup();
    identity.login.mockRejectedValue(
      new ApiError("账户服务暂不可用", 503, "account_service_unavailable"),
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
    const { controller, identity, res } = setup();
    identity.login.mockResolvedValue(loginResult());
    identity.recordLogin.mockRejectedValue(new Error("db down"));

    await expect(controller.login(LOGIN_BODY, res)).resolves.toMatchObject({ data: expect.anything() });
    expect(res.cookie).toHaveBeenCalled();
  });
});

describe("AuthController capabilities（本地常量）", () => {
  it("口令登录/注册恒支持、邮箱验证恒不支持——不再探测上游开关", async () => {
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
    const { controller, identity, prisma, res } = setup();
    identity.login.mockResolvedValue(loginResult());

    await controller.login(LOGIN_BODY, res);

    expect(prisma.client.user_info?.upsert).toBeUndefined();
  });
});

describe("AuthController 内部账号迁移（IKPC9F）", () => {
  it("原密码通过 → 签发 10 分钟迁移凭证", async () => {
    const { controller, identity, phoneActions } = setup();
    identity.verifyMigrationCandidate.mockResolvedValue({ userId: "42" });

    const out = await controller.verifyMigrationPassword({
      username: "alice",
      password: "OldPass123",
    });

    expect(out).toMatchObject({
      code: 200,
      data: { migration_token: "pa_token", expires_in: 600 },
    });
    expect(phoneActions.issue).toHaveBeenCalledWith({
      kind: "migration",
      userId: 42,
    });
  });

  it("原账号或密码为空 → 请输入原账号和密码", async () => {
    const { controller, identity } = setup();

    await expect(
      controller.verifyMigrationPassword({ username: "", password: "" }),
    ).rejects.toMatchObject({
      status: 401,
      code: "invalid_credentials",
      message: "请输入原账号和密码",
    });
    expect(identity.verifyMigrationCandidate).not.toHaveBeenCalled();
  });

  it("密码错误 → 账号或密码不正确", async () => {
    const { controller, identity } = setup();
    identity.verifyMigrationCandidate.mockRejectedValue(new InvalidCredentialsError());

    await expect(
      controller.verifyMigrationPassword({ username: "alice", password: "bad" }),
    ).rejects.toMatchObject({
      status: 401,
      code: "invalid_credentials",
      message: "账号或密码不正确",
    });
  });

  it("账号已绑定手机号 → 单独提示，不再混在密码错误里", async () => {
    const { controller, identity } = setup();
    identity.verifyMigrationCandidate.mockRejectedValue(
      new MigrationIneligibleError("该账号已绑定手机号，请直接使用手机号登录"),
    );

    await expect(
      controller.verifyMigrationPassword({
        username: "alice",
        password: "OldPass123",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "migration_ineligible",
      message: "该账号已绑定手机号，请直接使用手机号登录",
    });
  });

  it("账号停用 → 单独提示无法迁移", async () => {
    const { controller, identity } = setup();
    identity.verifyMigrationCandidate.mockRejectedValue(
      new MigrationIneligibleError("账号已停用，无法迁移"),
    );

    await expect(
      controller.verifyMigrationPassword({
        username: "alice",
        password: "OldPass123",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "migration_ineligible",
      message: "账号已停用，无法迁移",
    });
  });

  it("凭证无效 → migration_token_expired，不碰 identity", async () => {
    const { controller, identity, phoneActions } = setup();
    phoneActions.resolve.mockResolvedValue(null);

    await expect(
      controller.bindPhoneForMigration({
        migration_token: "pa_bad",
        phone: "13800001234",
        code: "123456",
        agreed_terms: true,
      }),
    ).rejects.toMatchObject({ code: "migration_token_expired" });
    expect(identity.commitMigrationBind).not.toHaveBeenCalled();
  });

  it("补绑成功 → 绑定原 ID、签发会话并撤销该账号旧会话", async () => {
    const { controller, identity, phoneActions, sessions, res } = setup();
    phoneActions.resolve.mockResolvedValue({ kind: "migration", userId: 42 });
    identity.commitMigrationBind.mockResolvedValue({
      id: "42",
      username: "alice",
      nickname: null,
      phone: "13800001234",
    });
    identity.getLoginResult.mockResolvedValue({
      ...loginResult(),
      phone: "13800001234",
      hasPassword: true,
    });

    const out = await controller.bindPhoneForMigration(
      {
        migration_token: "pa_ok",
        phone: "13800001234",
        code: "123456",
        agreed_terms: true,
      },
      res,
    );

    expect(out).toMatchObject({ code: 200, data: { user_id: 42 } });
    expect(phoneActions.revoke).toHaveBeenCalledWith("pa_ok");
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, "jwt-token");
    expect(res.cookie).toHaveBeenCalled();
  });
});

describe("AuthController 拼图验证（发码前）", () => {
  it("签发挑战：按号码 + 用途绑定", async () => {
    const { controller, captcha } = setup();
    const out = await controller.getCaptcha("13800001234", "login");
    expect(captcha.issue).toHaveBeenCalledWith("13800001234", "login");
    expect(out).toMatchObject({ code: 200, data: { id: "cap_test" } });
  });

  it("未带拼图 → captcha_required，不发短信", async () => {
    const { controller } = setup();
    await expect(
      controller.sendCode({ phone: "13800001234", purpose: "login" }, "1.2.3.4"),
    ).rejects.toMatchObject({ status: 400, code: "captcha_required" });
  });

  it("验证码答案错误 → captcha_invalid", async () => {
    const { controller, captcha } = setup();
    captcha.verify.mockResolvedValue("invalid");

    await expect(
      controller.sendCode(
        {
          phone: "13800001234",
          purpose: "login",
          captcha_id: "cap_test",
          captcha_answer: "AB2C",
        },
        "1.2.3.4",
      ),
    ).rejects.toMatchObject({ status: 400, code: "captcha_invalid" });
  });

  it("挑战过期 → captcha_expired", async () => {
    const { controller, captcha } = setup();
    captcha.verify.mockResolvedValue("expired");

    await expect(
      controller.sendCode(
        {
          phone: "13800001234",
          purpose: "login",
          captcha_id: "cap_test",
          captcha_answer: "AB2C",
        },
        "1.2.3.4",
      ),
    ).rejects.toMatchObject({ status: 400, code: "captcha_expired" });
  });
});

describe("AuthController 发码（验证码通过后）", () => {
  it("频控放行 → 交给验证码 module 发码", async () => {
    const { controller, verification, limiter } = setup();
    vi.spyOn(limiter, "take").mockResolvedValue({ allowed: true } as never);

    const out = await controller.sendCode(
      {
        phone: "13800001234",
        purpose: "login",
        captcha_id: "cap_test",
        captcha_answer: "AB2C",
      },
      "1.2.3.4",
    );

    expect(verification.issue).toHaveBeenCalledWith({
      phone: "13800001234",
      purpose: "login",
      ip: "1.2.3.4",
    });
    expect(out).toMatchObject({ code: 200 });
  });

  it("用途非法 → 返回 invalid_purpose，不进入验证码 module", async () => {
    const { controller, verification } = setup();
    const out = await controller.sendCode(
      { phone: "13800001234", purpose: "forgot" },
      "1.2.3.4",
    );
    expect(out).toMatchObject({
      code: 400,
      error_code: "invalid_purpose",
    });
    expect(verification.issue).not.toHaveBeenCalled();
  });

  it("短信渠道失败 → 抛出 502 并退回同号额度", async () => {
    const { controller, verification, limiter } = setup();
    vi.spyOn(limiter, "take").mockResolvedValue({
      allowed: true,
      member: "member-1",
    } as never);
    const refund = vi.spyOn(limiter, "refund").mockResolvedValue(undefined);
    verification.issue.mockRejectedValue(new Error("sms down"));

    await expect(
      controller.sendCode(
        {
          phone: "13800001234",
          purpose: "login",
          captcha_id: "cap_test",
          captcha_answer: "AB2C",
        },
        "1.2.3.4",
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: ACCOUNT_ERROR_SMS_SEND_FAILED,
    });
    expect(refund).toHaveBeenCalledTimes(2);
  });

  it("短信渠道失败 → 记录上游错误码与脱敏手机号，对外不泄漏原文", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { controller, verification, limiter } = setup();
    vi.spyOn(limiter, "take").mockResolvedValue({ allowed: true } as never);
    verification.issue.mockRejectedValue(
      new SmsUpstreamError("InvalidTemplate", "模板不存在", 400),
    );

    const error = await controller
      .sendCode(
        {
          phone: "13800001234",
          purpose: "login",
          captcha_id: "cap_test",
          captcha_answer: "AB2C",
        },
        "1.2.3.4",
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      status: 502,
      code: ACCOUNT_ERROR_SMS_SEND_FAILED,
    });
    expect(String((error as Error).message)).not.toContain("InvalidTemplate");
    const record = JSON.parse(String(warn.mock.calls.at(-1)?.[0]));
    expect(record).toMatchObject({
      body: "[sms] send failed",
      stage: "send-code",
      phone: "138****1234",
      ip: "1.2.3.4",
      purpose: "login",
      upstream_code: "InvalidTemplate",
      upstream_message: "模板不存在",
    });
    warn.mockRestore();
  });

  it("豁免只认 X-Real-IP：伪造 X-Forwarded-For 不能跳过手机号频控", async () => {
    const { controller, limiter, allowlist, verification } = setup();
    allowlist.isAllowed.mockImplementation((kind, key) => kind === "ip" && key === "10.0.0.1");
    const take = vi.spyOn(limiter, "take").mockResolvedValue({ allowed: true } as never);

    await controller.sendCode(
      {
        phone: "13800001234",
        purpose: "login",
        captcha_id: "cap_test",
        captcha_answer: "AB2C",
      },
      "10.0.0.1",
      undefined,
      undefined,
    );

    expect(take).toHaveBeenCalled();
    expect(verification.issue).toHaveBeenCalled();
  });

  it("X-Real-IP 命中豁免 → 跳过手机号频控", async () => {
    const { controller, limiter, allowlist, verification } = setup();
    allowlist.isAllowed.mockImplementation((kind, key) => kind === "ip" && key === "10.0.0.1");
    const take = vi.spyOn(limiter, "take").mockResolvedValue({ allowed: true } as never);

    await controller.sendCode(
      {
        phone: "13800001234",
        purpose: "login",
        captcha_id: "cap_test",
        captcha_answer: "AB2C",
      },
      "203.0.113.9",
      undefined,
      "10.0.0.1",
    );

    expect(take).not.toHaveBeenCalled();
    expect(verification.issue).toHaveBeenCalled();
  });
});

describe("迁移结果查询（IKQ1HL）", () => {
  it("缺凭证或无记录 → operation_not_found", async () => {
    const { controller } = setup();
    expect(await controller.migrationResult({})).toMatchObject({
      error_code: "operation_not_found",
    });
    expect(
      await controller.migrationResult({ migration_token: "pa_x" }),
    ).toMatchObject({ error_code: "operation_not_found" });
  });

  it("凭证已作废但记录存在 → 仍返回最终状态", async () => {
    const { controller, operationLog } = setup();
    operationLog.findByRef.mockResolvedValue({
      id: "1",
      category: "account",
      action: "migration_bind",
      target: "alice",
      targetUserId: "42",
      detail: JSON.stringify({ phone: "138****1234" }),
      operator: "alice",
      operatorId: "42",
      ipAddress: null,
      status: 2,
      ref: "ref-1",
      createdAt: "2026-10-28T00:00:00+08:00",
    } as never);

    const out = await controller.migrationResult({ migration_token: "pa_x" });
    expect(out).toMatchObject({
      code: 200,
      data: { operation: "migration_bind", status: 2 },
    });
  });
});

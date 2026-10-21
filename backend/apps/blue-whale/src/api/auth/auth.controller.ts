import { Body, Controller, Get, Headers, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { isValidPhone, NewApiError } from "@lib/core";
import {
  ACCOUNT_ERROR_ACCOUNT_DELETED,
  ACCOUNT_ERROR_ACCOUNT_DISABLED,
  ACCOUNT_ERROR_CODE_ATTEMPTS_EXHAUSTED,
  ACCOUNT_ERROR_CODE_EXPIRED,
  ACCOUNT_ERROR_CODE_WRONG,
  ACCOUNT_ERROR_TERMS_REQUIRED,
  ACCOUNT_LOCKED,
  FAILURE_CODE,
  fail,
  ok,
} from "@lib/contracts";
import { createAuthRepo } from "@lib/shared/persistence/index.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { handleSendCode } from "@lib/shared/auth/handle-send-code.js";
import { resolveSmsProvider, type SmsProvider } from "@lib/shared/auth/sms.js";
import {
  projectAccountBusinessFailure,
  toAuthError,
} from "@lib/shared/errors/auth-error.js";
import { RateLimit } from "@lib/shared/rate-limit/decorators/rate-limit.decorator.js";
import {
  LOGIN_LOCK_SCOPE,
  LoginFailureTracker,
} from "@lib/shared/rate-limit/login-failure-tracker.js";
import { RateLimiter } from "@lib/shared/rate-limit/rate-limiter.js";
import {
  AccountDeletedError,
  AccountDisabledError,
  CodeAttemptsExhaustedError,
  CodeExpiredError,
  CodeWrongError,
  IdentityService,
  InvalidCredentialsError,
  PasswordPolicyError,
  UsernameTakenError,
  type LocalLoginResult,
} from "@lib/shared/identity/index.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import { extractLoginToken } from "@lib/shared/session/login-token.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { LoginByCodeDto } from "./dto/login-by-code.dto.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { RegisterDto } from "./dto/register.dto.js";

function loginData(result: LocalLoginResult, isNewUser: boolean, token: string) {
  return {
    token,
    user_id: result.userId,
    username: result.username,
    nickname: result.nickname ?? result.username,
    email: result.email ?? null,
    phone: result.phone ?? "",
    is_new_user: isNewUser,
    has_password: result.hasPassword,
    must_change_password: result.mustChangePassword,
  };
}

function normalizeClientId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 8 && trimmed.length <= 64 ? trimmed : undefined;
}

function phoneCodeFailure(error: unknown): NewApiError | null {
  if (error instanceof CodeWrongError) {
    return new NewApiError(
      `验证码错误，请重新输入（还可尝试${error.remaining}次）`,
      400,
      ACCOUNT_ERROR_CODE_WRONG,
    );
  }
  if (error instanceof CodeAttemptsExhaustedError) {
    return new NewApiError(error.message, 400, ACCOUNT_ERROR_CODE_ATTEMPTS_EXHAUSTED);
  }
  if (error instanceof CodeExpiredError) {
    return new NewApiError(error.message, 400, ACCOUNT_ERROR_CODE_EXPIRED);
  }
  if (error instanceof AccountDisabledError) {
    return new NewApiError(error.message, 403, ACCOUNT_ERROR_ACCOUNT_DISABLED);
  }
  if (error instanceof AccountDeletedError) {
    return new NewApiError(error.message, 403, ACCOUNT_ERROR_ACCOUNT_DELETED);
  }
  return null;
}

const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

function authRateLimit(
  endpoint: "login" | "register" | "login_by_code",
  accountKey: "account" | "phone" = "account",
) {
  return RateLimit({
    buckets: [
      {
        scope: `${endpoint}_ip`,
        key: "ip" as const,
        limit: 20,
        windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      },
      {
        scope: `${endpoint}_${accountKey}`,
        key: accountKey,
        limit: 5,
        windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      },
    ],
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

const SMS_CODE_RATE_LIMIT = RateLimit({
  buckets: [
    { scope: "send_code_phone_minute", key: "phone" as const, limit: 1, windowMs: 60_000 },
    { scope: "send_code_phone_day", key: "phone" as const, limit: 10, windowMs: DAY_MS },
    { scope: "send_code_ip_minute", key: "ip" as const, limit: 5, windowMs: 60_000 },
    { scope: "send_code_ip_day", key: "ip" as const, limit: 50, windowMs: DAY_MS },
  ],
});

@Controller("auth")
export class AuthController {
  private smsInstance?: SmsProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    private readonly loginFailures: LoginFailureTracker,
    private readonly identity: IdentityService,
  ) {}

  private get sms(): SmsProvider {
    if (!this.smsInstance) this.smsInstance = resolveSmsProvider();
    return this.smsInstance;
  }

  @Public()
  @Post("send-code")
  @SMS_CODE_RATE_LIMIT
  async sendCode(
    @Body() body: { phone?: unknown; purpose?: unknown },
    @Headers("x-forwarded-for") forwardedFor?: string,
  ) {
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
    return handleSendCode(
      { phone: body?.phone, purpose: body?.purpose, ip },
      { db: createAuthRepo(this.prisma.client), sms: this.sms },
    );
  }

  private async establishSession(
    result: LocalLoginResult,
    clientId?: string | undefined,
  ): Promise<string> {
    if (result.userId == null || !result.username) {
      throw new NewApiError("账户服务响应异常", 502, "invalid_identity");
    }
    const token = await this.sessions.issueToken(String(result.userId));
    await this.sessions.createSession(token, {
      userId: result.userId,
      username: result.username,
      role: result.role,
      status: result.status,
      email: result.email ?? null,
      ...(clientId ? { clientId } : {}),
    });
    return token;
  }

  @Public()
  @Post("login")
  @authRateLimit("login")
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Headers("x-forwarded-for") forwardedFor?: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const clientId = normalizeClientId(body.client_id);
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

    if (!username || !password) {
      await this.recordLogin({ username, ip, userAgent, success: false, reason: "凭据为空" });
      return { code: FAILURE_CODE, msg: "用户名和密码不能为空", data: null };
    }
    if (await this.limiter.isBlocked(LOGIN_LOCK_SCOPE, username)) {
      await this.recordLogin({ username, ip, userAgent, success: false, reason: "账号锁定" });
      throw new NewApiError(
        "尝试次数过多，账号已锁定，请稍后再试",
        429,
        ACCOUNT_LOCKED,
      );
    }
    try {
      const result = await this.identity.login({ username, password });
      await this.loginFailures.clear(username);
      const sessionToken = await this.establishSession(result, clientId || undefined);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      await this.recordLogin({
        userId: String(result.userId),
        username,
        ip,
        userAgent,
        success: true,
      });
      return ok(loginData(result, false, sessionToken));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        await this.loginFailures.recordFailure(username);
        await this.recordLogin({ username, ip, userAgent, success: false, reason: "账密错误" });
        throw new NewApiError(error.message, 401, "invalid_credentials");
      }
      const projected = projectAccountBusinessFailure(error, 401);
      if (projected) {
        await this.loginFailures.recordFailure(username);
        await this.recordLogin({ username, ip, userAgent, success: false, reason: "账密错误" });
        throw projected;
      }
      throw toAuthError(error);
    }
  }

  @Public()
  @Post("login-by-code")
  @authRateLimit("login_by_code", "phone")
  async loginByCode(
    @Body() body: LoginByCodeDto,
    @Res({ passthrough: true }) res: Response,
    @Headers("x-forwarded-for") forwardedFor?: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const clientId = normalizeClientId(body.client_id);
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

    if (!isValidPhone(phone) || !code) {
      return fail(FAILURE_CODE, "手机号和验证码不能为空");
    }
    if (body.agreed_terms !== true) {
      throw new NewApiError(
        "请先阅读并同意用户服务协议和隐私政策",
        400,
        ACCOUNT_ERROR_TERMS_REQUIRED,
      );
    }

    try {
      const { result, isNewUser } = await this.identity.loginWithPhoneCode({ phone, code });
      const sessionToken = await this.establishSession(result, clientId || undefined);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      await this.recordLogin({
        userId: String(result.userId),
        username: result.username,
        ip,
        userAgent,
        success: true,
      });
      return ok(loginData(result, isNewUser, sessionToken));
    } catch (error) {
      const failure = phoneCodeFailure(error);
      if (failure) {
        await this.recordLogin({
          username: phone,
          ip,
          userAgent,
          success: false,
          reason: failure.message,
        });
        throw failure;
      }
      throw toAuthError(error);
    }
  }

  private async recordLogin(entry: {
    userId?: string | null | undefined;
    username: string;
    ip: string;
    userAgent?: string | undefined;
    success: boolean;
    reason?: string | undefined;
  }): Promise<void> {
    try {
      await this.identity.recordLogin({
        userId: entry.userId ?? null,
        username: entry.username,
        ip: entry.ip,
        userAgent: entry.userAgent ?? "",
        success: entry.success,
        reason: entry.reason,
      });
    } catch (error) {
      logger.error(
        `登录日志写入失败（username=${entry.username} success=${entry.success}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @Public()
  @Post("register")
  @authRateLimit("register")
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return { code: FAILURE_CODE, msg: "用户名和密码不能为空", data: null };
    }
    try {
      const result = await this.identity.register({
        username,
        password,
        ...(typeof body.email === "string" && body.email.trim()
          ? { email: body.email.trim() }
          : {}),
      });
      const sessionToken = await this.establishSession(result);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      return ok(loginData(result, true, sessionToken));
    } catch (error) {
      if (error instanceof UsernameTakenError || error instanceof PasswordPolicyError) {
        throw new NewApiError(error.message, 400, FAILURE_CODE);
      }
      throw toAuthError(error);
    }
  }

  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = extractLoginToken(req);
    if (token) await this.sessions.revoke(token);
    res.clearCookie(SESSION_COOKIE_NAME, {
      ...sessionCookieOptions(),
      maxAge: undefined,
    });
    return ok();
  }

  @Public()
  @Get("capabilities")
  async capabilities() {
    return ok({
      password_login: true,
      password_register: true,
      email_verification: false,
    });
  }
}

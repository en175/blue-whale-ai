import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiError, maskPhone } from "@lib/core";
import {
  ACCOUNT_ERROR_BIND_SUCCEEDED_LOGIN_FAILED,
  ACCOUNT_ERROR_CAPTCHA_EXPIRED,
  ACCOUNT_ERROR_CAPTCHA_INVALID,
  ACCOUNT_ERROR_CAPTCHA_REQUIRED,
  ACCOUNT_ERROR_MIGRATION_INELIGIBLE,
  ACCOUNT_ERROR_MIGRATION_TOKEN_EXPIRED,
  ACCOUNT_ERROR_PHONE_TAKEN,
  ACCOUNT_ERROR_TERMS_REQUIRED,
  ACCOUNT_LOCKED,
  FAILURE_CODE,
  RATE_LIMITED,
  fail,
  ok,
} from "@lib/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import {
  normalizeVerificationInput,
  PhoneVerificationService,
  requirePhoneAndCode,
} from "@lib/shared/auth/phone-verification.service.js";
import { CaptchaService } from "@lib/shared/auth/captcha.service.js";
import { SmsUpstreamError } from "@lib/shared/auth/sms.js";
import {
  projectAuthFailure,
  toAuthError,
} from "@lib/shared/errors/auth-error.js";
import { RateLimit } from "@lib/shared/rate-limit/decorators/rate-limit.decorator.js";
import {
  LOGIN_LOCK_SCOPE,
  LoginFailureTracker,
} from "@lib/shared/rate-limit/login-failure-tracker.js";
import { RateLimitAllowlist } from "@lib/shared/rate-limit/rate-limit-allowlist.js";
import { enforceRateLimit } from "@lib/shared/rate-limit/rate-limit-policy.js";
import { RateLimiter } from "@lib/shared/rate-limit/rate-limiter.js";
import {
  IdentityService,
  InvalidCredentialsError,
  MigrationIneligibleError,
  PhoneActionService,
  PhoneBindingService,
  PhoneTakenError,
} from "@lib/shared/identity/index.js";
import { LoginEntryService } from "@lib/shared/session/login-entry.service.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import { extractLoginToken } from "@lib/shared/session/login-token.js";
import {
  applySessionCookie,
  clearSessionCookie,
} from "@lib/shared/session/cookie.js";
import type { LoginByCodeDto } from "./dto/login-by-code.dto.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { MigrationBindDto } from "./dto/migration-bind.dto.js";
import type { MigrationVerifyDto } from "./dto/migration-verify.dto.js";
import type { RegisterDto } from "./dto/register.dto.js";

function phoneCodeFailure(error: unknown): ApiError | null {
  const failure = projectAuthFailure(error);
  if (!failure) return null;
  return new ApiError(failure.message, failure.status, failure.errorCode);
}

function verificationInputFailure(error: unknown) {
  const failure = projectAuthFailure(error);
  if (!failure) return null;
  return fail(FAILURE_CODE, failure.message, null, failure.errorCode);
}

const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

const MIGRATION_FAILURE_SCOPE = "migration_failure";
const MIGRATION_LOCK_SCOPE = "migration_lock";

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

const SMS_PHONE_BUCKETS = [
  {
    scope: "send_code_phone_minute",
    key: "phone" as const,
    limit: 1,
    windowMs: 10_000,
  },
  {
    scope: "send_code_phone_day",
    key: "phone" as const,
    limit: 60,
    windowMs: DAY_MS,
  },
];

const SMS_CODE_RATE_LIMIT = RateLimit({
  buckets: [
    { scope: "send_code_ip_minute", key: "ip" as const, limit: 5, windowMs: 60_000 },
    { scope: "send_code_ip_day", key: "ip" as const, limit: 50, windowMs: DAY_MS },
  ],
});

@Controller("auth")
export class AuthController {
  constructor(
    private readonly verification: PhoneVerificationService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    private readonly loginFailures: LoginFailureTracker,
    private readonly identity: IdentityService,
    private readonly phoneBinding: PhoneBindingService,
    private readonly phoneActions: PhoneActionService,
    private readonly captcha: CaptchaService,
    private readonly loginEntry: LoginEntryService,
    private readonly allowlist: RateLimitAllowlist,
  ) {}

  @Public()
  @Get("captcha")
  @RateLimit({
    buckets: [
      {
        scope: "captcha_ip",
        key: "ip" as const,
        limit: 20,
        windowMs: 60_000,
      },
    ],
  })
  async getCaptcha(
    @Query("phone") phoneRaw: string | undefined,
    @Query("purpose") purposeRaw: string | undefined,
  ) {
    let request;
    try {
      request = normalizeVerificationInput({
        phone: phoneRaw,
        purpose: purposeRaw,
      });
    } catch (error) {
      const failure = verificationInputFailure(error);
      if (failure) return failure;
      throw error;
    }
    return ok(await this.captcha.issue(request.phone, request.purpose));
  }

  @Public()
  @Post("send-code")
  @SMS_CODE_RATE_LIMIT
  async sendCode(
    @Body()
    body: {
      phone?: unknown;
      purpose?: unknown;
      captcha_id?: unknown;
      captcha_answer?: unknown;
    },
    @Headers("x-forwarded-for") forwardedFor?: string,
    @Res({ passthrough: true }) res?: Response,
    @Headers("x-real-ip") realIp?: string,
  ) {
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
    const allowlistIp = realIp?.trim() || null;
    let request;
    try {
      request = normalizeVerificationInput({
        phone: body?.phone,
        purpose: body?.purpose,
      });
    } catch (error) {
      const failure = verificationInputFailure(error);
      if (failure) return failure;
      throw error;
    }
    const { phone, purpose } = request;
    const captchaId =
      typeof body?.captcha_id === "string" ? body.captcha_id.trim() : "";
    if (!captchaId) {
      throw new ApiError("请先完成验证码验证", 400, ACCOUNT_ERROR_CAPTCHA_REQUIRED);
    }
    const verdict = await this.captcha.verify({
      id: captchaId,
      answer: body?.captcha_answer,
      phone,
      purpose,
    });
    if (verdict === "expired") {
      throw new ApiError(
        "验证已超时，请换一张后重试",
        400,
        ACCOUNT_ERROR_CAPTCHA_EXPIRED,
      );
    }
    if (verdict === "invalid") {
      throw new ApiError(
        "验证码错误，已换新图，请重新输入",
        400,
        ACCOUNT_ERROR_CAPTCHA_INVALID,
      );
    }

    const phoneDecision = await enforceRateLimit(
      SMS_PHONE_BUCKETS,
      { ip, allowlistIp, account: null, phone, user: null },
      { limiter: this.limiter, allowlist: this.allowlist },
    );
    if (!phoneDecision.allowed) {
      res?.setHeader("Retry-After", String(phoneDecision.retryAfter ?? 1));
      throw new ApiError("操作过于频繁，请稍后再试", 429, RATE_LIMITED);
    }

    try {
      await this.verification.issue({ phone, purpose, ip });
      return ok();
    } catch (error) {
      this.logSendFailure(phone, ip, purpose, error);
      return fail(FAILURE_CODE, "短信发送失败");
    }
  }

  private logSendFailure(
    phone: string,
    ip: string,
    purpose: string,
    error: unknown,
  ): void {
    logger.warn("[sms] send failed", {
      stage: "send-code",
      phone: maskPhone(phone),
      ip,
      purpose,
      error_type: error instanceof Error ? error.name : typeof error,
      ...(error instanceof SmsUpstreamError
        ? { upstream_code: error.code, upstream_message: error.upstreamMessage }
        : {
            error_message:
              error instanceof Error ? error.message : String(error),
          }),
    });
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
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

    if (!username || !password) {
      await this.loginEntry.fail({ username, ip, userAgent, reason: "凭据为空" });
      return { code: FAILURE_CODE, msg: "用户名和密码不能为空", data: null };
    }
    if (await this.limiter.isBlocked(LOGIN_LOCK_SCOPE, username)) {
      await this.loginEntry.fail({ username, ip, userAgent, reason: "账号锁定" });
      throw new ApiError(
        "尝试次数过多，账号已锁定，请稍后再试",
        429,
        ACCOUNT_LOCKED,
      );
    }
    try {
      const result = await this.identity.login({ username, password });
      await this.loginFailures.clear(username);
      const entry = await this.loginEntry.succeed({
        result,
        isNewUser: false,
        clientId: body.client_id,
        ip,
        userAgent,
      });
      applySessionCookie(res, entry.token);
      return ok(entry.data);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        await this.loginFailures.recordFailure(username);
        await this.loginEntry.fail({ username, ip, userAgent, reason: "账密错误" });
        throw new ApiError(error.message, 401, "invalid_credentials");
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
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
    let credentials;
    try {
      credentials = requirePhoneAndCode({
        phone: body.phone,
        code: body.code,
      });
    } catch (error) {
      const failure = verificationInputFailure(error);
      if (failure) return failure;
      throw error;
    }
    const { phone, code } = credentials;
    if (body.agreed_terms !== true) {
      throw new ApiError(
        "请先阅读并同意用户服务协议和隐私政策",
        400,
        ACCOUNT_ERROR_TERMS_REQUIRED,
      );
    }

    try {
      const { result, isNewUser } = await this.phoneBinding.loginWithPhoneCode({ phone, code });
      const entry = await this.loginEntry.succeed({
        result,
        isNewUser,
        clientId: body.client_id,
        ip,
        userAgent,
      });
      applySessionCookie(res, entry.token);
      return ok(entry.data);
    } catch (error) {
      const failure = phoneCodeFailure(error);
      if (failure) {
        await this.loginEntry.fail({
          username: phone,
          ip,
          userAgent,
          reason: failure.message,
        });
        throw failure;
      }
      throw toAuthError(error);
    }
  }

  @Public()
  @Post("migration/verify-password")
  @RateLimit({
    buckets: [
      {
        scope: "migration_verify_ip",
        key: "ip" as const,
        limit: 20,
        windowMs: 60_000,
      },
      {
        scope: "migration_verify_account",
        key: "account" as const,
        limit: 5,
        windowMs: 60_000,
      },
    ],
  })
  async verifyMigrationPassword(
    @Body() body: MigrationVerifyDto,
    @Headers("x-forwarded-for") forwardedFor?: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
    const invalidCredentialsMessage = "账号或密码不正确";

    if (!username || !password) {
      throw new ApiError("请输入原账号和密码", 401, "invalid_credentials");
    }
    if (await this.limiter.isBlocked(MIGRATION_LOCK_SCOPE, username)) {
      throw new ApiError(
        "尝试次数过多，账号已锁定，请稍后再试",
        429,
        ACCOUNT_LOCKED,
      );
    }

    try {
      const { userId } = await this.phoneBinding.verifyMigrationCandidate({
        username,
        password,
      });
      await this.limiter.reset(MIGRATION_FAILURE_SCOPE, username);
      await this.limiter.reset(MIGRATION_LOCK_SCOPE, username);
      await this.loginEntry.audit({
        userId,
        username,
        ip,
        userAgent,
        reason: "迁移验证",
      });
      const migrationToken = await this.phoneActions.issue({
        kind: "migration",
        userId: Number(userId),
      });
      return ok({ migration_token: migrationToken, expires_in: 600 });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        const result = await this.limiter.take({
          scope: MIGRATION_FAILURE_SCOPE,
          key: username,
          limit: 4,
          windowMs: 15 * 60 * 1000,
        });
        if (!result.allowed) {
          await this.limiter.block(MIGRATION_LOCK_SCOPE, username, 15 * 60 * 1000);
        }
        await this.loginEntry.fail({
          username,
          ip,
          userAgent,
          reason: "迁移密码错误",
        });
        throw new ApiError(invalidCredentialsMessage, 401, "invalid_credentials");
      }
      if (error instanceof MigrationIneligibleError) {
        await this.loginEntry.fail({
          username,
          ip,
          userAgent,
          reason: "迁移资格不符",
        });
        throw new ApiError(
          error.message,
          400,
          ACCOUNT_ERROR_MIGRATION_INELIGIBLE,
        );
      }
      throw toAuthError(error);
    }
  }

  @Public()
  @Post("migration/bind-phone")
  @authRateLimit("login_by_code", "phone")
  async bindPhoneForMigration(
    @Body() body: MigrationBindDto,
    @Res({ passthrough: true }) res: Response,
    @Headers("x-forwarded-for") forwardedFor?: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    const token =
      typeof body.migration_token === "string" ? body.migration_token.trim() : "";
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

    if (!token) {
      throw new ApiError(
        "原账号验证已过期，请重新验证",
        400,
        ACCOUNT_ERROR_MIGRATION_TOKEN_EXPIRED,
      );
    }
    let credentials;
    try {
      credentials = requirePhoneAndCode({
        phone: body.phone,
        code: body.code,
      });
    } catch (error) {
      const failure = verificationInputFailure(error);
      if (failure) return failure;
      throw error;
    }
    const { phone, code } = credentials;
    if (body.agreed_terms !== true) {
      throw new ApiError(
        "请先阅读并同意用户服务协议和隐私政策",
        400,
        ACCOUNT_ERROR_TERMS_REQUIRED,
      );
    }

    const action = await this.phoneActions.resolve("migration", token);
    if (!action) {
      throw new ApiError(
        "原账号验证已过期，请重新验证",
        400,
        ACCOUNT_ERROR_MIGRATION_TOKEN_EXPIRED,
      );
    }

    let user: { id: string; username: string };
    try {
      user = await this.phoneBinding.commitMigrationBind(action.userId, {
        phone,
        code,
      });
    } catch (error) {
      if (error instanceof PhoneTakenError) {
        await this.loginEntry.fail({
          username: phone,
          ip,
          userAgent,
          reason: "迁移补绑失败：号码已占用",
        });
        return fail(
          FAILURE_CODE,
          error.message,
          null,
          ACCOUNT_ERROR_PHONE_TAKEN,
        );
      }
      const failure = phoneCodeFailure(error);
      if (failure) {
        await this.loginEntry.fail({
          username: phone,
          ip,
          userAgent,
          reason: `迁移补绑失败：${failure.message}`,
        });
        throw failure;
      }
      throw toAuthError(error);
    }

    try {
      await this.phoneActions.revoke(token);
    } catch (error) {
      logger.error(
        `迁移补绑成功后作废迁移凭证失败（userId=${user.id}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      const result = await this.identity.getLoginResult(user.id);
      const entry = await this.loginEntry.succeed({
        result,
        isNewUser: false,
        clientId: body.client_id,
        ip,
        userAgent,
        revokeOthers: true,
      });
      applySessionCookie(res, entry.token);
      return ok(entry.data);
    } catch (error) {
      logger.error(
        `迁移补绑成功但登录失败（userId=${user.id}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ApiError(
        "手机号已绑定，请重新登录",
        500,
        ACCOUNT_ERROR_BIND_SUCCEEDED_LOGIN_FAILED,
      );
    }
  }

  @Public()
  @Post("register")
  @authRateLimit("register")
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) res: Response,
    @Headers("x-forwarded-for") forwardedFor?: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
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
      const entry = await this.loginEntry.succeed({
        result,
        isNewUser: true,
        ip,
        userAgent,
      });
      applySessionCookie(res, entry.token);
      return ok(entry.data);
    } catch (error) {
      const failure = phoneCodeFailure(error);
      if (failure) throw failure;
      throw toAuthError(error);
    }
  }

  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = extractLoginToken(req);
    if (token) await this.sessions.revoke(token);
    clearSessionCookie(res);
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

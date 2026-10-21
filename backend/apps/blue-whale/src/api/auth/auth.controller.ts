import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { isValidPhone, NewApiError } from "@lib/core";
import {
  ACCOUNT_ERROR_ACCOUNT_DELETED,
  ACCOUNT_ERROR_ACCOUNT_DISABLED,
  ACCOUNT_ERROR_BIND_SUCCEEDED_LOGIN_FAILED,
  ACCOUNT_ERROR_CAPTCHA_EXPIRED,
  ACCOUNT_ERROR_CAPTCHA_INVALID,
  ACCOUNT_ERROR_CAPTCHA_REQUIRED,
  ACCOUNT_ERROR_INVALID_PURPOSE,
  ACCOUNT_ERROR_MIGRATION_INELIGIBLE,
  ACCOUNT_ERROR_MIGRATION_TOKEN_EXPIRED,
  ACCOUNT_ERROR_OPERATION_FORBIDDEN,
  ACCOUNT_ERROR_OPERATION_NOT_FOUND,
  ACCOUNT_ERROR_OPERATION_PENDING,
  ACCOUNT_ERROR_PHONE_TAKEN,
  ACCOUNT_ERROR_QUERY_TOKEN_EXPIRED,
  ACCOUNT_ERROR_SESSION_EXPIRED,
  ACCOUNT_ERROR_TERMS_REQUIRED,
  ACCOUNT_LOCKED,
  FAILURE_CODE,
  LEGACY_VERIFICATION_PURPOSE,
  RATE_LIMITED,
  fail,
  isVerificationPurpose,
  ok,
} from "@lib/contracts";
import { createAuthRepo } from "@lib/shared/persistence/index.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { handleSendCode } from "@lib/shared/auth/handle-send-code.js";
import { resolveSmsProvider, type SmsProvider } from "@lib/shared/auth/sms.js";
import {
  AuthOperationService,
  maskPhone,
  type AuthOperationStatus,
  type AuthOperationType,
} from "@lib/shared/auth/auth-operation.service.js";
import { projectPhoneCodeError } from "@lib/shared/auth/phone-code-error.js";
import { CaptchaService } from "@lib/shared/auth/captcha.service.js";
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
  IdentityService,
  InvalidCredentialsError,
  MigrationIneligibleError,
  PasswordPolicyError,
  PhoneActionService,
  PhoneTakenError,
  UsernameTakenError,
  type LocalLoginResult,
} from "@lib/shared/identity/index.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import { extractLoginToken } from "@lib/shared/session/login-token.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { LoginByCodeDto } from "./dto/login-by-code.dto.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { MigrationBindDto } from "./dto/migration-bind.dto.js";
import type { MigrationVerifyDto } from "./dto/migration-verify.dto.js";
import type { OperationRecoveryDto } from "./dto/operation-recovery.dto.js";
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
  const failure = projectPhoneCodeError(error);
  if (!failure) return null;
  return new NewApiError(failure.message, failure.status, failure.errorCode);
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
  { scope: "send_code_phone_minute", limit: 1, windowMs: 60_000 },
  { scope: "send_code_phone_day", limit: 10, windowMs: DAY_MS },
] as const;

const SMS_CODE_RATE_LIMIT = RateLimit({
  buckets: [
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
    private readonly operations: AuthOperationService,
    private readonly phoneActions: PhoneActionService,
    private readonly captcha: CaptchaService,
  ) {}

  private get sms(): SmsProvider {
    if (!this.smsInstance) this.smsInstance = resolveSmsProvider();
    return this.smsInstance;
  }

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
    const phone = typeof phoneRaw === "string" ? phoneRaw.trim() : "";
    const purpose =
      purposeRaw === undefined || purposeRaw === "" || purposeRaw === null
        ? LEGACY_VERIFICATION_PURPOSE
        : purposeRaw;
    if (!isValidPhone(phone)) {
      return fail(FAILURE_CODE, "手机号格式不正确");
    }
    if (purpose !== LEGACY_VERIFICATION_PURPOSE && !isVerificationPurpose(purpose)) {
      return fail(FAILURE_CODE, "验证码用途不正确", null, ACCOUNT_ERROR_INVALID_PURPOSE);
    }
    return ok(await this.captcha.issue(phone, purpose));
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
      captcha_x?: unknown;
      request_id?: unknown;
    },
    @Headers("x-forwarded-for") forwardedFor?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const purpose =
      body?.purpose === undefined || body?.purpose === null || body?.purpose === ""
        ? LEGACY_VERIFICATION_PURPOSE
        : body.purpose;
    if (!isValidPhone(phone)) {
      return fail(FAILURE_CODE, "手机号格式不正确");
    }
    if (purpose !== LEGACY_VERIFICATION_PURPOSE && !isVerificationPurpose(purpose)) {
      return fail(FAILURE_CODE, "验证码用途不正确", null, ACCOUNT_ERROR_INVALID_PURPOSE);
    }
    const requestId =
      typeof body?.request_id === "string" && body.request_id.trim()
        ? body.request_id.trim()
        : undefined;
    const started = await this.operations.begin({
      type: "sms",
      requestId,
      phone,
    });
    if (started.duplicate) {
      if (started.operation.status === "pending") {
        throw new NewApiError(
          "正在确认操作结果，请稍候",
          409,
          ACCOUNT_ERROR_OPERATION_PENDING,
        );
      }
      if (started.operation.status === "succeeded") {
        return ok({ operation_id: started.operation.id });
      }
    }

    const captchaId =
      typeof body?.captcha_id === "string" ? body.captcha_id.trim() : "";
    const captchaX =
      typeof body?.captcha_x === "number"
        ? body.captcha_x
        : typeof body?.captcha_x === "string"
          ? Number(body.captcha_x)
          : Number.NaN;
    if (!captchaId) {
      await this.operations.fail(started.operation.id, ACCOUNT_ERROR_CAPTCHA_REQUIRED);
      throw new NewApiError("请先完成拼图验证", 400, ACCOUNT_ERROR_CAPTCHA_REQUIRED);
    }
    const verdict = await this.captcha.verify({
      id: captchaId,
      x: captchaX,
      phone,
      purpose,
    });
    if (verdict === "expired") {
      await this.operations.fail(started.operation.id, ACCOUNT_ERROR_CAPTCHA_EXPIRED);
      throw new NewApiError(
        "验证已超时，请换一张后重试",
        400,
        ACCOUNT_ERROR_CAPTCHA_EXPIRED,
      );
    }
    if (verdict === "invalid") {
      await this.operations.fail(started.operation.id, ACCOUNT_ERROR_CAPTCHA_INVALID);
      throw new NewApiError(
        "拼图未对准，已换新图，请重新拖动",
        400,
        ACCOUNT_ERROR_CAPTCHA_INVALID,
      );
    }

    for (const bucket of SMS_PHONE_BUCKETS) {
      const hit = await this.limiter.take({
        scope: bucket.scope,
        key: phone,
        limit: bucket.limit,
        windowMs: bucket.windowMs,
      });
      if (!hit.allowed) {
        await this.operations.fail(started.operation.id, "rate_limited");
        res?.setHeader("Retry-After", String(hit.retryAfter ?? 1));
        throw new NewApiError("操作过于频繁，请稍后再试", 429, RATE_LIMITED);
      }
    }

    const result = await handleSendCode(
      { phone, purpose, ip },
      { db: createAuthRepo(this.prisma.client), sms: this.sms },
    );
    if (result.code === 200) {
      await this.operations.succeed(started.operation.id, {});
      return ok({ operation_id: started.operation.id });
    }
    await this.operations.fail(started.operation.id, "sms_send_failed");
    return result;
  }

  private async beginOperation(input: {
    type: AuthOperationType;
    userId?: number | null;
    requestId?: string | undefined;
    phone?: string | undefined;
  }) {
    const started = await this.operations.begin(input);
    if (started.duplicate && started.operation.status === "pending") {
      throw new NewApiError(
        "正在确认操作结果，请稍候",
        409,
        ACCOUNT_ERROR_OPERATION_PENDING,
      );
    }
    return started;
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
    const requestId =
      typeof body.request_id === "string" && body.request_id.trim()
        ? body.request_id.trim()
        : undefined;
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

    const started = await this.beginOperation({
      type: "login",
      requestId,
      phone,
    });
    if (started.duplicate && started.operation.status === "succeeded") {
      const storedUserId = started.operation.result?.user_id;
      if (typeof storedUserId === "number") {
        try {
          const result = await this.identity.getLoginResult(storedUserId);
          const sessionToken = await this.establishSession(result, clientId);
          res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
          return ok({
            ...loginData(result, false, sessionToken),
            operation_id: started.operation.id,
          });
        } catch {
          throw new NewApiError(
            "登录已过期，请重新验证",
            401,
            ACCOUNT_ERROR_SESSION_EXPIRED,
          );
        }
      }
    }

    try {
      const { result, isNewUser } = await this.identity.loginWithPhoneCode({ phone, code });
      const sessionToken = await this.establishSession(result, clientId);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      await this.operations.succeed(started.operation.id, {
        user_id: result.userId,
        is_new_user: isNewUser,
      });
      await this.recordLogin({
        userId: String(result.userId),
        username: result.username,
        ip,
        userAgent,
        success: true,
      });
      return ok({
        ...loginData(result, isNewUser, sessionToken),
        operation_id: started.operation.id,
      });
    } catch (error) {
      const failure = phoneCodeFailure(error);
      if (failure) {
        await this.operations.fail(started.operation.id, String(failure.code ?? "code_error"));
        await this.recordLogin({
          username: phone,
          ip,
          userAgent,
          success: false,
          reason: failure.message,
        });
        throw failure;
      }
      if (error instanceof AccountDisabledError) {
        await this.operations.fail(started.operation.id, ACCOUNT_ERROR_ACCOUNT_DISABLED);
        throw new NewApiError(error.message, 403, ACCOUNT_ERROR_ACCOUNT_DISABLED);
      }
      if (error instanceof AccountDeletedError) {
        await this.operations.fail(started.operation.id, ACCOUNT_ERROR_ACCOUNT_DELETED);
        throw new NewApiError(error.message, 403, ACCOUNT_ERROR_ACCOUNT_DELETED);
      }
      await this.operations.fail(started.operation.id, "unknown");
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
    const uniformMessage = "账号或密码不正确，或当前账号不可迁移";

    if (!username || !password) {
      throw new NewApiError(uniformMessage, 401, "invalid_credentials");
    }
    if (await this.limiter.isBlocked(MIGRATION_LOCK_SCOPE, username)) {
      throw new NewApiError(
        "尝试次数过多，账号已锁定，请稍后再试",
        429,
        ACCOUNT_LOCKED,
      );
    }

    try {
      const { userId } = await this.identity.verifyMigrationCandidate({
        username,
        password,
      });
      await this.limiter.reset(MIGRATION_FAILURE_SCOPE, username);
      await this.limiter.reset(MIGRATION_LOCK_SCOPE, username);
      await this.recordLogin({
        userId,
        username,
        ip,
        userAgent,
        success: true,
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
        await this.recordLogin({
          username,
          ip,
          userAgent,
          success: false,
          reason: "迁移密码错误",
        });
        throw new NewApiError(uniformMessage, 401, "invalid_credentials");
      }
      if (error instanceof MigrationIneligibleError) {
        await this.recordLogin({
          username,
          ip,
          userAgent,
          success: false,
          reason: "迁移资格不符",
        });
        throw new NewApiError(
          uniformMessage,
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
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const clientId = normalizeClientId(body.client_id);
    const requestId =
      typeof body.request_id === "string" && body.request_id.trim()
        ? body.request_id.trim()
        : undefined;
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

    if (!token) {
      throw new NewApiError(
        "原账号验证已过期，请重新验证",
        400,
        ACCOUNT_ERROR_MIGRATION_TOKEN_EXPIRED,
      );
    }
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

    const started = await this.beginOperation({
      type: "migration",
      requestId,
      phone,
    });
    if (started.duplicate && started.operation.status === "succeeded") {
      const storedUserId = started.operation.result?.user_id;
      if (typeof storedUserId === "number") {
        const result = await this.identity.getLoginResult(storedUserId);
        const sessionToken = await this.establishSession(result, clientId);
        await this.sessions.revokeAllForUser(storedUserId, sessionToken);
        res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
        return ok({
          ...loginData(result, false, sessionToken),
          operation_id: started.operation.id,
        });
      }
    }

    const action = await this.phoneActions.resolve("migration", token);
    if (!action) {
      await this.operations.fail(
        started.operation.id,
        ACCOUNT_ERROR_MIGRATION_TOKEN_EXPIRED,
      );
      throw new NewApiError(
        "原账号验证已过期，请重新验证",
        400,
        ACCOUNT_ERROR_MIGRATION_TOKEN_EXPIRED,
      );
    }

    let user: { id: string; username: string };
    try {
      user = await this.identity.commitMigrationBind(action.userId, {
        phone,
        code,
      });
    } catch (error) {
      const failure = phoneCodeFailure(error);
      if (failure) {
        await this.operations.fail(
          started.operation.id,
          String(failure.code ?? "code_error"),
        );
        await this.recordLogin({
          username: phone,
          ip,
          userAgent,
          success: false,
          reason: `迁移补绑失败：${failure.message}`,
        });
        throw failure;
      }
      if (error instanceof PhoneTakenError) {
        await this.operations.fail(started.operation.id, ACCOUNT_ERROR_PHONE_TAKEN);
        await this.recordLogin({
          username: phone,
          ip,
          userAgent,
          success: false,
          reason: "迁移补绑失败：号码已占用",
        });
        return fail(
          FAILURE_CODE,
          error.message,
          null,
          ACCOUNT_ERROR_PHONE_TAKEN,
        );
      }
      if (error instanceof MigrationIneligibleError) {
        await this.operations.fail(
          started.operation.id,
          ACCOUNT_ERROR_MIGRATION_INELIGIBLE,
        );
        await this.recordLogin({
          username: phone,
          ip,
          userAgent,
          success: false,
          reason: "迁移补绑失败：资格不符",
        });
        throw new NewApiError(
          error.message,
          400,
          ACCOUNT_ERROR_MIGRATION_INELIGIBLE,
        );
      }
      await this.operations.fail(started.operation.id, "unknown");
      throw toAuthError(error);
    }

    await this.operations.succeed(started.operation.id, { user_id: user.id });
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
      const sessionToken = await this.establishSession(result, clientId);
      await this.sessions.revokeAllForUser(Number(user.id), sessionToken);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      await this.recordLogin({
        userId: String(user.id),
        username: user.username,
        ip,
        userAgent,
        success: true,
      });
      return ok({
        ...loginData(result, false, sessionToken),
        operation_id: started.operation.id,
      });
    } catch (error) {
      logger.error(
        `迁移补绑成功但登录失败（userId=${user.id}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new NewApiError(
        "手机号已绑定，请重新登录",
        500,
        ACCOUNT_ERROR_BIND_SUCCEEDED_LOGIN_FAILED,
      );
    }
  }

  @Public()
  @Get("operations/:id")
  async getOperation(
    @Param("id") id: string,
    @Query("query_token") queryToken: string | undefined,
    @Req() req: Request,
  ) {
    const operation = await this.operations.get(id);
    if (!operation) {
      throw new NewApiError(
        "暂未找到本次操作记录，请重试核实",
        404,
        ACCOUNT_ERROR_OPERATION_NOT_FOUND,
      );
    }

    let allowed = false;
    const loginToken = extractLoginToken(req);
    if (loginToken) {
      const session = await this.sessions.resolveSession(loginToken).catch(() => null);
      allowed =
        session != null &&
        operation.userId != null &&
        session.userId === operation.userId;
    }
    let queryRejected = false;
    if (!allowed && queryToken) {
      allowed = await this.operations.verifyQueryToken(queryToken, id);
      queryRejected = !allowed;
    }
    if (!allowed) {
      if (queryRejected) {
        throw new NewApiError(
          "查询授权已过期，请验证身份后继续确认原操作",
          403,
          ACCOUNT_ERROR_QUERY_TOKEN_EXPIRED,
        );
      }
      throw new NewApiError(
        "无权查询该操作记录",
        403,
        ACCOUNT_ERROR_OPERATION_FORBIDDEN,
      );
    }

    const storedPhone =
      operation.result && typeof operation.result.phone === "string"
        ? operation.result.phone
        : null;
    return ok({
      id: operation.id,
      type: operation.type,
      status: operation.status satisfies AuthOperationStatus,
      result: storedPhone
        ? { ...operation.result, phone: maskPhone(storedPhone) }
        : operation.result,
      error_code: operation.errorCode,
      phone_masked: maskPhone(operation.phone),
      created_at: operation.createdAt,
      updated_at: operation.updatedAt,
    });
  }

  @Public()
  @Post("operations/:id/recovery")
  async recoverOperationQuery(
    @Param("id") id: string,
    @Body() body: OperationRecoveryDto,
  ) {
    const operation = await this.operations.get(id);
    if (!operation) {
      throw new NewApiError(
        "暂未找到本次操作记录，请重试核实",
        404,
        ACCOUNT_ERROR_OPERATION_NOT_FOUND,
      );
    }
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!operation.phone) {
      throw new NewApiError(
        "无权查询该操作记录",
        403,
        ACCOUNT_ERROR_OPERATION_FORBIDDEN,
      );
    }
    if (!code) {
      return fail(FAILURE_CODE, "验证码已失效，请重新获取");
    }
    try {
      await this.identity.consumeRecoveryCode(operation.phone, code);
    } catch (error) {
      const failure = phoneCodeFailure(error);
      if (failure) throw failure;
      throw toAuthError(error);
    }
    const queryToken = await this.operations.issueQueryToken(
      operation.id,
      operation.userId ?? 0,
    );
    return ok({ query_token: queryToken, expires_in: 7 * 24 * 60 * 60 });
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

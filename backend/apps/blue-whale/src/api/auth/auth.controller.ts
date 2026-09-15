import { Body, Controller, Get, Headers, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  NewApiError,
  type NewApiLoginResult,
} from "@lib/core";
import { ACCOUNT_LOCKED, FAILURE_CODE, ok } from "@lib/contracts";
import { createAuthRepo, createUserInfoRepo } from "@lib/shared/persistence/index.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AccountService } from "@lib/shared/account/account.service.js";
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
import { SessionService } from "@lib/shared/session/session.service.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { RegisterDto } from "./dto/register.dto.js";

function loginData(result: NewApiLoginResult, isNewUser: boolean) {
  return {
    // 登录态走 HttpOnly 会话 cookie，响应不下发任何令牌给 JS。
    user_id: result.userId,
    username: result.username,
    email: result.email ?? null,
    phone: "",
    is_new_user: isNewUser,
    has_password: true,
  };
}

/** IKDR4J：IP 20 次/分拦单机批量撞库；账号 5 次/分拦多 IP 分散撞单账号。 */
const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

function authRateLimit(endpoint: "login" | "register") {
  return RateLimit({
    buckets: [
      {
        scope: `${endpoint}_ip`,
        key: "ip" as const,
        limit: 20,
        windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      },
      {
        scope: `${endpoint}_account`,
        key: "account" as const,
        limit: 5,
        windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      },
    ],
  });
}

@Controller("auth")
export class AuthController {
  private smsInstance?: SmsProvider;

  constructor(
    private readonly account: AccountService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    private readonly loginFailures: LoginFailureTracker,
  ) {}

  private get sms(): SmsProvider {
    if (!this.smsInstance) this.smsInstance = resolveSmsProvider();
    return this.smsInstance;
  }

  @Public()
  @Post("send-code")
  async sendCode(
    @Body() body: { phone?: unknown },
    @Headers("x-forwarded-for") forwardedFor?: string,
  ) {
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
    return handleSendCode(
      { phone: body?.phone, ip },
      { db: createAuthRepo(this.prisma.client), sms: this.sms },
    );
  }

  /** 会话签发：new-api sk- 明文入 Redis（修正四：去密），浏览器只拿 HttpOnly 会话 cookie。 */
  private async establishSession(result: NewApiLoginResult): Promise<string> {
    if (result.userId == null || !result.username) {
      throw new NewApiError("账户服务响应异常", 502, "invalid_identity");
    }
    try {
      const token = await this.sessions.createSession({
        userId: result.userId,
        username: result.username,
        role: result.role,
        status: result.status,
        email: result.email ?? null,
        sk: result.token,
      });
      // IKF YHJ：登录成功即刷新网关侧执行凭证，供 worker-java 的素材状态定时兜底按 userId 取用
      // （网关无服务级查询入口，素材接口只能以用户身份调用，见 ADR-0087）。
      // 失败只告警不阻断登录：缺行/旧行只会让该用户的素材状态停止跟进，登录与生成都不受影响。
      try {
        await createUserInfoRepo(this.prisma.client).upsertCredential(
          String(result.userId),
          result.token,
        );
      } catch (error) {
        logger.error(
          `auth establishSession: upsert user_info failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return token;
    } catch (error) {
      // 修正四：createSession 不再 seal sk（明文存 Redis），无 GenerationCredentialConfigurationError。
      throw error;
    }
  }

  @Public()
  @Post("login")
  @authRateLimit("login")
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return { code: FAILURE_CODE, msg: "用户名和密码不能为空", data: null };
    }
    if (await this.limiter.isBlocked(LOGIN_LOCK_SCOPE, username)) {
      // 失败锁定期内（IKDR4J）：直接 429，跳过对 new-api 的无效调用。
      throw new NewApiError(
        "尝试次数过多，账号已锁定，请稍后再试",
        429,
        ACCOUNT_LOCKED,
      );
    }
    try {
      const result = await this.account.login({ username, password });
      // 凭证已被上游接受（IKDR4J）：清零失败计数与锁定，会话签发失败不回退。
      await this.loginFailures.clear(username);
      const sessionToken = await this.establishSession(result);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      return ok(loginData(result, false));
    } catch (error) {
      const projected = projectAccountBusinessFailure(error, 401);
      if (projected) {
        // 仅账密错误计数（IKDR4J）：上游 5xx/超时是服务问题，不是撞库信号。
        await this.loginFailures.recordFailure(username);
        throw projected;
      }
      throw toAuthError(error);
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
      const result = await this.account.register({
        username,
        password,
        ...(typeof body.email === "string" && body.email.trim()
          ? { email: body.email.trim() }
          : {}),
        ...(typeof body.verification_code === "string"
          ? { verificationCode: body.verification_code }
          : {}),
      });
      const sessionToken = await this.establishSession(result);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      return ok(loginData(result, true));
    } catch (error) {
      // 上游业务失败（用户名重复/密码不合规）HTTP 200+success:false，透传原文，
      // 避免 toAuthError 未命中映射吞成 502「账户服务响应异常」。HTTP 用 400（非 200），
      // 否则前端 code===200 会当成功读到 null data。
      const projected = projectAccountBusinessFailure(error, FAILURE_CODE);
      if (projected) throw projected;
      throw toAuthError(error);
    }
  }

  /** 登出：清 HttpOnly 会话 cookie + Redis 吊销（上游 sk- 不动，登出与轮换分离，ADR-0062 #10/#19）。 */
  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) await this.sessions.revoke(token);
    // 清 cookie 时必须去掉 maxAge：Express 会带上 maxAge，RFC 6265 下 Max-Age 优先于 Expires，
    // 空 cookie 会残留到 maxAge 过期才真正删除
    res.clearCookie(SESSION_COOKIE_NAME, {
      ...sessionCookieOptions(),
      maxAge: undefined,
    });
    return ok();
  }

  @Public()
  @Get("capabilities")
  async capabilities() {
    try {
      const capabilities = await this.account.getAccountCapabilities();
      return ok({
        password_login: capabilities.passwordLogin,
        password_register: capabilities.passwordRegister,
        email_verification: capabilities.emailVerification,
      });
    } catch (error) {
      throw toAuthError(error);
    }
  }
}

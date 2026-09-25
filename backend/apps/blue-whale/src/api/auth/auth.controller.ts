import { Body, Controller, Get, Headers, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { NewApiError } from "@lib/core";
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
import {
  IdentityService,
  InvalidCredentialsError,
  type LocalLoginResult,
} from "@lib/shared/identity/identity.service.js";
import {
  resolveUpstreamCredential,
  UpstreamCredentialMissingError,
} from "@lib/shared/account/upstream-credential.js";
import { UsernameTakenError } from "@lib/shared/persistence/identity-user-repo.js";
import { PasswordPolicyError } from "@lib/shared/identity/password.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { RegisterDto } from "./dto/register.dto.js";

function loginData(result: LocalLoginResult, isNewUser: boolean) {
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

/**
 * 把登录/注册链路上的异常翻成 HTTP 错误。
 *
 * <p>⚠️ **配置类错误必须原样透传**：`toAuthError` 会把所有 503 压成「账户服务暂不可用」，
 * 而那句通用文案对「上游凭证没配」毫无帮助——运维看到它只会去查上游健康，
 * 而真正原因是少了一个环境变量。这类错误当初特地把变量名写进 message，
 * 就是为了在这一刻说出来，不能被兜底文案吃掉。
 */
function toAuthFailure(error: unknown): NewApiError {
  if (error instanceof UpstreamCredentialMissingError) return error;
  return toAuthError(error);
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
    private readonly identity: IdentityService,
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

  /**
   * 会话签发。
   *
   * <h2>这里以前存的是用户的 sk-，现在存的是项目级统一 key</h2>
   *
   * 口令校验已经切到我们自己的库（{@link IdentityService.login}），登录结果里
   * 不再有上游凭证——new-api 那边已经没有这个用户了，自然也发不出他的 key。
   * 下游仍然要一把 key 才能打 new-api，所以改用部署配置里的统一 key。
   *
   * <p>⚠️ **过渡期的已知后果**：new-api 的 per-user 数据（消费流水、充值记录）
   * 从此返回的是**项目维度**的数。这不是 bug，是「上游不再认识我们的用户」的必然结果，
   * 也正是必须建自己计费体系的原因。计费域接过来之后，这些接口改走 billing。
   */
  private async establishSession(result: LocalLoginResult): Promise<string> {
    if (result.userId == null || !result.username) {
      throw new NewApiError("账户服务响应异常", 502, "invalid_identity");
    }
    // 缺 key 时这里抛 503（UpstreamCredentialMissingError）：让问题在登录时就暴露，
    // 而不是等到用户点了生成、拿到一个来路不明的 401。
    const upstreamKey = resolveUpstreamCredential();
    const token = await this.sessions.createSession({
      userId: result.userId,
      username: result.username,
      role: result.role,
      status: result.status,
      email: result.email ?? null,
      sk: upstreamKey,
    });
    // IKF YHJ：登录成功即刷新网关侧执行凭证，供 worker-java 的素材状态定时兜底按 userId 取用
    // （网关无服务级查询入口，素材接口只能以用户身份调用，见 ADR-0087）。
    // 失败只告警不阻断登录：缺行/旧行只会让该用户的素材状态停止跟进，登录与生成都不受影响。
    //
    // ⚠️ 统一 key 之后这里是在**给每个用户写同一把 key**。看着冗余，但它是 worker-java
    //    那条按 userId 取凭证的链路目前唯一的入口；等 worker 也用服务身份取 key 时一并去掉。
    try {
      await createUserInfoRepo(this.prisma.client).upsertCredential(
        String(result.userId),
        upstreamKey,
      );
    } catch (error) {
      logger.error(
        `auth establishSession: upsert user_info failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
    // 只取第一跳：x-forwarded-for 可被客户端伪造，末尾几跳才是可信代理加上的。
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

    if (!username || !password) {
      // 空凭据也算一次尝试——它同样可能来自撞库脚本，不留痕就看不见这条路径
      await this.recordLogin({ username, ip, userAgent, success: false, reason: "凭据为空" });
      return { code: FAILURE_CODE, msg: "用户名和密码不能为空", data: null };
    }
    if (await this.limiter.isBlocked(LOGIN_LOCK_SCOPE, username)) {
      // 失败锁定期内（IKDR4J）：直接 429，跳过对 new-api 的无效调用。
      await this.recordLogin({ username, ip, userAgent, success: false, reason: "账号锁定" });
      throw new NewApiError(
        "尝试次数过多，账号已锁定，请稍后再试",
        429,
        ACCOUNT_LOCKED,
      );
    }
    try {
      // ★ 口令校验在**我们自己的库**（identity_users.password，bcrypt）。
      //   登录结果里没有上游凭证——new-api 已经不是我们的用户体系了。
      const result = await this.identity.login({ username, password });
      // 凭证已被接受（IKDR4J）：清零失败计数与锁定，会话签发失败不回退。
      await this.loginFailures.clear(username);
      const sessionToken = await this.establishSession(result);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      await this.recordLogin({
        userId: String(result.userId),
        username,
        ip,
        userAgent,
        success: true,
      });
      return ok(loginData(result, false));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        // 与「上游业务失败」分开：这里根本没有上游。计数与留痕口径与旧路径一致，
        // 因为对撞库者来说两条路径没有区别，防护也不该有区别。
        await this.loginFailures.recordFailure(username);
        await this.recordLogin({ username, ip, userAgent, success: false, reason: "账密错误" });
        // 文案与 InvalidCredentialsError 一致：不区分「用户不存在」和「密码错」
        throw new NewApiError(error.message, 401, "invalid_credentials");
      }
      const projected = projectAccountBusinessFailure(error, 401);
      if (projected) {
        // 仅账密错误计数（IKDR4J）：上游 5xx/超时是服务问题，不是撞库信号。
        await this.loginFailures.recordFailure(username);
        await this.recordLogin({ username, ip, userAgent, success: false, reason: "账密错误" });
        throw projected;
      }
      throw toAuthFailure(error);
    }
  }

  /**
   * 记一条登录日志。
   *
   * <p>⚠️ **吞掉异常只记 error**：日志是旁路，写不进去不该让用户登不上。
   * 但也不能静默——一个坏掉的日志表若表现为「一切正常」，
   * 那它在真正被需要的那天（查撞库、查「我明明登录成功了」）同样是空的。
   */
  private async recordLogin(entry: {
    // ⚠️ 可选属性显式带 `| undefined`：本仓开了 `exactOptionalPropertyTypes`，
    //    不加的话调用方传一个可能为 undefined 的 @Headers 值就编译不过。
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
      // ★ 注册也落我们自己的库。只切登录不切注册的话，新用户注册进 new-api、
      //   而登录查 identity_users——**注册完立刻登不上**。
      const result = await this.identity.register({
        username,
        password,
        ...(typeof body.email === "string" && body.email.trim()
          ? { email: body.email.trim() }
          : {}),
      });
      const sessionToken = await this.establishSession(result);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      return ok(loginData(result, true));
    } catch (error) {
      // 用户名占用 / 口令超长：都是用户能自己改的输入问题，走 HTTP 400 + 原文案。
      // 用 400 而非 200，否则前端 code===200 会把 data:null 当成功读。
      if (error instanceof UsernameTakenError || error instanceof PasswordPolicyError) {
        throw new NewApiError(error.message, 400, FAILURE_CODE);
      }
      throw toAuthFailure(error);
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

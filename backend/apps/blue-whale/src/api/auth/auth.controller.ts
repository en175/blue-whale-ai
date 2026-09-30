import { Body, Controller, Get, Headers, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { InvalidVerificationCodeError, isValidPhone, NewApiError } from "@lib/core";
import { ACCOUNT_LOCKED, FAILURE_CODE, ok } from "@lib/contracts";
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
    // IKJAZL：登录凭证是签名 JWT，**随响应体下发**，由前端自己保管并在后续请求里
    // 以 `Authorization: Bearer` 带回。它同时还会写一份 HttpOnly cookie ——
    // 那是迁移期的兼容通道，让还没升级的客户端继续可用，不是给 JS 读的。
    token,
    user_id: result.userId,
    username: result.username,
    email: result.email ?? null,
    // 空串而非 null：前端 `LoginData.phone` 声明为 `string`，注释写着「手机号（可为空串）」。
    // 存量用户（从 new-api 迁来的）一个手机号都没有，这里对他们就是空串。
    phone: result.phone ?? "",
    is_new_user: isNewUser,
    // 手机号验证码建出来的账号没有口令——前端据此决定个人设置里是「设置密码」还是「修改密码」。
    has_password: result.hasPassword,
    // IKJABH：管理员重置过密码，前端登录后必须**强制**弹改密、且不给关闭入口。
    // 带上它而不是只靠 /api/me：`is_new_user` 这些也是一次登录一个快照，
    // 前端在登录那一刻就要决定跳不跳这个流程，不该多等一次往返。
    must_change_password: result.mustChangePassword,
  };
}

/** IKDR4J：IP 20 次/分拦单机批量撞库；账号 5 次/分拦多 IP 分散撞单账号。 */
const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * 按「IP + 一个请求体里的标识」配两个桶。
 *
 * <p>⚠️ `accountKey` 必须与路由**实际读取的字段名**对得上：`account` 读 `body.username`，
 * `phone` 读 `body.phone`。对不上时 `extractKey` 返回 null，那个桶会**静默跳过**
 * ——配了、看着有防护，实际一条都没拦。
 */
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

/**
 * 短信频控（IKJA4Q）—— 短信**按条计费**，这是成本闸，不是防刷的锦上添花。
 *
 * <p>四个桶缺一不可：只按 IP 挡不住换 IP 刷同一个号；只按号码挡不住换号刷爆账单。
 * 日上限（号 10 条 / IP 50 条）就是真正兜住账单的那一条。
 */
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
   * 会话签发：**只记身份，不记上游凭证**。
   *
   * <h2>这里存过什么</h2>
   *
   * 最早存用户自己的 `sk-`（一用户一把）。new-api 改成项目级统一 key 之后，这里变成
   * **给每个用户存同一把 key**：既是一份 7 天不过期的密钥副本，也是「管理端改了 key
   * 对已登录用户不生效」的来源——会话是登录那一刻的快照。现在会话不再带凭证，
   * 上游 key 由 AuthGuard 按**当前配置**回注（`SystemSettingsService.requireUpstreamKey()`），
   * 轮换对全部在线会话立即生效。
   *
   * <p>⚠️ **登录不再依赖上游配置**。以前缺 key 时这里抛 503，于是「还没配 key 的部署
   * 谁也登不进去」——**包括要进去配它的管理员**，成死锁。凭证缺失的 fail-closed 落在
   * 真正打上游的地方（AuthGuard 不注入 → 下游 `parseBearerToken` 拿到 null 即 401，
   * 直接调用点抛 `UpstreamCredentialMissingError`），不在「进门」这一步。
   *
   * <p>⚠️ **过渡期的已知后果**：new-api 的 per-user 数据（消费流水、充值记录）
   * 返回的是**项目维度**的数。这不是 bug，是「上游不再认识我们的用户」的必然结果，
   * 也正是必须建自己计费体系的原因。计费域接过来之后，这些接口改走 billing。
   *
   * <p>IKJAZL：**签 JWT → 存进会话存储**。两道校验是刻意分工——**JWT 自证**
   * （没被篡改、没过期），**Redis 记注销**（登出、改密踢设备、冻结）。只剩 JWT 的话，
   * 登出之后它还能一路用到过期；只剩 Redis 的话，每个请求都得查一次库。
   */
  private async establishSession(result: LocalLoginResult): Promise<string> {
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
      // ★ 口令校验在**我们自己的库**（bw_users.password，bcrypt）。
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
      return ok(loginData(result, false, sessionToken));
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
      throw toAuthError(error);
    }
  }

  /**
   * 手机号验证码登录（IKJA4Q）—— 没绑过该手机号的账号**当场建一个**。
   *
   * <p>⚠️ **不要为了「复用现成代码」改回 `loginWithCode`**：那支用例最后一步签的是
   * **JWT**（`libs/core/auth/login-with-code.ts`），而全站认证走的是 Redis 会话 +
   * HttpOnly cookie `bw_session`。接错了会签出一个没人认的令牌，
   * **用户点完登录立刻 401**——而且报错落在下一次请求上，排查时很难指向这里。
   * 所以和口令登录一样走 {@link establishSession}。
   */
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
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

    if (!isValidPhone(phone) || !code) {
      return { code: FAILURE_CODE, msg: "手机号和验证码不能为空", data: null };
    }

    try {
      const { result, isNewUser } = await this.identity.loginWithPhoneCode({ phone, code });
      const sessionToken = await this.establishSession(result);
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
      if (error instanceof InvalidVerificationCodeError) {
        // 留痕口径与账密失败一致：对撞码的人来说两条路径没有区别，防护也不该有区别。
        // 失败时还不知道是谁，拿手机号占 username 这一列——登录日志只有这一个标识位。
        await this.recordLogin({
          username: phone,
          ip,
          userAgent,
          success: false,
          reason: "验证码错误",
        });
        throw new NewApiError(error.message, 401, "invalid_verification_code");
      }
      throw toAuthError(error);
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
      //   而登录查 bw_users——**注册完立刻登不上**。
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
      // 用户名占用 / 口令超长：都是用户能自己改的输入问题，走 HTTP 400 + 原文案。
      // 用 400 而非 200，否则前端 code===200 会把 data:null 当成功读。
      if (error instanceof UsernameTakenError || error instanceof PasswordPolicyError) {
        throw new NewApiError(error.message, 400, FAILURE_CODE);
      }
      throw toAuthError(error);
    }
  }

  /**
   * 登出（IKJAZL）：吊销 Redis 里的会话标记——**这是唯一能立即作废一个已签发 JWT 的手段**，
   * 因为 JWT 在过期之前一直自证有效。（上游 sk- 不动：登出与凭证轮换是两件事，
   * ADR-0062 #10/#19。）
   *
   * <p>令牌可能来自请求头（新）或 cookie（迁移期老客户端），**两处都要取**：只认一处的
   * 话，另一处登出会「看起来成功、其实会话还活着」。
   */
  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = extractLoginToken(req);
    if (token) await this.sessions.revoke(token);
    // 兼容期仍清 cookie：老的浏览器手里那份在这里一并作废，否则它能一路活到 7 天 TTL。
    // 清 cookie 时必须去掉 maxAge：Express 会带上 maxAge，RFC 6265 下 Max-Age 优先于
    // Expires，空 cookie 会残留到 maxAge 过期才真正删除。
    res.clearCookie(SESSION_COOKIE_NAME, {
      ...sessionCookieOptions(),
      maxAge: undefined,
    });
    return ok();
  }

  @Public()
  @Get("capabilities")
  async capabilities() {
    // ★ 本地常量，不再探测 new-api 的 /api/status 开关。
    //   口令登录与口令注册现在都由我们自己的库承载（bw_users + bcrypt），
    //   能力不该再取决于上游配置：上游挂了也不该让登录入口从页面上消失。
    //   email_verification（邮箱验证码注册）我们尚未实现，恒为 false。
    return ok({
      password_login: true,
      password_register: true,
      email_verification: false,
    });
  }
}

import { Body, Controller, Get, Headers, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  GenerationCredentialConfigurationError,
  NewApiError,
  type NewApiLoginResult,
} from "@blue-whale/core";
import { FAILURE_CODE, ok } from "@blue-whale/contracts";
import { createAuthRepo } from "@blue-whale/persistence";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { handleSendCode } from "@lib/shared/auth/handle-send-code.js";
import { resolveSmsProvider, type SmsProvider } from "@lib/shared/auth/sms.js";
import {
  projectAccountBusinessFailure,
  toAuthError,
} from "@lib/shared/errors/auth-error.js";
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

@Controller("auth")
export class AuthController {
  private smsInstance?: SmsProvider;

  constructor(
    private readonly account: AccountService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
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

  /** 会话签发：new-api sk- 密封入 Redis，浏览器只拿 HttpOnly 会话 cookie。 */
  private async establishSession(result: NewApiLoginResult): Promise<string> {
    if (result.userId == null || !result.username) {
      throw new NewApiError("账户服务响应异常", 502, "invalid_identity");
    }
    try {
      return await this.sessions.createSession({
        userId: result.userId,
        username: result.username,
        role: result.role,
        status: result.status,
        email: result.email ?? null,
        sk: result.token,
      });
    } catch (error) {
      if (error instanceof GenerationCredentialConfigurationError) {
        throw new NewApiError(
          "会话服务暂不可用",
          503,
          "session_service_unavailable",
        );
      }
      throw error;
    }
  }

  @Public()
  @Post("login")
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return { code: FAILURE_CODE, msg: "用户名和密码不能为空", data: null };
    }
    try {
      const result = await this.account.login({ username, password });
      const sessionToken = await this.establishSession(result);
      res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
      return ok(loginData(result, false));
    } catch (error) {
      const projected = projectAccountBusinessFailure(error, 401);
      if (projected) throw projected;
      throw toAuthError(error);
    }
  }

  @Public()
  @Post("register")
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

import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { NewApiError, type NewApiLoginResult } from "@blue-whale/core";
import { FAILURE_CODE, ok } from "@blue-whale/contracts";
import { createAuthRepo } from "@blue-whale/persistence";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { handleSendCode } from "@lib/shared/auth/handle-send-code.js";
import { resolveSmsProvider, type SmsProvider } from "@lib/shared/auth/sms.js";
import { toAuthError } from "@lib/shared/errors/auth-error.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { RegisterDto } from "./dto/register.dto.js";

function loginData(result: NewApiLoginResult, isNewUser: boolean) {
  return {
    access_token: result.token,
    refresh_token: "",
    expires_in: 0,
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

  @Public()
  @Post("login")
  async login(@Body() body: LoginDto) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return { code: FAILURE_CODE, msg: "用户名和密码不能为空", data: null };
    }
    try {
      const result = await this.account.login({ username, password });
      return ok(loginData(result, false));
    } catch (error) {
      if (error instanceof NewApiError && error.status === 200) {
        throw new NewApiError("登录凭证无效", 401, "invalid_credentials");
      }
      throw toAuthError(error);
    }
  }

  @Public()
  @Post("register")
  async register(@Body() body: RegisterDto) {
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
      return ok(loginData(result, true));
    } catch (error) {
      throw toAuthError(error);
    }
  }

  @Public()
  @Post("logout")
  logout() {
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

import { Body, Controller, Get, Post } from "@nestjs/common";
import { NewApiError, type NewApiLoginResult } from "@blue-whale/core";
import { FAILURE_CODE, ok } from "@blue-whale/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { toAuthError } from "@lib/shared/errors/auth-error.js";
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
  constructor(private readonly account: AccountService) {}

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

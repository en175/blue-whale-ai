import { Body, Controller, Get, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { isValidPhone, NewApiError } from "@lib/core";
import { createLogger } from "@lib/core/logging";
import {
  ACCOUNT_ERROR_CODE_ATTEMPTS_EXHAUSTED,
  ACCOUNT_ERROR_CODE_EXPIRED,
  ACCOUNT_ERROR_CODE_WRONG,
  ACCOUNT_ERROR_PHONE_TAKEN,
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  changePasswordRequestSchema,
  FAILURE_CODE,
  fail,
  ok,
} from "@lib/contracts";
import { projectAccountError } from "@lib/shared/account/change-password-error.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import {
  CodeAttemptsExhaustedError,
  CodeExpiredError,
  CodeWrongError,
  IdentityService,
  PhoneAlreadyBoundError,
  PhoneTakenError,
} from "@lib/shared/identity/index.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { BindPhoneDto } from "./dto/bind-phone.dto.js";

@Controller()
export class MeController {
  private readonly logger = createLogger("me");

  constructor(
    private readonly sessions: SessionService,
    private readonly identity: IdentityService,
  ) {}

  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser) {
    const flags = await this.identity.resolveAccountFlags(user.userId);
    return ok({
      id: Number(user.userId),
      user_id: Number(user.userId),
      username: user.username,
      nickname: flags?.nickname ?? user.username,
      email: user.email,
      phone: flags?.phone ?? "",
      has_password: flags?.hasPassword ?? false,
      must_change_password: flags?.mustChangePassword ?? false,
      is_admin: await this.identity.isAdmin(user.userId),
      tier: await this.identity.resolveTier(user.userId),
      roles: await this.identity.listRoleCodes(user.userId),
    });
  }

  @Post("me/phone")
  async bindPhone(
    @Body() body: BindPhoneDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const userId = user?.userId;
    if (userId == null) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!isValidPhone(phone) || !code) {
      return fail(FAILURE_CODE, "手机号和验证码不能为空");
    }
    try {
      await this.identity.bindPhone(userId, { phone, code });
    } catch (error) {
      if (error instanceof CodeWrongError) {
        return fail(
          FAILURE_CODE,
          `验证码错误，请重新输入（还可尝试${error.remaining}次）`,
          null,
          ACCOUNT_ERROR_CODE_WRONG,
        );
      }
      if (error instanceof CodeAttemptsExhaustedError) {
        return fail(
          FAILURE_CODE,
          error.message,
          null,
          ACCOUNT_ERROR_CODE_ATTEMPTS_EXHAUSTED,
        );
      }
      if (error instanceof CodeExpiredError) {
        return fail(FAILURE_CODE, error.message, null, ACCOUNT_ERROR_CODE_EXPIRED);
      }
      if (error instanceof PhoneTakenError) {
        return fail(FAILURE_CODE, error.message, null, ACCOUNT_ERROR_PHONE_TAKEN);
      }
      if (error instanceof PhoneAlreadyBoundError) {
        return fail(FAILURE_CODE, error.message);
      }
      throw error;
    }
    return ok();
  }

  @Put("me/password")
  async changePassword(
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = changePasswordRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new NewApiError("新密码不能为空", 400, "invalid_params");
    }
    const userId = user?.userId;
    if (userId == null) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    const currentToken = (req as Request & { loginToken?: string }).loginToken;
    let wasForced = false;
    try {
      wasForced = await this.identity.changePassword(userId, {
        oldPassword: parsed.data.original_password,
        newPassword: parsed.data.password,
      });
    } catch (error) {
      const projected = projectAccountError(error, "修改密码失败");
      if (projected.code === ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE) {
        this.logger.error(
          `changePassword 未归类错误: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return fail(projected.code, projected.message);
    }
    let revokedSessions = 0;
    try {
      revokedSessions = await this.sessions.revokeAllForUser(
        Number(userId),
        wasForced ? currentToken : undefined,
      );
    } catch (error) {
      this.logger.error(
        `changePassword user=${userId} session revoke failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (wasForced) {
        this.logger.error(
          `changePassword user=${userId} 强制改密会话枚举失败，已保留当前会话（其余会话待后续吊销）`,
        );
        return ok({ revokedSessions });
      }
      try {
        if (currentToken) await this.sessions.revoke(currentToken);
        res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
      } catch (fallbackError) {
        this.logger.error(
          `changePassword fallback revoke failed: ${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`,
        );
      }
    }
    return ok({ revokedSessions });
  }
}

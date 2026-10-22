import { Body, Controller, Get, Patch, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { isValidPhone, NewApiError } from "@lib/core";
import { createLogger } from "@lib/core/logging";
import {
  ACCOUNT_ERROR_PHONE_NOT_BOUND,
  ACCOUNT_ERROR_PHONE_TAKEN,
  ACCOUNT_ERROR_REBIND_BINDING_CHANGED,
  ACCOUNT_ERROR_REBIND_SAME_PHONE,
  ACCOUNT_ERROR_REBIND_TOKEN_EXPIRED,
  ACCOUNT_ERROR_REBIND_TOKEN_INVALID,
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  changePasswordRequestSchema,
  FAILURE_CODE,
  fail,
  ok,
} from "@lib/contracts";
import { projectAccountError } from "@lib/shared/account/change-password-error.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import {
  IdentityService,
  InvalidCredentialsError,
  NicknameInvalidError,
  PhoneActionService,
  PhoneAlreadyBoundError,
  PhoneNotBoundError,
  PhoneTakenError,
  RebindBindingChangedError,
  RebindSamePhoneError,
} from "@lib/shared/identity/index.js";
import { projectPhoneCodeError } from "@lib/shared/auth/phone-code-error.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { BindPhoneDto } from "./dto/bind-phone.dto.js";
import type { NicknameDto } from "./dto/nickname.dto.js";
import type { RebindDto } from "./dto/rebind.dto.js";
import type { RebindVerifyCurrentDto } from "./dto/rebind-verify-current.dto.js";

@Controller()
export class MeController {
  private readonly logger = createLogger("me");

  constructor(
    private readonly sessions: SessionService,
    private readonly identity: IdentityService,
    private readonly phoneActions: PhoneActionService,
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
      const failure = projectPhoneCodeError(error);
      if (failure) {
        return fail(FAILURE_CODE, failure.message, null, failure.errorCode);
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

  @Post("me/phone/rebind/verify-current")
  async verifyCurrentPhone(
    @Body() body: RebindVerifyCurrentDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const userId = user?.userId;
    if (userId == null) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) {
      return fail(FAILURE_CODE, "验证码已失效，请重新获取");
    }
    try {
      const { oldPhone } = await this.identity.rebindVerifyCurrent(userId, code);
      const rebindToken = await this.phoneActions.issue({
        kind: "rebind",
        userId: Number(userId),
        phone: oldPhone,
      });
      return ok({ rebind_token: rebindToken, expires_in: 600 });
    } catch (error) {
      const failure = projectPhoneCodeError(error);
      if (failure) {
        return fail(FAILURE_CODE, failure.message, null, failure.errorCode);
      }
      if (error instanceof PhoneNotBoundError) {
        return fail(FAILURE_CODE, error.message, null, ACCOUNT_ERROR_PHONE_NOT_BOUND);
      }
      if (error instanceof InvalidCredentialsError) {
        throw new NewApiError("登录已过期，请重新验证", 401, "unauthorized");
      }
      throw error;
    }
  }

  @Post("me/phone/rebind")
  async rebindPhone(
    @Body() body: RebindDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = user?.userId;
    if (userId == null) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    const token = typeof body.rebind_token === "string" ? body.rebind_token.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!isValidPhone(phone) || !code) {
      return fail(FAILURE_CODE, "手机号和验证码不能为空");
    }

    if (!token) {
      return fail(
        FAILURE_CODE,
        "原手机号验证已过期，请重新验证",
        null,
        ACCOUNT_ERROR_REBIND_TOKEN_EXPIRED,
      );
    }
    const action = await this.phoneActions.resolve("rebind", token);
    if (!action || action.userId !== Number(userId) || !action.phone) {
      return fail(
        FAILURE_CODE,
        "换绑凭证无效，请重新验证原手机号",
        null,
        ACCOUNT_ERROR_REBIND_TOKEN_INVALID,
      );
    }

    let newPhone: string;
    try {
      ({ phone: newPhone } = await this.identity.commitRebind(userId, {
        oldPhone: action.phone,
        phone,
        code,
      }));
    } catch (error) {
      const failure = projectPhoneCodeError(error);
      if (failure) {
        return fail(FAILURE_CODE, failure.message, null, failure.errorCode);
      }
      if (error instanceof PhoneTakenError) {
        return fail(FAILURE_CODE, error.message, null, ACCOUNT_ERROR_PHONE_TAKEN);
      }
      if (error instanceof RebindSamePhoneError) {
        return fail(
          FAILURE_CODE,
          error.message,
          null,
          ACCOUNT_ERROR_REBIND_SAME_PHONE,
        );
      }
      if (error instanceof RebindBindingChangedError) {
        return fail(
          FAILURE_CODE,
          error.message,
          null,
          ACCOUNT_ERROR_REBIND_BINDING_CHANGED,
        );
      }
      if (error instanceof InvalidCredentialsError) {
        throw new NewApiError("登录已过期，请重新验证", 401, "unauthorized");
      }
      throw error;
    }

    let revokedSessions = 0;
    try {
      await this.phoneActions.revoke(token);
    } catch (error) {
      this.logger.error(
        `换绑成功但记录收尾失败（userId=${userId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      revokedSessions = await this.sessions.revokeAllForUser(Number(userId));
    } catch (error) {
      this.logger.error(
        `换绑成功但撤销会话失败（userId=${userId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    res.clearCookie(SESSION_COOKIE_NAME, {
      ...sessionCookieOptions(),
      maxAge: undefined,
    });
    return ok({
      phone: newPhone,
      revoked_sessions: revokedSessions,
      relogin_required: true,
    });
  }

  @Patch("me/nickname")
  async updateNickname(
    @Body() body: NicknameDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const userId = user?.userId;
    if (userId == null) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    try {
      const result = await this.identity.updateNickname(userId, body.nickname);
      return ok(result);
    } catch (error) {
      if (error instanceof NicknameInvalidError) {
        return fail(
          FAILURE_CODE,
          error.message,
          null,
          "nickname_invalid",
        );
      }
      if (error instanceof InvalidCredentialsError) {
        throw new NewApiError("登录已过期，请重新验证", 401, "unauthorized");
      }
      throw error;
    }
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

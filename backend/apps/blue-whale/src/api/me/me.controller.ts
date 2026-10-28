import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiError, maskIdentifier, maskPhone } from "@lib/core";
import { createLogger } from "@lib/core/logging";
import {
  ACCOUNT_ERROR_OPERATION_FORBIDDEN,
  ACCOUNT_ERROR_OPERATION_NOT_FOUND,
  ACCOUNT_ERROR_REBIND_TOKEN_EXPIRED,
  ACCOUNT_ERROR_REBIND_TOKEN_INVALID,
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  changePasswordRequestSchema,
  FAILURE_CODE,
  fail,
  ok,
} from "@lib/contracts";
import {
  projectAuthFailure,
  projectPasswordChangeFailure,
} from "@lib/shared/errors/auth-error.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { requirePhoneAndCode } from "@lib/shared/auth/phone-verification.service.js";
import {
  AccountDirectoryService,
  IdentityService,
  InvalidCredentialsError,
  operationRef,
  parseOperationDetail,
  PhoneActionService,
  PhoneBindingService,
} from "@lib/shared/identity/index.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import {
  OPERATION_STATUS_FAILED,
  OPERATION_STATUS_PENDING,
  OPERATION_STATUS_SUCCEEDED,
} from "@lib/shared/persistence/index.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import { clearSessionCookie } from "@lib/shared/session/cookie.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { BindPhoneDto } from "./dto/bind-phone.dto.js";
import type { NicknameDto } from "./dto/nickname.dto.js";
import type { RebindDto } from "./dto/rebind.dto.js";
import type { RebindVerifyCurrentDto } from "./dto/rebind-verify-current.dto.js";

function verificationInputFailure(error: unknown) {
  const failure = projectAuthFailure(error);
  return failure
    ? fail(FAILURE_CODE, failure.message, null, failure.errorCode)
    : null;
}

@Controller()
export class MeController {
  private readonly logger = createLogger("me");

  constructor(
    private readonly sessions: SessionService,
    private readonly identity: IdentityService,
    private readonly phoneBinding: PhoneBindingService,
    private readonly directory: AccountDirectoryService,
    private readonly phoneActions: PhoneActionService,
    private readonly operationLog: OperationLogService,
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
      is_admin: await this.directory.isAdmin(user.userId),
      tier: await this.directory.resolveTier(user.userId),
      roles: await this.directory.listRoleCodes(user.userId),
    });
  }

  @Post("me/phone")
  async bindPhone(
    @Body() body: BindPhoneDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const userId = user?.userId;
    if (userId == null) {
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
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
    try {
      await this.phoneBinding.bindPhone(userId, { phone, code });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new ApiError("登录已过期，请重新验证", 401, "unauthorized");
      }
      const failure = projectAuthFailure(error);
      if (failure) {
        return fail(FAILURE_CODE, failure.message, null, failure.errorCode);
      }
      throw error;
    }
    return ok();
  }

  @Post("me/phone/rebind/verify-current")
  async verifyCurrentPhone(
    @Body() body: RebindVerifyCurrentDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers("x-forwarded-for") forwardedFor?: string,
  ) {
    const userId = user?.userId;
    if (userId == null) {
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
    }
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) {
      return fail(FAILURE_CODE, "验证码已失效，请重新获取");
    }
    try {
      const { oldPhone } = await this.phoneBinding.rebindVerifyCurrent(userId, code);
      const rebindToken = await this.phoneActions.issue({
        kind: "rebind",
        userId: Number(userId),
        phone: oldPhone,
      });
      const ref = operationRef(rebindToken);
      await this.operationLog.record({
        category: "account",
        action: "phone_rebind",
        target: maskPhone(oldPhone),
        targetUserId: userId,
        detail: JSON.stringify({ stage: "verified" }),
        operator: maskPhone(oldPhone),
        operatorId: userId,
        ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
        status: OPERATION_STATUS_PENDING,
        ref,
      });
      return ok({
        rebind_token: rebindToken,
        operation_ref: ref,
        expires_in: 600,
      });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new ApiError("登录已过期，请重新验证", 401, "unauthorized");
      }
      const failure = projectAuthFailure(error);
      if (failure) {
        return fail(FAILURE_CODE, failure.message, null, failure.errorCode);
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
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
    }
    const token = typeof body.rebind_token === "string" ? body.rebind_token.trim() : "";
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

    if (!token) {
      return fail(
        FAILURE_CODE,
        "原手机号验证已过期，请重新验证",
        null,
        ACCOUNT_ERROR_REBIND_TOKEN_EXPIRED,
      );
    }
    const ref = operationRef(token);
    const action = await this.phoneActions.resolve("rebind", token);
    if (!action || action.userId !== Number(userId) || !action.phone) {
      await this.operationLog.finish(ref, {
        status: OPERATION_STATUS_FAILED,
        detail: JSON.stringify({ message: "换绑凭证无效，请重新验证原手机号" }),
      });
      return fail(
        FAILURE_CODE,
        "换绑凭证无效，请重新验证原手机号",
        null,
        ACCOUNT_ERROR_REBIND_TOKEN_INVALID,
      );
    }

    let newPhone: string;
    try {
      ({ phone: newPhone } = await this.phoneBinding.commitRebind(userId, {
        oldPhone: action.phone,
        phone,
        code,
      }));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        await this.operationLog.finish(ref, {
          status: OPERATION_STATUS_FAILED,
          detail: JSON.stringify({ message: "登录已过期，请重新验证" }),
        });
        throw new ApiError("登录已过期，请重新验证", 401, "unauthorized");
      }
      const failure = projectAuthFailure(error);
      if (failure) {
        await this.operationLog.finish(ref, {
          status: OPERATION_STATUS_FAILED,
          detail: JSON.stringify({
            message: failure.message,
            error_code: failure.errorCode ?? null,
          }),
        });
        return fail(FAILURE_CODE, failure.message, null, failure.errorCode);
      }
      await this.operationLog.finish(ref, {
        status: OPERATION_STATUS_FAILED,
        detail: JSON.stringify({ message: "操作未完成，请重新发起" }),
      });
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
    clearSessionCookie(res);
    await this.operationLog.finish(ref, {
      status: OPERATION_STATUS_SUCCEEDED,
      detail: JSON.stringify({
        phone: maskPhone(newPhone),
        revoked_sessions: revokedSessions,
      }),
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
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
    }
    const operationId =
      typeof body.operation_id === "string"
        ? body.operation_id.trim().slice(0, 64)
        : "";
    const ref = operationId || null;
    try {
      const result = await this.identity.updateNickname(userId, body.nickname);
      await this.operationLog.record({
        category: "account",
        action: "nickname_update",
        target: result.nickname,
        targetUserId: userId,
        detail: JSON.stringify({ nickname: result.nickname }),
        operator: maskIdentifier(user?.username ?? ""),
        operatorId: userId,
        status: OPERATION_STATUS_SUCCEEDED,
        ref,
      });
      return ok(result);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new ApiError("登录已过期，请重新验证", 401, "unauthorized");
      }
      const failure = projectAuthFailure(error);
      if (failure) {
        await this.operationLog.record({
          category: "account",
          action: "nickname_update",
          targetUserId: userId,
          detail: JSON.stringify({
            message: failure.message,
            error_code: failure.errorCode ?? null,
          }),
          operator: maskIdentifier(user?.username ?? ""),
          operatorId: userId,
          status: OPERATION_STATUS_FAILED,
          ref,
        });
        return fail(FAILURE_CODE, failure.message, null, failure.errorCode);
      }
      throw error;
    }
  }

  @Get("me/operations/:ref")
  async operationResult(
    @Param("ref") ref: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const userId = user?.userId;
    if (userId == null) {
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
    }
    const record = ref
      ? await this.operationLog.findByRef(ref.trim(), String(userId))
      : null;
    if (!record) {
      return fail(
        FAILURE_CODE,
        "暂未找到本次操作记录，请重试核实",
        null,
        ACCOUNT_ERROR_OPERATION_NOT_FOUND,
      );
    }
    if (record.targetUserId !== String(userId)) {
      return fail(
        FAILURE_CODE,
        "无权查询该操作记录",
        null,
        ACCOUNT_ERROR_OPERATION_FORBIDDEN,
      );
    }
    return ok({
      operation: record.action,
      status: record.status,
      detail: parseOperationDetail(record.detail),
      created_at: record.createdAt,
    });
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
      throw new ApiError("新密码不能为空", 400, "invalid_params");
    }
    const userId = user?.userId;
    if (userId == null) {
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
    }
    const currentToken = (req as Request & { loginToken?: string }).loginToken;
    try {
      await this.identity.changePassword(userId, {
        oldPassword: parsed.data.original_password,
        newPassword: parsed.data.password,
      });
    } catch (error) {
      const projected = projectPasswordChangeFailure(error, "修改密码失败");
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
      revokedSessions = await this.sessions.revokeAllForUser(Number(userId));
    } catch (error) {
      this.logger.error(
        `changePassword user=${userId} session revoke failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      try {
        if (currentToken) await this.sessions.revoke(currentToken);
        clearSessionCookie(res);
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

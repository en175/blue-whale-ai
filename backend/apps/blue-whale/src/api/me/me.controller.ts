import { Body, Controller, Get, Headers, Put, Res } from "@nestjs/common";
import type { Response } from "express";
import { NewApiError } from "@lib/core";
import { createLogger } from "@lib/core/logging";
import {
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  changePasswordRequestSchema,
  fail,
  ok,
} from "@lib/contracts";
import { AccountService } from "@lib/shared/account/account.service.js";
import { projectAccountError } from "@lib/shared/account/change-password-error.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** 会话身份快照（AuthGuard 从本地会话解析，不再每次调 new-api /token/identity）。 */
@Controller()
export class MeController {
  private readonly logger = createLogger("me");

  constructor(
    private readonly account: AccountService,
    private readonly sessions: SessionService,
    private readonly identity: IdentityService,
  ) {}

  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser) {
    return ok({
      id: Number(user.userId),
      user_id: Number(user.userId),
      username: user.username,
      email: user.email,
      phone: "",
      has_password: true,
      is_admin: await this.identity.isAdmin(user.userId),
      // 会员等级：前端据此展示会员标识，**billing 侧据此算折扣**。
      // 每次现查而不是从会话快照取——会员到期没有「用户重新登录」这一步，
      // 会话里带的等级会一直停在登录那一刻。
      tier: await this.identity.resolveTier(user.userId),
      // 角色：**我们自己的**权威（identity_user_roles），与上面的 is_admin 不是同一个来源。
      // is_admin 目前仍来自 new-api 的 role 字段，new-api 独立后就没了；
      // roles 是它的替代，两者并存到断链那天（见 migration 20260924200000 的文末说明）。
      roles: await this.identity.listRoleCodes(user.userId),
    });
  }

  /** 修改密码（IKBRCK）：AuthGuard 已回注真实 sk-，原样透传网关 PUT /api/user/self。
   *  新密码长度口径 8–20（网关为事实源），此处只做非空契约校验，不二次限长。
   *  改密成功后吊销该用户全部会话（含当前窗口）；若枚举吊销失败，兜底至少清掉当前窗口。 */
  @Put("me/password")
  async changePassword(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @CurrentUser() user?: AuthenticatedUser,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const parsed = changePasswordRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new NewApiError("原密码和新密码不能为空", 400, "invalid_params");
    }
    const token = parseBearerToken(authorization);
    if (!token) {
      throw new NewApiError("未提供有效令牌", 401, "unauthorized");
    }
    try {
      await this.account.changePassword(
        {
          originalPassword: parsed.data.original_password,
          newPassword: parsed.data.password,
        },
        token,
      );
    } catch (error) {
      // IKBQEE / ADR-0078：账号域错误统一投影——网关英文 message 归一为
      // 账号域数值码（1101 原密码错误/1102 密码格式/1103 未设密码）+ 中文，杜绝英文透传。
      const projected = projectAccountError(error, "修改密码失败");
      // 未归类错误（1100 兜底）现在走 HTTP200 信封，不再有 4xx/5xx 可观测——主动留痕。
      if (projected.code === ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE) {
        this.logger.error(
          `changePassword 未归类上游错误: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return fail(projected.code, projected.message);
    }
    // 改密成功后再踢会话（best-effort）：上游改密成功已保证新密码生效，
    // 会话吊销失败不阻断改密，避免旧会话残留。
    let revokedSessions = 0;
    try {
      if (user?.userId != null) {
        revokedSessions = await this.sessions.revokeAllForUser(Number(user.userId));
      }
    } catch (error) {
      this.logger.error(
        `changePassword user=${user?.userId} session revoke failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // 兜底：枚举吊销失败（SCAN+pipeline）时，至少直接吊销当前会话并清 cookie——
      // 保证当前浏览器改密后立即要求重新登录（其他设备会话靠 ≤5min 复核或后续枚举）。
      try {
        if (token) await this.sessions.revoke(token);
        if (res) res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
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

import { Body, Controller, Get, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { NewApiError } from "@lib/core";
import { createLogger } from "@lib/core/logging";
import {
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  changePasswordRequestSchema,
  fail,
  ok,
} from "@lib/contracts";
import { projectAccountError } from "@lib/shared/account/change-password-error.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { IdentityService } from "@lib/shared/identity/index.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** 会话身份快照（AuthGuard 从本地会话解析；身份与角色一律读我们自己的库）。 */
@Controller()
export class MeController {
  private readonly logger = createLogger("me");

  constructor(
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
      // 角色：**我们自己的**权威（bw_user_roles/bw_roles），与 is_admin 同源。
      // 两者只是形态不同：is_admin 回答「有没有管理权限」（判定走 `roles.isAdmin` 的
      // code 集合成员），roles 给出原始 code 列表供管理端展示与细粒度判断。
      roles: await this.identity.listRoleCodes(user.userId),
    });
  }

  /**
   * 修改密码（IKBRCK）：原密码校验与新口令写入都在**我们自己的库**
   * （`bw_users.password`，bcrypt），不再转发网关的 `PUT /api/user/self`。
   *
   * <p>响应形状与错误映射保持不变：账号域数值码（1101 原密码错误 / 1102 口令格式 /
   * 1103 未设密码）+ 中文。口令长度口径也回到我们自己的口径（bcrypt 72 字节上限），
   * 不再是网关的 8–20 位。
   *
   * <p>改密成功后吊销该用户全部会话（含当前窗口）；若枚举吊销失败，兜底至少清掉当前窗口。
   */
  @Put("me/password")
  async changePassword(
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = changePasswordRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new NewApiError("原密码和新密码不能为空", 400, "invalid_params");
    }
    // 改密必须知道「改的是谁」。以前这件事由上游凭 sk- 回答，而现在的 sk- 是
    // **项目级统一 key**，答不出用户身份——拿不到本地身份就只能要求重新登录。
    const userId = user?.userId;
    if (userId == null) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    try {
      await this.identity.changePassword(userId, {
        oldPassword: parsed.data.original_password,
        newPassword: parsed.data.password,
      });
    } catch (error) {
      // IKBQEE / ADR-0078：账号域错误统一投影——错误现在来自我们自己的库，
      // 但对外的口径不变：账号域数值码 + 中文，不把异常原文透传给前端。
      const projected = projectAccountError(error, "修改密码失败");
      // 未归类错误（1100 兜底）走 HTTP200 信封，不再有 4xx/5xx 可观测——主动留痕。
      if (projected.code === ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE) {
        this.logger.error(
          `changePassword 未归类错误: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return fail(projected.code, projected.message);
    }
    // 改密成功后再踢会话（best-effort）：新口令已落库，会话吊销失败不阻断改密，
    // 避免旧会话残留。
    let revokedSessions = 0;
    try {
      revokedSessions = await this.sessions.revokeAllForUser(Number(userId));
    } catch (error) {
      this.logger.error(
        `changePassword user=${userId} session revoke failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // 兜底：枚举吊销失败（SCAN+pipeline）时，至少直接吊销当前会话并清 cookie——
      // 保证当前浏览器改密后立即要求重新登录（其他设备会话靠 ≤5min 复核或后续枚举）。
      //
      // ⚠️ 要吊销的是**会话 cookie 里的 sess_ 令牌**。请求头里的那个 Bearer 是
      //    AuthGuard 回注的**上游 sk-**，拿它 revoke 等于删一个不存在的键。
      const currentToken = req.cookies?.[SESSION_COOKIE_NAME];
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

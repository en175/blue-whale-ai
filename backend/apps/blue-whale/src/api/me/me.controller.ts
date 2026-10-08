import { Body, Controller, Get, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { InvalidVerificationCodeError, isValidPhone, NewApiError } from "@lib/core";
import { createLogger } from "@lib/core/logging";
import {
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
    // 手机号与「有没有口令」**现查**，不吃会话快照——用户绑完手机号、或第一次设好
    // 口令之后，都没有「重新登录」这一步来刷新会话里那份值。（同下面 tier 的理由。）
    const flags = await this.identity.resolveAccountFlags(user.userId);
    return ok({
      id: Number(user.userId),
      user_id: Number(user.userId),
      username: user.username,
      email: user.email,
      // 空串而非 null：前端 `MeData.phone` 声明为 `string`，注释写着「可为空串」。
      phone: flags?.phone ?? "",
      // 查不到人时回 false 而不是 true——**别替用户宣称他有口令**。
      has_password: flags?.hasPassword ?? false,
      // IKJABH：管理员重置过密码 → 前端强制弹改密。与上面两个一样**现查**：
      // 改密成功要立刻让这个标记消失，而这里没有「重新登录」来刷新会话。
      must_change_password: flags?.mustChangePassword ?? false,
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
   * 绑定手机号（IKJA4Q）——**首次绑定**，不做换绑。
   *
   * <p>不挂 `@Public()`：它是「给自己加一个登录标识」，必须有身份（ADR-0066 默认全保护）。
   *
   * <p>也不挂 `@RateLimit` 的号码桶：验证码的**发放**已经在 `send-code` 那边按号、按 IP
   * 卡过四道，这里再卡一道只会让用户「重试一次绑定」时莫名其妙地被拒。
   */
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
      // 这三类都是**用户能自己处理**的输入问题，走 HTTP200 信封 + 原文案
      // （前端 `code===200` 才算成功，信封失败不会被当成成功读）。
      if (
        error instanceof InvalidVerificationCodeError ||
        error instanceof PhoneTakenError ||
        error instanceof PhoneAlreadyBoundError
      ) {
        return fail(FAILURE_CODE, error.message);
      }
      // 其余（身份库不可达等）交给全局异常过滤器，不在这里编一个文案。
      throw error;
    }
    return ok();
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
   * 唯一例外是**强制改密**（IKJABH）：那一次当前会话必须留下，否则用户改完立刻掉线。
   * 返回 `revokedSessions` 供前端提示「已登出其他设备」。
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
      // ⚠️ 文案不提「原密码」：无口令的账号走的是**设置**密码，本来就没有原密码（IKJA4R）。
      throw new NewApiError("新密码不能为空", 400, "invalid_params");
    }
    // 改密必须知道「改的是谁」。以前这件事由上游凭 sk- 回答，而现在的 sk- 是
    // **项目级统一 key**，答不出用户身份——拿不到本地身份就只能要求重新登录。
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
    //
    // ⚠️ IKJABH：**强制改密时豁免当前会话**。不豁免的话，被管理员重置过的用户
    //    会走进这个循环——登进来 → 被拦去改密 → 改完成功 → 立刻被自己的改密踢回
    //    登录页 → 再登一次。自助改密不需要这个豁免（改完重新登录是合理的），
    //    所以只在 `wasForced` 时传。其余设备照样被踢：那些才可能是拿到临时口令的人。
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
      // 兜底：枚举吊销失败（SCAN+pipeline）时，至少直接吊销当前会话并清 cookie——
      // 保证当前浏览器改密后立即要求重新登录（其他设备会话靠后续枚举或自然过期）。
      //
      // ⚠️ IKJABH：**强制改密时这个兜底整个跳过**。它的动作（吊销当前会话 + 清
      //    cookie）正是上面刚豁免掉的那两件事，跑下去等于把豁免撤销掉、用户立刻掉线。
      //    代价是这一次枚举失败时其他设备的会话留到下回——但枚举失败本就意味着
      //    Redis 出了问题，此时再补一刀只会砍在自己脚上。
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

import { Body, Controller, Get, Headers, Put } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { changePasswordRequestSchema, ok } from "@blue-whale/contracts";
import { AccountService } from "@lib/shared/account/account.service.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import { toUpstreamError } from "@lib/shared/errors/upstream-error.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** 会话身份快照（AuthGuard 从本地会话解析，不再每次调 new-api /token/identity）。 */
@Controller()
export class MeController {
  constructor(private readonly account: AccountService) {}

  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser) {
    return ok({
      id: Number(user.userId),
      user_id: Number(user.userId),
      username: user.username,
      email: user.email,
      phone: "",
      has_password: true,
      is_admin: user.isAdmin,
    });
  }

  /** 修改密码（IKBRCK）：AuthGuard 已回注真实 sk-，原样透传网关 PUT /api/user/self。
   *  新密码长度口径 8–20（网关为事实源），此处只做非空契约校验，不二次限长。 */
  @Put("me/password")
  async changePassword(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
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
      throw toUpstreamError(error, "修改密码失败");
    }
    return ok();
  }
}

import { Controller, Get } from "@nestjs/common";
import { ok } from "@blue-whale/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** 会话身份快照（AuthGuard 从本地会话解析，不再每次调 new-api /token/identity）。 */
@Controller()
export class MeController {
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
}

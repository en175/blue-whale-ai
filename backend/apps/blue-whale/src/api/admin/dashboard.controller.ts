import { Controller, Get, Headers, UseGuards } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { collectDashboardStats } from "@lib/shared/account/admin-dashboard.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import { toAdminError } from "@lib/shared/errors/admin-error.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("admin/dashboard")
@UseGuards(AdminGuard)
export class AdminDashboardController {
  constructor(private readonly account: AccountService) {}

  @Get()
  async stats(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("authorization") authorization?: string,
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    try {
      const data = await collectDashboardStats(
        this.account,
        token,
        Number(user.userId),
      );
      return { success: true, data };
    } catch (error) {
      throw toAdminError(error);
    }
  }
}

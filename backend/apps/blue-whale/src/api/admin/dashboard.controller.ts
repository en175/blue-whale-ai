import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { DashboardService, resolveDashboardRange } from "@lib/shared/dashboard/index.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";

@Controller("admin/dashboard")
@UseGuards(AdminGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  async stats(@Query() query: Record<string, string> = {}) {
    try {
      const range = resolveDashboardRange({ from: query.from, to: query.to });
      return { success: true, data: await this.dashboard.stats(range) };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}

import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { toAdminError } from "@lib/shared/errors/admin-error.js";
import { IdentityService } from "@lib/shared/identity/index.js";

/**
 * 仪表盘运行概览。
 *
 * <p>⚠️ **只剩总用户数**。原先还有今日充值 / 今日消费 / 待处理订单与最近充值、最近消费，
 * 它们全部来自 new-api 的账单与充值接口——new-api 已降级成上游供应商，那些数不再是我们
 * 的账；计费侧也还没有按「全站维度」的聚合查询。**所以字段被删掉而不是留成 0**：
 * 一个恒为 0 的「今日充值」看起来像「今天没人充值」，那是不报错的错答案。
 */
@Controller("admin/dashboard")
@UseGuards(AdminGuard)
export class AdminDashboardController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  async stats() {
    try {
      // pageSize 只取总数：列表本身由 GET /api/admin/users 提供。
      const { total } = await this.identity.listAdminUsers({ page: 1, pageSize: 1 });
      return { success: true, data: { totalUsers: total } };
    } catch (error) {
      throw toAdminError(error);
    }
  }
}

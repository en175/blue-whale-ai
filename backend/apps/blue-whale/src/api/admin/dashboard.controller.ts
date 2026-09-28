import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { DashboardService, resolveDashboardRange } from "@lib/shared/dashboard/index.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";

/**
 * 仪表盘运行概览。
 *
 * <p>指标与各自的权威来源见 `DashboardService` 的文件头。总用户数取自本地身份库，
 * 其余几个数来自我们自己的 `generation_jobs` / `recharge_orders` 与 billing 的预留表——
 * 原先那几个「今日充值 / 今日消费 / 待处理订单」读的是 new-api 的账单与充值接口，
 * new-api 降级成上游供应商后那些数不再属于我们，**所以当时删掉了而不是留成 0**：
 * 一个恒为 0 的「今日充值」看起来像「今天没人充值」，那是不报错的错答案。
 * 现在账本与订单表都在我们手里，这几个数才重新算得出来。
 */
@Controller("admin/dashboard")
@UseGuards(AdminGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * GET /api/admin/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * <p>区间是**北京时间的自然日、含首尾**；`from` / `to` 都不传 = 今天。
   * 口径与上限（30 天）由 {@link resolveDashboardRange} 一处说了算——
   * 前端也拦一道，但它是体验；**这里是权威**，直接打 API 的人绕不过去。
   */
  @Get()
  async stats(@Query() query: Record<string, string> = {}) {
    try {
      const range = resolveDashboardRange({ from: query.from, to: query.to });
      return { success: true, data: await this.dashboard.stats(range) };
    } catch (error) {
      // ⚠️ AdminException **原样抛出**：`toAdminError` 只认 `NewApiError` 的状态码，
      //    喂给它一个 400 的 AdminException 会被压成 500 —— 「区间超过 30 天」
      //    于是变成「服务器错误」，前端既没法按状态码分辨，用户看到的文案也失去指向。
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}

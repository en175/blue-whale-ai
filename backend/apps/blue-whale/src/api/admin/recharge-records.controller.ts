import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { RechargeService } from "@lib/shared/recharge/recharge.service.js";
import {
  RECHARGE_ORDER_STATUSES,
  type RechargeOrderStatus,
} from "@lib/shared/persistence/index.js";

/**
 * 订单状态白名单。传别的当场拒绝——静默返回空列表与「真的没有」长得一模一样。
 *
 * <p>清单**不在这里手写**：状态一扩（2026-09-26 由 4 态到 6 态），
 * 手写的数组不会报错，只会让新状态的单筛不出来（「按 paid_pending 筛」永远返回空）。
 */
const STATUSES = RECHARGE_ORDER_STATUSES;

/**
 * 充值记录（管理端）。
 *
 * <p>数据源是**我们自己的** `recharge_orders`（ADR-0114 决策 7：充值已接回，走
 * BlueWhalePay 的杭州银行渠道，不再经由 new-api）。所以这一页读的是本地表、
 * offset 分页、**有总数**——与消费记录那条读 billing 账本的游标分页形状不同。
 *
 * <p>⚠️ 与用户端的 `/api/recharge/orders/:tradeNo` 不是一回事：那条经
 *    `RechargeService.loadOwnOrder` 强制归属校验（只能查自己的单），
 *    这条是管理端全站视图。鉴权由 `AdminGuard` 承担，不再做归属过滤。
 */
@Controller("admin/recharge-records")
@UseGuards(AdminGuard)
export class AdminRechargeRecordsController {
  constructor(private readonly recharge: RechargeService) {}

  /**
   * GET /api/admin/recharge-records?page=&pageSize=&userId=&status=&tradeNo=
   *
   * <p>全部筛选条件可选：都不传 = 全站最近一批订单（运营进来第一眼看的正是这个）。
   */
  @Get()
  async list(@Query() query: Record<string, string> = {}) {
    const filter: {
      page: number;
      pageSize: number;
      userId?: number;
      status?: RechargeOrderStatus;
      tradeNo?: string;
    } = {
      page: parsePageParam(query.page),
      pageSize: parsePageSizeParam(query.pageSize),
    };

    const userId = query.userId?.trim();
    if (userId) {
      const parsed = Number(userId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new AdminException(400, "userId 须为正整数");
      }
      filter.userId = parsed;
    }

    const status = query.status?.trim();
    if (status) {
      if (!STATUSES.includes(status as RechargeOrderStatus)) {
        throw new AdminException(400, `status 须为 ${STATUSES.join("/")}`);
      }
      filter.status = status as RechargeOrderStatus;
    }

    // 交易单号**精确**匹配：运营是拿单号来对账的，模糊匹配会带出无关行，
    // 而对账场景下「多给几行」比「少给几行」更难发现
    const tradeNo = query.tradeNo?.trim();
    if (tradeNo) filter.tradeNo = tradeNo;

    try {
      const { items, total } = await this.recharge.listOrdersForAdmin(filter);
      return { success: true, data: { list: items, total } };
    } catch (error) {
      throw toAdminError(error);
    }
  }
}

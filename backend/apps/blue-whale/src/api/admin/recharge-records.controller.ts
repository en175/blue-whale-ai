import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { RechargeService } from "@lib/shared/recharge/recharge.service.js";
import {
  RECHARGE_ORDER_STATUS,
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
 * offset 分页、**有总数**——与积分记录那条读 billing 账本的游标分页形状不同。
 *
 * <p>⚠️ 与用户端的 `/api/recharge/orders/:tradeNo` 不是一回事：那条经
 *    `RechargeService.loadOwnOrder` 强制归属校验（只能查自己的单），
 *    这条是管理端全站视图。鉴权由 `AdminGuard` 承担，不再做归属过滤。
 */
@Controller("admin/recharge-records")
@UseGuards(AdminGuard)
export class AdminRechargeRecordsController {
  constructor(
    private readonly recharge: RechargeService,
    private readonly operationLog: OperationLogService,
  ) {}

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

  /**
   * POST /api/admin/recharge-records/:tradeNo/retry-grant —— 人工补发一笔卡住的单。
   *
   * <p>「钱收了、积分始终发不出去」的单在自动重试窗口（2 小时）用尽之后就**没有任何出口**了：
   * 没有「放弃」状态、没有任何动作能再推它一次。这个接口就是那个出口（E-1）——
   * 规则（为什么越过窗口、为什么不抢名额、失败为什么不吞）全在
   * `RechargeService.retryGrantForAdmin`，这里只做路由与审计。
   *
   * <p>⚠️ 它是**写操作**，落在别人的线上资金状态上：审计 best-effort 写一条，
   * 记下单号与补发前后的状态 —— 事后要能回答「这笔是谁、什么时候推的、推成功没有」。
   */
  @Post(":tradeNo/retry-grant")
  async retryGrant(@Param("tradeNo") tradeNo: string) {
    const id = tradeNo?.trim();
    if (!id) throw new AdminException(400, "缺少交易单号");

    let result: { tradeNo: string; status: RechargeOrderStatus };
    try {
      result = await this.recharge.retryGrantForAdmin(id);
    } catch (error) {
      throw toAdminError(error);
    }
    await this.writeRetryAudit(id, result.status);
    return { success: true, data: result };
  }

  /** 审计 best-effort：写不进去不阻断**已经发生**的补发（补发是钱路径，回滚才是更大的错）。 */
  private async writeRetryAudit(
    tradeNo: string,
    status: RechargeOrderStatus,
  ): Promise<void> {
    try {
      await this.operationLog.create({
        category: "recharge",
        action: "重试发放",
        target: tradeNo,
        detail:
          status === RECHARGE_ORDER_STATUS.paid
            ? "人工补发成功，积分已到账"
            : `人工补发后订单仍停在 ${status}（发放仍失败，详见服务端日志）`,
        operator: "admin",
      });
    } catch {
      /* best-effort */
    }
  }
}

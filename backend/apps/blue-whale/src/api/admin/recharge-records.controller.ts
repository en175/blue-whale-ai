import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
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
    private readonly identity: IdentityService,
  ) {}

  /**
   * GET /api/admin/recharge-records?page=&pageSize=&keyword=&status=&tradeNo=
   *
   * <p>`keyword` 是用户 ID / 手机号 / 用户名，**都要完整**（精确匹配）。空 = 全部用户。
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

    // ⚠️ 校验一律排在查人**之前**：查不到用户时下面会直接回空页，排在后面的话
    //    `?keyword=查无此人&status=success` 会拿到 200 空列表，而不是 400 ——
    //    而本文件开头就写着「非法筛选条件必须当场 400，静默空列表与『真的没有』长得一样」。
    const status = query.status?.trim();
    if (status) {
      if (!STATUSES.includes(status as RechargeOrderStatus)) {
        throw new AdminException(400, `status 须为 ${STATUSES.join("/")}`);
      }
      filter.status = status as RechargeOrderStatus;
    }

    // ⚠️ 还认着旧的 `userId`。前端与后端不是原子发版（本仓 2026-09-26 实测过 3100 上
    //    跑着 4 小时前的构建），一个还没刷新的管理页仍会发 `?userId=42`。不认它的后果
    //    不是报错，而是**静默回一页全站订单**——运营以为筛了那个人，实际看到所有人的单，
    //    而这一页是拿来对账的。
    const keyword = (query.keyword ?? query.userId ?? "").trim();
    if (keyword) {
      const resolved = await this.identity.findAdminUserIdByKeyword(keyword);
      // 认不出这个人就回空页。「查无此人」与「这个人没有订单」在界面上同形，是**接受的**。
      if (resolved === undefined) {
        return { success: true, data: { list: [], total: 0 } };
      }
      filter.userId = resolved;
    }

    // 交易单号**精确**匹配：运营是拿单号来对账的，模糊匹配会带出无关行，
    // 而对账场景下「多给几行」比「少给几行」更难发现
    const tradeNo = query.tradeNo?.trim();
    if (tradeNo) filter.tradeNo = tradeNo;

    try {
      const { items, total } = await this.recharge.listOrdersForAdmin(filter);

      // 用户名 / 手机号：**一次 IN 查回来**，不逐行查（同积分记录与任务记录页）。
      // `recharge_orders` 里只有 user_id，认不出人。
      const identities = await this.identity.loadAdminUserIdentities(
        // ponytail: `Number()` 在 2^53 以下无损；真实用户 id 远小于此。真涨到那个量级时
        //   把 `loadUserIdentities` 的入参放宽成 `string | number`，别在这里默默丢精度。
        items.map((item) => Number(item.userId)),
      );

      return {
        success: true,
        data: {
          list: items.map((item) => {
            // ⚠️ `|| null` 而不是 `?? null`：身份里用空串表示「没有」（存量用户没手机号是常态），
            //    落到对外契约里收敛成**唯一的**一种「没有」。用户查不到时 identity 整个缺席，
            //    同样落到 null。
            const identity = identities.get(Number(item.userId));
            return {
              ...item,
              nickname: identity?.nickname || null,
              phone: identity?.phone || null,
            };
          }),
          total,
        },
      };
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

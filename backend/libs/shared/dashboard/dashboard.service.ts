/* ============================================
 * 仪表盘统计：四个数 + 原有的总用户数。
 *
 * ── 每个数各自的权威来源 ────────────────────────────────────────────────────
 *
 * | 指标         | 表 / 端点                                | 字段                          |
 * | ------------ | ---------------------------------------- | ----------------------------- |
 * | 总用户       | 本地 `identity_users`（IdentityService）  | `count`                       |
 * | 任务数       | 本地 `generation_jobs`                    | `count`，按 `gmt_create` 落区间 |
 * | 总使用积分   | billing `billing_cost_reservations`       | `status='settled'` 的 `actual_credits` 求和 |
 * | 总充值积分   | 本地 `recharge_orders`                    | `status='paid'` 的 `credits` 求和 |
 * | 总收入金额   | 本地 `recharge_orders`                    | `status='paid'` 的 `amount_fen` 求和 |
 *
 * ⚠️ **「使用积分」与「充值积分」不是同一口径的两面，不能相减**：
 *    前者是**消耗**（出），后者是**发放**（进）。进减出也不是余额——余额还要算上赠送、
 *    过期核销与冻结中的部分，那是 billing 的余额接口（`QueryBalance`）的事。
 *    所以这里只给两个独立的数，**不合成「结余」**。
 *
 * ⚠️ **充值积分按原价派生、收入金额按实付**，两者基数不同，这是**有意的**：
 *    `recharge.service.ts` 的约定是「折扣是让利——少收钱、不少给积分」，
 *    到账积分由档位原价派生（`credits` 在下单时刻冻结），而 `amount_fen` 才是用户
 *    真正付出去的钱。看到「充了 100 万分只收了 1 万块」先别当 bug，去看档位折扣。
 *
 * ── 为什么用 `paid_at` 而不是 `gmt_create` 划充值 ──────────────────────────
 *
 * `gmt_create` 是**下单**时刻，`paid_at` 是**到账**时刻。这两个数回答的是「这段时间
 * 收到了多少钱 / 发出去了多少积分」——钱是到账那一刻才进来的，一笔昨天下单、今天付款的
 * 订单属于今天。`status='paid'` 蕴含 `paid_at` 非空（`markPaid` 一并写入），不会漏行。
 * ============================================ */
import { Injectable } from "@nestjs/common";
import {
  BillingAdminError,
  fetchConsumedCredits,
} from "@lib/shared/billing/billing-admin-client.js";
import { createLogger, type Logger } from "@lib/core/logging";
import { IdentityService } from "@lib/shared/identity/index.js";
import {
  PAID_REACHED_STATUSES,
  RECHARGE_ORDER_STATUS,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { withinRange, type DashboardRange } from "./dashboard-range.js";

/** 某个任务类型在区间内的任务数。 */
export interface DashboardJobTypeCount {
  /** `generation_jobs.type` 的原值（`video` / `audio_trim` / …）。中文名由前端映射 */
  type: string;
  count: number;
}

export interface DashboardStats {
  /** 区间起止自然日（北京时间），原样回给前端，便于界面确认「你看的是哪一段」 */
  from: string;
  to: string;
  totalUsers: number;
  /** 区间内的任务数。**也是下面占比的分母**（由同一份分组结果求和得出，见 `stats`） */
  totalJobs: number;
  /**
   * 区间内**已结算**的实际消耗积分合计。
   *
   * <p>⚠️ `null` = **billing 取不到**，与 `0` 是两件事。0 的意思是「这段时间确实没人消费」，
   *    而 billing 挂了的时候我们并不知道消费了多少——给 0 就是一句不报错的假话
   *    （同 `AdminDashboardController` 里「删掉卡片而不是留成 0」的那条理由）。
   */
  totalUsedCredits: number | null;
  /** 区间内已到账订单发放的积分合计（按档位**原价**派生，见文件头） */
  totalRechargeCredits: number;
  /** 区间内已到账订单的**实付**金额合计，单位**分**（不是元、不是积分） */
  totalRevenueFen: number;
  /** 按任务类型分组，任务数降序；空区间为 `[]` */
  jobTypeCounts: DashboardJobTypeCount[];
}

@Injectable()
export class DashboardService {
  private readonly logger: Logger = createLogger("dashboard");

  constructor(
    private readonly identity: IdentityService,
    private readonly prisma: PrismaService,
  ) {}

  async stats(range: DashboardRange): Promise<DashboardStats> {
    const window = withinRange(range);

    // 三趟查询并发：彼此无依赖，串行只是白等。billing 那一趟在 allSettled 之外单独接，
    // 因为它的失败**不该**带走另外三个数（见 totalUsedCredits 的注释）。
    const [users, jobTypeCounts, rechargeTotals] = await Promise.all([
      this.identity.listAdminUsers({ page: 1, pageSize: 1 }),
      this.countJobsByType(window),
      this.sumPaidRecharges(window),
    ]);

    return {
      from: range.from,
      to: range.to,
      totalUsers: users.total,
      // ⚠️ 总数由**分组结果求和**得出，而不是另发一条 count：两者分属两条语句时会因为
      //    两条之间新落库的任务而对不上（分母与分子取自两个瞬间），
      //    表现是占比加起来不是 100%，而没人会发现。同一份结果里取和就没有这个缝。
      totalJobs: jobTypeCounts.reduce((sum, row) => sum + row.count, 0),
      totalUsedCredits: await this.consumedCredits(range),
      totalRechargeCredits: rechargeTotals.credits,
      totalRevenueFen: rechargeTotals.revenueFen,
      jobTypeCounts,
    };
  }

  /**
   * 区间内的任务数，按类型分组（一条 SQL）。
   *
   * <p>按任务数降序、同数按类型名升序：占比条的次序必须是**稳定**的，否则两次刷新
   * 之间（同数不同序）条形的上下位置会跳。
   */
  private async countJobsByType(
    window: { gte: Date; lt: Date },
  ): Promise<DashboardJobTypeCount[]> {
    const rows = await this.prisma.client.generation_jobs.groupBy({
      by: ["type"],
      // is_delete 与任务记录页（job-repo.listForAdmin）同一口径：软删的任务不算数
      where: { is_delete: false, gmt_create: window },
      _count: { _all: true },
    });
    return rows
      .map((row) => ({ type: row.type, count: row._count._all }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }

  /** 区间内已到账订单的积分合计与实付金额合计（一条 SQL 出两个数）。 */
  /**
   * 区间内的**实收金额**与**已发放积分**合计。
   *
   * <p>⚠️ 两个数的口径**从此不同**（2026-09-26 状态机拆出 `paid_pending` 之后）：
   * <ul>
   *   <li><b>实收金额</b>取「≥ 待到账」（`paid_pending` 或 `paid`）—— 钱**已经收了**。
   *       只算 `paid` 会把「已付款、只是积分还没发成功」的单漏掉，**收入被低报**。</li>
   *   <li><b>到账积分</b>仍取严格 `paid` —— 那些积分确实还没发出去，算进来就是虚报。</li>
   * </ul>
   *
   * <p>所以一条 `where` 出不来了（原实现是一条 aggregate 出两个数）。改成按 status 分组
   * 取回、在内存里分开累加 —— **仍然只有一次往返**，代价只是多传回一行。
   */
  private async sumPaidRecharges(window: {
    gte: Date;
    lt: Date;
  }): Promise<{ credits: number; revenueFen: number }> {
    const rows = await this.prisma.client.recharge_orders.groupBy({
      by: ["status"],
      where: {
        is_delete: 0,
        status: { in: [...PAID_REACHED_STATUSES] },
        paid_at: window,
      },
      _sum: { credits: true, amount_fen: true },
    });

    let credits = 0;
    let revenueFen = 0;
    // 两列都是 BIGINT，没行时 `_sum` 为 null（不是 0）。
    // 转 Number：区间上限 30 天，30 天内的充值笔数与单笔金额都不足以逼近
    // Number.MAX_SAFE_INTEGER（9e15），这个转法是安全的。
    for (const row of rows) {
      revenueFen += Number(row._sum.amount_fen ?? 0n);
      if (row.status === RECHARGE_ORDER_STATUS.paid) {
        credits += Number(row._sum.credits ?? 0n);
      }
    }
    return { credits, revenueFen };
  }

  /**
   * 区间内的已结算消耗，来自 billing。
   *
   * <p>⚠️ billing 取不到时**返回 null 并记一条 error 日志**，而不是让整个仪表盘 500：
   *    另外四个数都在我们自己的库里，billing 抖动不该把它们一起带走。前端拿到 null
   *    会显式显示「计费服务不可用」而不是一个 0。
   */
  private async consumedCredits(range: DashboardRange): Promise<number | null> {
    try {
      return await fetchConsumedCredits(range.start, range.endExclusive);
    } catch (error) {
      this.logger.error(
        `billing 消耗聚合取不到（区间 ${range.from}~${range.to}）：` +
          `${error instanceof BillingAdminError ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

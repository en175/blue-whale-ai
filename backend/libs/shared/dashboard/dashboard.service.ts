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

export interface DashboardJobTypeCount {
  type: string;
  count: number;
}

export interface DashboardStats {
  from: string;
  to: string;
  totalUsers: number;
  totalJobs: number;
  totalUsedCredits: number | null;
  totalRechargeCredits: number;
  totalRevenueFen: number;
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

    const [totalUsers, jobTypeCounts, rechargeTotals] = await Promise.all([
      this.identity.countAdminUsers(),
      this.countJobsByType(window),
      this.sumPaidRecharges(window),
    ]);

    return {
      from: range.from,
      to: range.to,
      totalUsers,
      totalJobs: jobTypeCounts.reduce((sum, row) => sum + row.count, 0),
      totalUsedCredits: await this.consumedCredits(range),
      totalRechargeCredits: rechargeTotals.credits,
      totalRevenueFen: rechargeTotals.revenueFen,
      jobTypeCounts,
    };
  }

  private async countJobsByType(
    window: { gte: Date; lt: Date },
  ): Promise<DashboardJobTypeCount[]> {
    const rows = await this.prisma.client.generation_jobs.groupBy({
      by: ["type"],
      where: { is_delete: false, gmt_create: window },
      _count: { _all: true },
    });
    return rows
      .map((row) => ({ type: row.type, count: row._count._all }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }

  private async sumPaidRecharges(window: {
    gte: Date;
    lt: Date;
  }): Promise<{ credits: number; revenueFen: number }> {
    const rows = await this.prisma.client.recharge_orders.groupBy({
      by: ["status"],
      where: {
        is_delete: 0,
        status: { in: [...PAID_REACHED_STATUSES] },
        OR: [
          { paid_at: window },
          { paid_at: null, paid_pending_at: window },
          { paid_at: null, paid_pending_at: null, gmt_create: window },
        ],
      },
      _sum: { credits: true, amount_fen: true },
    });

    let credits = 0;
    let revenueFen = 0;
    for (const row of rows) {
      revenueFen += Number(row._sum.amount_fen ?? 0n);
      if (row.status === RECHARGE_ORDER_STATUS.paid) {
        credits += Number(row._sum.credits ?? 0n);
      }
    }
    return { credits, revenueFen };
  }

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

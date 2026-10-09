import type { PrismaClient } from "@prisma/client";


export const RECHARGE_ORDER_STATUS = {
  pending: "pending",
  paidPending: "paid_pending",
  paid: "paid",
  failed: "failed",
  expired: "expired",
  grantFailed: "grant_failed",
} as const;

export type RechargeOrderStatus =
  (typeof RECHARGE_ORDER_STATUS)[keyof typeof RECHARGE_ORDER_STATUS];

export const RECHARGE_ORDER_STATUSES: readonly RechargeOrderStatus[] = Object.values(
  RECHARGE_ORDER_STATUS,
);

export const PAID_REACHED_STATUSES: readonly RechargeOrderStatus[] = [
  RECHARGE_ORDER_STATUS.paidPending,
  RECHARGE_ORDER_STATUS.grantFailed,
  RECHARGE_ORDER_STATUS.paid,
];

export const RECHARGE_ORDER_SNAPSHOT_DEFAULTS = {
  productType: "tier",
  productName: "",
  bonusCredits: 0,
  creditsValidMonths: null,
  firstPurchaseState: "unknown",
  firstPurchaseEligible: 0,
  permissionResult: "allowed",
} as const;

export interface RechargeOrderView {
  tradeNo: string;
  payOrderId: string | null;
  cashierUrl: string | null;
  userId: string;
  tierId: string | null;
  amountFen: number;
  credits: number;
  bonusCredits: number;
  firstPurchaseEligible: number;
  firstPurchaseState: string;
  creditsPerYuan: number;
  productType: string;
  productName: string;
  status: RechargeOrderStatus;
  paidAt: string | null;
  notifyCount: number;
  createdAt: string;
  creditsValidMonths: number | null;
  paidPendingAt: string | null;
}

export interface CreateRechargeOrderInput {
  tradeNo: string;
  userId: number;
  tierId: number | null;
  amountFen: number;
  credits: number;
  creditsPerYuan: number;
  productType?: string;
  productName?: string;
  bonusCredits?: number;
  creditsValidMonths?: number | null;
  firstPurchaseState?: string;
  firstPurchaseEligible?: number;
  permissionResult?: string;
  configVersion?: number;
}

export interface RechargeOrderListFilter {
  page: number;
  pageSize: number;
  userId?: number;
  status?: RechargeOrderStatus;
  statuses?: readonly RechargeOrderStatus[];
  tradeNo?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

export interface ActiveOrderIdentity {
  userId: number;
  productType: string;
  tierId: number | null;
  credits: number;
  amountFen: number;
}

export interface RechargeOrderPage {
  items: RechargeOrderView[];
  total: number;
}

export interface AbandonedGrants {
  total: number;
  samples: RechargeOrderView[];
}

export interface RechargeOrderRepo {
  create(input: CreateRechargeOrderInput): Promise<RechargeOrderView>;
  getByTradeNo(tradeNo: string): Promise<RechargeOrderView | null>;
  list(filter: RechargeOrderListFilter): Promise<RechargeOrderPage>;
  listByTradeNos(tradeNos: readonly string[]): Promise<RechargeOrderView[]>;
  findActiveOrder(identity: ActiveOrderIdentity): Promise<RechargeOrderView | null>;
  findUnsettledPaidOrder(userId: number): Promise<RechargeOrderView | null>;
  listGrantsToRetry(
    window: { staleBefore: Date; windowStart: Date },
    limit: number,
  ): Promise<RechargeOrderView[]>;
  listGrantsPastRetryWindow(
    windowStart: Date,
    sampleLimit: number,
  ): Promise<AbandonedGrants>;
  bindGatewayOrder(
    tradeNo: string,
    gateway: { payOrderId: string; cashierUrl: string },
  ): Promise<boolean>;
  markPaidPending(tradeNo: string): Promise<boolean>;
  markPaid(input: {
    tradeNo: string;
    creditsExpireAt?: Date;
    firstPurchaseState?: string;
  }): Promise<boolean>;
  markGrantFailed(tradeNo: string): Promise<boolean>;
  recordNotify(tradeNo: string): Promise<void>;
  claimQuerySlot(tradeNo: string, intervalMs: number): Promise<boolean>;
  markFailed(tradeNo: string): Promise<void>;
  markExpired(tradeNo: string): Promise<void>;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(row: any): RechargeOrderView {
  const status = RECHARGE_ORDER_STATUSES.includes(row.status)
    ? (row.status as RechargeOrderStatus)
    : RECHARGE_ORDER_STATUS.pending;
  return {
    tradeNo: row.trade_no,
    payOrderId: row.pay_order_id ?? null,
    cashierUrl: row.cashier_url ?? null,
    userId: row.user_id.toString(),
    tierId: row.tier_id === null ? null : row.tier_id.toString(),
    amountFen: Number(row.amount_fen),
    credits: Number(row.credits),
    bonusCredits: Number(row.bonus_credits),
    firstPurchaseEligible: Number(row.first_purchase_eligible),
    firstPurchaseState: row.first_purchase_state,
    creditsPerYuan: row.credits_per_yuan,
    productType: row.product_type,
    productName: row.product_name,
    status,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    notifyCount: row.notify_count,
    createdAt: new Date(row.gmt_create).toISOString(),
    creditsValidMonths:
      row.credits_valid_months === null || row.credits_valid_months === undefined
        ? null
        : Number(row.credits_valid_months),
    paidPendingAt: row.paid_pending_at
      ? new Date(row.paid_pending_at).toISOString()
      : null,
  };
}


export function createRechargeOrderRepo(prisma: PrismaClient): RechargeOrderRepo {
  return {
    async create(input) {
      const row = await prisma.recharge_orders.create({
        data: {
          trade_no: input.tradeNo,
          user_id: BigInt(input.userId),
          tier_id: input.tierId === null ? null : BigInt(input.tierId),
          amount_fen: BigInt(input.amountFen),
          credits: BigInt(input.credits),
          credits_per_yuan: input.creditsPerYuan,
          status: RECHARGE_ORDER_STATUS.pending,
          product_type:
            input.productType ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.productType,
          product_name:
            input.productName ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.productName,
          bonus_credits: BigInt(
            input.bonusCredits ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.bonusCredits,
          ),
          credits_expire_at: null,
          credits_valid_months:
            input.creditsValidMonths ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.creditsValidMonths,
          first_purchase_state:
            input.firstPurchaseState ??
            RECHARGE_ORDER_SNAPSHOT_DEFAULTS.firstPurchaseState,
          first_purchase_eligible:
            input.firstPurchaseEligible ??
            RECHARGE_ORDER_SNAPSHOT_DEFAULTS.firstPurchaseEligible,
          permission_result:
            input.permissionResult ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.permissionResult,
          config_version: input.configVersion ?? 0,
        },
      });
      return toView(row);
    },

    async getByTradeNo(tradeNo) {
      const row = await prisma.recharge_orders.findFirst({
        where: { trade_no: tradeNo, is_delete: 0 },
      });
      return row ? toView(row) : null;
    },

    async list(filter) {
      const where = {
        is_delete: 0,
        ...(filter.userId !== undefined ? { user_id: BigInt(filter.userId) } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        ...(filter.statuses !== undefined ? { status: { in: [...filter.statuses] } } : {}),
        ...(filter.tradeNo !== undefined ? { trade_no: filter.tradeNo } : {}),
        ...(filter.createdFrom || filter.createdTo
          ? {
              gmt_create: {
                ...(filter.createdFrom ? { gte: filter.createdFrom } : {}),
                ...(filter.createdTo ? { lte: filter.createdTo } : {}),
              },
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.recharge_orders.count({ where }),
        prisma.recharge_orders.findMany({
          where,
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      return { items: rows.map(toView), total };
    },

    async listByTradeNos(tradeNos) {
      const unique = [...new Set(tradeNos)].filter((tradeNo) => tradeNo !== "");
      if (unique.length === 0) return [];
      const rows = await prisma.recharge_orders.findMany({
        where: { is_delete: 0, trade_no: { in: unique } },
      });
      return rows.map(toView);
    },

    async findActiveOrder(identity) {
      const row = await prisma.recharge_orders.findFirst({
        where: {
          user_id: BigInt(identity.userId),
          status: RECHARGE_ORDER_STATUS.pending,
          is_delete: 0,
          product_type: identity.productType,
          tier_id: identity.tierId === null ? null : BigInt(identity.tierId),
          credits: BigInt(identity.credits),
          amount_fen: BigInt(identity.amountFen),
        },
        orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
      });
      return row ? toView(row) : null;
    },

    async findUnsettledPaidOrder(userId) {
      const row = await prisma.recharge_orders.findFirst({
        where: {
          user_id: BigInt(userId),
          status: {
            in: [
              RECHARGE_ORDER_STATUS.paidPending,
              RECHARGE_ORDER_STATUS.grantFailed,
            ],
          },
          is_delete: 0,
        },
        orderBy: [{ gmt_create: "asc" }, { id: "asc" }],
      });
      return row ? toView(row) : null;
    },

    async listGrantsToRetry({ staleBefore, windowStart }, limit) {
      const rows = await prisma.recharge_orders.findMany({
        where: {
          is_delete: 0,
          status: {
            in: [RECHARGE_ORDER_STATUS.paidPending, RECHARGE_ORDER_STATUS.grantFailed],
          },
          OR: [
            { paid_pending_at: { gte: windowStart, lt: staleBefore } },
            { paid_pending_at: null, gmt_create: { gte: windowStart, lt: staleBefore } },
          ],
        },
        orderBy: [{ gmt_create: "asc" }, { id: "asc" }],
        take: limit,
      });
      return rows.map(toView);
    },

    async listGrantsPastRetryWindow(windowStart, sampleLimit) {
      const where = {
        is_delete: 0,
        status: {
          in: [RECHARGE_ORDER_STATUS.paidPending, RECHARGE_ORDER_STATUS.grantFailed],
        },
        OR: [
          { paid_pending_at: { lt: windowStart } },
          { paid_pending_at: null, gmt_create: { lt: windowStart } },
        ],
      };
      const [total, rows] = await Promise.all([
        prisma.recharge_orders.count({ where }),
        prisma.recharge_orders.findMany({
          where,
          orderBy: [{ gmt_create: "asc" }, { id: "asc" }],
          take: sampleLimit,
        }),
      ]);
      return { total, samples: rows.map(toView) };
    },

    async bindGatewayOrder(tradeNo, gateway) {
      try {
        const r = await prisma.recharge_orders.updateMany({
          where: { trade_no: tradeNo, pay_order_id: null },
          data: {
            pay_order_id: gateway.payOrderId,
            cashier_url: gateway.cashierUrl,
            gmt_modified: new Date(),
          },
        });
        return r.count > 0;
      } catch {
        return false;
      }
    },

    async markPaidPending(tradeNo) {
      const r = await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: { notIn: [...PAID_REACHED_STATUSES] } },
        data: {
          status: RECHARGE_ORDER_STATUS.paidPending,
          paid_pending_at: new Date(),
          gmt_modified: new Date(),
        },
      });
      return r.count > 0;
    },

    async markPaid({ tradeNo, creditsExpireAt, firstPurchaseState }) {
      const r = await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: { not: RECHARGE_ORDER_STATUS.paid } },
        data: {
          status: RECHARGE_ORDER_STATUS.paid,
          paid_at: new Date(),
          ...(creditsExpireAt ? { credits_expire_at: creditsExpireAt } : {}),
          ...(firstPurchaseState ? { first_purchase_state: firstPurchaseState } : {}),
          gmt_modified: new Date(),
        },
      });
      return r.count > 0;
    },

    async recordNotify(tradeNo) {
      await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo },
        data: { notify_count: { increment: 1 }, gmt_modified: new Date() },
      });
    },

    async markGrantFailed(tradeNo) {
      const r = await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: RECHARGE_ORDER_STATUS.paidPending },
        data: { status: RECHARGE_ORDER_STATUS.grantFailed, gmt_modified: new Date() },
      });
      return r.count > 0;
    },

    async claimQuerySlot(tradeNo, intervalMs) {
      const cutoff = new Date(Date.now() - intervalMs);
      const r = await prisma.recharge_orders.updateMany({
        where: {
          trade_no: tradeNo,
          OR: [{ last_query_at: null }, { last_query_at: { lt: cutoff } }],
        },
        data: { last_query_at: new Date() },
      });
      return r.count > 0;
    },

    async markFailed(tradeNo) {
      await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: RECHARGE_ORDER_STATUS.pending },
        data: { status: RECHARGE_ORDER_STATUS.failed, gmt_modified: new Date() },
      });
    },

    async markExpired(tradeNo) {
      await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: RECHARGE_ORDER_STATUS.pending },
        data: { status: RECHARGE_ORDER_STATUS.expired, gmt_modified: new Date() },
      });
    },
  };
}

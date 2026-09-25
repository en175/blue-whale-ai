import type { PrismaClient } from "@prisma/client";

/** 充值订单 repo（Prisma-backed）。
 *
 *  ⚠️ 到账判定一律走这里的两条唯一索引与 `markPaid` 的条件更新，
 *  **不靠**「网关只推一次」这种假设：回调会重投，重复发积分是直接的资金损失。 */

export type RechargeOrderStatus = "pending" | "paid" | "expired" | "failed";

export interface RechargeOrderView {
  tradeNo: string;
  /** 支付网关订单号；下单应答回来前为 null */
  payOrderId: string | null;
  userId: string;
  tierId: string;
  /** 实付金额，单位分 */
  amountFen: number;
  /** 下单时冻结的到账积分 */
  credits: number;
  creditsPerYuan: number;
  status: RechargeOrderStatus;
  paidAt: string | null;
  grantLotId: string | null;
  notifyCount: number;
  createdAt: string;
}

export interface CreateRechargeOrderInput {
  tradeNo: string;
  userId: number;
  tierId: number;
  amountFen: number;
  credits: number;
  creditsPerYuan: number;
}

export interface RechargeOrderRepo {
  create(input: CreateRechargeOrderInput): Promise<RechargeOrderView>;
  getByTradeNo(tradeNo: string): Promise<RechargeOrderView | null>;
  /** 绑定网关订单号。该号已被别的订单占用（或本单已绑过别的号）时返回 false */
  bindPayOrderId(tradeNo: string, payOrderId: string): Promise<boolean>;
  /**
   * 标记到账。**条件更新**：仅当当前状态不是 paid 时才改，返回是否本次改成功。
   *
   * <p>返回值就是「该由我来发积分吗」的答案——重复回调里只有一个调用者为 true。
   * 但**发放本身仍由 billing 的幂等键兜底**（见 recharge.service）：这里判赢了也只发一次，
   * 判输了也不会重发，两层都要有。
   */
  markPaid(input: { tradeNo: string; grantLotId?: string }): Promise<boolean>;
  /** 记一次回调到达（只做可观测，不参与判定） */
  recordNotify(tradeNo: string): Promise<void>;
  /**
   * 抢占一次「向网关查单」的名额。
   *
   * <p>用户端每 3 秒轮询一次状态，若每次都去问网关，一个用户就是每分钟 20 次查单。
   * 距上次查单不足 `intervalMs` 时返回 false。
   *
   * <p>⚠️ 名额记在**库里**而不是进程内存：多实例部署时每个进程各记各的内存，等于没限流。
   */
  claimQuerySlot(tradeNo: string, intervalMs: number): Promise<boolean>;
  markFailed(tradeNo: string): Promise<void>;
  markExpired(tradeNo: string): Promise<void>;
}

/* ---------- helpers ---------- */

const STATUSES: readonly RechargeOrderStatus[] = ["pending", "paid", "expired", "failed"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(row: any): RechargeOrderView {
  const status = STATUSES.includes(row.status) ? (row.status as RechargeOrderStatus) : "pending";
  return {
    tradeNo: row.trade_no,
    payOrderId: row.pay_order_id ?? null,
    userId: row.user_id.toString(),
    tierId: row.tier_id.toString(),
    amountFen: Number(row.amount_fen),
    credits: Number(row.credits),
    creditsPerYuan: row.credits_per_yuan,
    status,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    grantLotId: row.grant_lot_id === null ? null : row.grant_lot_id.toString(),
    notifyCount: row.notify_count,
    createdAt: new Date(row.gmt_create).toISOString(),
  };
}

/* ---------- factory ---------- */

export function createRechargeOrderRepo(prisma: PrismaClient): RechargeOrderRepo {
  return {
    async create(input) {
      const row = await prisma.recharge_orders.create({
        data: {
          trade_no: input.tradeNo,
          user_id: BigInt(input.userId),
          tier_id: BigInt(input.tierId),
          amount_fen: BigInt(input.amountFen),
          credits: BigInt(input.credits),
          credits_per_yuan: input.creditsPerYuan,
          status: "pending",
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

    async bindPayOrderId(tradeNo, payOrderId) {
      // 条件更新：本单尚无网关订单号时才绑。更新不到行说明它已经被绑过
      // （或号被别的订单占了 → 唯一索引会拒绝，同样让 count=0，不会静默改写归属）
      try {
        const r = await prisma.recharge_orders.updateMany({
          where: { trade_no: tradeNo, pay_order_id: null },
          data: { pay_order_id: payOrderId, gmt_modified: new Date() },
        });
        return r.count > 0;
      } catch {
        return false;
      }
    },

    async markPaid({ tradeNo, grantLotId }) {
      const r = await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: { not: "paid" } },
        data: {
          status: "paid",
          paid_at: new Date(),
          // 只有真拿到批次 id 时才写：幂等命中（409）那条路径拿不到它，
          // 写 null 会把早先那次成功留下的批次号抹掉
          ...(grantLotId ? { grant_lot_id: BigInt(grantLotId) } : {}),
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
        where: { trade_no: tradeNo, status: "pending" },
        data: { status: "failed", gmt_modified: new Date() },
      });
    },

    async markExpired(tradeNo) {
      await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: "pending" },
        data: { status: "expired", gmt_modified: new Date() },
      });
    },
  };
}

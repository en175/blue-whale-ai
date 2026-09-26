import type { PrismaClient } from "@prisma/client";

/** 充值档位 repo（Prisma-backed），blue_whale 侧 CRUD。
 *  支付执行逻辑在 Go new-api，本 repo 只管档位数据。 */

export interface TopupTierView {
  id: string;
  name: string;
  amount: number;
  originalPrice: number;
  discount: number;
  price: number;
  isRecommended: boolean;
  status: "active" | "inactive";
  startTime: string | null;
  endTime: string | null;
  sortOrder: number;
  /**
   * 档位配置版本。**每保存一次 +1**（不是自增主键，也不跟 gmt_modified 等价：
   * 后者是「什么时候动的」，它是「口径变到第几版了」）。
   *
   * <p>下单时把它快照进 `recharge_orders.config_version`，用来回答
   * 「这单是改价前还是改价后下的」——订单只冻结了价格与积分数，没冻结「当时是哪一版配置」。
   */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTopupTierInput {
  name?: string;
  amount: number;
  originalPrice: number;
  discount: number;
  isRecommended?: boolean;
  status?: "active" | "inactive";
  startTime?: string | null;
  endTime?: string | null;
}

export interface UpdateTopupTierInput {
  name?: string;
  amount?: number;
  originalPrice?: number;
  discount?: number;
  isRecommended?: boolean;
  status?: "active" | "inactive";
  startTime?: string | null;
  endTime?: string | null;
  sortOrder?: number;
}

export interface TopupTierRepo {
  /** 管理端：列出全部档位（含停用），按 sort_order 排序 */
  listAll(): Promise<TopupTierView[]>;
  /** 用户端：列出有效档位（active + 时间窗口内），按 sort_order 排序 */
  listActive(): Promise<TopupTierView[]>;
  getById(id: string): Promise<TopupTierView | null>;
  create(input: CreateTopupTierInput): Promise<TopupTierView>;
  update(id: string, input: UpdateTopupTierInput): Promise<TopupTierView | null>;
  remove(id: string): Promise<boolean>;
  /** 批量更新排序 */
  updateSortOrder(items: { id: string; sortOrder: number }[]): Promise<void>;
  /** 当前最大 sort_order */
  maxSortOrder(): Promise<number>;
}

/* ---------- helpers ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(row: any): TopupTierView {
  return {
    id: row.id.toString(),
    name: row.name,
    amount: Number(row.amount),
    originalPrice: Number(row.original_price),
    discount: Number(row.discount),
    price: Number(row.price),
    isRecommended: row.is_recommended,
    status: row.status,
    startTime: row.start_time ? new Date(row.start_time).toISOString() : null,
    endTime: row.end_time ? new Date(row.end_time).toISOString() : null,
    sortOrder: row.sort_order,
    version: row.version,
    createdAt: new Date(row.gmt_create).toISOString(),
    updatedAt: new Date(row.gmt_modified).toISOString(),
  };
}

function parseDateTime(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(v);
}

/** id 守卫：仅接受十进制正整数串。BigInt("abc") 会抛错，不能让路径参数直接炸成 500。 */
function parseId(id: string): bigint | null {
  if (typeof id !== "string" || !/^\d{1,19}$/.test(id)) return null;
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

/* ---------- factory ---------- */

export function createTopupTierRepo(prisma: PrismaClient): TopupTierRepo {
  return {
    async listAll() {
      const rows = await prisma.topup_tiers.findMany({
        where: { is_delete: 0 },
        orderBy: { sort_order: "asc" },
      });
      return rows.map(toView);
    },

    async listActive() {
      const now = new Date();
      const rows = await prisma.topup_tiers.findMany({
        where: {
          is_delete: 0,
          status: "active",
          AND: [
            { OR: [{ start_time: null }, { start_time: { lte: now } }] },
            { OR: [{ end_time: null }, { end_time: { gte: now } }] },
          ],
        },
        orderBy: { sort_order: "asc" },
      });
      return rows.map(toView);
    },

    async getById(id) {
      const pid = parseId(id);
      if (pid === null) return null;
      const row = await prisma.topup_tiers.findFirst({
        where: { id: pid, is_delete: 0 },
      });
      return row ? toView(row) : null;
    },

    async create(input) {
      const maxSort = await prisma.topup_tiers.aggregate({
        where: { is_delete: 0 },
        _max: { sort_order: true },
      });
      const nextSort = (maxSort._max.sort_order ?? 0) + 1;
      const price = Math.round(input.originalPrice * input.discount * 100) / 100;

      const row = await prisma.topup_tiers.create({
        data: {
          name: input.name || `${input.amount}积分`,
          amount: BigInt(Math.round(input.amount)),
          original_price: input.originalPrice,
          discount: input.discount,
          price,
          is_recommended: input.isRecommended ?? false,
          status: input.status ?? "active",
          start_time: parseDateTime(input.startTime),
          end_time: parseDateTime(input.endTime),
          sort_order: nextSort,
        },
      });
      return toView(row);
    },

    async update(id, input) {
      const pid = parseId(id);
      if (pid === null) return null;
      const existing = await prisma.topup_tiers.findFirst({
        where: { id: pid, is_delete: 0 },
      });
      if (!existing) return null;

      const originalPrice = Number(input.originalPrice ?? existing.original_price);
      const discount = Number(input.discount ?? existing.discount);
      const price = Math.round(originalPrice * discount * 100) / 100;

      const data: Record<string, unknown> = {
        price,
        // 口径版本 +1。写在**保存**这一步（而不是只在改价时）：保存是运营唯一能改商品配置的
        // 入口，版本号要能覆盖名字 / 折扣 / 上下架 / 时间窗 —— 这些都会改变用户下单时看到的东西。
        // 排序不算配置（见 updateSortOrder：它只动 sort_order，不碰 version）。
        version: { increment: 1 },
        gmt_modified: new Date(),
      };
      if (input.name !== undefined) data.name = input.name;
      if (input.amount !== undefined) data.amount = BigInt(Math.round(input.amount));
      if (input.originalPrice !== undefined) data.original_price = input.originalPrice;
      if (input.discount !== undefined) data.discount = input.discount;
      if (input.isRecommended !== undefined) data.is_recommended = input.isRecommended;
      if (input.status !== undefined) data.status = input.status;
      if (input.startTime !== undefined) data.start_time = parseDateTime(input.startTime);
      if (input.endTime !== undefined) data.end_time = parseDateTime(input.endTime);
      if (input.sortOrder !== undefined) data.sort_order = input.sortOrder;

      const row = await prisma.topup_tiers.update({
        where: { id: pid },
        data,
      });
      return toView(row);
    },

    async remove(id) {
      const pid = parseId(id);
      if (pid === null) return false;
      const r = await prisma.topup_tiers.updateMany({
        where: { id: pid, is_delete: 0 },
        data: { is_delete: 1, gmt_modified: new Date() },
      });
      return r.count > 0;
    },

    async updateSortOrder(items) {
      const parsed = items.map((item) => ({
        pid: parseId(item.id),
        sortOrder: item.sortOrder,
        rawId: item.id,
      }));
      const invalid = parsed.find((p) => p.pid === null);
      if (invalid) throw new Error(`非法档位 id: ${invalid.rawId}`);
      await prisma.$transaction(
        parsed.map((item) =>
          prisma.topup_tiers.update({
            where: { id: item.pid as bigint },
            data: { sort_order: item.sortOrder, gmt_modified: new Date() },
          }),
        ),
      );
    },

    async maxSortOrder() {
      const r = await prisma.topup_tiers.aggregate({
        where: { is_delete: 0 },
        _max: { sort_order: true },
      });
      return r._max.sort_order ?? 0;
    },
  };
}
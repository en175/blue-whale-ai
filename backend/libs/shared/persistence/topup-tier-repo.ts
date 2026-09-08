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

      const data: Record<string, unknown> = { price, gmt_modified: new Date() };
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
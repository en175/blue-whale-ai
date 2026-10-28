import { wallClockRfc3339, wallClockRfc3339OrNull } from "@lib/core";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";


export type TopupTierStatus = "draft" | "active" | "inactive";

export type TopupTierPermission = "all" | "user_group" | "member_tier";

export interface TopupTierView {
  id: string;
  name: string;
  baseCredits: number;
  originalPrice: number;
  discount: number;
  price: number;
  isRecommended: boolean;
  status: TopupTierStatus;
  startTime: string | null;
  endTime: string | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;

  description: string;
  bonusCredits: number;
  activityTag: string;
  buttonText: string;
  firstPurchaseEligible: boolean;
  creditsValidMonths: number;
  permission: TopupTierPermission;
  permissionAllowlist: string[];
  permissionDeniedHint: string;
}

export interface CreateTopupTierInput {
  name?: string;
  baseCredits: number;
  originalPrice: number;
  discount: number;
  isRecommended?: boolean;
  status?: TopupTierStatus;
  startTime?: string | null;
  endTime?: string | null;
  description?: string;
  bonusCredits?: number;
  activityTag?: string;
  buttonText?: string;
  firstPurchaseEligible?: boolean;
  creditsValidMonths?: number;
  permission?: TopupTierPermission;
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
}

export interface UpdateTopupTierInput {
  name?: string;
  baseCredits?: number;
  originalPrice?: number;
  discount?: number;
  isRecommended?: boolean;
  status?: TopupTierStatus;
  startTime?: string | null;
  endTime?: string | null;
  sortOrder?: number;
  description?: string;
  bonusCredits?: number;
  activityTag?: string;
  buttonText?: string;
  firstPurchaseEligible?: boolean;
  creditsValidMonths?: number;
  permission?: TopupTierPermission;
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
}

export interface TopupTierRepo {
  listAll(): Promise<TopupTierView[]>;
  listActive(): Promise<TopupTierView[]>;
  getById(id: string): Promise<TopupTierView | null>;
  create(input: CreateTopupTierInput): Promise<TopupTierView>;
  update(id: string, input: UpdateTopupTierInput): Promise<TopupTierView | null>;
  remove(id: string): Promise<boolean>;
  updateSortOrder(items: { id: string; sortOrder: number }[]): Promise<void>;
}


function nullableJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

function toAllowlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const text =
      typeof item === "string"
        ? item.trim()
        : typeof item === "number" && Number.isSafeInteger(item) && item >= 0
          ? String(item)
          : "";
    if (!/^\d{1,19}$/.test(text)) continue;
    const id = String(BigInt(text));
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(row: any): TopupTierView {
  return {
    id: row.id.toString(),
    name: row.name,
    baseCredits: Number(row.base_credits),
    originalPrice: Number(row.original_price),
    discount: Number(row.discount),
    price: Number(row.price),
    isRecommended: row.is_recommended,
    status: row.status,
    startTime: wallClockRfc3339OrNull(row.start_time),
    endTime: wallClockRfc3339OrNull(row.end_time),
    sortOrder: row.sort_order,
    version: row.version,
    createdAt: wallClockRfc3339(new Date(row.gmt_create)),
    updatedAt: wallClockRfc3339(new Date(row.gmt_modified)),
    description: row.description,
    bonusCredits: Number(row.bonus_credits),
    activityTag: row.activity_tag,
    buttonText: row.button_text,
    firstPurchaseEligible: row.first_purchase_eligible === 1,
    creditsValidMonths: row.credits_valid_months,
    permission: row.permission,
    permissionAllowlist: toAllowlist(row.permission_allowlist),
    permissionDeniedHint: row.permission_denied_hint,
  };
}

function parseDateTime(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(v);
}

function parseId(id: string): bigint | null {
  if (typeof id !== "string" || !/^\d{1,19}$/.test(id)) return null;
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}


export function createTopupTierRepo(prisma: PrismaClient): TopupTierRepo {
  return {
    async listAll() {
      const rows = await prisma.billing_products.findMany({
        where: { is_delete: 0 },
        orderBy: { sort_order: "asc" },
      });
      return rows.map(toView);
    },

    async listActive() {
      const now = new Date();
      const rows = await prisma.billing_products.findMany({
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
      const row = await prisma.billing_products.findFirst({
        where: { id: pid, is_delete: 0 },
      });
      return row ? toView(row) : null;
    },

    async create(input) {
      const maxSort = await prisma.billing_products.aggregate({
        where: { is_delete: 0 },
        _max: { sort_order: true },
      });
      const nextSort = (maxSort._max.sort_order ?? 0) + 1;
      const price = Math.round(input.originalPrice * input.discount * 100) / 100;
      const baseCredits = BigInt(Math.round(input.baseCredits));

      const row = await prisma.billing_products.create({
        data: {
          name: input.name || `${input.baseCredits}积分`,
          base_credits: baseCredits,
          amount: baseCredits,
          original_price: input.originalPrice,
          discount: input.discount,
          price,
          is_recommended: input.isRecommended ?? false,
          status: input.status ?? "draft",
          start_time: parseDateTime(input.startTime),
          end_time: parseDateTime(input.endTime),
          sort_order: nextSort,
          description: input.description ?? "",
          bonus_credits: BigInt(Math.round(input.bonusCredits ?? 0)),
          activity_tag: input.activityTag ?? "",
          button_text: input.buttonText ?? "立享加赠",
          first_purchase_eligible: input.firstPurchaseEligible ? 1 : 0,
          credits_valid_months: input.creditsValidMonths ?? 24,
          permission: input.permission ?? "all",
          permission_allowlist: nullableJson(input.permissionAllowlist),
          permission_denied_hint: input.permissionDeniedHint ?? "",
        },
      });
      return toView(row);
    },

    async update(id, input) {
      const pid = parseId(id);
      if (pid === null) return null;
      const existing = await prisma.billing_products.findFirst({
        where: { id: pid, is_delete: 0 },
      });
      if (!existing) return null;

      const originalPrice = Number(input.originalPrice ?? existing.original_price);
      const discount = Number(input.discount ?? existing.discount);
      const price = Math.round(originalPrice * discount * 100) / 100;

      const data: Record<string, unknown> = {
        price,
        version: { increment: 1 },
        gmt_modified: new Date(),
      };
      if (input.name !== undefined) data.name = input.name;
      if (input.baseCredits !== undefined) {
        const credits = BigInt(Math.round(input.baseCredits));
        data.base_credits = credits;
        data.amount = credits;
      }
      if (input.originalPrice !== undefined) data.original_price = input.originalPrice;
      if (input.discount !== undefined) data.discount = input.discount;
      if (input.isRecommended !== undefined) data.is_recommended = input.isRecommended;
      if (input.status !== undefined) data.status = input.status;
      if (input.startTime !== undefined) data.start_time = parseDateTime(input.startTime);
      if (input.endTime !== undefined) data.end_time = parseDateTime(input.endTime);
      if (input.sortOrder !== undefined) data.sort_order = input.sortOrder;
      if (input.description !== undefined) data.description = input.description;
      if (input.bonusCredits !== undefined) {
        data.bonus_credits = BigInt(Math.round(input.bonusCredits));
      }
      if (input.activityTag !== undefined) data.activity_tag = input.activityTag;
      if (input.buttonText !== undefined) data.button_text = input.buttonText;
      if (input.firstPurchaseEligible !== undefined) {
        data.first_purchase_eligible = input.firstPurchaseEligible ? 1 : 0;
      }
      if (input.creditsValidMonths !== undefined) {
        data.credits_valid_months = input.creditsValidMonths;
      }
      if (input.permission !== undefined) data.permission = input.permission;
      if (input.permissionAllowlist !== undefined) {
        data.permission_allowlist = nullableJson(input.permissionAllowlist);
      }
      if (input.permissionDeniedHint !== undefined) {
        data.permission_denied_hint = input.permissionDeniedHint;
      }

      const row = await prisma.billing_products.update({
        where: { id: pid },
        data,
      });
      return toView(row);
    },

    async remove(id) {
      const pid = parseId(id);
      if (pid === null) return false;
      const r = await prisma.billing_products.updateMany({
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
          prisma.billing_products.update({
            where: { id: item.pid as bigint },
            data: { sort_order: item.sortOrder, gmt_modified: new Date() },
          }),
        ),
      );
    },
  };
}
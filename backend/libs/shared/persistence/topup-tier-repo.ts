import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/** 充值档位 repo（Prisma-backed），blue_whale 侧 CRUD。
 *  支付执行逻辑在 Go new-api，本 repo 只管档位数据。 */

/**
 * 上架状态三态（PRD §10.5）。
 *
 * <p>`draft` 是本次新增的**默认值**：新建卡片落在草稿，不上用户侧
 * （{@link TopupTierRepo.listActive} 只认 `active`），运营把字段配齐再上架。
 * 存量行一律不动 —— 它们已经是上架/下架，没有理由回退成草稿。
 */
export type TopupTierStatus = "draft" | "active" | "inactive";

/**
 * 购买权限（PRD §10.4）。
 *
 * <p>⚠️ `member_tier`（指定会员等级）是**阶段 2** 的事，本阶段只在枚举里占位、
 * 不做判断 —— 先写进列定义，将来接会员模块时加的是逻辑，不是 DDL。
 * 本阶段真正生效的是 `all` 与 `user_group`。
 */
export type TopupTierPermission = "all" | "user_group" | "member_tier";

export interface TopupTierView {
  id: string;
  name: string;
  amount: number;
  originalPrice: number;
  discount: number;
  price: number;
  isRecommended: boolean;
  status: TopupTierStatus;
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

  /* ── PRD §10.2 卡片展示与首购活动（迁移 047）── */
  /** 卡片说明。选填 → 空串表示未填 */
  description: string;
  /** 首购/活动赠送积分；0 = 不赠送。只有参与首购且用户满足首购条件时才发放 */
  bonusCredits: number;
  /** 活动标签，如「首购加赠 50%」；空串 = 无标签。已首购用户侧隐藏 */
  activityTag: string;
  /** 购买按钮文案，默认「立享加赠」 */
  buttonText: string;
  /** 是否参与首购。与 `recharge_orders.first_purchase_eligible` 同义：下单时快照进订单 */
  firstPurchaseEligible: boolean;
  /**
   * 到账积分有效期，单位**月**（默认 24 = 2 年）。
   *
   * <p>口径钉死为月：`年` 表达不了 6/18 个月这类档位，而月向上兼容。
   */
  creditsValidMonths: number;
  /** 购买权限。`all` / `user_group` 本阶段生效，`member_tier` 阶段 2 */
  permission: TopupTierPermission;
  /**
   * 权限白名单（userId 列表）。**读出恒为数组**：存量行的列是 NULL，归一成 `[]`。
   *
   * <p>元素是**十进制字符串**而不是 number —— userId 是 BigInt，
   * 超过 JS 安全整数范围后 number 会静默改值（`9007199254740993` → `…992`），
   * 而白名单错一位就是「放进来一个陌生人」。
   */
  permissionAllowlist: string[];
  /** 无权限提示文案；空串 = 用前端默认文案 */
  permissionDeniedHint: string;
}

export interface CreateTopupTierInput {
  name?: string;
  amount: number;
  originalPrice: number;
  discount: number;
  isRecommended?: boolean;
  /** 不传 = `draft`（PRD §10.5：新建卡片默认草稿） */
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
  amount?: number;
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

/**
 * 可空 JSON 列：null → **SQL NULL** 用 `Prisma.DbNull` 表达。
 *
 * <p>Prisma 不允许对 Json 列裸传 `null`——裸 `null` 在它那里是「JSON 里放一个 null」，
 * 列本身非空，与存量行的 SQL NULL 不是一回事。写进去的是哪种，读出来就得按哪种判断。
 */
function nullableJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

/**
 * 读白名单：**宽的读、严的写**。
 *
 * <p>列里理论上有三种东西：我们写进去的十进制 userId 串、存量行的 NULL、
 * 和手改过库的人留下的数字。读路径不该因为看不懂某一行就抛错，
 * 所以这里跳过无法识别的元素而不是报错；识别不了的一律丢掉。
 *
 * <p>掐前导零与写路径同口径（`007` → `7`）：不掐的话，「同一个用户在名单里存了两条」
 * 与「名单里有个谁也匹配不上的 id」会同时发生——比对是字符串比对。
 */
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
          // ⚠️ 默认 **draft**，不是 active（PRD §10.5「新建卡片默认草稿，不展示给用户」）。
          // 这里与列默认值同口径：即使有人绕过本 repo 直接 INSERT（漏写 status），
          // 落下来的也是草稿而不是「上线了」——错的方向必须是保守的那一边。
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
      // 显式 null = 清空白名单；[] = 名单为空（两者语义由调用方定，物理落点见 nullableJson）
      if (input.permissionAllowlist !== undefined) {
        data.permission_allowlist = nullableJson(input.permissionAllowlist);
      }
      if (input.permissionDeniedHint !== undefined) {
        data.permission_denied_hint = input.permissionDeniedHint;
      }

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
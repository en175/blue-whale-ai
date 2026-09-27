import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { TopupTierPermission } from "./topup-tier-repo.js";

/**
 * 自定义充值配置 repo（模块 B，PRD §7 / §10.3）。
 *
 * <p>**单行表**：`id` 恒为 {@link CUSTOM_CONFIG_ROW_ID}，主键把「只有一份配置」这件事
 * 钉在 DDL 上。整行读、整行写 —— PRD §10.3 的九个字段是一份完整口径，
 * 按字段分开存会出现「下限改了、上限还是旧的」那种中间态被读到。
 *
 * <p>⚠️ 配置**不落 `system_settings`**：那张表存凭证（AES 密文 + `is_secret` + 轮换语义），
 * 这里是明文商品配置。两者的读写路径与安全假设完全不同，混在一起迟早出事。
 */

/** 单行表唯一那行的主键。**不是自增**：多一行就是两份互相矛盾的配置。 */
export const CUSTOM_CONFIG_ROW_ID = 1;

/** 自定义充值配置的读视图（服务端内部口径，单位都是整数积分 / 月）。 */
export interface RechargeCustomConfigView {
  /** 最低充值积分（PRD §7.1 默认 600 = ¥40） */
  minCredits: number;
  /** 最高充值积分（PRD §7.1 默认 499,995） */
  maxCredits: number;
  /** 默认选中积分（PRD §7.1 默认 600） */
  defaultCredits: number;
  /**
   * 每元积分数（PRD §7.1 默认 15）。
   *
   * <p>⚠️ **本表自己的**换算率，与定价目录里那条**消费锚点**不是一回事：
   * 自定义充值是唯一真的拿它算价格的地方（`customPriceFen`）。
   * 档位到账积分读 `topup_tiers.base_credits`，与任何换算率都无关。
   */
  creditsPerYuan: number;
  /** 积分步长（PRD §10.3）。滑杆步进与手输修正用。 */
  stepCredits: number;
  /** 是否启用（PRD §10.3）。false = 用户侧不展示，下单被拒 */
  enabled: boolean;
  /** 购买权限。枚举与 `topup_tiers.permission` **同一套**（PRD §10.3「与固定积分卡一致」） */
  permission: TopupTierPermission;
  /** 白名单（userId 十进制字符串）。**读出恒为数组**：列的 NULL 归一成 `[]` */
  permissionAllowlist: string[];
  /** 无权限提示；空串 = 用前端默认文案 */
  permissionDeniedHint: string;
  /** 到账积分有效期，单位**月**（默认 24 = 2 年） */
  creditsValidMonths: number;
  /** 配置版本，每保存一次 +1（下单时快照进 `recharge_orders.config_version`） */
  version: number;
  /** 配置最后更新时间（ISO 8601）。管理端展示「当前口径是什么时候定的」 */
  updatedAt: string;
}

/** 保存配置的输入。**只传要改的键**：不传的键保持原值（部分更新）。 */
export interface SaveRechargeCustomConfigInput {
  minCredits?: number;
  maxCredits?: number;
  defaultCredits?: number;
  creditsPerYuan?: number;
  stepCredits?: number;
  enabled?: boolean;
  permission?: TopupTierPermission;
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
  creditsValidMonths?: number;
}

export interface RechargeCustomConfigRepo {
  /** 读唯一那行；**行不存在返回 null**（由调用方决定这是「配置错了」还是「用默认值」）。 */
  get(): Promise<RechargeCustomConfigView | null>;
  /**
   * 保存（upsert）并让 `version` +1。
   *
   * <p>用 upsert 而不是 update：行缺失时**不静默**——upsert 会把它建出来，
   * 而不是让运营在后台点了保存、什么都没发生。新建时 `version` 从 0 起。
   */
  save(input: SaveRechargeCustomConfigInput): Promise<RechargeCustomConfigView>;
}

/* ---------- helpers ---------- */

/**
 * 可空 JSON 列：null → **SQL NULL** 用 `Prisma.DbNull` 表达。
 *
 * <p>Prisma 不允许对 Json 列裸传 `null` —— 裸 `null` 在它那里是「JSON 里放一个 null」，
 * 列本身非空，与存量行的 SQL NULL 不是一回事。写进去的是哪种，读出来就得按哪种判断。
 * （与 `topup-tier-repo.ts` 里同名的私有函数同源，各留一份是为了两个 repo 互不依赖。）
 */
function nullableJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

/**
 * 读白名单：**宽的读、严的写**（与 `topup-tier-repo.ts` 同口径）。
 *
 * <p>列里理论上有三种东西：我们写进去的十进制 userId 串、列的 NULL、手改过库的人留下的数字。
 * 读路径不该因为看不懂某一行就抛错，识别不了的元素一律丢掉。
 * 掐前导零（`007` → `7`）与写路径一致，否则「同一用户在名单里存两条」与
 * 「名单里有个谁也匹配不上的 id」会同时发生 —— 比对是字符串比对。
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
function toView(row: any): RechargeCustomConfigView {
  return {
    minCredits: Number(row.min_credits),
    maxCredits: Number(row.max_credits),
    defaultCredits: Number(row.default_credits),
    creditsPerYuan: row.credits_per_yuan,
    stepCredits: Number(row.step_credits),
    enabled: row.enabled === 1,
    permission: row.permission,
    permissionAllowlist: toAllowlist(row.permission_allowlist),
    permissionDeniedHint: row.permission_denied_hint,
    creditsValidMonths: row.credits_valid_months,
    version: row.version,
    updatedAt: new Date(row.gmt_modified).toISOString(),
  };
}

/** 输入 → 列。只映射显式传了的键（undefined 的键整体不出现在写入里）。 */
function toColumns(input: SaveRechargeCustomConfigInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.minCredits !== undefined) out.min_credits = BigInt(input.minCredits);
  if (input.maxCredits !== undefined) out.max_credits = BigInt(input.maxCredits);
  if (input.defaultCredits !== undefined) {
    out.default_credits = BigInt(input.defaultCredits);
  }
  if (input.creditsPerYuan !== undefined) out.credits_per_yuan = input.creditsPerYuan;
  if (input.stepCredits !== undefined) out.step_credits = BigInt(input.stepCredits);
  if (input.enabled !== undefined) out.enabled = input.enabled ? 1 : 0;
  if (input.permission !== undefined) out.permission = input.permission;
  // 显式 null = 清空白名单；[] = 名单为空（两种语义由调用方定，物理落点见 nullableJson）
  if (input.permissionAllowlist !== undefined) {
    out.permission_allowlist = nullableJson(input.permissionAllowlist);
  }
  if (input.permissionDeniedHint !== undefined) {
    out.permission_denied_hint = input.permissionDeniedHint;
  }
  if (input.creditsValidMonths !== undefined) {
    out.credits_valid_months = input.creditsValidMonths;
  }
  return out;
}

/* ---------- factory ---------- */

export function createRechargeCustomConfigRepo(
  prisma: PrismaClient,
): RechargeCustomConfigRepo {
  return {
    async get() {
      const row = await prisma.recharge_custom_config.findUnique({
        where: { id: CUSTOM_CONFIG_ROW_ID },
      });
      return row ? toView(row) : null;
    },

    async save(input) {
      const columns = toColumns(input);
      const row = await prisma.recharge_custom_config.upsert({
        where: { id: CUSTOM_CONFIG_ROW_ID },
        // 行缺失时建出来（缺的列落表默认值 = PRD §7.1 的默认配置），
        // `version` 从 0 起与迁移种子的那一行同口径
        create: { id: CUSTOM_CONFIG_ROW_ID, version: 0, ...columns },
        // ⚠️ version 走数据库自增而不是「读出来 +1 再写回」：后者在并发保存下会丢一次版本
        //（两个运营同时保存，两人都读到 3、都写成 4）—— 而 config_version 是订单快照里
        // 回答「这单是哪一版配置」的唯一依据，丢版本等于两版不同的口径共用一个号。
        update: { ...columns, version: { increment: 1 }, gmt_modified: new Date() },
      });
      return toView(row);
    },
  };
}

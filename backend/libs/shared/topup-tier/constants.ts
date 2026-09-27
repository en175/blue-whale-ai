import type {
  TopupTierPermission,
  TopupTierStatus,
} from "@lib/shared/persistence/index.js";

/** 解析档位原价：只接受正整数，其余 → null。 */
export function parseTierOriginalPrice(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** 解析折扣比例：只接受 (0, 1] 的有限数字，其余 → null。 */
export function parseTierDiscount(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n <= 0 || n > 1) return null;
  return n;
}

/* ---------- 迁移 047 新增字段的解析（PRD §10.2 / §10.4 / §10.5） ---------- */

/** 三态白名单。**顺序即界面顺序**：草稿在前，因为新建卡片的落点就是它。 */
export const TOPUP_TIER_STATUSES = ["draft", "active", "inactive"] as const;

/**
 * 解析上架状态。
 *
 * <p>⚠️ 这里**不认识 undefined** —— 「没传」和「传了非法值」是两件事：
 * 前者该落到默认的 `draft`（PRD §10.5），后者该报 400。
 * 把 `undefined → draft` 混进这个函数，非法值就会被静默当成草稿存下来，
 * 运营会以为自己改成功了。默认值由调用方显式决定。
 */
export function parseTierStatus(raw: unknown): TopupTierStatus | null {
  return TOPUP_TIER_STATUSES.find((s) => s === raw) ?? null;
}

/** 三态的中文名（审计日志与列表共用一处，别在各页各写一份）。 */
export function tierStatusLabel(status: string): string {
  if (status === "draft") return "草稿";
  return status === "active" ? "上架" : "下架";
}

/**
 * 购买权限枚举（PRD §10.4）。
 *
 * <p>⚠️ `member_tier` 是**阶段 2** 的事，本阶段只占位不生效。放进枚举是为了
 * 「加值不用改表」——列的 VARCHAR(16) 现在就容得下它。
 */
export const TOPUP_TIER_PERMISSIONS = ["all", "user_group", "member_tier"] as const;

/** 解析购买权限：不认得的 → null（由调用方报 400）。不做 `undefined → all` 的兜底，理由同上。 */
export function parseTierPermission(raw: unknown): TopupTierPermission | null {
  return TOPUP_TIER_PERMISSIONS.find((p) => p === raw) ?? null;
}

/** 权限的中文名（管理端展示用）。 */
export function tierPermissionLabel(permission: string): string {
  if (permission === "user_group") return "指定用户群";
  if (permission === "member_tier") return "指定会员等级";
  return "全部登录用户";
}

/** 单个 userId 归一：数字取安全整数、字符串取纯数字，统一成**掐掉前导零的十进制串**。 */
function normalizeUserId(item: unknown): string | null {
  if (typeof item === "number") {
    return Number.isSafeInteger(item) && item >= 0 ? String(item) : null;
  }
  if (typeof item !== "string") return null;
  const trimmed = item.trim();
  if (!/^\d{1,19}$/.test(trimmed)) return null;
  // 掐前导零：`007` 与 `7` 是同一个用户，不去重就会在名单里存两条
  return String(BigInt(trimmed));
}

/**
 * 解析权限白名单（PRD §10.4「指定用户群」）。
 *
 * <p>元素是 userId 的**十进制字符串**，不是 number：userId 是 BigInt，
 * 超过 JS 安全整数后 number 会静默改值，白名单错一位就是放进一个陌生人。
 *
 * <p>返回 `null` = **输入不可解析**（调用方报 400）；`[]` 是合法值（名单为空）。
 * 两者必须分开 —— 否则「传了个对象」会被当成「名单为空」存下去。
 */
export function parseTierAllowlist(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    const id = normalizeUserId(item);
    if (id === null) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** 解析非负整数（赠送积分）：只接受 >= 0 的整数，其余 → null。 */
export function parseNonNegativeInt(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * 解析基础积分（**配置值**，单位整数积分；2026-09-27 起不再从原价派生）。
 *
 * <p>只接受 >= 1：0 积分的档位是「用户付了钱、账上什么都没有」，
 * `RechargeService.createOrder` 本来就拒绝它 —— 在**配置**这一步拦住比让用户
 * 点下去才报错好。数字串（表单从 DOM 出来就是字符串）与原价 / 折扣同口径放行。
 */
export function parseBaseCredits(raw: unknown): number | null {
  const n = parseNonNegativeInt(raw);
  if (n === null || n < 1) return null;
  return n;
}

/**
 * 解析积分有效期（PRD §10.2「积分有效期」，单位**月**）。
 *
 * <p>只接受 1..1200（100 年）的正整数：0 或负数会让本该到期的积分永不到期，
 * 上千个月的“有效期”实际上是「永久」，不如让人显式选别的表达。
 */
export function parseCreditsValidMonths(raw: unknown): number | null {
  const n = parseNonNegativeInt(raw);
  if (n === null || n < 1 || n > 1200) return null;
  return n;
}

/** 解析选填文本列：非字符串 → null（不明说就丢，不要 `String(obj)` 存成 `[object Object]`）。 */
export function parseOptionalText(raw: unknown): string | null {
  return typeof raw === "string" ? raw.trim() : null;
}


/** 档位没显式起名时，服务端生成的默认名形态：`<数字>积分`。 */
const AUTO_NAME_RE = /^\d+积分$/;

/**
 * 读档位时的展示名归一。
 *
 * <p>没起名的档位，服务端在**创建那一刻**把名字烘成 `${当时的到账积分}积分`。
 * 而到账积分现在是从定价目录派生的（`原价 × creditsPerYuan`）——**换算口径一改，
 * 老档位的名字就与它旁边那个数字对不上了**：列表里显示「5000000积分」、到账却是 150。
 * 用户和管理员都会当成扣错了。
 *
 * <p>所以读取时：**只对「看起来是自动生成的」名字重新派生**，人工起过的名字一律不动——
 * 名字是运营的表达，「春季特惠」不该被我们改写。
 */
export function displayTierName(storedName: string, derivedAmount: number): string {
  return AUTO_NAME_RE.test(storedName.trim()) ? `${derivedAmount}积分` : storedName;
}

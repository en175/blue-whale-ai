import type {
  TopupTierPermission,
  TopupTierStatus,
  TopupTierView,
} from "@lib/shared/persistence/index.js";

export function parseTierOriginalPrice(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function parseTierDiscount(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n <= 0 || n > 1) return null;
  return n;
}


export const TOPUP_TIER_STATUSES = ["draft", "active", "inactive"] as const;

export function parseTierStatus(raw: unknown): TopupTierStatus | null {
  return TOPUP_TIER_STATUSES.find((s) => s === raw) ?? null;
}

export function tierStatusLabel(status: string): string {
  if (status === "draft") return "草稿";
  return status === "active" ? "上架" : "下架";
}

export const TOPUP_TIER_PERMISSIONS = ["all", "user_group", "member_tier"] as const;

export function parseTierPermission(raw: unknown): TopupTierPermission | null {
  return TOPUP_TIER_PERMISSIONS.find((p) => p === raw) ?? null;
}

export function tierPermissionLabel(permission: string): string {
  if (permission === "user_group") return "指定用户群";
  if (permission === "member_tier") return "指定会员等级";
  return "全部登录用户";
}

export const DEFAULT_TIER_PERMISSION_DENIED_HINT = "当前账号暂不可购买该档位";

export function canPurchaseByPermission(
  permission: TopupTierPermission,
  allowlist: readonly string[],
  userId: number,
): boolean {
  if (permission === "user_group") {
    return allowlist.includes(String(userId));
  }
  return true;
}

export function canPurchaseTier(
  tier: Pick<TopupTierView, "permission" | "permissionAllowlist">,
  userId: number,
): boolean {
  return canPurchaseByPermission(tier.permission, tier.permissionAllowlist, userId);
}

export function tierDeniedHint(tier: Pick<TopupTierView, "permissionDeniedHint">): string {
  const hint = tier.permissionDeniedHint.trim();
  return hint || DEFAULT_TIER_PERMISSION_DENIED_HINT;
}

function normalizeUserId(item: unknown): string | null {
  if (typeof item === "number") {
    return Number.isSafeInteger(item) && item >= 0 ? String(item) : null;
  }
  if (typeof item !== "string") return null;
  const trimmed = item.trim();
  if (!/^\d{1,19}$/.test(trimmed)) return null;
  return String(BigInt(trimmed));
}

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

export function parseNonNegativeInt(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export function parseBaseCredits(raw: unknown): number | null {
  const n = parseNonNegativeInt(raw);
  if (n === null || n < 1) return null;
  return n;
}

export function parseCreditsValidMonths(raw: unknown): number | null {
  const n = parseNonNegativeInt(raw);
  if (n === null || n < 1 || n > 1200) return null;
  return n;
}

export function parseOptionalText(raw: unknown): string | null {
  return typeof raw === "string" ? raw.trim() : null;
}


const AUTO_NAME_RE = /^\d+积分$/;

export function displayTierName(storedName: string, grantedCredits: number): string {
  return AUTO_NAME_RE.test(storedName.trim()) ? `${grantedCredits}积分` : storedName;
}

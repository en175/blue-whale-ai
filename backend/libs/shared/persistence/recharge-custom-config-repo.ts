import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { TopupTierPermission } from "./topup-tier-repo.js";


export const CUSTOM_CONFIG_ROW_ID = 1;

export interface RechargeCustomConfigView {
  minCredits: number;
  maxCredits: number;
  defaultCredits: number;
  creditsPerYuan: number;
  stepCredits: number;
  enabled: boolean;
  permission: TopupTierPermission;
  permissionAllowlist: string[];
  permissionDeniedHint: string;
  creditsValidMonths: number;
  version: number;
  updatedAt: string;
}

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
  get(): Promise<RechargeCustomConfigView | null>;
  save(input: SaveRechargeCustomConfigInput): Promise<RechargeCustomConfigView>;
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
        create: { id: CUSTOM_CONFIG_ROW_ID, version: 0, ...columns },
        update: { ...columns, version: { increment: 1 }, gmt_modified: new Date() },
      });
      return toView(row);
    },
  };
}

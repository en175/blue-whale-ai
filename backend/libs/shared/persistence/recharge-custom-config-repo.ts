import { wallClockRfc3339 } from "@lib/core";
import type { PrismaClient } from "@prisma/client";
import type { TopupTierPermission } from "./topup-tier-repo.js";


export const RECHARGE_CUSTOM_SETTING_KEY = "rechargeCustom";

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

interface StoredConfig {
  minCredits: number;
  maxCredits: number;
  defaultCredits: number;
  creditsPerYuan: number;
  stepCredits: number;
  enabled: boolean;
  permission: TopupTierPermission;
  permissionAllowlist: string[] | null;
  permissionDeniedHint: string;
  creditsValidMonths: number;
}

interface SettingRow {
  setting_value: string;
  version: number;
  gmt_modified: Date;
}

const NUMERIC_FIELDS = [
  "minCredits",
  "maxCredits",
  "defaultCredits",
  "creditsPerYuan",
  "stepCredits",
  "creditsValidMonths",
] as const;


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

export function parseStoredConfig(raw: string): StoredConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const config = {} as StoredConfig;
  for (const field of NUMERIC_FIELDS) {
    const value = source[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
    config[field] = value;
  }
  const enabled = source.enabled;
  if (enabled !== true && enabled !== false && enabled !== 1 && enabled !== 0) {
    return null;
  }
  config.enabled = enabled === true || enabled === 1;
  if (typeof source.permission !== "string") return null;
  config.permission = source.permission as TopupTierPermission;
  if (source.permissionDeniedHint !== undefined && typeof source.permissionDeniedHint !== "string") {
    return null;
  }
  config.permissionDeniedHint =
    typeof source.permissionDeniedHint === "string" ? source.permissionDeniedHint : "";
  config.permissionAllowlist =
    source.permissionAllowlist == null ? null : toAllowlist(source.permissionAllowlist);
  return config;
}

function toView(config: StoredConfig, row: SettingRow): RechargeCustomConfigView {
  return {
    ...config,
    permissionAllowlist: config.permissionAllowlist ?? [],
    version: row.version,
    updatedAt: wallClockRfc3339(new Date(row.gmt_modified)),
  };
}

function mergeStored(
  current: StoredConfig,
  input: SaveRechargeCustomConfigInput,
): StoredConfig {
  return {
    minCredits: input.minCredits ?? current.minCredits,
    maxCredits: input.maxCredits ?? current.maxCredits,
    defaultCredits: input.defaultCredits ?? current.defaultCredits,
    creditsPerYuan: input.creditsPerYuan ?? current.creditsPerYuan,
    stepCredits: input.stepCredits ?? current.stepCredits,
    enabled: input.enabled ?? current.enabled,
    permission: input.permission ?? current.permission,
    permissionAllowlist:
      input.permissionAllowlist === undefined
        ? current.permissionAllowlist
        : input.permissionAllowlist,
    permissionDeniedHint: input.permissionDeniedHint ?? current.permissionDeniedHint,
    creditsValidMonths: input.creditsValidMonths ?? current.creditsValidMonths,
  };
}


export function createRechargeCustomConfigRepo(
  prisma: PrismaClient,
): RechargeCustomConfigRepo {
  async function readRow(): Promise<{ config: StoredConfig; row: SettingRow } | null> {
    const row = await prisma.system_settings.findUnique({
      where: { setting_key: RECHARGE_CUSTOM_SETTING_KEY },
    });
    if (!row) return null;
    const config = parseStoredConfig(row.setting_value);
    return config ? { config, row } : null;
  }

  return {
    async get() {
      const found = await readRow();
      return found ? toView(found.config, found.row) : null;
    },

    async save(input) {
      const found = await readRow();
      if (!found) {
        throw new Error(
          `自定义充值配置缺失或损坏：system_settings.${RECHARGE_CUSTOM_SETTING_KEY}`,
        );
      }
      const next = mergeStored(found.config, input);
      const row = await prisma.system_settings.update({
        where: { setting_key: RECHARGE_CUSTOM_SETTING_KEY },
        data: {
          setting_value: JSON.stringify(next),
          is_secret: false,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
      const config = parseStoredConfig(row.setting_value);
      if (!config) {
        throw new Error(
          `自定义充值配置写入后无法解析：system_settings.${RECHARGE_CUSTOM_SETTING_KEY}`,
        );
      }
      return toView(config, row);
    },
  };
}

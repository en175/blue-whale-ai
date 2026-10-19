import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { wallClockRfc3339 } from "@lib/core";
import { pricingFieldErr } from "@lib/shared/model-capability/constants.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

export interface MediaToolPricingRow {
  id: string;
  tool_type: string;
  label: string;
  pricing: unknown;
  version: number;
  enabled: boolean;
  charge_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateMediaToolPricingInput {
  label?: string;
  pricing?: Prisma.InputJsonValue;
  enabled?: boolean;
  charge_enabled?: boolean;
}

export type ParseMediaToolPricingUpdateResult =
  | { ok: true; value: UpdateMediaToolPricingInput }
  | { ok: false; error: string };

export function parseMediaToolPricingUpdate(
  body: unknown,
): ParseMediaToolPricingUpdateResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "请求体须为对象" };
  }
  const raw = body as Record<string, unknown>;
  const value: UpdateMediaToolPricingInput = {};
  if (raw.label !== undefined) {
    if (typeof raw.label !== "string" || raw.label.trim() === "") {
      return { ok: false, error: "label 须为非空字符串" };
    }
    if (raw.label.trim().length > 64) {
      return { ok: false, error: "label 不能超过 64 个字符" };
    }
    value.label = raw.label.trim();
  }
  if (raw.pricing !== undefined) {
    if (raw.pricing === null) {
      return { ok: false, error: "pricing 不能为 null" };
    }
    const error = pricingFieldErr(raw.pricing);
    if (error !== null) {
      return { ok: false, error };
    }
    value.pricing = raw.pricing as Prisma.InputJsonValue;
  }
  for (const key of ["enabled", "charge_enabled"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") {
      return { ok: false, error: `${key} 须为布尔值` };
    }
    value[key] = raw[key] as boolean;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, error: "没有可更新的字段" };
  }
  return { ok: true, value };
}

type PricingRow = {
  id: bigint;
  tool_type: string;
  label: string;
  pricing: unknown;
  version: number;
  enabled: boolean;
  charge_enabled: boolean;
  gmt_create: Date;
  gmt_modified: Date;
};

function toRow(row: PricingRow): MediaToolPricingRow {
  return {
    id: row.id.toString(),
    tool_type: row.tool_type,
    label: row.label,
    pricing: row.pricing,
    version: row.version,
    enabled: row.enabled,
    charge_enabled: row.charge_enabled,
    created_at: wallClockRfc3339(new Date(row.gmt_create)),
    updated_at: wallClockRfc3339(new Date(row.gmt_modified)),
  };
}

@Injectable()
export class MediaToolPricingAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return this.prisma.client.media_tool_pricing;
  }

  async listAll(): Promise<MediaToolPricingRow[]> {
    const rows = await this.client.findMany({
      where: { is_delete: false },
      orderBy: { tool_type: "asc" },
    });
    return rows.map(toRow);
  }

  async get(toolType: string): Promise<MediaToolPricingRow | null> {
    const row = await this.client.findFirst({
      where: { tool_type: toolType, is_delete: false },
    });
    return row ? toRow(row) : null;
  }

  async update(
    toolType: string,
    input: UpdateMediaToolPricingInput,
  ): Promise<MediaToolPricingRow | null> {
    const existing = await this.client.findFirst({
      where: { tool_type: toolType, is_delete: false },
    });
    if (!existing) return null;
    const data: Prisma.media_tool_pricingUpdateInput = {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.pricing !== undefined ? { pricing: input.pricing } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.charge_enabled !== undefined
        ? { charge_enabled: input.charge_enabled }
        : {}),
      version: { increment: 1 },
      gmt_modified: new Date(),
    };
    const row = await this.client.update({
      where: { id: existing.id },
      data,
    });
    return toRow(row);
  }

  async toggleCharge(toolType: string): Promise<MediaToolPricingRow | null> {
    const existing = await this.client.findFirst({
      where: { tool_type: toolType, is_delete: false },
    });
    if (!existing) return null;
    return this.update(toolType, {
      charge_enabled: !existing.charge_enabled,
    });
  }

  async toggleEnabled(toolType: string): Promise<MediaToolPricingRow | null> {
    const existing = await this.client.findFirst({
      where: { tool_type: toolType, is_delete: false },
    });
    if (!existing) return null;
    return this.update(toolType, { enabled: !existing.enabled });
  }
}

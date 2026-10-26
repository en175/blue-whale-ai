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

const TOOL_PRICING_CONTRACT: Record<
  string,
  { baseUnit: string; axes: readonly string[] }
> = {
  audio_mix: { baseUnit: "usage.seconds", axes: [] },
  audio_speed: { baseUnit: "usage.seconds", axes: [] },
  audio_trim: { baseUnit: "usage.seconds", axes: [] },
  audio_video_mux: { baseUnit: "usage.seconds", axes: ["resolution"] },
  image_cutout: { baseUnit: "constant:1", axes: [] },
  image_enhance: { baseUnit: "constant:1", axes: ["multiple"] },
  image_erase: { baseUnit: "constant:1", axes: [] },
  image_outpaint: { baseUnit: "constant:1", axes: [] },
  media_extract: { baseUnit: "usage.seconds", axes: [] },
  video_enhance: { baseUnit: "usage.seconds", axes: ["resolution"] },
  video_frame_interpolation: { baseUnit: "usage.seconds", axes: ["fps"] },
  video_matting: { baseUnit: "usage.seconds", axes: [] },
  video_scene_split: { baseUnit: "usage.seconds", axes: [] },
  video_subtitle_erase: { baseUnit: "usage.seconds", axes: [] },
  vocal_split: { baseUnit: "usage.seconds", axes: [] },
};

export function mediaToolPricingContractError(
  toolType: string,
  pricing: unknown,
): string | null {
  const contract = TOOL_PRICING_CONTRACT[toolType];
  if (!contract) return `未知工具类型：${toolType}`;
  const root = pricing as Record<string, unknown>;
  if (root.baseUnit !== contract.baseUnit) {
    return `baseUnit 须为 ${contract.baseUnit}`;
  }
  const basePrice = root.basePrice;
  if (basePrice === null || typeof basePrice !== "object" || Array.isArray(basePrice)) {
    return "basePrice 缺失或格式非法";
  }
  const price = basePrice as Record<string, unknown>;
  if (contract.axes.length === 0) {
    return price.kind === "const"
      ? null
      : "该工具只支持固定单价（basePrice.kind=const）";
  }
  if (price.kind !== "table") {
    return `该工具必须使用分档价（basePrice.kind=table，按 ${contract.axes.join("、")}）`;
  }
  const by = Array.isArray(price.by)
    ? price.by.filter((axis): axis is string => typeof axis === "string")
    : [];
  const axesMatch =
    by.length === contract.axes.length &&
    contract.axes.every((axis) => by.includes(axis));
  return axesMatch ? null : `分档维度须为 ${contract.axes.join("、")}`;
}

export function parseMediaToolPricingUpdate(
  body: unknown,
  toolType: string,
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
    const contractError = mediaToolPricingContractError(toolType, raw.pricing);
    if (contractError !== null) {
      return { ok: false, error: contractError };
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

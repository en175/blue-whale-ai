import { wallClockRfc3339 } from "@lib/core";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { invalidateModelCapabilityCache } from "./model-capability-cache.js";
import { defaultChannelFor } from "../generation/image-channel-parser.js";


export interface AdminModelCapabilityRow {
  id: string;
  provider_id: string;
  model_id: string;
  capability_type: string;
  model_label: string;
  icon: string | null;
  supported_sizes: unknown;
  supported_aspect_ratios: unknown;
  supported_durations: unknown | null;
  supported_formats: unknown;
  default_size: string;
  default_format: string | null;
  default_aspect_ratio: string;
  default_duration: number | null;
  features: unknown;
  channel: string | null;
  request_mapping: unknown;
  pricing: unknown;
  enabled: boolean;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateModelCapabilityInput {
  provider_id: string;
  model_id: string;
  capability_type: string;
  model_label: string;
  icon?: string | null;
  supported_sizes?: unknown;
  supported_aspect_ratios?: unknown;
  supported_durations?: unknown | null;
  supported_formats?: unknown;
  default_size?: string;
  default_format?: string | null;
  default_aspect_ratio?: string;
  default_duration?: number | null;
  features?: unknown;
  channel?: string;
  request_mapping?: unknown;
  pricing?: unknown | null;
  enabled?: boolean;
}

export interface UpdateModelCapabilityInput {
  model_label?: string;
  icon?: string | null;
  supported_sizes?: unknown;
  supported_aspect_ratios?: unknown;
  supported_durations?: unknown | null;
  supported_formats?: unknown;
  default_size?: string;
  default_format?: string | null;
  default_aspect_ratio?: string;
  default_duration?: number | null;
  features?: unknown;
  channel?: string;
  request_mapping?: unknown;
  pricing?: unknown | null;
  enabled?: boolean;
  sort_order?: number;
}

export type CreateModelCapabilityResult =
  | { ok: true; row: AdminModelCapabilityRow }
  | { ok: false; error: "conflict" };

export type UpdateSortOrderResult =
  | { ok: true }
  | { ok: false; error: "not-found"; missingId: string };

export interface ModelCapabilityAdminRepo {
  listAll(): Promise<AdminModelCapabilityRow[]>;
  getById(id: string): Promise<AdminModelCapabilityRow | null>;
  create(input: CreateModelCapabilityInput): Promise<CreateModelCapabilityResult>;
  update(
    id: string,
    input: UpdateModelCapabilityInput,
  ): Promise<AdminModelCapabilityRow | null>;
  toggleEnabled(id: string): Promise<AdminModelCapabilityRow | null>;
  remove(id: string): Promise<boolean>;
  updateSortOrder(
    items: { id: string; sortOrder: number }[],
  ): Promise<UpdateSortOrderResult>;
  setDefault(id: string): Promise<AdminModelCapabilityRow | null>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(row: any): AdminModelCapabilityRow {
  return {
    id: row.id.toString(),
    provider_id: row.provider_id,
    model_id: row.model_id,
    capability_type: row.capability_type,
    model_label: row.model_label,
    icon: row.icon,
    supported_sizes: row.supported_sizes,
    supported_aspect_ratios: row.supported_aspect_ratios,
    supported_durations: row.supported_durations,
    supported_formats: row.supported_formats,
    default_size: row.default_size,
    default_format: row.default_format,
    default_aspect_ratio: row.default_aspect_ratio,
    default_duration: row.default_duration,
    features: row.features,
    channel: typeof row.channel === "string" && row.channel.length > 0 ? row.channel : null,
    request_mapping: row.request_mapping ?? null,
    pricing: row.pricing ?? null,
    enabled: row.enabled,
    sort_order: row.sort_order,
    is_default: row.is_default === true,
    created_at: wallClockRfc3339(new Date(row.gmt_create)),
    updated_at: wallClockRfc3339(new Date(row.gmt_modified)),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function parseId(id: string): bigint | null {
  if (typeof id !== "string" || !/^\d{1,19}$/.test(id)) return null;
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

function deriveDefaultSize(input: CreateModelCapabilityInput): string {
  if (input.default_size) return input.default_size;
  const sizes = Array.isArray(input.supported_sizes) ? input.supported_sizes : [];
  const first = sizes[0];
  if (first && typeof first === "object" && first !== null && "id" in first) {
    const id = (first as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return "";
}

function nullableJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

export function createModelCapabilityAdminRepo(
  prisma: PrismaClient,
): ModelCapabilityAdminRepo {
  const repo: ModelCapabilityAdminRepo = {
    async listAll() {
      const rows = await prisma.generation_model_capability.findMany({
        where: { is_delete: false },
        orderBy: [{ capability_type: "asc" }, { sort_order: "asc" }],
      });
      return rows.map(toRow);
    },

    async getById(id) {
      const pid = parseId(id);
      if (pid === null) return null;
      const row = await prisma.generation_model_capability.findFirst({
        where: { id: pid, is_delete: false },
      });
      return row ? toRow(row) : null;
    },

    async create(input) {
      const maxSort = await prisma.generation_model_capability.aggregate({
        where: { is_delete: false },
        _max: { sort_order: true },
      });
      const nextSort = (maxSort._max.sort_order ?? 0) + 1;
      try {
        const row = await prisma.generation_model_capability.create({
          data: {
            provider_id: input.provider_id,
            model_id: input.model_id,
            capability_type: input.capability_type,
            model_label: input.model_label,
            icon: input.icon ?? null,
            supported_sizes: (input.supported_sizes ??
              []) as Prisma.InputJsonValue,
            supported_aspect_ratios: (input.supported_aspect_ratios ??
              []) as Prisma.InputJsonValue,
            supported_durations: nullableJson(input.supported_durations),
            supported_formats: (input.supported_formats ??
              []) as Prisma.InputJsonValue,
            default_size: deriveDefaultSize(input),
            default_format: input.default_format ?? null,
            default_aspect_ratio: input.default_aspect_ratio ?? "",
            default_duration: input.default_duration ?? null,
            features: (input.features ?? {}) as Prisma.InputJsonValue,
            channel: input.channel ?? defaultChannelFor(input.capability_type),
            request_mapping: nullableJson(input.request_mapping),
            pricing: nullableJson(input.pricing),
            enabled: input.enabled ?? true,
            sort_order: nextSort,
          },
        });
        return { ok: true, row: toRow(row) };
      } catch (error) {
        if (isUniqueConstraintError(error)) return { ok: false, error: "conflict" };
        throw error;
      }
    },

    async update(id, input) {
      const pid = parseId(id);
      if (pid === null) return null;
      const existing = await prisma.generation_model_capability.findFirst({
        where: { id: pid, is_delete: false },
      });
      if (!existing) return null;

      const data: Record<string, unknown> = { gmt_modified: new Date() };
      if (input.model_label !== undefined) data.model_label = input.model_label;
      if (input.icon !== undefined) data.icon = input.icon;
      if (input.supported_sizes !== undefined) data.supported_sizes = input.supported_sizes;
      if (input.supported_aspect_ratios !== undefined)
        data.supported_aspect_ratios = input.supported_aspect_ratios;
      if (input.supported_durations !== undefined)
        data.supported_durations = nullableJson(input.supported_durations);
      if (input.supported_formats !== undefined)
        data.supported_formats = input.supported_formats;
      if (input.default_size !== undefined) data.default_size = input.default_size;
      if (input.default_format !== undefined) data.default_format = input.default_format;
      if (input.default_aspect_ratio !== undefined)
        data.default_aspect_ratio = input.default_aspect_ratio;
      if (input.default_duration !== undefined)
        data.default_duration = input.default_duration;
      if (input.features !== undefined) data.features = input.features;
      if (input.channel !== undefined) data.channel = input.channel;
      if (input.request_mapping !== undefined)
        data.request_mapping = nullableJson(input.request_mapping);
      if (input.pricing !== undefined) data.pricing = nullableJson(input.pricing);
      if (input.enabled !== undefined) data.enabled = input.enabled;
      if (input.sort_order !== undefined) data.sort_order = input.sort_order;

      const row = await prisma.generation_model_capability.update({
        where: { id: pid },
        data,
      });
      return toRow(row);
    },

    async toggleEnabled(id) {
      const pid = parseId(id);
      if (pid === null) return null;
      const flipped = await prisma.$executeRaw`
        UPDATE generation_model_capability
        SET enabled = NOT enabled, gmt_modified = NOW()
        WHERE id = ${pid} AND is_delete = false
      `;
      if (flipped === 0) return null;
      const row = await prisma.generation_model_capability.findFirst({
        where: { id: pid, is_delete: false },
      });
      return row ? toRow(row) : null;
    },

    async remove(id) {
      const pid = parseId(id);
      if (pid === null) return false;
      const r = await prisma.generation_model_capability.updateMany({
        where: { id: pid, is_delete: false },
        data: { is_delete: true, gmt_modified: new Date() },
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
      if (invalid) throw new Error(`非法模型 id: ${invalid.rawId}`);
      const existing = await prisma.generation_model_capability.findMany({
        where: { id: { in: parsed.map((p) => p.pid as bigint) }, is_delete: false },
        select: { id: true },
      });
      const found = new Set(existing.map((r) => r.id.toString()));
      const missing = parsed.find((p) => !found.has((p.pid as bigint).toString()));
      if (missing) {
        return { ok: false, error: "not-found", missingId: missing.rawId };
      }
      await prisma.$transaction(
        parsed.map((item) =>
          prisma.generation_model_capability.update({
            where: { id: item.pid as bigint },
            data: { sort_order: item.sortOrder, gmt_modified: new Date() },
          }),
        ),
      );
      return { ok: true };
    },

    async setDefault(id) {
      const pid = parseId(id);
      if (pid === null) return null;
      const target = await prisma.generation_model_capability.findFirst({
        where: { id: pid, is_delete: false },
        select: { id: true, capability_type: true },
      });
      if (!target) return null;

      await prisma.$transaction([
        prisma.generation_model_capability.updateMany({
          where: {
            capability_type: target.capability_type,
            is_delete: false,
            is_default: true,
            id: { not: pid },
          },
          data: { is_default: false, gmt_modified: new Date() },
        }),
        prisma.generation_model_capability.update({
          where: { id: pid },
          data: { is_default: true, gmt_modified: new Date() },
        }),
      ]);

      const row = await prisma.generation_model_capability.findFirst({
        where: { id: pid, is_delete: false },
      });
      return row ? toRow(row) : null;
    },
  };
  return invalidateOnWrite(repo);
}

function invalidateOnWrite(repo: ModelCapabilityAdminRepo): ModelCapabilityAdminRepo {
  return {
    listAll: () => repo.listAll(),
    getById: (id) => repo.getById(id),
    create: async (input) => {
      const result = await repo.create(input);
      if (result.ok) await invalidateModelCapabilityCache();
      return result;
    },
    update: async (id, input) => {
      const row = await repo.update(id, input);
      if (row) await invalidateModelCapabilityCache();
      return row;
    },
    toggleEnabled: async (id) => {
      const row = await repo.toggleEnabled(id);
      if (row) await invalidateModelCapabilityCache();
      return row;
    },
    remove: async (id) => {
      const removed = await repo.remove(id);
      if (removed) await invalidateModelCapabilityCache();
      return removed;
    },
    updateSortOrder: async (items) => {
      const result = await repo.updateSortOrder(items);
      if (result.ok) await invalidateModelCapabilityCache();
      return result;
    },
    setDefault: async (id) => {
      const row = await repo.setDefault(id);
      if (row) await invalidateModelCapabilityCache();
      return row;
    },
  };
}

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/** generation_model_capability 管理端 repo（Prisma-backed，IK6T46）。
 *  与消费端 model-capability-repo（listEnabledByType，只管启用展示）互补：
 *  本 repo 管后台全量视图（含停用、未软删），字段保持 snake_case 原样往返，
 *  供 admin 列表展示与后续编辑（能力 JSON 列原始往返，不整形）。
 */

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
  enabled: boolean;
  sort_order: number;
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
  enabled?: boolean;
}

/** 编辑可改字段：展示/能力/默认参数/启停/排序。身份（provider_id/model_id/capability_type）创建后不可改。 */
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
  /** 管理端：列出全部未软删模型（含停用），按 capability_type + sort_order 排序。 */
  listAll(): Promise<AdminModelCapabilityRow[]>;
  /** 管理端：按 id 取单个未软删模型；id 非法或不存在 → null。 */
  getById(id: string): Promise<AdminModelCapabilityRow | null>;
  /** 新建模型；同 (provider_id, model_id) 已存在（含软删）→ conflict。 */
  create(input: CreateModelCapabilityInput): Promise<CreateModelCapabilityResult>;
  /** 更新模型（身份字段不可改）；id 不存在或已软删 → null。 */
  update(
    id: string,
    input: UpdateModelCapabilityInput,
  ): Promise<AdminModelCapabilityRow | null>;
  /** 启停切换：翻转 enabled（即时影响 dock 展示列表）；id 不存在或已软删 → null。 */
  toggleEnabled(id: string): Promise<AdminModelCapabilityRow | null>;
  /** 软删除（is_delete=true，行数据保留）；已软删或不存在 → false。 */
  remove(id: string): Promise<boolean>;
  /** 批量更新排序（sort_order）；任一 id 非法 → 抛错；任一 id 不存在/已软删 → not-found（不产生部分更新）。 */
  updateSortOrder(
    items: { id: string; sortOrder: number }[],
  ): Promise<UpdateSortOrderResult>;
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
    enabled: row.enabled,
    sort_order: row.sort_order,
    created_at: new Date(row.gmt_create).toISOString(),
    updated_at: new Date(row.gmt_modified).toISOString(),
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

/** id 守卫：仅接受十进制正整数串。BigInt("abc") 会抛错，不能让路径参数直接炸成 500。 */
function parseId(id: string): bigint | null {
  if (typeof id !== "string" || !/^\d{1,19}$/.test(id)) return null;
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

/** default_size 缺省时派生自 supported_sizes 首项 id（与服务端展示口径一致）。 */
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

/** 可空 JSON 列：null → SQL NULL 用 Prisma.DbNull 表达（Prisma 不允许对 Json 列裸传 null）。 */
function nullableJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

export function createModelCapabilityAdminRepo(
  prisma: PrismaClient,
): ModelCapabilityAdminRepo {
  return {
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
      // 原子翻转：SQL 层 NOT enabled，避免 read-modify-write 竞态（并发/双击下
      // 各语句都基于当前值取反，不丢失更新）。命中 0 行 = 不存在或已软删 → null。
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
      // 与 remove/toggleEnabled 同口径：只对未软删行生效。先整体校验存在性，
      // 任一 id 不存在/已软删 → not-found，避免事务产生部分更新。
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
  };
}

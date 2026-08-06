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

export interface ModelCapabilityAdminRepo {
  /** 管理端：列出全部未软删模型（含停用），按 capability_type + sort_order 排序。 */
  listAll(): Promise<AdminModelCapabilityRow[]>;
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
  };
}

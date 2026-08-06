/**
 * admin models — 模型能力目录数据层（IK6T46）。
 *
 * 对接 /api/admin/models 系列接口（withAdminUser 保护）。
 * 字段保持 snake_case 原样往返（对应 generation_model_capability 列），
 * 能力 JSON 列（supported_sizes / features 等）由服务端原样返回，
 * 编辑时经原始 JSON 编辑器改回。
 */

import { adminRequest } from "./admin-api";

export type AdminModelRow = {
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
};

export async function getModels(): Promise<AdminModelRow[]> {
  return (await adminRequest<AdminModelRow[]>("/api/admin/models")).data;
}

/** 新建 payload：身份字段 + 展示/能力/默认参数（服务端 parseModelCreateBody 校验形状）。 */
export type AdminModelCreatePayload = {
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
};

/** 编辑 payload：只含可编辑字段（身份创建后不可改）。 */
export type AdminModelUpdatePayload = {
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
};

export async function createModel(
  payload: AdminModelCreatePayload,
): Promise<AdminModelRow> {
  return (
    await adminRequest<AdminModelRow>("/api/admin/models", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  ).data;
}

export async function updateModel(
  id: string,
  payload: AdminModelUpdatePayload,
): Promise<AdminModelRow> {
  return (
    await adminRequest<AdminModelRow>(`/api/admin/models/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  ).data;
}

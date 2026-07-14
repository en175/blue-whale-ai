/**
 * assets —— 资产库列表请求层（assets 页用）。字段 snake_case 对齐后端。
 */

import { request, type Paged } from "./api";

/** 资产列表项（GET /api/agent/assets records，不含 storageKey）。 */
export type AssetItem = {
  id: number;
  type: string;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  source: string | null;
  created_at: string | null;
};

/** 资产列表：按 type 过滤 + 分页，按创建时间倒序。 */
export function listAssets(
  params: { type?: string; page?: number; size?: number } = {},
): Promise<Paged<AssetItem>> {
  const q = new URLSearchParams();
  if (params.type) q.set("type", params.type);
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 60));
  return request<Paged<AssetItem>>(`/assets?${q.toString()}`, "GET");
}

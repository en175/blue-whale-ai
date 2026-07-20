/**
 * assets —— 资产库列表请求层（assets 页用）。字段 camelCase 对齐后端。
 */

import { request, type Paged } from "./api";
import { apiRequest } from "./api-client";

/** 资产列表项（GET /api/agent/assets records，不含 storageKey）。 */
export type AssetItem = {
  id: number;
  type: string;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  source: string | null;
  createdAt: string | null;
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

/**
 * 上传素材到 TOS（后端中转）：multipart file + projectId + type → {id, url}。
 * 返回 url 为 TOS 永久地址，可持久化到 canvas 节点，刷新不丢（替 URL.createObjectURL 临时 blob）。
 */
export async function uploadAsset(
  file: File,
  projectId: number,
  type: "image" | "video" | "audio",
): Promise<{ id: number; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("projectId", String(projectId));
  fd.append("type", type);
  return apiRequest<{ id: number; url: string }>("/api/agent/assets/upload", {
    method: "POST",
    body: fd,
  });
}

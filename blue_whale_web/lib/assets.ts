/**
 * assets —— 资产库列表请求层 + 素材上传（前端分片直传 TOS，IK3PKB）。字段 camelCase 对齐后端。
 */

import { request, type Paged } from "./api";
import { uploadToTos } from "./uploadTos";

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
 * 上传素材（前端分片直传 TOS，IK3PKB）：
 *   1. uploadToTos：Next.js 签预签名 → 浏览器分片直传 TOS（进度 + 断点续传待补）
 *   2. commit：后端 HEAD 校验 + 落 Asset → {id, url}
 *
 * 返回 url 为 TOS 永久地址，可持久化到 canvas 节点，刷新不丢。
 * onProgress 回调直传百分比（0-100）。
 */
export async function uploadAsset(
  file: File,
  projectId: number,
  type: "image" | "video" | "audio",
  onProgress?: (pct: number) => void,
): Promise<{ id: number; url: string }> {
  const { storageKey } = await uploadToTos(file, projectId, type, onProgress);
  return request<{ id: number; url: string }>("/assets/upload/commit", "POST", {
    projectId,
    type,
    storageKey,
    contentType: file.type,
    size: file.size,
  });
}

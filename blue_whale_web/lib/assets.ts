/**
 * assets —— 资产库列表请求层（assets 页用）。字段 snake_case 对齐后端。
 */

import { request, type Paged } from "./api";
import { presignAsset, completeAsset } from "./api/endpoints";

/** 资产列表项（GET /api/assets records，不含 storageKey）。 */
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

/**
 * 把资产复制到目标普通 canvas 项目（生成页「添加到项目」用）。
 * Idempotency-Key 必传：同一资产→同一项目的重试须复用同一键（生命周期由调用点管理）。
 * 返回目标项目内的新副本；响应字段与 AssetItem 一致。
 */
export function copyAssetToProject(
  projectId: number,
  sourceAssetId: number,
  idempotencyKey: string,
): Promise<AssetItem> {
  return request<AssetItem>(
    `/projects/${projectId}/assets`,
    "POST",
    { source_asset_id: sourceAssetId },
    { "Idempotency-Key": idempotencyKey },
  );
}

/**
 * 上传媒体文件到对象存储（Node 资产 presign + PUT + complete 三步流）。
 *
 * 流程：① POST /api/agent/assets/uploads/presign → { storage_key, upload_url, headers }；
 *      ② PUT upload_url 直连 TOS（headers 由 presign 给，不走网关鉴权）；
 *      ③ POST /api/agent/assets/uploads/complete → HEAD 校验并落 Asset。
 * 返回 { id, url }：id = asset_id（string，全链路与 DockMediaItem.assetId / store key 对齐），
 * url 为 TOS 永久地址，可持久化到画布节点，刷新不丢。
 *
 * projectId 在 complete 时校验归属并写入 Asset.project_id。
 */
export async function uploadAsset(
  file: File,
  projectId: number,
  type: "image" | "video" | "audio",
): Promise<{ id: string; url: string }> {
  const presign = await presignAsset({
    type,
    mime: file.type || "application/octet-stream",
    size: file.size,
  });
  const putResp = await fetch(presign.upload_url, {
    method: "PUT",
    headers: presign.headers,
    body: file,
  });
  if (!putResp.ok) throw new Error(`上传失败: ${putResp.status}`);
  const asset = await completeAsset({
    project_id: String(projectId),
    type,
    mime: file.type || "application/octet-stream",
    size: file.size,
    storage_key: presign.storage_key,
  });
  return { id: asset.asset_id, url: asset.url };
}

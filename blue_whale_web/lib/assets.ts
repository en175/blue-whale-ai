/**
 * assets —— 资产库列表请求层（assets 页用）。字段 snake_case 对齐后端。
 */

import { request, type Paged } from "./api";
import { presignAsset, completeAsset } from "./api/endpoints";
import { detectMediaKind, readLocalMediaMetadata } from "./mediaSize";
import type { WireInteger } from "./wire-integer";

/** 资产列表项（GET /api/assets records，不含 storageKey）。 */
export type AssetItem = {
  id: number | string;
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
  projectId: WireInteger,
  sourceAssetId: WireInteger,
  idempotencyKey: string,
): Promise<AssetItem> {
  return request<AssetItem>(
    `/projects/${projectId}/assets`,
    "POST",
    { source_asset_id: sourceAssetId },
    { "Idempotency-Key": idempotencyKey },
  );
}

function uploadMime(file: File, type: "image" | "video" | "audio"): string {
  if (file.type.trim()) return file.type;
  if (type === "video") {
    const name = file.name.toLowerCase();
    if (name.endsWith(".mov")) return "video/quicktime";
    if (name.endsWith(".mp4")) return "video/mp4";
  }
  return "application/octet-stream";
}

/**
 * PUT 直连 TOS 带上传进度（fetch 无 upload 进度，需 XHR）。
 * onprogress 按 loaded/total 回报 0-100 百分比；非 2xx / 网络错误 / 中止均 reject。
 */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress((e.loaded / e.total) * 100);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`上传失败: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("上传失败: 网络错误"));
    xhr.onabort = () => reject(new Error("上传失败: 已取消"));
    xhr.send(file);
  });
}

/**
 * 上传会话：presign 结果 + 声明元数据。PUT/complete 失败后重试沿用同一会话
 * （同一 storage_key），complete 经 findCommittedUpload 幂等 —— 每个文件会话
 * 至多产生一个 Asset，重试不重复创建（IK67GX T03）。
 */
export type UploadSession = {
  type: "image" | "video" | "audio";
  mime: string;
  size: number;
  storage_key: string;
  upload_url: string;
  headers: Record<string, string>;
  /** 会话创建时刻（ms），与 expires_in 一起判定 presign 是否仍有效。 */
  created_at: number;
  expires_in: number;
};

/** presign 到期前 30s 即视为失效，避免 PUT 飞行途中过期。 */
function sessionStillUsable(session: UploadSession): boolean {
  return Date.now() < session.created_at + (session.expires_in - 30) * 1000;
}

/**
 * 取可用上传会话：existing 与文件匹配且未过期则原样复用（重试不重新 presign），
 * 否则新签一个。调用方应在 PUT 前保存返回值，失败重试才能沿用同一 storage_key。
 */
export async function ensureUploadSession(
  file: File,
  kind: "image" | "video" | "audio",
  existing?: UploadSession | null,
): Promise<UploadSession> {
  const mime = uploadMime(file, kind);
  if (
    existing &&
    existing.type === kind &&
    existing.mime === mime &&
    existing.size === file.size &&
    sessionStillUsable(existing)
  ) {
    return existing;
  }
  return {
    ...(await presignAsset({ type: kind, mime, size: file.size })),
    type: kind,
    mime,
    size: file.size,
    created_at: Date.now(),
  };
}

/** 会话内的 PUT + complete；complete 按 storage_key 幂等（findCommittedUpload）。 */
export async function completeUploadSession(input: {
  file: File;
  projectId?: WireInteger;
  kind: "image" | "video" | "audio";
  session: UploadSession;
  onProgress?: (pct: number) => void;
}): Promise<{ assetId: string; url: string }> {
  const { file, projectId, kind, session } = input;
  const metadata =
    kind === "video" ? await readLocalMediaMetadata(file, kind) : {};
  if (input.onProgress) {
    await putWithProgress(
      session.upload_url,
      session.headers,
      file,
      input.onProgress,
    );
  } else {
    const putResp = await fetch(session.upload_url, {
      method: "PUT",
      headers: session.headers,
      body: file,
    });
    if (!putResp.ok) throw new Error(`上传失败: ${putResp.status}`);
  }
  const asset = await completeAsset({
    ...(projectId == null ? {} : { project_id: String(projectId) }),
    type: kind,
    mime: session.mime,
    size: file.size,
    storage_key: session.storage_key,
    ...metadata,
  });
  return { assetId: asset.asset_id, url: asset.url };
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
 * 传入 onProgress 时 PUT 改走 XHR 以回报上传百分比（占位卡进度环）；不传保持 fetch 原路径。
 */
export async function uploadAsset(
  file: File,
  projectId?: WireInteger,
  declaredType?: "image" | "video" | "audio",
  onProgress?: (pct: number) => void,
): Promise<{ id: string; url: string }> {
  const type = declaredType ?? detectMediaKind(file);
  const session = await ensureUploadSession(file, type);
  const { assetId, url } = await completeUploadSession({
    file,
    projectId,
    kind: type,
    session,
    onProgress,
  });
  return { id: assetId, url };
}

/** 逻辑删除当前用户素材；服务端负责归属校验。 */
export function deleteAsset(assetId: WireInteger): Promise<void> {
  return request<void>(`/assets/${assetId}`, "DELETE");
}

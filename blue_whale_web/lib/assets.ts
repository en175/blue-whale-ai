/**
 * assets —— 资产库列表请求层（assets 页用）。字段 camelCase 对齐后端。
 */

import { request, type Paged } from "./api";
import { buildAuthHeaders } from "./api-client";
import { loadAccessToken } from "@/components/auth/authStorage";

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
 * onProgress 可选，回调上传百分比（0-100）；内部用 XHR 实现进度事件。
 */
export async function uploadAsset(
  file: File,
  projectId: number,
  type: "image" | "video" | "audio",
  onProgress?: (pct: number) => void,
): Promise<{ id: number; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("projectId", String(projectId));
  fd.append("type", type);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/agent/assets/upload");

    xhr.withCredentials = true;

    // 携带鉴权头（Bearer token + X-User-Id），对齐 apiFetch 行为
    const token = loadAccessToken();
    const authHeaders = buildAuthHeaders(token);
    for (const [key, value] of Object.entries(authHeaders)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`上传失败: ${xhr.status}`));
        return;
      }
      try {
        const json = JSON.parse(xhr.responseText);
        if (json.code !== 200) {
          reject(new Error(json.msg || `上传错误 ${json.code}`));
          return;
        }
        resolve(json.data as { id: number; url: string });
      } catch {
        reject(new Error(`上游响应非 JSON（HTTP ${xhr.status}）`));
      }
    };

    xhr.onerror = () => reject(new Error("网络错误，上传失败"));
    xhr.ontimeout = () => reject(new Error("上传超时"));

    xhr.send(fd);
  });
}

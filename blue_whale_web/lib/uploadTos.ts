/**
 * uploadTos —— 前端分片直传 TOS（IK3PKB）。
 *
 * 三步（Next.js 签名服务 + 浏览器分片直传，不经任何后端中转文件字节）：
 *   1. POST /api/upload/prepare         → { storageKey, uploadId, partSize }
 *   2. 逐片 POST /api/upload/sign-part  → { url }，fetch PUT 文件分片到 TOS，收 ETag
 *   3. POST /api/upload/complete        → 合并
 *
 * 断点续传：MVP 未实现 checkpoint（localStorage 存 uploadId+已传 parts），后续补。
 *
 * TODO(IK3PKB): /api/upload/* 三个 Next.js route 需加鉴权（校 JWT），MVP 暂开放。
 */
type PrepareResult = { storageKey: string; uploadId: string; partSize: number };
type Part = { PartNumber: number; ETag: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: { code: number; msg?: string; data?: T };
  try {
    json = await res.json();
  } catch {
    throw new Error(`预签名服务响应非 JSON（HTTP ${res.status}）`);
  }
  if (json.code !== 200) {
    throw new Error(json.msg || `预签名服务错误 ${json.code}`);
  }
  return json.data as T;
}

/**
 * 分片直传文件到 TOS。
 * @returns storageKey（commit 时回传后端落 Asset）
 */
export async function uploadToTos(
  file: File,
  projectId: number,
  type: "image" | "video" | "audio",
  onProgress?: (pct: number) => void,
): Promise<{ storageKey: string }> {
  // 1. prepare：生成 storageKey + 初始化分片拿 uploadId
  const prep = await postJson<PrepareResult>("/api/upload/prepare", {
    projectId,
    type,
    contentType: file.type,
    size: file.size,
  });
  const { storageKey, uploadId, partSize } = prep;

  // 2. 分片：逐片签 URL → PUT 到 TOS → 收 ETag
  const totalParts = Math.max(1, Math.ceil(file.size / partSize));
  const parts: Part[] = [];
  for (let i = 0; i < totalParts; i++) {
    const partNumber = i + 1;
    const start = i * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);

    const { url } = await postJson<{ url: string }>("/api/upload/sign-part", {
      storageKey,
      uploadId,
      partNumber,
    });

    const res = await fetch(url, { method: "PUT", body: blob });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`分片 ${partNumber}/${totalParts} 上传失败: HTTP ${res.status}`);
    }
    // ETag 在响应头，需 TOS CORS Expose（已配）
    const etag = res.headers.get("etag") || res.headers.get("ETag");
    if (!etag) {
      throw new Error(`分片 ${partNumber} 缺 ETag（检查 CORS Expose-Headers）`);
    }
    // TOS 返回 ETag 带引号，complete 去引号（联调时确认格式）
    parts.push({ PartNumber: partNumber, ETag: etag.replace(/^"|"$/g, "") });

    onProgress?.(Math.round((partNumber / totalParts) * 100));
  }

  // 3. complete：合并
  await postJson<{ ok: boolean }>("/api/upload/complete", { storageKey, uploadId, parts });
  onProgress?.(100);
  return { storageKey };
}

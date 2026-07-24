/**
 * TOS server client（IK3PKB 前端直传预签名）。
 *
 * 仅在 Next.js server route 内 import（持永久 AK/SK，绝不进客户端 bundle / git）。
 * AK/SK 走环境变量（.env.local，已 gitignore），不硬编码。
 */
import { TosClient } from "@volcengine/tos-sdk";

export const TOS_REGION = process.env.TOS_REGION || "cn-beijing";
// endpoint 传 host（不含 https://），tos-sdk 内部拼 {bucket}.{endpoint} + 协议
export const TOS_ENDPOINT = (process.env.TOS_ENDPOINT || "https://tos-cn-beijing.volces.com").replace(/^https?:\/\//, "");
export const TOS_BUCKET = process.env.TOS_BUCKET || "bluewhale-assets";
export const TOS_PREFIX = process.env.TOS_PREFIX || "sweet-oa";

/** 分片大小（TOS 要求除最后一片外 ≥ 5MB）。 */
export const PART_SIZE = 5 * 1024 * 1024;

/** 按类型大小上限（与后端 AssetService 对齐）。 */
export const MAX_SIZE: Record<string, number> = {
  image: 2 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
};

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

/** Content-Type → 扩展名（与后端 extension 对齐）。 */
export function extOf(contentType: string): string {
  return MIME_EXT[contentType.split(";")[0].trim().toLowerCase()] || "bin";
}

/** 建临时 TOS client（持永久 AK/SK）。 */
export function tosClient(): TosClient {
  const accessKeyId = process.env.TOS_ACCESS_KEY;
  const accessKeySecret = process.env.TOS_SECRET_KEY;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("TOS_ACCESS_KEY / TOS_SECRET_KEY 未配置（见 .env.local）");
  }
  return new TosClient({
    accessKeyId,
    accessKeySecret,
    region: TOS_REGION,
    endpoint: TOS_ENDPOINT,
  });
}

/** 生成 storageKey：{prefix}/assets/{projectId}/{type}/{uuid}.{ext}（与后端 buildPath 对齐）。 */
export function buildStorageKey(projectId: number, type: string, contentType: string): string {
  const ext = extOf(contentType);
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `${TOS_PREFIX}/assets/${projectId}/${type}/${uuid}.${ext}`;
}

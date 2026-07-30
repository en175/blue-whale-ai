/**
 * uploadRules —— 画布「上传附件」前端白名单 + 大小上限（IK55VE）。
 *
 * input accept 可被绕过（拖入/全选文件类型），合法性以扩展名白名单为准；
 * 扩展名缺失时回退 MIME 前缀判 kind。大小按 kind 分档：图片 20MB / 视频 500MB。
 * 校验不过一律前端拒绝（toast），不发出任何上传请求。
 */

/** input[accept] 值：图片 .jpg/.jpeg/.png/.webp/.gif，视频 .mp4/.mov/.webm（无音频）。 */
export const UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm";
/** IK55VT 参考卡参考图上传：仅图片白名单。 */
export const IMAGE_UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif";
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm"]);

export type UploadFileKind = "image" | "video";
export type UploadFileLike = { name: string; size: number; type: string };
export type UploadValidation =
  { ok: true; kind: UploadFileKind } | { ok: false; reason: string };

/** 扩展名（小写化）优先；缺失时回退 MIME 前缀。不在白名单一律 null。 */
function kindOf(file: UploadFileLike): UploadFileKind | null {
  const ext = /\.([a-z0-9]+)$/.exec(file.name.toLowerCase())?.[1];
  if (ext) {
    if (IMAGE_EXTS.has(ext)) return "image";
    if (VIDEO_EXTS.has(ext)) return "video";
    return null;
  }
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

/** 白名单 + 大小上限校验；超过才拒（等于放行）。 */
export function validateUploadFile(file: UploadFileLike): UploadValidation {
  const kind = kindOf(file);
  if (!kind) return { ok: false, reason: "仅支持图片与视频格式" };
  if (kind === "image" && file.size > MAX_IMAGE_BYTES)
    return { ok: false, reason: "图片超过 20MB，无法上传" };
  if (kind === "video" && file.size > MAX_VIDEO_BYTES)
    return { ok: false, reason: "视频超过 500MB，无法上传" };
  return { ok: true, kind };
}

/**
 * 多选分发：合法文件逐个 upload（调用方发起上传），非法文件逐个 reject（调用方 toast）。
 * 纯函数，同步执行；非法文件不会产生任何上传请求。
 */
export function selectUploadFiles<T extends UploadFileLike>(
  files: readonly T[],
  handlers: { upload: (file: T) => void; reject: (reason: string) => void },
): void {
  for (const file of files) {
    const result = validateUploadFile(file);
    if (result.ok) handlers.upload(file);
    else handlers.reject(result.reason);
  }
}

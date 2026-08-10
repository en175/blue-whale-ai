/**
 * uploadRules —— 画布「上传附件」与对话面板上传共用的前端白名单 + 大小上限。
 *
 * input accept 可被绕过（拖入/全选文件类型），合法性以扩展名白名单为准；
 * 扩展名缺失时回退 MIME 前缀判 kind。大小按 kind 分档，与后端
 * lib/assets/handle-upload.ts 的 MAX_BYTES 对齐：图片 20MB / 视频 200MB / 音频 25MB。
 * 校验不过一律前端拒绝（toast），不发出任何上传请求。
 */

/** input[accept] 值：图片 .jpg/.jpeg/.png/.webp/.gif，视频 .mp4/.mov/.webm，音频 .mp3/.wav/.m4a/.aac/.ogg。 */
export const UPLOAD_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.ogg";
/** IK55VT 参考卡参考图上传：仅图片白名单。 */
export const IMAGE_UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif";
/** 模板媒体上传（IK7JVE）：图片五格式 ≤20MB，视频仅 mp4 ≤200MB（grilling Q7）。 */
export const TEMPLATE_UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.mp4";
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "ogg"]);
const TEMPLATE_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const TEMPLATE_VIDEO_EXTS = new Set(["mp4"]);
const TEMPLATE_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type UploadFileKind = "image" | "video" | "audio";
export type UploadFileLike = { name: string; size: number; type: string };
export type UploadValidation =
  { ok: true; kind: UploadFileKind } | { ok: false; reason: string };
/** 模板媒体（IK7JVE）：kind 收窄为 image|video，与 TEMPLATE_UPLOAD_RULES 对齐。 */
export type TemplateUploadValidation =
  { ok: true; kind: "image" | "video" } | { ok: false; reason: string };

const UNSUPPORTED_REASON = "仅支持图片、视频与音频格式";

/** 扩展名（小写化）优先；缺失时回退 MIME 前缀。不在白名单一律 null。 */
function kindOf(file: UploadFileLike): UploadFileKind | null {
  const ext = /\.([a-z0-9]+)$/.exec(file.name.toLowerCase())?.[1];
  if (ext) {
    if (IMAGE_EXTS.has(ext)) return "image";
    if (VIDEO_EXTS.has(ext)) return "video";
    if (AUDIO_EXTS.has(ext)) return "audio";
    return null;
  }
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

/** 白名单 + 大小上限校验；超过才拒（等于放行）。 */
export function validateUploadFile(file: UploadFileLike): UploadValidation {
  const kind = kindOf(file);
  if (!kind) return { ok: false, reason: UNSUPPORTED_REASON };
  if (kind === "image" && file.size > MAX_IMAGE_BYTES)
    return { ok: false, reason: "图片超过 20MB，无法上传" };
  if (kind === "video" && file.size > MAX_VIDEO_BYTES)
    return { ok: false, reason: "视频超过 200MB，无法上传" };
  if (kind === "audio" && file.size > MAX_AUDIO_BYTES)
    return { ok: false, reason: "音频超过 25MB，无法上传" };
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

/** 模板媒体上传白名单 + 大小校验（IK7JVE）：与画布 uploadRules 同构，但视频收紧为仅 mp4。 */
export function validateTemplateUploadFile(
  file: UploadFileLike,
): TemplateUploadValidation {
  const ext = /\.([a-z0-9]+)$/.exec(file.name.toLowerCase())?.[1];
  if (ext) {
    if (TEMPLATE_IMAGE_EXTS.has(ext)) {
      if (file.size > MAX_IMAGE_BYTES) {
        return { ok: false, reason: "图片超过 20MB，无法上传" };
      }
      return { ok: true, kind: "image" };
    }
    if (TEMPLATE_VIDEO_EXTS.has(ext)) {
      if (file.size > MAX_VIDEO_BYTES) {
        return { ok: false, reason: "视频超过 200MB，无法上传" };
      }
      return { ok: true, kind: "video" };
    }
    return {
      ok: false,
      reason: "仅支持 jpg/jpeg/png/webp/gif 图片或 mp4 视频",
    };
  }
  // 无扩展名：回退 MIME 前缀判断（同画布 uploadRules 语义）。
  const mime = file.type.toLowerCase();
  if (TEMPLATE_IMAGE_MIMES.has(mime)) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, reason: "图片超过 20MB，无法上传" };
    }
    return { ok: true, kind: "image" };
  }
  if (mime === "video/mp4") {
    if (file.size > MAX_VIDEO_BYTES) {
      return { ok: false, reason: "视频超过 200MB，无法上传" };
    }
    return { ok: true, kind: "video" };
  }
  return { ok: false, reason: "仅支持 jpg/jpeg/png/webp/gif 图片或 mp4 视频" };
}

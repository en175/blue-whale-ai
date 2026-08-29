// IKBQEE / ADR-0078：生成任务失败错误码统一清单。
//
// 原则（ADR-0078）：
//  - 只登记不动名：历史 DB 已写入的 error.code 字面量不动（投影仍识别并给正确文案），
//    新写入一律用 canonical 枚举常量（同语义合并后的收敛码）；
//  - 同语义合并：重复语义的旧码归入 LEGACY_CODE_TO_CANONICAL 别名表，新写入不再使用；
//  - 五分类：input（入参/素材）/ provider（上游生成服务）/ processing（执行/转存/超时）/
//    safety（安全审核）/ internal（内部兜底）。
//  - 本文件是唯一来源：public-error.ts、所有 fail 调用点都引用它。新增失败码必须在此登记。

// ── input 类：入参/素材不合法——不可重试，改参数后重新发起 ──
export const ERROR_INVALID_INPUT = "invalid_input";
export const ERROR_UNSUPPORTED_TYPE = "unsupported_type";
export const ERROR_UNSUPPORTED_INPUT = "unsupported_input";
export const ERROR_MODEL_UNAVAILABLE = "model_unavailable";
export const ERROR_REFERENCE_ASSET_UNAVAILABLE = "reference_asset_unavailable";
export const ERROR_REFERENCE_LIMIT_EXCEEDED = "reference_limit_exceeded";
/** 媒体提取：源视频资产不可用（IKARDY）。 */
export const ERROR_SOURCE_ASSET_UNAVAILABLE = "source_asset_unavailable";

// ── provider 类：上游生成服务异常 ──
/** 生成服务欠费（new-api 402/余额不足）——不可重试，需充值（原被 provider_failed 吞语义）。 */
export const ERROR_QUOTA_EXHAUSTED = "quota_exhausted";
export const ERROR_PROVIDER_CREDENTIAL_MISSING = "provider_credential_missing";
export const ERROR_PROVIDER_CONFIG = "provider_config";
/** 瞬时失败：网络不可达/上游 5xx/结果转存失败等——可重试（图片自动重试依赖此码）。 */
export const ERROR_PROVIDER_FAILED = "provider_failed";
export const ERROR_PROVIDER_TIMEOUT = "provider_timeout";
export const ERROR_NO_RESULT = "no_result";

// ── processing 类：任务执行链路问题 ──
export const ERROR_SUBMISSION_UNKNOWN = "submission_unknown";
export const ERROR_TIMED_OUT = "timed_out";
export const ERROR_STORAGE_FAILED = "storage_failed";
export const ERROR_ALL_OUTPUTS_FAILED = "all_outputs_failed";

// ── safety 类：安全审核 ──
export const ERROR_CONTENT_REJECTED = "content_rejected";
export const ERROR_CONTENT_REVIEW_UNAVAILABLE = "content_review_unavailable";

// ── internal 类：兜底/未知异常 ──
export const ERROR_MEDIA_EXTRACT_FAILED = "media_extract_failed";
export const ERROR_VIDEO_GENERATION_FAILED = "video_generation_failed";
export const ERROR_IMAGE_GENERATION_FAILED = "image_generation_failed";

// ── 媒体提取端口码（IKARDY：视频→音频） ──
export const ERROR_VIDEO_HAS_NO_AUDIO_TRACK = "video_has_no_audio_track";
export const ERROR_VIDEO_DOWNLOAD_FAILED = "video_download_failed";
export const ERROR_VIDEO_TOO_LARGE = "video_too_large";
export const ERROR_EXTRACT_FAILED = "extract_failed";
export const ERROR_UPLOAD_FAILED = "upload_failed";
export const ERROR_ENQUEUE_FAILED = "enqueue_failed";

/**
 * 旧码 → canonical 别名表（ADR-0078 同语义合并）。
 * 历史 DB 已写入这些旧码：投影时经 resolveErrorCode 归一到 canonical 拿正确文案/可重试判定；
 * 新写入一律用 canonical 码，不再产生这些旧码。
 */
export const LEGACY_CODE_TO_CANONICAL: Record<string, string> = {
  invalid_video_inputs: ERROR_INVALID_INPUT,
  invalid_reference_video: ERROR_INVALID_INPUT,
  unsupported_video_inputs: ERROR_UNSUPPORTED_INPUT,
  unsupported_reference_type: ERROR_UNSUPPORTED_INPUT,
  invalid_video_response: ERROR_PROVIDER_FAILED,
};

/** 全部 canonical 错误码集合（投影白名单）。 */
export const GENERATION_ERROR_CODES = new Set<string>([
  ERROR_INVALID_INPUT,
  ERROR_UNSUPPORTED_TYPE,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_REFERENCE_ASSET_UNAVAILABLE,
  ERROR_REFERENCE_LIMIT_EXCEEDED,
  ERROR_SOURCE_ASSET_UNAVAILABLE,
  ERROR_QUOTA_EXHAUSTED,
  ERROR_PROVIDER_CREDENTIAL_MISSING,
  ERROR_PROVIDER_CONFIG,
  ERROR_PROVIDER_FAILED,
  ERROR_PROVIDER_TIMEOUT,
  ERROR_NO_RESULT,
  ERROR_SUBMISSION_UNKNOWN,
  ERROR_TIMED_OUT,
  ERROR_STORAGE_FAILED,
  ERROR_ALL_OUTPUTS_FAILED,
  ERROR_CONTENT_REJECTED,
  ERROR_CONTENT_REVIEW_UNAVAILABLE,
  ERROR_MEDIA_EXTRACT_FAILED,
  ERROR_VIDEO_GENERATION_FAILED,
  ERROR_IMAGE_GENERATION_FAILED,
  ERROR_VIDEO_HAS_NO_AUDIO_TRACK,
  ERROR_VIDEO_DOWNLOAD_FAILED,
  ERROR_VIDEO_TOO_LARGE,
  ERROR_EXTRACT_FAILED,
  ERROR_UPLOAD_FAILED,
  ERROR_ENQUEUE_FAILED,
]);

/** 可重试失败码（ADR-0078 修正：目前全部失败都可用户手动重试，retryable 恒 true。
 *  手动重试入口 `POST /retry` 只按 job.status === failed 放行、不看 code；
 *  失败原因由用户在 UI 上根据 message 自行判断（欠费→充值后重试、瞬时→直接重试）。
 *  若将来某个失败码不允许重试，在此按码标 false 即可。 */
export const RETRYABLE_ERROR_CODES = new Set<string>([
  ERROR_PROVIDER_FAILED,
  ERROR_PROVIDER_TIMEOUT,
  ERROR_STORAGE_FAILED,
  ERROR_QUOTA_EXHAUSTED,
  ERROR_INVALID_INPUT,
  ERROR_UNSUPPORTED_TYPE,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_REFERENCE_ASSET_UNAVAILABLE,
  ERROR_REFERENCE_LIMIT_EXCEEDED,
  ERROR_SOURCE_ASSET_UNAVAILABLE,
  ERROR_PROVIDER_CREDENTIAL_MISSING,
  ERROR_PROVIDER_CONFIG,
  ERROR_NO_RESULT,
  ERROR_SUBMISSION_UNKNOWN,
  ERROR_TIMED_OUT,
  ERROR_ALL_OUTPUTS_FAILED,
  ERROR_CONTENT_REJECTED,
  ERROR_CONTENT_REVIEW_UNAVAILABLE,
  ERROR_MEDIA_EXTRACT_FAILED,
  ERROR_VIDEO_GENERATION_FAILED,
  ERROR_IMAGE_GENERATION_FAILED,
  ERROR_VIDEO_HAS_NO_AUDIO_TRACK,
  ERROR_VIDEO_DOWNLOAD_FAILED,
  ERROR_VIDEO_TOO_LARGE,
  ERROR_EXTRACT_FAILED,
  ERROR_UPLOAD_FAILED,
  ERROR_ENQUEUE_FAILED,
]);

/** 是否可重试（ADR-0078 修正：目前一律可手动重试）。 */
export function isRetryableForType(code: string, type: string): boolean {
  return true;
}

/** 旧码归一为 canonical（未在别名表 → 原样返回，由调用方判断是否白名单内）。 */
export function resolveErrorCode(code: string): string {
  return LEGACY_CODE_TO_CANONICAL[code] ?? code;
}

/** 投影兜底：按任务类型生成 fallback 码（只对白名单外历史码触发）。 */
export function fallbackErrorCode(type: string): string {
  if (type === "video") return ERROR_VIDEO_GENERATION_FAILED;
  if (type === "media_extract") return ERROR_MEDIA_EXTRACT_FAILED;
  return ERROR_IMAGE_GENERATION_FAILED;
}

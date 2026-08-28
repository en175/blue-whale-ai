// IKBQEE / ADR-0078：生成任务失败错误投影层。
// 对外错误对象：顶层 {code, message, retryable} 保持兼容；新增 details（调试详情，禁展示用户）
// 与 params（结构化上下文，契约预留）。恒占位字段 retry_after_seconds/request_id/input_request_id/
// budget_effect 已移除。
import {
  ERROR_ALL_OUTPUTS_FAILED,
  ERROR_CONTENT_REJECTED,
  ERROR_CONTENT_REVIEW_UNAVAILABLE,
  ERROR_ENQUEUE_FAILED,
  ERROR_EXTRACT_FAILED,
  ERROR_IMAGE_GENERATION_FAILED,
  ERROR_INVALID_INPUT,
  ERROR_MEDIA_EXTRACT_FAILED,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_NO_RESULT,
  ERROR_PROVIDER_CONFIG,
  ERROR_PROVIDER_CREDENTIAL_MISSING,
  ERROR_PROVIDER_FAILED,
  ERROR_PROVIDER_TIMEOUT,
  ERROR_QUOTA_EXHAUSTED,
  ERROR_REFERENCE_ASSET_UNAVAILABLE,
  ERROR_REFERENCE_LIMIT_EXCEEDED,
  ERROR_SOURCE_ASSET_UNAVAILABLE,
  ERROR_STORAGE_FAILED,
  ERROR_SUBMISSION_UNKNOWN,
  ERROR_TIMED_OUT,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_UNSUPPORTED_TYPE,
  ERROR_UPLOAD_FAILED,
  ERROR_VIDEO_DOWNLOAD_FAILED,
  ERROR_VIDEO_GENERATION_FAILED,
  ERROR_VIDEO_HAS_NO_AUDIO_TRACK,
  ERROR_VIDEO_TOO_LARGE,
  GENERATION_ERROR_CODES,
  RETRYABLE_ERROR_CODES,
  fallbackErrorCode,
  resolveErrorCode,
} from "./error-codes.js";

/** 用户可见中文文案（ADR-0078：对外 message 一律由此生成，杜绝 provider 原文/英文 request id）。 */
function messageFor(code: string, type: string): string {
  switch (code) {
    case ERROR_SUBMISSION_UNKNOWN:
      return "无法确认视频任务是否已提交";
    case ERROR_TIMED_OUT:
      return "视频生成超时";
    case ERROR_STORAGE_FAILED:
      return "生成结果存储失败";
    case ERROR_PROVIDER_FAILED:
      return type === "video"
        ? "视频生成失败"
        : type === "audio"
          ? "音频生成失败"
          : "图像生成失败";
    case ERROR_NO_RESULT:
      return "生成服务未返回结果";
    case ERROR_ALL_OUTPUTS_FAILED:
      return "所有输出均生成失败";
    case ERROR_CONTENT_REJECTED:
      return "生成内容未通过安全审核";
    case ERROR_CONTENT_REVIEW_UNAVAILABLE:
      return "内容审核不可用";
    case ERROR_INVALID_INPUT:
      return "输入参数无效";
    case ERROR_UNSUPPORTED_TYPE:
      return "不支持的生成类型";
    case ERROR_UNSUPPORTED_INPUT:
      return "输入内容不支持";
    case ERROR_MODEL_UNAVAILABLE:
      return "模型未开通或不可用";
    case ERROR_REFERENCE_ASSET_UNAVAILABLE:
      return "参考素材不可用";
    case ERROR_REFERENCE_LIMIT_EXCEEDED:
      return "参考素材数量超过限制";
    case ERROR_SOURCE_ASSET_UNAVAILABLE:
      return "源视频资产不可用";
    case ERROR_QUOTA_EXHAUSTED:
      return "账户余额不足，请充值后重试";
    case ERROR_PROVIDER_CREDENTIAL_MISSING:
      return "生成服务凭证未配置";
    case ERROR_PROVIDER_CONFIG:
      return "生成服务配置不完整";
    case ERROR_PROVIDER_TIMEOUT:
      return "生成服务响应超时";
    case ERROR_VIDEO_HAS_NO_AUDIO_TRACK:
      return "视频没有音轨";
    case ERROR_VIDEO_DOWNLOAD_FAILED:
      return "视频下载失败";
    case ERROR_VIDEO_TOO_LARGE:
      return "视频超过大小上限";
    case ERROR_EXTRACT_FAILED:
      return "音频提取失败";
    case ERROR_UPLOAD_FAILED:
      return "音频上传失败";
    case ERROR_ENQUEUE_FAILED:
      return "任务入队失败";
    case ERROR_MEDIA_EXTRACT_FAILED:
      return "音频提取失败";
    case ERROR_VIDEO_GENERATION_FAILED:
      return "视频生成失败";
    case ERROR_IMAGE_GENERATION_FAILED:
      return "图像生成失败";
    default:
      if (type === "media_extract") return "音频提取失败";
      return type === "video"
        ? "视频生成失败"
        : type === "audio"
          ? "音频生成失败"
          : "图像生成失败";
  }
}

export interface PublicJobError {
  code: string;
  message: string;
  retryable: boolean;
  /** 调试详情（provider 原文、request_id、重试次数等）。禁止展示给用户，仅供排查/埋点。 */
  details?: Record<string, unknown> | null;
  /** 结构化上下文（契约预留，本期仅对个别码填充，如 max_reference_count）。 */
  params?: Record<string, unknown> | null;
}

/**
 * 把 DB 存储的原始 error 投影为对外错误对象（ADR-0078）。
 * - code：canonical 码保留；旧码经 LEGACY_CODE_TO_CANONICAL 归一；白名单外历史码按类型 fallback；
 * - message：一律 messageFor() 用户可读中文，不使用 DB 原文；
 * - retryable：真实按码判定（RETRYABLE_ERROR_CODES）；
 * - details：DB 原文 + 可选扩展详情（供排查，禁展示）；
 * - params：结构化上下文（本期预留）。
 */
export function projectPublicError(
  storedError: Record<string, unknown> | null,
  type: string,
): PublicJobError | null {
  if (storedError === null) return null;
  const rawCode = storedError.code;
  let code = rawCode == null ? fallbackErrorCode(type) : String(rawCode);
  code = resolveErrorCode(code);
  if (!GENERATION_ERROR_CODES.has(code)) {
    code = fallbackErrorCode(type);
  }
  const rawMessage =
    typeof storedError.message === "string" ? storedError.message : undefined;
  const details: Record<string, unknown> = {
    raw: rawMessage ?? null,
    ...(storedError.details !== undefined
      ? { stored: storedError.details }
      : {}),
  };
  return {
    code,
    message: messageFor(code, type),
    retryable: RETRYABLE_ERROR_CODES.has(code),
    details,
    params:
      storedError.params !== undefined && storedError.params !== null
        ? (storedError.params as Record<string, unknown>)
        : null,
  };
}

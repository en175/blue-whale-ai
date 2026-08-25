const KNOWN_CODES = new Set([
  "submission_unknown",
  "timed_out",
  "storage_failed",
  "provider_failed",
  "no_result",
  "all_outputs_failed",
  "content_rejected",
  "content_review_unavailable",
  "invalid_video_inputs",
  "reference_asset_unavailable",
  "unsupported_reference_type",
  "reference_limit_exceeded",
  "invalid_reference_video",
  "unsupported_video_inputs",
  "provider_credential_missing",
  "invalid_input",
  // IKARDY：媒体提取（视频→音频）
  "video_has_no_audio_track",
  "video_download_failed",
  "video_too_large",
  "extract_failed",
  "upload_failed",
  "enqueue_failed",
  "source_asset_unavailable",
  "media_extract_failed",
]);

function fallbackCode(type: string): string {
  if (type === "video") return "video_generation_failed";
  if (type === "media_extract") return "media_extract_failed";
  return "image_generation_failed";
}

function messageFor(code: string, type: string): string {
  switch (code) {
    case "submission_unknown":
      return "无法确认视频任务是否已提交";
    case "timed_out":
      return "视频生成超时";
    case "storage_failed":
      return "生成结果存储失败";
    case "provider_failed":
      return type === "video"
        ? "视频生成失败"
        : type === "audio"
          ? "音频生成失败"
          : "图像生成失败";
    case "no_result":
      return "生成服务未返回结果";
    case "all_outputs_failed":
      return "所有输出均生成失败";
    case "content_rejected":
      return "生成内容未通过安全审核";
    case "content_review_unavailable":
      return "内容审核不可用";
    case "invalid_video_inputs":
      return "视频输入参数无效";
    case "reference_asset_unavailable":
      return "参考素材不可用";
    case "unsupported_reference_type":
      return "不支持的参考素材类型";
    case "reference_limit_exceeded":
      return "参考素材数量超过限制";
    case "invalid_reference_video":
      return "参考视频无效";
    case "unsupported_video_inputs":
      return "不支持的视频输入";
    case "provider_credential_missing":
      return "生成服务凭证未配置";
    case "invalid_input":
      return "输入参数无效";
    // IKARDY：媒体提取
    case "video_has_no_audio_track":
      return "视频没有音轨";
    case "video_download_failed":
      return "视频下载失败";
    case "video_too_large":
      return "视频超过大小上限";
    case "extract_failed":
      return "音频提取失败";
    case "upload_failed":
      return "音频上传失败";
    case "enqueue_failed":
      return "任务入队失败";
    case "source_asset_unavailable":
      return "源视频资产不可用";
    case "media_extract_failed":
      return "音频提取失败";
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
  retry_after_seconds: number | null;
  request_id: string | null;
  input_request_id: string | null;
  budget_effect: string;
}

export function projectPublicError(
  storedError: Record<string, unknown> | null,
  type: string,
): PublicJobError | null {
  if (storedError === null) return null;
  const rawCode = storedError.code;
  let code = rawCode == null ? fallbackCode(type) : String(rawCode);
  const message = messageFor(code, type);
  if (!KNOWN_CODES.has(code)) {
    code = fallbackCode(type);
  }
  return {
    code,
    message,
    retryable: false,
    retry_after_seconds: null,
    request_id: null,
    input_request_id: null,
    budget_effect: "none",
  };
}

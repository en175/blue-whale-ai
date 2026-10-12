import {
  ERROR_AUDIO_GENERATION_FAILED,
  ERROR_IMAGE_GENERATION_FAILED,
  ERROR_INVALID_INPUT,
  ERROR_INVALID_REFERENCE,
  ERROR_MEDIA_EXTRACT_FAILED,
  ERROR_PLATFORM_QUOTA_EXHAUSTED,
  ERROR_PROVIDER_FAILED,
  ERROR_QUOTA_EXHAUSTED,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
  ERROR_VIDEO_GENERATION_FAILED,
  ERROR_VOCAL_SPLIT_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
  errorCodeToNumeric,
  isQuotaSignal,
  messageOf,
  type PublicGenerationError,
} from "@lib/contracts";

export const GENERATION_ERROR_CODES = new Set<string>(
  Object.keys(GENERATION_ERROR_NUMERIC_CODES),
);

export const LEGACY_CODE_TO_CANONICAL: Record<string, string> = {
  invalid_video_inputs: ERROR_INVALID_REFERENCE,
  invalid_reference_video: ERROR_INVALID_REFERENCE,
  unsupported_video_inputs: ERROR_UNSUPPORTED_INPUT,
  unsupported_reference_type: ERROR_UNSUPPORTED_INPUT,
  invalid_video_response: ERROR_PROVIDER_FAILED,
};

export function resolveErrorCode(code: string): string {
  return LEGACY_CODE_TO_CANONICAL[code] ?? code;
}

export function fallbackErrorCode(type: string): string {
  if (type === "video") return ERROR_VIDEO_GENERATION_FAILED;
  if (type === "media_extract") return ERROR_MEDIA_EXTRACT_FAILED;
  if (type === "audio") return ERROR_AUDIO_GENERATION_FAILED;
  if (type === "vocal_split") return ERROR_VOCAL_SPLIT_FAILED;
  if (type === "video_frame_interpolation") return ERROR_VIDEO_FRAME_INTERPOLATION_FAILED;
  return ERROR_IMAGE_GENERATION_FAILED;
}

export function messageFor(code: string, type: string): string {
  const fromTable = messageOf(errorCodeToNumeric(code));
  if (fromTable !== "未知错误") return fromTable;
  return messageOf(errorCodeToNumeric(fallbackErrorCode(type)));
}

function resolveLegacyQuotaOrigin(
  code: string,
  storedError: Record<string, unknown>,
): string {
  if (code !== ERROR_QUOTA_EXHAUSTED) return code;
  const message = storedError.message;
  if (typeof message !== "string" || !isQuotaSignal(message)) return code;
  return ERROR_PLATFORM_QUOTA_EXHAUSTED;
}

export function projectPublicError(
  storedError: Record<string, unknown> | null,
  type: string,
): PublicGenerationError | null {
  if (storedError === null) return null;
  const rawCode = storedError.code;
  let code = rawCode == null ? fallbackErrorCode(type) : String(rawCode);
  code = resolveErrorCode(code);
  code = resolveLegacyQuotaOrigin(code, storedError);
  if (!GENERATION_ERROR_CODES.has(code)) {
    code = fallbackErrorCode(type);
  }
  const tableMessage = messageFor(code, type);
  if (tableMessage !== "未知错误") {
    return {
      code: errorCodeToNumeric(code),
      reason: code,
      message: tableMessage,
    };
  }
  const storedMessage =
    typeof storedError.message === "string" && storedError.message.trim() !== ""
      ? storedError.message.trim()
      : null;
  return {
    code: errorCodeToNumeric(code),
    reason: code,
    message: storedMessage ?? "生成失败",
  };
}

/** 生成失败的公开错误投影（对齐 Java GenerationPublicError）。
 *  DB 存的内部 error map → 前端安全的 {code,message,retryable,...,budget_effect} 信封。
 *  不透出内部 detail / stack。 */

const KNOWN_CODES = new Set([
  "submission_unknown",
  "timed_out",
  "storage_failed",
  "provider_failed",
  "no_result",
  "all_outputs_failed",
  "content_rejected",
  "content_review_unavailable",
]);

function fallbackCode(type: string): string {
  return type === "video" ? "video_generation_failed" : "image_generation_failed";
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
      return type === "video" ? "视频生成失败" : "图像生成失败";
    case "no_result":
      return "生成服务未返回结果";
    case "all_outputs_failed":
      return "所有输出均生成失败";
    case "content_rejected":
      return "生成内容未通过安全审核";
    case "content_review_unavailable":
      return "内容审核不可用";
    default:
      return type === "video" ? "视频生成失败" : "图像生成失败";
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

/** stored error map → 公开信封；storedError 为 null 时返回 null（对齐 Java）。
 *  budget_effect 暂固定 "none"：点数/预留仍在 Java 层，Node 读路径先不跨库。 */
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

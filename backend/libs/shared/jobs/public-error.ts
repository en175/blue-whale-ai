// IKBQEE / ADR-0078：生成任务失败错误投影层。
// 二期：对外错误对象只含 { code: 数值码, message: 中文 }——数值码每错一码（1xxx 段，
// 见 packages/contracts/src/generation-error-codes.ts）；message 一律由 messageFor() 生成
// 用户可读中文，不暴露 provider 原文/英文 request id（原文存 DB error.details 供排查）。
// 文案唯一来源在 contracts/error-codes.ts（ERROR_CODE_DEFINITIONS，ADR-0083）。
// 本文件只对依赖任务类型（video/audio/image/media_extract）的码做 type 分支覆盖。
import {
  errorCodeMessage,
  errorCodeToNumeric,
  type PublicGenerationError,
} from "@blue-whale/contracts";
import {
  ERROR_PROVIDER_FAILED,
  GENERATION_ERROR_CODES,
  fallbackErrorCode,
  resolveErrorCode,
} from "./error-codes.js";

/**
 * 用户可见中文文案（ADR-0078：对外 message 一律由此生成，杜绝 provider 原文/英文 request id）。
 * 唯一来源：contracts/error-codes.ts 的 ERROR_CODE_DEFINITIONS（ADR-0083）——所有领域码的
 * 固定文案（含 submission_unknown/timed_out 等带「视频」语义的码）都从码表取。
 * 本函数唯一覆盖的是依赖任务类型（video/audio/image/media_extract）的 provider_failed——
 * 它在码表里是通用文案，此处按 type 输出；其余码直接查码表，未登记码按 type 兜底。
 */
export function messageFor(code: string, type: string): string {
  // 唯一 type 分支码：文案随任务类型变（码表只记通用文案），此处覆盖。
  if (code === ERROR_PROVIDER_FAILED) {
    return type === "video"
      ? "视频生成失败"
      : type === "audio"
        ? "音频生成失败"
        : "图像生成失败";
  }
  // 其余码：文案从统一码表取（唯一来源）。
  const fromTable = errorCodeMessage(code);
  if (fromTable) return fromTable;
  // 兜底：码表未登记（白名单外历史码）按 type 生成。
  if (type === "media_extract") return "音频提取失败";
  return type === "video"
    ? "视频生成失败"
    : type === "audio"
      ? "音频生成失败"
      : "图像生成失败";
}

/**
 * 把 DB 存储的原始 error 投影为对外错误对象（ADR-0078 二期）。
 * - code：canonical 字符串码归一 → 查数值映射表，输出每错一码的独立数值码（白名单外历史码按类型 fallback 后映射）；
 * - message：一律 messageFor() 用户可读中文，不使用 DB 原文；
 * - retryable/params/details：不入对外契约——retryable 目前恒可重试（前端一律展示重试），
 *   details 存 DB 供排查，避免泄漏 provider 原文。
 * 输入为 null（历史数据无 error / 非对象 error）时返回 null，由调用方按类型兜底。
 */
export function projectPublicError(
  storedError: Record<string, unknown> | null,
  type: string,
): PublicGenerationError | null {
  if (storedError === null) return null;
  const rawCode = storedError.code;
  let code = rawCode == null ? fallbackErrorCode(type) : String(rawCode);
  code = resolveErrorCode(code);
  if (!GENERATION_ERROR_CODES.has(code)) {
    code = fallbackErrorCode(type);
  }
  return {
    code: errorCodeToNumeric(code),
    message: messageFor(code, type),
  };
}

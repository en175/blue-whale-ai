// IKBQEE / ADR-0078：生成任务失败错误投影器（backend 特有，非错误码表）。
//
// 职责（单一）：把 DB 里存储的原始 job error 投影为对外错误对象 { code: 数值码, message: 中文 }。
//   - 判定辅助：GENERATION_ERROR_CODES（白名单）/ resolveErrorCode（旧码归一）/ fallbackErrorCode（按类型兜底）；
//   - messageFor：字符串码 → 中文文案（查 contracts 码表，未登记按类型兜底）；
//   - projectPublicError：storedError → { code, message }（对外）。
//
// 错误码**常量与文案**的唯一来源在 contracts/error-codes.ts（跨包共享，高内聚）。
// 本文件只含 backend 的投影判定，不做错误码 re-export——需要 ERROR_* 常量的消费方应直接从
// @blue-whale/contracts 引，不要经过本文件（避免双重来源）。
import {
  ERROR_AUDIO_GENERATION_FAILED,
  ERROR_IMAGE_GENERATION_FAILED,
  ERROR_INVALID_INPUT,
  ERROR_INVALID_REFERENCE,
  ERROR_MEDIA_EXTRACT_FAILED,
  ERROR_PROVIDER_FAILED,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_VIDEO_GENERATION_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
  errorCodeToNumeric,
  messageOf,
  type PublicGenerationError,
} from "@blue-whale/contracts";

/** 全部 canonical 错误码集合（投影白名单）。
 *  即生成域数值表中所有已登记字符串码——单一来源（contracts），此处不重复定义。 */
export const GENERATION_ERROR_CODES = new Set<string>(
  Object.keys(GENERATION_ERROR_NUMERIC_CODES),
);

/** 旧码 → canonical 别名表（ADR-0078 同语义合并）。
 *  历史 DB 已写入这些旧码：投影时经 resolveErrorCode 归一到 canonical。
 *  （保留供投影兼容历史数据；新写入不再产生这些旧码。） */
export const LEGACY_CODE_TO_CANONICAL: Record<string, string> = {
  // IKE7JP：参考素材/帧位类旧码统一归 invalid_reference（语义一致，不再归 invalid_input）。
  invalid_video_inputs: ERROR_INVALID_REFERENCE,
  invalid_reference_video: ERROR_INVALID_REFERENCE,
  unsupported_video_inputs: ERROR_UNSUPPORTED_INPUT,
  unsupported_reference_type: ERROR_UNSUPPORTED_INPUT,
  invalid_video_response: ERROR_PROVIDER_FAILED,
};

/** 旧码归一为 canonical（未在别名表 → 原样返回，由调用方判断是否白名单内）。 */
export function resolveErrorCode(code: string): string {
  return LEGACY_CODE_TO_CANONICAL[code] ?? code;
}

/** 投影兜底：按任务类型生成 fallback 码（只对白名单外历史码触发）。
 *  与 messageFor 兜底保持一致（video/audio/image/media_extract），音频任务兜到专属 audio 码。 */
export function fallbackErrorCode(type: string): string {
  if (type === "video") return ERROR_VIDEO_GENERATION_FAILED;
  if (type === "media_extract") return ERROR_MEDIA_EXTRACT_FAILED;
  if (type === "audio") return ERROR_AUDIO_GENERATION_FAILED;
  return ERROR_IMAGE_GENERATION_FAILED;
}

/**
 * 用户可见中文文案（ADR-0078：对外 message 一律由此生成，杜绝 provider 原文/英文 request id）。
 * 唯一来源：contracts/error-codes.ts 的 ERROR_CODES（一码一文案，ADR-0083）。
 * 先按字符串码转数字查码表；未登记（白名单外历史码或更细粒度 type）时按任务类型兜底。
 */
export function messageFor(code: string, type: string): string {
  // 唯一来源：码表（一码一文案）。已登记码直接查表。
  const fromTable = messageOf(errorCodeToNumeric(code));
  if (fromTable !== "未知错误") return fromTable;
  // 白名单外/未登记历史码：按类型 fallback 到 canonical 码，再查表取文案——
  // 不再 hardcode 文案（与码表单一来源），fallback 码必在码表，不会落到「未知错误」。
  return messageOf(errorCodeToNumeric(fallbackErrorCode(type)));
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
  // IKE7JP：码表文案优先（ADR-0078 对外 message 唯一来源）；码表未登记时（白名单外/细粒度码）
  // 用类型兜底码的码表文案（如「视频生成失败」）——上游/provider 原文（英文、request id）不外露，
  // 自有码的具体原因（首尾帧素材必须是图片等）由 messageFor 命中码表保留语义。code 一律出自码表。
  const tableMessage = messageFor(code, type);
  if (tableMessage !== "未知错误") {
    return {
      code: errorCodeToNumeric(code),
      message: tableMessage,
    };
  }
  // 理论上不可达（messageFor 对白名单内码必命中，白名单外码经 fallbackErrorCode 也必命中）；
  // 兜底保留 DB 原文，避免返回空文案。
  const storedMessage =
    typeof storedError.message === "string" && storedError.message.trim() !== ""
      ? storedError.message.trim()
      : null;
  return {
    code: errorCodeToNumeric(code),
    message: storedMessage ?? "生成失败",
  };
}

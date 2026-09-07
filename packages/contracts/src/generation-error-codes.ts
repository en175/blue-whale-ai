// IKBQEE / ADR-0078：生成任务失败错误码（跨包共享来源）。
// backend/libs/shared/jobs/error-codes.ts 是完整定义（含分类/白名单/可重试判定/别名归并），
// 本文件只导出 worker/runner/provider 需要引用的错误码常量。
// 原则：错误码是字符串契约——provider/worker/投影三层共用同一字面量，杜绝散落内联。

export const ERROR_INVALID_INPUT = "invalid_input";
export const ERROR_UNSUPPORTED_TYPE = "unsupported_type";
export const ERROR_UNSUPPORTED_INPUT = "unsupported_input";
export const ERROR_MODEL_UNAVAILABLE = "model_unavailable";
export const ERROR_REFERENCE_ASSET_UNAVAILABLE = "reference_asset_unavailable";
export const ERROR_REFERENCE_LIMIT_EXCEEDED = "reference_limit_exceeded";
export const ERROR_SOURCE_ASSET_UNAVAILABLE = "source_asset_unavailable";

export const ERROR_QUOTA_EXHAUSTED = "quota_exhausted";
export const ERROR_PROVIDER_CREDENTIAL_MISSING = "provider_credential_missing";
export const ERROR_PROVIDER_CONFIG = "provider_config";
export const ERROR_PROVIDER_FAILED = "provider_failed";
export const ERROR_PROVIDER_TIMEOUT = "provider_timeout";
export const ERROR_NO_RESULT = "no_result";

export const ERROR_SUBMISSION_UNKNOWN = "submission_unknown";
export const ERROR_TIMED_OUT = "timed_out";
export const ERROR_STORAGE_FAILED = "storage_failed";
export const ERROR_ALL_OUTPUTS_FAILED = "all_outputs_failed";

export const ERROR_CONTENT_REJECTED = "content_rejected";
export const ERROR_CONTENT_REVIEW_UNAVAILABLE = "content_review_unavailable";

export const ERROR_MEDIA_EXTRACT_FAILED = "media_extract_failed";
export const ERROR_VIDEO_GENERATION_FAILED = "video_generation_failed";
export const ERROR_IMAGE_GENERATION_FAILED = "image_generation_failed";

export const ERROR_VIDEO_HAS_NO_AUDIO_TRACK = "video_has_no_audio_track";
export const ERROR_VIDEO_DOWNLOAD_FAILED = "video_download_failed";
export const ERROR_VIDEO_TOO_LARGE = "video_too_large";
export const ERROR_EXTRACT_FAILED = "extract_failed";
export const ERROR_UPLOAD_FAILED = "upload_failed";
export const ERROR_ENQUEUE_FAILED = "enqueue_failed";

// ── 对外数值错误码（IKBQEE 二期：字符串码 → 每错一码的独立数值码）──
// 响应结构：{ code: 数值, msg: 中文, data: {job_id,status,progress,asset} }。
// 字符串码是内部契约（DB/worker/投影），数值码是前端消费的外部契约——一一映射、每个错误一个码。
// 段位：1001-1099 生成任务领域错误（quota_exhausted=1001 为用户格式示例约定）。
// 后续领域（如 Agent/资产/支付）从 1100+ 起扩展；未知/白名单外码兜底 1000。
// 保留位：1000 兜底、1001 固定 quota_exhausted；余下码位可被后续领域顺延占用。
export const GENERATION_ERROR_UNKNOWN_NUMERIC_CODE = 1000;
export const GENERATION_ERROR_NUMERIC_CODES: Record<string, number> = {
  [ERROR_QUOTA_EXHAUSTED]: 1001,
  [ERROR_INVALID_INPUT]: 1002,
  [ERROR_UNSUPPORTED_TYPE]: 1003,
  [ERROR_UNSUPPORTED_INPUT]: 1004,
  [ERROR_MODEL_UNAVAILABLE]: 1005,
  [ERROR_REFERENCE_ASSET_UNAVAILABLE]: 1006,
  [ERROR_REFERENCE_LIMIT_EXCEEDED]: 1007,
  [ERROR_SOURCE_ASSET_UNAVAILABLE]: 1008,
  [ERROR_PROVIDER_CREDENTIAL_MISSING]: 1009,
  [ERROR_PROVIDER_CONFIG]: 1010,
  [ERROR_PROVIDER_FAILED]: 1011,
  [ERROR_PROVIDER_TIMEOUT]: 1012,
  [ERROR_NO_RESULT]: 1013,
  [ERROR_SUBMISSION_UNKNOWN]: 1014,
  [ERROR_TIMED_OUT]: 1015,
  [ERROR_STORAGE_FAILED]: 1016,
  [ERROR_ALL_OUTPUTS_FAILED]: 1017,
  [ERROR_CONTENT_REJECTED]: 1018,
  [ERROR_CONTENT_REVIEW_UNAVAILABLE]: 1019,
  [ERROR_MEDIA_EXTRACT_FAILED]: 1020,
  [ERROR_VIDEO_GENERATION_FAILED]: 1021,
  [ERROR_IMAGE_GENERATION_FAILED]: 1022,
  [ERROR_VIDEO_HAS_NO_AUDIO_TRACK]: 1023,
  [ERROR_VIDEO_DOWNLOAD_FAILED]: 1024,
  [ERROR_VIDEO_TOO_LARGE]: 1025,
  [ERROR_EXTRACT_FAILED]: 1026,
  [ERROR_UPLOAD_FAILED]: 1027,
  [ERROR_ENQUEUE_FAILED]: 1028,
};

/** 字符串码 → 数值码；白名单外/未知码兜底 1000。 */
export function errorCodeToNumeric(code: string): number {
  return GENERATION_ERROR_NUMERIC_CODES[code] ?? GENERATION_ERROR_UNKNOWN_NUMERIC_CODE;
}

// ── provider 错误信号（上游错误正文识别，跨 provider 共享，IKDAJN）──
// provider 层据这些信号把上游错误归入错误码（content-policy > quota > provider_failed）。
// 单一来源：新增/调整 keyword 只改这里，各 provider（audio/video×2）同时生效。
// 注：packages/core/src/ark-image-client.ts 有同构本地副本（保留「余额」），IKDP2C 去重前
// 与权威版存在「余额」语义分歧——ARK 直连路径仍认「余额」，relay 路径不认（IKDQ5F）。

/** 内容安全策略信号：命中 → ERROR_CONTENT_REJECTED（版权/敏感）。中英文 keyword 都覆盖
 *  （实测线上英文 copyright restrictions / sensitive information、中文「版权」「敏感」都可能出现）。 */
export const CONTENT_POLICY_SIGNAL =
  /(copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy)/i;

/** 内容安全策略信号判定：copyright/sensitive 命中 → true（IKDAJN）。 */
export function isContentPolicySignal(text: string): boolean {
  return CONTENT_POLICY_SIGNAL.test(text);
}

/** 欠费信号（IKBQEE / ADR-0078 共享判定，自 new-api-video-task-provider 迁入统一）。
 *  不只看 402：new-api 预扣费失败常以 HTTP200+body 报错（job 1565/1612 真实案例），
 *  中文「预扣费额度失败/剩余额度/额度不足」与英文 quota/balance/insufficient 均命中。
 *  IKDQ5F：去掉「余额」一词——无用户/账户语境的「渠道无余额」「new-api 音频生成余额不足」
 *  等非用户欠费文案不再误判；真欠费靠「预扣费/剩余额度」锚点兜住。 */
export const NEW_API_QUOTA_SIGNAL =
  /(预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required)/i;

/** 欠费信号判定：HTTP 402 或正文命中欠费信号（IKBQEE）。 */
export function isQuotaSignal(text: string, status?: number): boolean {
  return status === 402 || NEW_API_QUOTA_SIGNAL.test(text);
}

/** 生成任务失败对外错误对象（ADR-0078 二期：数值码 + 中文文案，前端可直接展示 msg）。 */
export interface PublicGenerationError {
  /** 每错一码的独立数值码（1xxx 段；未知兜底 1000）。 */
  code: number;
  /** 用户可读中文文案（quota_exhausted→"账户余额不足，请充值后重试"）。 */
  message: string;
}

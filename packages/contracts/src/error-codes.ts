// 全库统一错误码文件（IKDZGM / ADR-0083）。
//
// 这就是要的「一份错误码」：全局唯一，高内聚。生成任务域、账号域、全局业务码
// 的错误码常量/数值表/文案表全部收在这一处。散落各处报错、要中文文案，都查这里。
//
// 段位约定（对齐 result.ts ADR-0078）：
//   4xx/5xx   —— HTTP 语义错误（参数/未授权/资源不存在等基础设施错误）
//   1xxx      —— 领域错误码，每错一码（生成域 1001-1028；账号域 1100+）
//   1xxxx     —— 全局业务码（Java SystemCode 系，如 100301 资源不存在）
//
// 对外契约：错误响应统一 { code: 数值码, message: 中文 }（见 result.ts ResultEnvelope）。
// 前端按数值 code 分支（如 web/src/api/jobs.ts isGenerationDomainError 用 1000-1099）。
//
// 职责边界：本文件是错误码 & 文案的唯一来源 + provider 错误信号识别；
// 信封函数 ok()/fail()/ResultEnvelope 在 result.ts（非错误码，不并入）。

// ═══════════════════════════════════════════════════════════════
// 一、生成任务域错误码（字符串契约，worker/provider/投影三层共用）
// ═══════════════════════════════════════════════════════════════
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
export const ERROR_AUDIO_GENERATION_FAILED = "audio_generation_failed";

export const ERROR_VIDEO_HAS_NO_AUDIO_TRACK = "video_has_no_audio_track";
export const ERROR_VIDEO_DOWNLOAD_FAILED = "video_download_failed";
export const ERROR_VIDEO_TOO_LARGE = "video_too_large";
export const ERROR_EXTRACT_FAILED = "extract_failed";
export const ERROR_UPLOAD_FAILED = "upload_failed";
export const ERROR_ENQUEUE_FAILED = "enqueue_failed";

/** HTTP 限流（IKDPHS）：NewApiError 第三参；过滤器按 status=429 透传。 */
export const RATE_LIMITED = "rate_limited";

// ═══════════════════════════════════════════════════════════════
// 二、账号域错误码（字符串契约）
// ═══════════════════════════════════════════════════════════════
export const ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE = 1100;
export const ACCOUNT_ERROR_PASSWORD_INCORRECT = "password_incorrect";
export const ACCOUNT_ERROR_PASSWORD_INVALID = "password_invalid";
export const ACCOUNT_ERROR_PASSWORD_NOT_SET = "password_not_set";

// ═══════════════════════════════════════════════════════════════
// 三、对外数值错误码（字符串码 → 每错一码的独立数值码）
// ═══════════════════════════════════════════════════════════════
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
  [ERROR_AUDIO_GENERATION_FAILED]: 1029,
};

/** 字符串码 → 数值码；白名单外/未知码兜底 1000。 */
export function errorCodeToNumeric(code: string): number {
  return GENERATION_ERROR_NUMERIC_CODES[code] ?? GENERATION_ERROR_UNKNOWN_NUMERIC_CODE;
}

export const ACCOUNT_ERROR_NUMERIC_CODES: Record<string, number> = {
  [ACCOUNT_ERROR_PASSWORD_INCORRECT]: 1101,
  [ACCOUNT_ERROR_PASSWORD_INVALID]: 1102,
  [ACCOUNT_ERROR_PASSWORD_NOT_SET]: 1103,
};

/** 字符串码 → 数值码；白名单外/未知码兜底 1100。 */
export function accountErrorToNumeric(code: string): number {
  return ACCOUNT_ERROR_NUMERIC_CODES[code] ?? ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE;
}

/** 账号域中文文案（对外 message 唯一生成，杜绝网关英文透传）。
 *  单一来源：经 accountErrorToNumeric 转数字后查 ERROR_CODES 表；未登记给账号域兜底。
 *  不再 switch 硬编码——避免与 ERROR_CODES 表双份维护（ADR-0083 一码一文案）。 */
export function accountMessageFor(code: string): string {
  const fromTable = ERROR_CODES[accountErrorToNumeric(code)];
  return fromTable ?? "账号操作失败，请稍后重试";
}

// ═══════════════════════════════════════════════════════════════
// 四、一码一中文文案表（对外 message 唯一来源）
// ═══════════════════════════════════════════════════════════════
export const ERROR_CODES: Record<number, string> = {
  // ── 生成任务领域（1xxx）──
  1001: "账户余额不足，请充值后重试",
  1002: "输入参数无效",
  1003: "不支持的生成类型",
  1004: "输入内容不支持",
  1005: "模型未开通或不可用",
  1006: "参考素材不可用",
  1007: "参考素材数量超过限制",
  1008: "源视频资产不可用",
  1009: "生成服务凭证未配置",
  1010: "生成服务配置不完整",
  1011: "生成服务响应异常",
  1012: "生成服务响应超时",
  1013: "生成服务未返回结果",
  1014: "无法确认视频任务是否已提交",
  1015: "视频生成超时",
  1016: "生成结果存储失败",
  1017: "所有输出均生成失败",
  1018: "生成内容未通过安全审核",
  1019: "内容审核不可用",
  1020: "音频提取失败",
  1021: "视频生成失败",
  1022: "图像生成失败",
  1023: "视频没有音轨",
  1024: "视频下载失败",
  1025: "视频超过大小上限",
  1026: "音频提取失败",
  1027: "音频上传失败",
  1028: "任务入队失败",
  1029: "音频生成失败", // audio_generation_failed
  // ── 账号域（1xxx，1100+）──
  1101: "原密码错误，请重试",
  1102: "新密码需为 8-20 位",
  1103: "当前账号未设置密码",
  // ── 全局业务码（1xxxx，Java SystemCode 系；常量见下方三节）──
  100000: "缺少幂等键",
  100100: "资源不存在",
  100202: "资源不可用",
  100301: "资源不存在",
  100302: "幂等键已使用",
  100303: "任务状态冲突",
  100307: "任务已处于终态，无法执行该操作",
  100308: "任务当前状态不可重试",
  100401: "计划消息不存在或不属于该项目",
  100402: "该计划的应用类型暂不支持",
  100403: "计划能力快照已过期，需生成新计划",
  100404: "该计划已应用成功，不可重复应用",
  100405: "余额不足，请充值后重试",
  100406: "版本冲突，请刷新后重试",
  100407: "覆盖目标已变化，请生成新计划",
  100408: "空参数卡片不可保存，请补全参考图或描述",
  100410: "共享资产类型不支持",
};

/** 按数字码取中文文案；未登记返回 undefined（调用方决定兜底/缺省文案）。 */
export function errorMessage(code: number): string | undefined {
  return ERROR_CODES[code];
}

/** 数字码 → 中文文案，未登记给缺省「未知错误」。（对外响应建议用之，避免 undefined 泄漏。） */
export function messageOf(code: number): string {
  return ERROR_CODES[code] ?? "未知错误";
}

// ═══════════════════════════════════════════════════════════════
// 五、provider 错误信号（上游错误正文识别，跨 provider 共享）
// ═══════════════════════════════════════════════════════════════
export const CONTENT_POLICY_SIGNAL =
  /(copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy)/i;

export function isContentPolicySignal(text: string): boolean {
  return CONTENT_POLICY_SIGNAL.test(text);
}

export const NEW_API_QUOTA_SIGNAL =
  /(预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required)/i;

export function isQuotaSignal(text: string, status?: number): boolean {
  return status === 402 || NEW_API_QUOTA_SIGNAL.test(text);
}

// ═══════════════════════════════════════════════════════════════
// 六、对外错误对象类型
// ═══════════════════════════════════════════════════════════════
export interface PublicGenerationError {
  code: number;
  message: string;
}

export interface PublicAccountError {
  code: number;
  message: string;
}

// ═══════════════════════════════════════════════════════════════
// 七、全局业务码常量（数字码；Java SystemCode 系，来源 result.ts）
//    信封函数 ok()/fail()/ResultEnvelope 留在 result.ts，不并入。
// ═══════════════════════════════════════════════════════════════
export const SUCCESS_CODE = 200;
export const FAILURE_CODE = 400;
export const DATA_NOT_EXIST_CODE = 100100;
export const ASSET_UNAVAILABLE_CODE = 100202;
export const RESOURCE_NOT_FOUND_CODE = 100301;
export const IDEMPOTENCY_KEY_REUSED_CODE = 100302;
export const AGENT_RUN_CONFLICT_CODE = 100303;
export const AGENT_RUN_ALREADY_TERMINAL_CODE = 100307;
export const AGENT_RUN_NOT_RETRYABLE_CODE = 100308;
export const PARAM_MISSING_CODE = 100000;
export const PLAN_APPLICATION_PLAN_NOT_FOUND_CODE = 100401;
export const PLAN_APPLICATION_KIND_UNSUPPORTED_CODE = 100402;
export const PLAN_APPLICATION_CAPABILITY_DRIFT_CODE = 100403;
export const PLAN_APPLICATION_ALREADY_APPLIED_CODE = 100404;
export const PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE = 100405;
export const SCENE_CARD_VERSION_CONFLICT_CODE = 100406;
export const PLAN_APPLICATION_TARGET_STALE_CODE = 100407;
export const SHARED_ASSET_EMPTY_CARD_CODE = 100408;
export const SHARED_ASSET_TYPE_UNSUPPORTED_CODE = 100410;

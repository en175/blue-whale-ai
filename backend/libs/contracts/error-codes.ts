
export const ERROR_INVALID_INPUT = "invalid_input";
export const ERROR_UNSUPPORTED_TYPE = "unsupported_type";
export const ERROR_UNSUPPORTED_INPUT = "unsupported_input";
export const ERROR_MODEL_UNAVAILABLE = "model_unavailable";
export const ERROR_REFERENCE_ASSET_UNAVAILABLE = "reference_asset_unavailable";
export const ERROR_REFERENCE_LIMIT_EXCEEDED = "reference_limit_exceeded";
export const ERROR_SOURCE_ASSET_UNAVAILABLE = "source_asset_unavailable";
export const ERROR_CAPABILITY_UNSUPPORTED_PARAM = "capability_unsupported_param";
export const ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION = "capability_unsupported_resolution";
export const ERROR_CAPABILITY_UNSUPPORTED_RATIO = "capability_unsupported_ratio";
export const ERROR_TASK_TYPE_PARAM_CONSTRAINT = "task_type_param_constraint";
export const ERROR_CAPABILITY_UNSUPPORTED_DURATION = "capability_unsupported_duration";
export const ERROR_INVALID_REFERENCE = "invalid_reference";
export const ERROR_INVALID_REFERENCE_TYPE = "invalid_reference_type";
export const ERROR_INVALID_REFERENCE_MEDIA = "invalid_reference_media";
export const ERROR_OUTPUT_COUNT_MISMATCH = "output_count_mismatch";

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
export const ERROR_CONTENT_REJECTED_REFERENCE = "content_rejected_reference";
export const ERROR_CONTENT_REJECTED_AUDIO = "content_rejected_audio";
export const ERROR_CONTENT_REVIEW_UNAVAILABLE = "content_review_unavailable";

export const ERROR_MEDIA_EXTRACT_FAILED = "media_extract_failed";
export const ERROR_VIDEO_GENERATION_FAILED = "video_generation_failed";
export const ERROR_IMAGE_GENERATION_FAILED = "image_generation_failed";
export const ERROR_AUDIO_GENERATION_FAILED = "audio_generation_failed";
export const ERROR_IMAGE_ENHANCE_FAILED = "image_enhance_failed";
export const ERROR_IMAGE_ERASE_FAILED = "image_erase_failed";
export const ERROR_IMAGE_OUTPAINT_FAILED = "image_outpaint_failed";
export const ERROR_IMAGE_CUTOUT_FAILED = "image_cutout_failed";
export const ERROR_VIDEO_SUBTITLE_ERASE_FAILED = "video_subtitle_erase_failed";
export const ERROR_MEDIA_EXTRACT_PROVIDER_FAILED = "media_extract_provider_failed";
export const ERROR_VIDEO_ENHANCE_FAILED = "video_enhance_failed";
export const ERROR_VOCAL_SPLIT_FAILED = "vocal_split_failed";
export const ERROR_AUDIO_TRIM_FAILED = "audio_trim_failed";
export const ERROR_AUDIO_MIX_FAILED = "audio_mix_failed";
export const ERROR_VIDEO_SCENE_SPLIT_FAILED = "video_scene_split_failed";
export const ERROR_VIDEO_MATTING_FAILED = "video_matting_failed";
export const ERROR_VIDEO_FRAME_INTERPOLATION_FAILED = "video_frame_interpolation_failed";
export const ERROR_AUDIO_SPEED_FAILED = "audio_speed_failed";
export const ERROR_AUDIO_VIDEO_MUX_FAILED = "audio_video_mux_failed";

export const ERROR_VIDEO_HAS_NO_AUDIO_TRACK = "video_has_no_audio_track";
export const ERROR_VIDEO_DOWNLOAD_FAILED = "video_download_failed";
export const ERROR_VIDEO_TOO_LARGE = "video_too_large";
export const ERROR_EXTRACT_FAILED = "extract_failed";
export const ERROR_UPLOAD_FAILED = "upload_failed";
export const ERROR_ENQUEUE_FAILED = "enqueue_failed";

export const ERROR_JOB_NOT_RETRYABLE_STATUS = "job_not_retryable_status";
export const ERROR_JOB_ALREADY_RETRIED = "job_already_retried";

export const ERROR_QUOTE_STALE = "quote_stale";
export const ERROR_FINALIZE_ALREADY_ATTEMPTED = "finalize_already_attempted";
export const ERROR_FINALIZE_DEADLINE_EXCEEDED = "finalize_deadline_exceeded";

export const GENERATION_ERROR_DETAIL_HTTP_STATUS = "http_status";

export const RATE_LIMITED = "rate_limited";

export const ACCOUNT_LOCKED = "account_locked";

export const ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE = 1100;
export const ACCOUNT_ERROR_PASSWORD_INCORRECT = "password_incorrect";
export const ACCOUNT_ERROR_PASSWORD_INVALID = "password_invalid";
export const ACCOUNT_ERROR_PASSWORD_NOT_SET = "password_not_set";

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
  [ERROR_CONTENT_REJECTED_REFERENCE]: 1038,
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
  [ERROR_CAPABILITY_UNSUPPORTED_PARAM]: 1030,
  [ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION]: 1031,
  [ERROR_CAPABILITY_UNSUPPORTED_RATIO]: 1032,
  [ERROR_CAPABILITY_UNSUPPORTED_DURATION]: 1033,
  [ERROR_INVALID_REFERENCE]: 1034,
  [ERROR_INVALID_REFERENCE_TYPE]: 1035,
  [ERROR_INVALID_REFERENCE_MEDIA]: 1036,
  [ERROR_OUTPUT_COUNT_MISMATCH]: 1037,
  [ERROR_IMAGE_ENHANCE_FAILED]: 1039,
  [ERROR_IMAGE_ERASE_FAILED]: 1040,
  [ERROR_IMAGE_OUTPAINT_FAILED]: 1041,
  [ERROR_IMAGE_CUTOUT_FAILED]: 1042,
  [ERROR_VIDEO_SUBTITLE_ERASE_FAILED]: 1043,
  [ERROR_MEDIA_EXTRACT_PROVIDER_FAILED]: 1044,
  [ERROR_VIDEO_ENHANCE_FAILED]: 1045,
  [ERROR_AUDIO_TRIM_FAILED]: 1048,
  [ERROR_VIDEO_SCENE_SPLIT_FAILED]: 1046,
  [ERROR_VOCAL_SPLIT_FAILED]: 1047,
  [ERROR_VIDEO_FRAME_INTERPOLATION_FAILED]: 1049,
  [ERROR_VIDEO_MATTING_FAILED]: 1050,
  [ERROR_AUDIO_MIX_FAILED]: 1051,
  [ERROR_AUDIO_SPEED_FAILED]: 1052,
  [ERROR_AUDIO_VIDEO_MUX_FAILED]: 1053,
  [ERROR_JOB_NOT_RETRYABLE_STATUS]: 1054,
  [ERROR_JOB_ALREADY_RETRIED]: 1055,
  [ERROR_QUOTE_STALE]: 1056,
  [ERROR_FINALIZE_ALREADY_ATTEMPTED]: 1057,
  [ERROR_FINALIZE_DEADLINE_EXCEEDED]: 1058,
  [ERROR_CONTENT_REJECTED_AUDIO]: 1059,
  [ERROR_TASK_TYPE_PARAM_CONSTRAINT]: 1060,
};

export function errorCodeToNumeric(code: string): number {
  return GENERATION_ERROR_NUMERIC_CODES[code] ?? GENERATION_ERROR_UNKNOWN_NUMERIC_CODE;
}

export const ACCOUNT_ERROR_NUMERIC_CODES: Record<string, number> = {
  [ACCOUNT_ERROR_PASSWORD_INCORRECT]: 1101,
  [ACCOUNT_ERROR_PASSWORD_INVALID]: 1102,
  [ACCOUNT_ERROR_PASSWORD_NOT_SET]: 1103,
};

export function accountErrorToNumeric(code: string): number {
  return ACCOUNT_ERROR_NUMERIC_CODES[code] ?? ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE;
}

export function accountMessageFor(code: string): string {
  const fromTable = ERROR_CODES[accountErrorToNumeric(code)];
  return fromTable ?? "账号操作失败，请稍后重试";
}


export interface ErrorCodeSpec {
  code: number;
  status: number;
  message: string;
}

export const ASSET_ERROR_SPECS = {
  ASSET_TYPE_UNSUPPORTED: {
    code: 2001,
    status: 400,
    message: "不支持的素材类型",
  },
  ASSET_TYPE_MIME_MISMATCH: {
    code: 2002,
    status: 400,
    message: "文件类型与声明类型不匹配",
  },
  ASSET_FORMAT_UNSUPPORTED: {
    code: 2003,
    status: 400,
    message: "这个图片格式读不了。请用 JPG、PNG、WebP 或 GIF。",
  },
  ASSET_SIZE_INVALID: {
    code: 2004,
    status: 400,
    message: "文件大小无效或超过限制",
  },
  ASSET_STORAGE_KEY_MISSING: {
    code: 2005,
    status: 400,
    message: "缺少存储键",
  },
  ASSET_STORAGE_KEY_FOREIGN: {
    code: 2006,
    status: 403,
    message: "存储键与当前用户不匹配",
  },
  ASSET_OBJECT_MISSING: {
    code: 2007,
    status: 404,
    message: "上传对象不存在",
  },
  ASSET_SIZE_MISMATCH: {
    code: 2008,
    status: 422,
    message: "文件大小与实际上传不符",
  },
  ASSET_MIME_MISMATCH: {
    code: 2009,
    status: 422,
    message: "文件类型与实际上传不符",
  },
  ASSET_BYTES_UNRECOGNIZED: {
    code: 2010,
    status: 400,
    message:
      "这个文件打不开，可能已损坏。请换一份 JPG、PNG、WebP 或 MP4 重新上传。",
  },
  ASSET_KIND_MISMATCH: {
    code: 2012,
    status: 422,
    message: "这个文件的实际类型和你选择的类型不一致。请重新上传。",
  },
  ASSET_STORAGE_UNCONFIGURED: {
    code: 2011,
    status: 503,
    message: "对象存储未配置",
  },
  ASSET_MATERIAL_UNAVAILABLE: {
    code: 2013,
    status: 400,
    message: "该素材未审核通过，不能用于视频生成",
  },
} as const satisfies Record<string, ErrorCodeSpec>;

export type AssetErrorName = keyof typeof ASSET_ERROR_SPECS;

export const SKILL_ERROR_SPECS = {
  SKILL_NOT_FOUND: {
    code: 100100,
    status: 404,
    message: "技能不存在",
  },
  SKILL_NAME_CONFLICT: {
    code: 100101,
    status: 409,
    message: "同名技能已存在",
  },
  SKILL_NAME_RESERVED: {
    code: 100102,
    status: 409,
    message: "名称与官方技能冲突",
  },
  SKILL_ADD_CONFLICT: {
    code: 100103,
    status: 409,
    message: "官方技能与你的个人技能同名，无法添加；你仍可直接使用",
  },
  SKILL_FORMAT_FAILED: {
    code: 100104,
    status: 503,
    message: "AI 格式化失败，请稍后重试",
  },
  SKILL_IN_USE: {
    code: 100105,
    status: 409,
    message: "技能正在使用中，无法删除",
  },
  SKILL_FORMAT_INVALID: {
    code: 100106,
    status: 400,
    message: "SKILL.md 格式不合法",
  },
  SKILL_PARAM_INVALID: {
    code: 100107,
    status: 400,
    message: "参数不合法",
  },
} as const satisfies Record<string, ErrorCodeSpec>;

export type SkillErrorName = keyof typeof SKILL_ERROR_SPECS;

export const ERROR_CODES: Record<number, string> = {
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
  1038: "生成内容可能涉及版权限制，请调整提示词或素材后重试",
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
  1029: "音频生成失败",
  1030: "当前模型不支持所选参数，请按提示调整",
  1031: "当前模型不支持所选分辨率",
  1032: "当前模型不支持所选比例",
  1033: "当前模型不支持所选时长",
  1034: "参考素材无效，请重新选择",
  1035: "参考素材类型不符合要求，请更换后重试",
  1036: "参考视频不符合要求（格式/大小/时长/像素），请更换后重试",
  1037: "生成数量与预期不符，请重新生成",
  1039: "高清放大失败，请重试",
  1040: "图片擦除失败，请重试",
  1041: "扩图失败，请重试",
  1042: "抠图失败，请重试",
  1043: "去字幕失败，请重试",
  1044: "音频提取失败，请重试",
  1045: "视频画质增强失败，请重试",
  1046: "场景切分失败，请重试",
  1047: "人声背景分离失败，请重试",
  1048: "音频截取失败，请重试",
  1049: "视频插帧失败，请重试",
  1050: "智能抠像失败，请重试",
  1051: "音频混合失败，请重试",
  1052: "音频调速失败，请重试",
  1053: "音视频合成失败，请重试",
  1054: "当前状态不允许重试，仅失败或部分成功的任务可重试",
  1055: "该任务的失败项已全部重试，无需再次重试",
  1056: "价格已更新，请刷新后重新确认提交",
  1057: "该样片已有成片任务，请查看其成片结果",
  1058: "已超过样片转成片的截止时间，可重新生成样片后再试",
  1059: "生成的音频可能涉及版权限制，请调整提示词后重试",
  1060: "提示词包含修改、替换或延长原视频的意图，输出比例将自动跟随参考视频，请将比例切换为「自动」后重试",
  1101: "原密码错误，请重试",
  1102: "新密码需为 8-20 位",
  1103: "当前账号未设置密码",
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
  100409: "幂等键冲突：同键异载荷",
  100410: "共享资产类型不支持",
};

for (const spec of Object.values(ASSET_ERROR_SPECS)) {
  ERROR_CODES[spec.code] = spec.message;
}
for (const spec of Object.values(SKILL_ERROR_SPECS)) {
  ERROR_CODES[spec.code] = spec.message;
}

export function errorMessage(code: number): string | undefined {
  return ERROR_CODES[code];
}

export function messageOf(code: number): string {
  return ERROR_CODES[code] ?? "未知错误";
}

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

export interface PublicGenerationError {
  code: number;
  reason?: string;
  message: string;
}

export interface PublicAccountError {
  code: number;
  message: string;
}

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
export const IDEMPOTENCY_CONFLICT_CODE = 100409;
export const SHARED_ASSET_TYPE_UNSUPPORTED_CODE = 100410;




const GLOBAL_CODE_HTTP_STATUS: Record<number, number> = {
  [PARAM_MISSING_CODE]: 400,
  [RESOURCE_NOT_FOUND_CODE]: 404,
  [ASSET_UNAVAILABLE_CODE]: 503,
  [1001]: 402,
  [IDEMPOTENCY_CONFLICT_CODE]: 409,
};

const SPEC_CODE_HTTP_STATUS: Record<number, number> = Object.fromEntries(
  [...Object.values(ASSET_ERROR_SPECS), ...Object.values(SKILL_ERROR_SPECS)].map(
    (spec) => [spec.code, spec.status],
  ),
);

export function httpStatusForCode(code: number): number {
  if (code >= 400 && code <= 599) return code;
  return SPEC_CODE_HTTP_STATUS[code] ?? GLOBAL_CODE_HTTP_STATUS[code] ?? 400;
}

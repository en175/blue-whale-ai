// 全库统一错误码表（IKDZGM / ADR-0083 阶段1：单一码表）。
//
// 目标：全库错误码的**文案唯一来源** + **数值码唯一映射**。此前散落三处：
//  - result.ts                 —— 全局业务码（1xxxx，Java SystemCode 系，数字码）
//  - generation-error-codes.ts —— 生成任务领域码（字符串契约 + 1xxx 数值）
//  - account-error-codes.ts    —— 账号域码（字符串契约 + 1xxx 数值）
// 各域各有一张 `xxx_NUMERIC_CODES` 表 + 各自 `xxxMessageFor`，文案在各调用点写死。
//
// 原则（对齐 ADR-0078 / 0083）：
//  - 错误码是字符串契约（ADR-0078）：表项 key 用域码常量，禁止散落内联字面量；
//  - 段位：4xx/5xx=HTTP 语义、1xxx=领域错误码（每错一码）、1xxxx=全局业务码；
//  - 对外错误对象统一 { code: 数值码, message: 中文 }；message 一律由本表生成；
//  - 新增/改文案只改本表，不再跨多文件平维护。
//
// 注意：生成任务域部分码文案依赖任务类型（video/audio/image/media_extract），type 分支
// 留在 backend/libs/shared/jobs/public-error.js 的 messageFor(code,type)（与后端字段投影耦合），
// 本表只记「无 type 差异」的通用文案，type 分支码的 value 为兜底。
import {
  ACCOUNT_ERROR_PASSWORD_INCORRECT,
  ACCOUNT_ERROR_PASSWORD_INVALID,
  ACCOUNT_ERROR_PASSWORD_NOT_SET,
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
} from "./account-error-codes.js";
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
  GENERATION_ERROR_UNKNOWN_NUMERIC_CODE,
} from "./generation-error-codes.js";

/**
 * 领域错误码定义表：字符串域码 → { 数值码, 通用中文文案 }。
 * 唯一来源——新增/调整领域错误码或文案在此登记（每错一码）。
 */
export const ERROR_CODE_DEFINITIONS: Record<string, { code: number; message: string }> = {
  // ── 生成任务领域（1xxx，1001-1028）──
  [ERROR_INVALID_INPUT]: { code: 1002, message: "输入参数无效" },
  [ERROR_UNSUPPORTED_TYPE]: { code: 1003, message: "不支持的生成类型" },
  [ERROR_UNSUPPORTED_INPUT]: { code: 1004, message: "输入内容不支持" },
  [ERROR_MODEL_UNAVAILABLE]: { code: 1005, message: "模型未开通或不可用" },
  [ERROR_REFERENCE_ASSET_UNAVAILABLE]: { code: 1006, message: "参考素材不可用" },
  [ERROR_REFERENCE_LIMIT_EXCEEDED]: { code: 1007, message: "参考素材数量超过限制" },
  [ERROR_SOURCE_ASSET_UNAVAILABLE]: { code: 1008, message: "源视频资产不可用" },
  [ERROR_QUOTA_EXHAUSTED]: { code: 1001, message: "账户余额不足，请充值后重试" },
  [ERROR_PROVIDER_CREDENTIAL_MISSING]: { code: 1009, message: "生成服务凭证未配置" },
  [ERROR_PROVIDER_CONFIG]: { code: 1010, message: "生成服务配置不完整" },
  [ERROR_PROVIDER_FAILED]: { code: 1011, message: "生成服务响应异常" }, // type 分支见 backend messageFor
  [ERROR_PROVIDER_TIMEOUT]: { code: 1012, message: "生成服务响应超时" },
  [ERROR_NO_RESULT]: { code: 1013, message: "生成服务未返回结果" },
  [ERROR_SUBMISSION_UNKNOWN]: { code: 1014, message: "无法确认视频任务是否已提交" },
  [ERROR_TIMED_OUT]: { code: 1015, message: "视频生成超时" },
  [ERROR_STORAGE_FAILED]: { code: 1016, message: "生成结果存储失败" },
  [ERROR_ALL_OUTPUTS_FAILED]: { code: 1017, message: "所有输出均生成失败" },
  [ERROR_CONTENT_REJECTED]: { code: 1018, message: "生成内容未通过安全审核" },
  [ERROR_CONTENT_REVIEW_UNAVAILABLE]: { code: 1019, message: "内容审核不可用" },
  [ERROR_MEDIA_EXTRACT_FAILED]: { code: 1020, message: "音频提取失败" },
  [ERROR_VIDEO_GENERATION_FAILED]: { code: 1021, message: "视频生成失败" },
  [ERROR_IMAGE_GENERATION_FAILED]: { code: 1022, message: "图像生成失败" },
  [ERROR_VIDEO_HAS_NO_AUDIO_TRACK]: { code: 1023, message: "视频没有音轨" },
  [ERROR_VIDEO_DOWNLOAD_FAILED]: { code: 1024, message: "视频下载失败" },
  [ERROR_VIDEO_TOO_LARGE]: { code: 1025, message: "视频超过大小上限" },
  [ERROR_EXTRACT_FAILED]: { code: 1026, message: "音频提取失败" },
  [ERROR_UPLOAD_FAILED]: { code: 1027, message: "音频上传失败" },
  [ERROR_ENQUEUE_FAILED]: { code: 1028, message: "任务入队失败" },

  // ── 账号域（1xxx，1100+）──
  [ACCOUNT_ERROR_PASSWORD_INCORRECT]: { code: 1101, message: "原密码错误，请重试" },
  [ACCOUNT_ERROR_PASSWORD_INVALID]: { code: 1102, message: "新密码需为 8-20 位" },
  [ACCOUNT_ERROR_PASSWORD_NOT_SET]: { code: 1103, message: "当前账号未设置密码" },
};

/** 全局业务码（1xxxx，Java SystemCode 系）规范文案表：数字码 → 规范中文文案。
 *  现状：fail() 调用点到处现写「资源不存在/项目不存在」等——同一码多文案。此表收敛为规范值。 */
export const GLOBAL_CODE_MESSAGES: Record<number, string> = {
  // 1001xx 数据存在性
  100100: "资源不存在",
  100202: "资源不可用",
  100301: "资源不存在",
  100302: "幂等键已使用",
  100303: "任务状态冲突",
  // 计划应用（IK67H9）
  100401: "计划消息不存在或不属于该项目",
  100402: "该计划的应用类型暂不支持",
  100403: "计划能力快照已过期，需生成新计划",
  100404: "该计划已应用成功，不可重复应用",
  100405: "余额不足，请充值后重试",
  100406: "版本冲突，请刷新后重试",
  100407: "覆盖目标已变化，请生成新计划",
  // 画布共享资产（IK9QKP）
  100408: "空参数卡片不可保存，请补全参考图或描述",
  100410: "共享资产类型不支持",
};

/** 按字符串域码取「数值码 + 通用中文文案」；未登记返回 undefined（调用方决定兜底）。 */
export function errorCodeDefinition(code: string): { code: number; message: string } | undefined {
  return ERROR_CODE_DEFINITIONS[code];
}

/** 按字符串域码取通用中文文案；未登记返回 undefined。 */
export function errorCodeMessage(code: string): string | undefined {
  return ERROR_CODE_DEFINITIONS[code]?.message;
}

/** 按数字全局码取规范中文文案；未登记返回 undefined。 */
export function globalCodeMessage(code: number): string | undefined {
  return GLOBAL_CODE_MESSAGES[code];
}

/**
 * 按字符串域码取数值码；未登记按段位兜底（生成域 1000、账号域 1100）。
 * 全局业务码（1xxxx）不走此函数——它们本身就是数字码，见 result.ts / GLOBAL_CODE_MESSAGES。
 */
export function domainCodeToNumeric(code: string): number {
  const def = ERROR_CODE_DEFINITIONS[code];
  if (def) return def.code;
  return code.startsWith("password")
    ? ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE
    : GENERATION_ERROR_UNKNOWN_NUMERIC_CODE;
}

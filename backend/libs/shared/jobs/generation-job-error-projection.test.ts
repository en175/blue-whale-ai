import { describe, expect, it } from "vitest";

import {
  GENERATION_ERROR_CODES,
  fallbackErrorCode,
  resolveErrorCode,
} from "./generation-job-error-projection.js";
import {
  ERROR_ALL_OUTPUTS_FAILED,
  ERROR_AUDIO_GENERATION_FAILED,
  ERROR_CONTENT_REJECTED,
  ERROR_CONTENT_REVIEW_UNAVAILABLE,
  ERROR_ENQUEUE_FAILED,
  ERROR_EXTRACT_FAILED,
  ERROR_IMAGE_GENERATION_FAILED,
  ERROR_INVALID_INPUT,
  ERROR_MEDIA_EXTRACT_FAILED,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_NO_RESULT,
  ERROR_PLATFORM_QUOTA_EXHAUSTED,
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
  ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
  ERROR_VIDEO_GENERATION_FAILED,
  ERROR_VIDEO_HAS_NO_AUDIO_TRACK,
  ERROR_VIDEO_TOO_LARGE,
  GENERATION_ERROR_NUMERIC_CODES,
  GENERATION_ERROR_UNKNOWN_NUMERIC_CODE,
  errorCodeToNumeric,
} from "@lib/contracts";
import { messageFor, projectPublicError } from "./generation-job-error-projection.js";

describe("error-codes", () => {
  it("枚举常量值稳定（对外契约）", () => {
    expect(ERROR_INVALID_INPUT).toBe("invalid_input");
    expect(ERROR_PROVIDER_FAILED).toBe("provider_failed");
    expect(ERROR_QUOTA_EXHAUSTED).toBe("quota_exhausted");
    expect(ERROR_PLATFORM_QUOTA_EXHAUSTED).toBe("platform_quota_exhausted");
  });

  it("全部常量都在 GENERATION_ERROR_CODES 白名单内", () => {
    const exported = [
      ERROR_INVALID_INPUT,
      ERROR_UNSUPPORTED_TYPE,
      ERROR_UNSUPPORTED_INPUT,
      ERROR_MODEL_UNAVAILABLE,
      ERROR_REFERENCE_ASSET_UNAVAILABLE,
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      ERROR_SOURCE_ASSET_UNAVAILABLE,
      ERROR_QUOTA_EXHAUSTED,
      ERROR_PROVIDER_CREDENTIAL_MISSING,
      ERROR_PROVIDER_CONFIG,
      ERROR_PROVIDER_FAILED,
      ERROR_PROVIDER_TIMEOUT,
      ERROR_NO_RESULT,
      ERROR_SUBMISSION_UNKNOWN,
      ERROR_TIMED_OUT,
      ERROR_STORAGE_FAILED,
      ERROR_ALL_OUTPUTS_FAILED,
      ERROR_CONTENT_REJECTED,
      ERROR_CONTENT_REVIEW_UNAVAILABLE,
      ERROR_MEDIA_EXTRACT_FAILED,
      ERROR_VIDEO_GENERATION_FAILED,
      ERROR_IMAGE_GENERATION_FAILED,
      ERROR_VIDEO_HAS_NO_AUDIO_TRACK,
      ERROR_VIDEO_DOWNLOAD_FAILED,
      ERROR_VIDEO_TOO_LARGE,
      ERROR_EXTRACT_FAILED,
      ERROR_UPLOAD_FAILED,
      ERROR_ENQUEUE_FAILED,
      ERROR_AUDIO_GENERATION_FAILED,
    ];
    for (const c of exported) {
      expect(GENERATION_ERROR_CODES.has(c), `code ${c} 未登记`).toBe(true);
    }
  });

  it("数值码映射：每错一码，一一对应且无重复（ADR-0078 二期）", () => {
    const exported = [
      ERROR_INVALID_INPUT,
      ERROR_UNSUPPORTED_TYPE,
      ERROR_UNSUPPORTED_INPUT,
      ERROR_MODEL_UNAVAILABLE,
      ERROR_REFERENCE_ASSET_UNAVAILABLE,
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      ERROR_SOURCE_ASSET_UNAVAILABLE,
      ERROR_QUOTA_EXHAUSTED,
      ERROR_PROVIDER_CREDENTIAL_MISSING,
      ERROR_PROVIDER_CONFIG,
      ERROR_PROVIDER_FAILED,
      ERROR_PROVIDER_TIMEOUT,
      ERROR_NO_RESULT,
      ERROR_SUBMISSION_UNKNOWN,
      ERROR_TIMED_OUT,
      ERROR_STORAGE_FAILED,
      ERROR_ALL_OUTPUTS_FAILED,
      ERROR_CONTENT_REJECTED,
      ERROR_CONTENT_REVIEW_UNAVAILABLE,
      ERROR_MEDIA_EXTRACT_FAILED,
      ERROR_VIDEO_GENERATION_FAILED,
      ERROR_IMAGE_GENERATION_FAILED,
      ERROR_VIDEO_HAS_NO_AUDIO_TRACK,
      ERROR_VIDEO_DOWNLOAD_FAILED,
      ERROR_VIDEO_TOO_LARGE,
      ERROR_EXTRACT_FAILED,
      ERROR_UPLOAD_FAILED,
      ERROR_ENQUEUE_FAILED,
      ERROR_AUDIO_GENERATION_FAILED,
    ];
    const codes = exported.map((c) => GENERATION_ERROR_NUMERIC_CODES[c]);
    for (const n of codes) {
      expect(typeof n).toBe("number");
    }
    expect(new Set(codes).size).toBe(exported.length);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTA_EXHAUSTED]).toBe(1001);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_INVALID_INPUT]).toBe(1002);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_PROVIDER_FAILED]).toBe(1011);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_IMAGE_GENERATION_FAILED]).toBe(
      1022,
    );
    expect(errorCodeToNumeric("some_unknown_code")).toBe(1000);
    expect(GENERATION_ERROR_UNKNOWN_NUMERIC_CODE).toBe(1000);
  });

  it("旧码归一 canonical", () => {
    expect(resolveErrorCode("invalid_video_inputs")).toBe("invalid_reference");
    expect(resolveErrorCode("invalid_reference_video")).toBe("invalid_reference");
    expect(resolveErrorCode("unsupported_video_inputs")).toBe(
      "unsupported_input",
    );
    expect(resolveErrorCode("unsupported_reference_type")).toBe(
      "unsupported_input",
    );
    expect(resolveErrorCode("invalid_video_response")).toBe("provider_failed");
    expect(resolveErrorCode("provider_failed")).toBe("provider_failed");
  });

  it("fallback 按类型", () => {
    expect(fallbackErrorCode("video")).toBe("video_generation_failed");
    expect(fallbackErrorCode("media_extract")).toBe("media_extract_failed");
    expect(fallbackErrorCode("image")).toBe("image_generation_failed");
    expect(fallbackErrorCode("audio")).toBe("audio_generation_failed");
    expect(fallbackErrorCode("video_frame_interpolation")).toBe(
      ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
    );
  });
});

describe("projectPublicError", () => {
  it("canonical 码 → 数值码 + 码表文案（上游原文不返给用户）", () => {
    const out = projectPublicError(
      { code: "provider_failed", message: "上游英文原文" },
      "image",
    );
    expect(out).not.toBeNull();
    expect(out!.code).toBe(1011);
    expect(out!.message).toBe("服务暂时异常，本次生成失败。");
    expect(out!.category).toBe("transient");
    expect(out!.retryable).toBe(true);
    expect("params" in out!).toBe(false);
    expect("details" in out!).toBe(false);
  });

  it("quota_exhausted + 上游英文欠费原文：按证据翻成 1061，上游英文不回显", () => {
    const out = projectPublicError(
      {
        code: "quota_exhausted",
        message: "The request failed because your account has an overdue balance.",
      },
      "image",
    );
    expect(out!.code).toBe(1061);
    expect(out!.message).toBe("当前模型服务暂不可用，请稍后再试或选择其他可用模型。");
  });

  it("旧码归一：历史 invalid_video_inputs → invalid_reference 数值码 1034 + 码表文案", () => {
    const out = projectPublicError(
      { code: "invalid_video_inputs", message: "首帧只能指定一个来源" },
      "video",
    );
    expect(out!.code).toBe(1034);
    expect(out!.message).toBe("参考素材无法用于本次生成，请更换后再发送。");
  });

  it("IKFL53/IKJ8J8: content_rejected_reference → 1038 + 中性兜底文案", () => {
    const out = projectPublicError(
      {
        code: "content_rejected_reference",
        message:
          "The request failed because the output video may be related to copyright restrictions. Request id: req-2048",
      },
      "video",
    );
    expect(out!.code).toBe(1038);
    expect(out!.message).toBe("内容未通过审核，请调整描述或参考素材后再发送。");
  });

  it("IKJ8J8: content_rejected_audio → 1059 + 音频版权精确文案", () => {
    const out = projectPublicError(
      {
        code: "content_rejected_audio",
        message:
          "The generated audio may involve copyright restrictions. Please revise your input and retry.",
      },
      "video",
    );
    expect(out!.code).toBe(1059);
    expect(out!.message).toBe("内容未通过审核，请调整描述或参考素材后再发送。");
  });

  it("白名单外码 fallback 到类型兜底：码表文案（操作未完成，请稍后查看。）", () => {
    const out = projectPublicError({ code: "some_new_code" }, "video");
    expect(out!.code).toBe(1021);
    expect(out!.message).toBe("操作未完成，请稍后查看。");
  });

  it("IKHLK3: 插帧白名单外码 → 1049 + 插帧文案", () => {
    const out = projectPublicError({ code: "some_new_code" }, "video_frame_interpolation");
    expect(out!.code).toBe(1049);
    expect(out!.message).toBe("操作未完成，请稍后查看。");
  });

  it("IKJFGQ：reason 随投影外发 canonical 字符串码——数值码撞号重排时前端识别的稳定锚点", () => {
    const out = projectPublicError(
      { code: "task_type_param_constraint", message: "任意" },
      "video",
    );
    expect(out!.code).toBe(1060);
    expect(out!.reason).toBe("task_type_param_constraint");
    expect(projectPublicError({ code: "invalid_video_inputs" }, "video")!.reason).toBe("invalid_reference");
    expect(projectPublicError({ code: "some_new_code" }, "video")!.reason).toBe("video_generation_failed");
  });

  it("null 输入返回 null", () => {
    expect(projectPublicError(null, "image")).toBeNull();
  });
});

describe("messageFor", () => {
  it("每种错误码都有中文文案（前端只展示 msg）", () => {
    const cases: Array<[string, string]> = [
      [ERROR_QUOTA_EXHAUSTED, "积分余额不足，本次尚未提交。"],
      [ERROR_INVALID_INPUT, "当前参数不受支持，请调整后再发送。"],
      [ERROR_UNSUPPORTED_TYPE, "当前参数不受支持，请调整后再发送。"],
      [ERROR_UNSUPPORTED_INPUT, "当前参数不受支持，请调整后再发送。"],
      [ERROR_MODEL_UNAVAILABLE, "当前模型服务暂不可用，请稍后再试或选择其他可用模型。"],
      [ERROR_REFERENCE_ASSET_UNAVAILABLE, "参考素材无法用于本次生成，请更换后再发送。"],
      [ERROR_REFERENCE_LIMIT_EXCEEDED, "当前参考不符合所选模型要求，请调整后再发送。"],
      [ERROR_SOURCE_ASSET_UNAVAILABLE, "参考素材无法用于本次生成，请更换后再发送。"],
      [ERROR_PROVIDER_CREDENTIAL_MISSING, "当前模型服务暂不可用，请稍后再试或选择其他可用模型。"],
      [ERROR_PROVIDER_CONFIG, "当前模型服务暂不可用，请稍后再试或选择其他可用模型。"],
      [ERROR_PROVIDER_TIMEOUT, "服务暂时异常，本次生成失败。"],
      [ERROR_NO_RESULT, "操作未完成，请稍后查看。"],
      [ERROR_SUBMISSION_UNKNOWN, "提交结果核对中，请勿重复提交。"],
      [ERROR_TIMED_OUT, "服务暂时异常，本次生成失败。"],
      [ERROR_STORAGE_FAILED, "结果保存失败，结果暂未恢复。"],
      [ERROR_ALL_OUTPUTS_FAILED, "操作未完成，请稍后查看。"],
      [ERROR_CONTENT_REJECTED, "内容未通过审核，请调整描述或参考素材后再发送。"],
      [ERROR_CONTENT_REVIEW_UNAVAILABLE, "服务暂时异常，本次生成失败。"],
      [ERROR_MEDIA_EXTRACT_FAILED, "操作未完成，请稍后查看。"],
      [ERROR_VIDEO_GENERATION_FAILED, "操作未完成，请稍后查看。"],
      [ERROR_IMAGE_GENERATION_FAILED, "操作未完成，请稍后查看。"],
      [ERROR_VIDEO_HAS_NO_AUDIO_TRACK, "参考素材无法用于本次生成，请更换后再发送。"],
      [ERROR_VIDEO_DOWNLOAD_FAILED, "服务暂时异常，本次生成失败。"],
      [ERROR_VIDEO_TOO_LARGE, "参考文件超过大小限制，请更换或压缩后上传。"],
      [ERROR_EXTRACT_FAILED, "操作未完成，请稍后查看。"],
      [ERROR_UPLOAD_FAILED, "参考素材上传失败，请检查网络后重新上传。"],
      [ERROR_ENQUEUE_FAILED, "服务暂时异常，本次生成失败。"],
    ];
    for (const [code, expected] of cases) {
      expect(messageFor(code, "image"), `messageFor(${code})`).toBe(expected);
    }
  });

  it("I一码一文案：provider_failed 统一文案，media_extract 码表文案（ADR-0083）", () => {
    expect(messageFor(ERROR_PROVIDER_FAILED, "video")).toBe("服务暂时异常，本次生成失败。");
    expect(messageFor(ERROR_PROVIDER_FAILED, "audio")).toBe("服务暂时异常，本次生成失败。");
    expect(messageFor(ERROR_PROVIDER_FAILED, "image")).toBe("服务暂时异常，本次生成失败。");
    expect(messageFor(ERROR_MEDIA_EXTRACT_FAILED, "media_extract")).toBe(
      "操作未完成，请稍后查看。",
    );
    expect(messageFor(ERROR_EXTRACT_FAILED, "media_extract")).toBe(
      "操作未完成，请稍后查看。",
    );
  });

  it("未知码按类型兜底到对应中文", () => {
    expect(messageFor("some_new_code", "video")).toBe("操作未完成，请稍后查看。");
    expect(messageFor("some_new_code", "audio")).toBe("操作未完成，请稍后查看。");
    expect(messageFor("some_new_code", "image")).toBe("操作未完成，请稍后查看。");
    expect(messageFor("some_new_code", "media_extract")).toBe("操作未完成，请稍后查看。");
  });

  it("projectPublicError 对 null stored_error 不抛错", () => {
    expect(projectPublicError(null, "video")).toBeNull();
  });
});

describe("platform_quota_exhausted（ADR-0128：平台额度不足与个人积分不足分离）", () => {
  it("新码 platform_quota_exhausted → 1061 + 平台文案", () => {
    const out = projectPublicError(
      {
        code: "platform_quota_exhausted",
        message: "预扣费额度失败，当前分组负载剩余额度不足",
      },
      "video",
    );
    expect(out!.code).toBe(1061);
    expect(out!.reason).toBe("platform_quota_exhausted");
    expect(out!.message).toBe("当前模型服务暂不可用，请稍后再试或选择其他可用模型。");
  });

  it("旧记录 quota_exhausted + 上游欠费原文 → 按证据翻成 1061", () => {
    const out = projectPublicError(
      {
        code: "quota_exhausted",
        message: "预扣费额度失败：当前分组负载剩余额度不足",
      },
      "video",
    );
    expect(out!.code).toBe(1061);
    expect(out!.message).toBe("当前模型服务暂不可用，请稍后再试或选择其他可用模型。");
  });

  it("旧记录 quota_exhausted 但无额度证据 → 保持 1001（证据不足不推断）", () => {
    const out = projectPublicError(
      { code: "quota_exhausted", message: "任务执行失败" },
      "video",
    );
    expect(out!.code).toBe(1001);
    expect(out!.message).toBe("积分余额不足，本次尚未提交。");
  });

  it("普通上游异常不误报余额不足", () => {
    const out = projectPublicError(
      { code: "provider_failed", message: "upstream gateway 502" },
      "video",
    );
    expect(out!.code).toBe(1011);
    expect(out!.message).toBe("服务暂时异常，本次生成失败。");
  });
});

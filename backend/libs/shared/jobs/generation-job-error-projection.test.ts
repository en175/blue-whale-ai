// IKBQEE / ADR-0078：错误码枚举 + 投影补齐 单元测试。
// 二期：对外输出为 { code: 数值码, message: 中文 }——数值码每错一码、前端可映射。
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
  GENERATION_ERROR_NUMERIC_CODES,
  GENERATION_ERROR_UNKNOWN_NUMERIC_CODE,
  errorCodeToNumeric,
} from "@blue-whale/contracts";
import { messageFor, projectPublicError } from "./generation-job-error-projection.js";

describe("error-codes", () => {
  it("枚举常量值稳定（对外契约）", () => {
    expect(ERROR_INVALID_INPUT).toBe("invalid_input");
    expect(ERROR_PROVIDER_FAILED).toBe("provider_failed");
    expect(ERROR_QUOTA_EXHAUSTED).toBe("quota_exhausted");
  });

  it("全部常量都在 GENERATION_ERROR_CODES 白名单内", () => {
    // 逐个校验每个导出常量已登记——新增失败码忘登记会被此测试捕获。
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
    // 每个字符串码都有数值码，且数值码互不重复
    for (const n of codes) {
      expect(typeof n).toBe("number");
    }
    expect(new Set(codes).size).toBe(exported.length);
    // 特定映射稳定（对外契约）
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTA_EXHAUSTED]).toBe(1001);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_INVALID_INPUT]).toBe(1002);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_PROVIDER_FAILED]).toBe(1011);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_IMAGE_GENERATION_FAILED]).toBe(
      1022,
    );
    // 未知码兜底
    expect(errorCodeToNumeric("some_unknown_code")).toBe(1000);
    expect(GENERATION_ERROR_UNKNOWN_NUMERIC_CODE).toBe(1000);
  });

  it("旧码归一 canonical", () => {
    expect(resolveErrorCode("invalid_video_inputs")).toBe("invalid_input");
    expect(resolveErrorCode("invalid_reference_video")).toBe("invalid_input");
    expect(resolveErrorCode("unsupported_video_inputs")).toBe(
      "unsupported_input",
    );
    expect(resolveErrorCode("unsupported_reference_type")).toBe(
      "unsupported_input",
    );
    expect(resolveErrorCode("invalid_video_response")).toBe("provider_failed");
    // 未在别名表的码原样返回
    expect(resolveErrorCode("provider_failed")).toBe("provider_failed");
  });

  it("fallback 按类型", () => {
    expect(fallbackErrorCode("video")).toBe("video_generation_failed");
    expect(fallbackErrorCode("media_extract")).toBe("media_extract_failed");
    expect(fallbackErrorCode("image")).toBe("image_generation_failed");
    expect(fallbackErrorCode("audio")).toBe("audio_generation_failed");
  });
});

describe("projectPublicError", () => {
  it("canonical 码 → 数值码 + 中文 message（无 retryable/params/details）", () => {
    const out = projectPublicError(
      { code: "provider_failed", message: "上游英文原文" },
      "image",
    );
    expect(out).not.toBeNull();
    expect(out!.code).toBe(1011);
    // IKDZGM / ADR-0083：一码一文案——provider_failed 统一文案，不再按 type 分词。
    expect(out!.message).toBe("生成服务响应异常");
    expect("retryable" in out!).toBe(false);
    expect("params" in out!).toBe(false);
    expect("details" in out!).toBe(false);
  });

  it("quota_exhausted：1001 + 充值引导文案", () => {
    // 真实案例 job 1494：provider_failed + overdue balance 英文
    const out = projectPublicError(
      {
        code: "quota_exhausted",
        message: "The request failed because your account has an overdue balance.",
      },
      "image",
    );
    expect(out!.code).toBe(1001);
    expect(out!.message).toBe("账户余额不足，请充值后重试");
  });

  it("旧码归一：历史 invalid_video_inputs → invalid_input 数值码 + 中文", () => {
    const out = projectPublicError(
      { code: "invalid_video_inputs", message: "首帧只能指定一个来源" },
      "video",
    );
    expect(out!.code).toBe(1002);
    expect(out!.message).toBe("输入参数无效");
  });

  it("白名单外码 fallback 到类型兜底再映射数值码", () => {
    const out = projectPublicError({ code: "some_new_code" }, "video");
    expect(out!.code).toBe(1021); // video_generation_failed
    expect(out!.message).toBe("视频生成失败");
  });

  it("null 输入返回 null", () => {
    expect(projectPublicError(null, "image")).toBeNull();
  });
});

describe("messageFor", () => {
  it("每种错误码都有中文文案（前端只展示 msg）", () => {
    const cases: Array<[string, string]> = [
      [ERROR_QUOTA_EXHAUSTED, "账户余额不足，请充值后重试"],
      [ERROR_INVALID_INPUT, "输入参数无效"],
      [ERROR_UNSUPPORTED_TYPE, "不支持的生成类型"],
      [ERROR_UNSUPPORTED_INPUT, "输入内容不支持"],
      [ERROR_MODEL_UNAVAILABLE, "模型未开通或不可用"],
      [ERROR_REFERENCE_ASSET_UNAVAILABLE, "参考素材不可用"],
      [ERROR_REFERENCE_LIMIT_EXCEEDED, "参考素材数量超过限制"],
      [ERROR_SOURCE_ASSET_UNAVAILABLE, "源视频资产不可用"],
      [ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置"],
      [ERROR_PROVIDER_CONFIG, "生成服务配置不完整"],
      [ERROR_PROVIDER_TIMEOUT, "生成服务响应超时"],
      [ERROR_NO_RESULT, "生成服务未返回结果"],
      [ERROR_SUBMISSION_UNKNOWN, "无法确认视频任务是否已提交"],
      [ERROR_TIMED_OUT, "视频生成超时"],
      [ERROR_STORAGE_FAILED, "生成结果存储失败"],
      [ERROR_ALL_OUTPUTS_FAILED, "所有输出均生成失败"],
      [ERROR_CONTENT_REJECTED, "生成内容未通过安全审核"],
      [ERROR_CONTENT_REVIEW_UNAVAILABLE, "内容审核不可用"],
      [ERROR_MEDIA_EXTRACT_FAILED, "音频提取失败"],
      [ERROR_VIDEO_GENERATION_FAILED, "视频生成失败"],
      [ERROR_IMAGE_GENERATION_FAILED, "图像生成失败"],
      [ERROR_VIDEO_HAS_NO_AUDIO_TRACK, "视频没有音轨"],
      [ERROR_VIDEO_DOWNLOAD_FAILED, "视频下载失败"],
      [ERROR_VIDEO_TOO_LARGE, "视频超过大小上限"],
      [ERROR_EXTRACT_FAILED, "音频提取失败"],
      [ERROR_UPLOAD_FAILED, "音频上传失败"],
      [ERROR_ENQUEUE_FAILED, "任务入队失败"],
    ];
    for (const [code, expected] of cases) {
      expect(messageFor(code, "image"), `messageFor(${code})`).toBe(expected);
    }
  });

  it("I一码一文案：provider_failed 统一文案，media_extract 码表文案（ADR-0083）", () => {
    // IKDZGM / ADR-0083：一码一文案——provider_failed 不再按 type 分词。
    expect(messageFor(ERROR_PROVIDER_FAILED, "video")).toBe("生成服务响应异常");
    expect(messageFor(ERROR_PROVIDER_FAILED, "audio")).toBe("生成服务响应异常");
    expect(messageFor(ERROR_PROVIDER_FAILED, "image")).toBe("生成服务响应异常");
    // media_extract 码：码表有文案（1020/1026 均「音频提取失败」），直接查表。
    expect(messageFor(ERROR_MEDIA_EXTRACT_FAILED, "media_extract")).toBe(
      "音频提取失败",
    );
    expect(messageFor(ERROR_EXTRACT_FAILED, "media_extract")).toBe(
      "音频提取失败",
    );
  });

  it("未知码按类型兜底到对应中文", () => {
    expect(messageFor("some_new_code", "video")).toBe("视频生成失败");
    expect(messageFor("some_new_code", "audio")).toBe("音频生成失败");
    expect(messageFor("some_new_code", "image")).toBe("图像生成失败");
    expect(messageFor("some_new_code", "media_extract")).toBe("音频提取失败");
  });

  it("projectPublicError 对 null stored_error 不抛错", () => {
    // 失败 job 但 stored_error 为 null（历史数据/非对象 error）→ 投影返回 null，
    // 调用方 jobs.service 会走类型兜底（code/msg 同步）。
    expect(projectPublicError(null, "video")).toBeNull();
  });
});

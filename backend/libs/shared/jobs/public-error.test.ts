// IKBQEE / ADR-0078：错误码枚举 + 投影补齐 单元测试。
import { describe, expect, it } from "vitest";

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
  GENERATION_ERROR_CODES,
  LEGACY_CODE_TO_CANONICAL,
  RETRYABLE_ERROR_CODES,
  fallbackErrorCode,
  isRetryableForType,
  resolveErrorCode,
} from "./error-codes.js";
import { projectPublicError } from "./public-error.js";

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
    ];
    for (const c of exported) {
      expect(GENERATION_ERROR_CODES.has(c), `code ${c} 未登记`).toBe(true);
    }
  });

  it("retryable 集合：目前全部失败码可重试（ADR-0078 修正）", () => {
    expect(RETRYABLE_ERROR_CODES.has(ERROR_PROVIDER_FAILED)).toBe(true);
    expect(RETRYABLE_ERROR_CODES.has(ERROR_PROVIDER_TIMEOUT)).toBe(true);
    expect(RETRYABLE_ERROR_CODES.has(ERROR_STORAGE_FAILED)).toBe(true);
    expect(RETRYABLE_ERROR_CODES.has(ERROR_QUOTA_EXHAUSTED)).toBe(true);
    expect(RETRYABLE_ERROR_CODES.has(ERROR_INVALID_INPUT)).toBe(true);
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
    expect(LEGACY_CODE_TO_CANONICAL).toMatchObject({});
  });

  it("fallback 按类型", () => {
    expect(fallbackErrorCode("video")).toBe("video_generation_failed");
    expect(fallbackErrorCode("media_extract")).toBe("media_extract_failed");
    expect(fallbackErrorCode("image")).toBe("image_generation_failed");
    expect(fallbackErrorCode("audio")).toBe("image_generation_failed");
  });

  it("retryable 手动重试语义：不区分，失败一律可重试（ADR-0078 修正）", () => {
    // 失败原因由用户根据 message 自行判断，不阻断手动重试
    expect(isRetryableForType("provider_failed", "image")).toBe(true);
    expect(isRetryableForType("provider_failed", "video")).toBe(true);
    expect(isRetryableForType("provider_failed", "audio")).toBe(true);
    expect(isRetryableForType("provider_failed", "media_extract")).toBe(true);
    expect(isRetryableForType("provider_timeout", "video")).toBe(true);
    expect(isRetryableForType("storage_failed", "image")).toBe(true);
    expect(isRetryableForType("quota_exhausted", "image")).toBe(true);
    expect(isRetryableForType("invalid_input", "image")).toBe(true);
    expect(isRetryableForType("unsupported_input", "image")).toBe(true);
    expect(isRetryableForType("content_rejected", "image")).toBe(true);
  });
});

describe("projectPublicError", () => {
  it("canonical 码保留 + message 中文 + retryable 按码", () => {
    const out = projectPublicError(
      { code: "provider_failed", message: "上游英文原文" },
      "image",
    );
    expect(out).not.toBeNull();
    expect(out!.code).toBe("provider_failed");
    expect(out!.message).toBe("图像生成失败");
    expect(out!.retryable).toBe(true);
    expect(out!.details).toEqual({ raw: "上游英文原文" });
  });

  it("quota_exhausted 语义还原：message 充值引导 + 欠费可手动重试 + details 带原文", () => {
    // 真实案例 job 1494：provider_failed + overdue balance 英文
    const out = projectPublicError(
      {
        code: "quota_exhausted",
        message: "The request failed because your account has an overdue balance.",
      },
      "image",
    );
    expect(out!.code).toBe("quota_exhausted");
    expect(out!.message).toBe("账户余额不足，请充值后重试");
    // 手动重试语义：充值后可重试
    expect(out!.retryable).toBe(true);
    expect(out!.details).toEqual({
      raw: "The request failed because your account has an overdue balance.",
    });
  });

  it("旧码归一：历史 invalid_video_inputs → invalid_input 中文 + 可重试", () => {
    const out = projectPublicError(
      { code: "invalid_video_inputs", message: "首帧只能指定一个来源" },
      "video",
    );
    expect(out!.code).toBe("invalid_input");
    expect(out!.message).toBe("输入参数无效");
    expect(out!.retryable).toBe(true);
  });

  it("白名单外码 fallback 到类型兜底", () => {
    const out = projectPublicError({ code: "some_new_code" }, "video");
    expect(out!.code).toBe("video_generation_failed");
    expect(out!.message).toBe("视频生成失败");
  });

  it("details 透传存储的扩展详情（DB 写入侧新增字段）", () => {
    const out = projectPublicError(
      { code: "provider_failed", message: "x", details: { request_id: "r1" } },
      "image",
    );
    expect(out!.details).toEqual({ raw: "x", stored: { request_id: "r1" } });
  });

  it("params 透传（契约预留）", () => {
    const out = projectPublicError(
      { code: "unsupported_input", message: "x", params: { max_reference_count: 9 } },
      "image",
    );
    expect(out!.params).toEqual({ max_reference_count: 9 });
    expect(out!.retryable).toBe(true);
  });

  it("null 输入返回 null", () => {
    expect(projectPublicError(null, "image")).toBeNull();
  });

  it("顶层结构兼容：不再输出恒占位字段", () => {
    const out = projectPublicError({ code: "provider_failed" }, "image")!;
    expect("retry_after_seconds" in out).toBe(false);
    expect("request_id" in out).toBe(false);
    expect("budget_effect" in out).toBe(false);
    expect(ERROR_IMAGE_GENERATION_FAILED).toBe("image_generation_failed");
  });
});

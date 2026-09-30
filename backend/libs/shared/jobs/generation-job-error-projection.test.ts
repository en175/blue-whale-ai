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
    expect(resolveErrorCode("invalid_video_inputs")).toBe("invalid_reference");
    expect(resolveErrorCode("invalid_reference_video")).toBe("invalid_reference");
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
    // IKHLK3：插帧兜到契约 1049（同 vocal_split 先例，不落到图片生成的默认文案）。
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
    // 码表优先（ADR-0078）：provider_failed 统一文案，不返上游英文原文。
    expect(out!.message).toBe("生成服务响应异常");
    expect("retryable" in out!).toBe(false);
    expect("params" in out!).toBe(false);
    expect("details" in out!).toBe(false);
  });

  it("quota_exhausted：1001 + 码表文案（上游英文不回显）", () => {
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

  it("旧码归一：历史 invalid_video_inputs → invalid_reference 数值码 1034 + 码表文案", () => {
    const out = projectPublicError(
      { code: "invalid_video_inputs", message: "首帧只能指定一个来源" },
      "video",
    );
    expect(out!.code).toBe(1034);
    expect(out!.message).toBe("参考素材无效，请重新选择");
  });

  it("IKFL53/IKJ8J8: content_rejected_reference → 1038 + 中性兜底文案", () => {
    // 版权拒绝任务 DB error.code=content_rejected_reference → 后端投影到 1038 + 中文文案，
    // 不返上游 copyright 英文原文（含 Request id）。
    // IKJ8J8：文案中性化——判定只按上游版权关键词、不区分参考/输出，不再宣称「参考内容」。
    const out = projectPublicError(
      {
        code: "content_rejected_reference",
        message:
          "The request failed because the output video may be related to copyright restrictions. Request id: req-2048",
      },
      "video",
    );
    expect(out!.code).toBe(1038);
    expect(out!.message).toBe("生成内容可能涉及版权限制，请调整提示词或素材后重试");
  });

  it("IKJ8J8: content_rejected_audio → 1059 + 音频版权精确文案", () => {
    // 输出侧音频版权拒绝（火山官方码 OutputAudioSensitiveContentDetected，worker 前置分支归类）
    // → 后端投影到 1059 + 对齐官方释义的文案，用户一眼知道是配乐的问题。
    const out = projectPublicError(
      {
        code: "content_rejected_audio",
        message:
          "The generated audio may involve copyright restrictions. Please revise your input and retry.",
      },
      "video",
    );
    expect(out!.code).toBe(1059);
    expect(out!.message).toBe("生成的音频可能涉及版权限制，请调整提示词后重试");
  });

  it("白名单外码 fallback 到类型兜底：码表文案（视频生成失败）", () => {
    const out = projectPublicError({ code: "some_new_code" }, "video");
    expect(out!.code).toBe(1021); // video_generation_failed
    expect(out!.message).toBe("视频生成失败");
  });

  it("IKHLK3: 插帧白名单外码 → 1049 + 插帧文案", () => {
    const out = projectPublicError({ code: "some_new_code" }, "video_frame_interpolation");
    expect(out!.code).toBe(1049);
    expect(out!.message).toBe("视频插帧失败，请重试");
  });

  it("IKJFGQ：reason 随投影外发 canonical 字符串码——数值码撞号重排时前端识别的稳定锚点", () => {
    // worker 归类的比例约束失败（1060）是撞号重排已发生过一次的码：字符串码进信封 data.code，
    // 前端识别优先读它。归一（旧码别名）与 fallback（白名单外兜底）同样带归一后的 canonical 串。
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

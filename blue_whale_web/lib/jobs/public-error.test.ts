import { describe, expect, it } from "vitest";
import { projectPublicError } from "./public-error";

describe("projectPublicError", () => {
  it.each([
    ["invalid_video_inputs", "视频输入参数无效"],
    ["reference_asset_unavailable", "参考素材不可用"],
    ["unsupported_reference_type", "不支持的参考素材类型"],
    ["reference_limit_exceeded", "参考素材数量超过限制"],
    ["invalid_reference_video", "参考视频无效"],
    ["unsupported_video_inputs", "不支持的视频输入"],
    ["provider_credential_missing", "生成服务凭证未配置"],
    ["invalid_input", "输入参数无效"],
  ])("保留稳定错误码 %s", (code, message) => {
    expect(projectPublicError({ code }, "video")).toMatchObject({
      code,
      message,
    });
  });
});

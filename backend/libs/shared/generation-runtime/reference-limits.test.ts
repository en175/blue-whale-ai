import { describe, expect, it } from "vitest";

import { checkReferenceLimits, videoReferenceMax, type ReferenceLimitFeatures } from "./reference-limits.js";

function features(overrides: Partial<ReferenceLimitFeatures> = {}): ReferenceLimitFeatures {
  return {
    image_reference_max: 9,
    video_reference: true,
    video_reference_max: 5,
    audio_reference: true,
    audio_reference_max: 3,
    max_reference_duration_sec: null,
    ...overrides,
  };
}

describe("videoReferenceMax（IKL406 编辑模式）", () => {
  it("edit 收紧为 1，其余模式保持通用上限", () => {
    expect(videoReferenceMax(5, "edit")).toBe(1);
    expect(videoReferenceMax(5, "omni")).toBe(5);
    expect(videoReferenceMax(5, null)).toBe(5);
    expect(videoReferenceMax(5)).toBe(5);
  });

  it("通用上限为 0 时收紧不会反向放宽", () => {
    expect(videoReferenceMax(0, "edit")).toBe(0);
  });
});

describe("checkReferenceLimits 编辑模式参考上限（IKL406）", () => {
  it("edit 模式 1 段视频放行、2 段拒绝", () => {
    expect(checkReferenceLimits(features(), [{ type: "video" }], "video", "edit")).toBeNull();
    expect(checkReferenceLimits(features(), [{ type: "video" }, { type: "video" }], "video", "edit"))
      .toBe("参考视频最多 1 个");
  });

  it("edit 模式只卡视频段数：1 段视频 + N 张图片仍放行", () => {
    expect(
      checkReferenceLimits(
        features(),
        [{ type: "video" }, { type: "image" }, { type: "image" }, { type: "image" }],
        "video",
        "edit",
      ),
    ).toBeNull();
  });

  it("非 edit 模式不受影响，通用上限照旧", () => {
    expect(checkReferenceLimits(features(), [{ type: "video" }, { type: "video" }], "video"))
      .toBeNull();
  });

  it("audio / image 分支不受 edit 影响", () => {
    expect(checkReferenceLimits(features(), [{ type: "audio" }], "audio", "edit")).toBeNull();
    expect(checkReferenceLimits(features({ image_reference_max: 1 }), [{ type: "image" }], "image", "edit"))
      .toBeNull();
  });
});

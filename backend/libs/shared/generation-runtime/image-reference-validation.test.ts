import { describe, expect, it } from "vitest";

import { validateReferenceImages } from "./image-reference-validation.js";

function image(width: number | null, height: number | null) {
  return { width, height };
}

describe("validateReferenceImages 单图口径（IKQYEH）", () => {
  it("恰在 3600 万像素边界放行", () => {
    expect(validateReferenceImages([image(6000, 6000)])).toBeNull();
  });

  it("超过 3600 万像素拒绝并带配置上限", () => {
    expect(validateReferenceImages([image(6001, 6000)])).toEqual({
      message:
        "参考图总像素超出当前模型限制（单张最多 3600 万像素），请更换较小的图片后重试",
      params: { max_reference_pixels: 36_000_000 },
    });
  });

  it("宽高比恰为 16 或 1/16 放行", () => {
    expect(validateReferenceImages([image(6400, 400)])).toBeNull();
    expect(validateReferenceImages([image(400, 6400)])).toBeNull();
  });

  it("多张图各自合规但合计超上限 → 放行（单图口径）", () => {
    expect(validateReferenceImages([image(5000, 4000), image(5000, 4000)])).toBeNull();
  });

  it("宽高比超过 16 拒绝", () => {
    expect(validateReferenceImages([image(6800, 400)])).toEqual({
      message:
        "参考图宽高比超出当前模型限制（1/16 至 16），请更换尺寸比例更合适的图片后重试",
      params: { max_reference_ratio: 16 },
    });
  });

  it("宽高比低于 1/16 拒绝", () => {
    expect(validateReferenceImages([image(400, 6800)])?.params).toEqual({
      max_reference_ratio: 16,
    });
  });

  it("真实尺寸缺失放行，不新增误拒", () => {
    expect(validateReferenceImages([image(null, null), image(3000, null)])).toBeNull();
  });

  it("能力配置覆盖默认上限", () => {
    expect(
      validateReferenceImages([image(2000, 600)], {
        max_reference_image_pixels: 1_000_000,
      })?.params,
    ).toEqual({ max_reference_pixels: 1_000_000 });
    expect(
      validateReferenceImages([image(500, 200)], {
        max_reference_image_ratio: 2,
      })?.params,
    ).toEqual({ max_reference_ratio: 2 });
  });

  it("配置了非法宽高比（<1）回落到默认 16，不造成全量误拒", () => {
    expect(
      validateReferenceImages([image(6800, 400)], {
        max_reference_image_ratio: 0.5,
      })?.params,
    ).toEqual({ max_reference_ratio: 16 });
    expect(
      validateReferenceImages([image(1000, 1000)], {
        max_reference_image_ratio: 0.5,
      }),
    ).toBeNull();
  });
});

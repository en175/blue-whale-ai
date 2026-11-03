import { describe, expect, it } from "vitest";

import {
  validateConfiguredReferenceImages,
  validateReferenceImageMedia,
  validateReferenceImages,
} from "./image-reference-validation.js";

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

  it("配置了非法总像素（0 / NaN）回落到默认 36,000,000", () => {
    expect(
      validateReferenceImages([image(6001, 6000)], {
        max_reference_image_pixels: 0,
      })?.params,
    ).toEqual({ max_reference_pixels: 36_000_000 });
    expect(
      validateReferenceImages([image(1000, 1000)], {
        max_reference_image_pixels: Number.NaN,
      }),
    ).toBeNull();
  });
});

describe("validateConfiguredReferenceImages 仅校验已配置维度（IKSLLC）", () => {
  it("两项都未配置 → 放行，不回退默认 36M / 16", () => {
    expect(validateConfiguredReferenceImages([image(8000, 8000)], {})).toBeNull();
    expect(validateConfiguredReferenceImages([image(8000, 8000)], null)).toBeNull();
  });

  it("只配像素 → 超限拒绝，文案带配置值", () => {
    expect(
      validateConfiguredReferenceImages([image(6144, 6144)], {
        max_reference_image_pixels: 36_000_000,
      }),
    ).toEqual({
      message:
        "参考图总像素超出当前模型限制（单张最多 3600 万像素），请更换较小的图片后重试",
      params: { max_reference_pixels: 36_000_000 },
    });
  });

  it("只配比例 2.5 → 超比例拒绝，1:1 放行", () => {
    expect(
      validateConfiguredReferenceImages([image(6400, 400)], {
        max_reference_image_ratio: 2.5,
      })?.params,
    ).toEqual({ max_reference_ratio: 2.5 });
    expect(
      validateConfiguredReferenceImages([image(2048, 2048)], {
        max_reference_image_ratio: 2.5,
      }),
    ).toBeNull();
  });

  it("只配像素时宽高比不再回退默认 16", () => {
    expect(
      validateConfiguredReferenceImages([image(6400, 400)], {
        max_reference_image_pixels: 36_000_000,
      }),
    ).toBeNull();
  });

  it("真实尺寸缺失放行", () => {
    expect(
      validateConfiguredReferenceImages([image(null, null), image(6000, null)], {
        max_reference_image_pixels: 36_000_000,
      }),
    ).toBeNull();
  });
});

describe("validateReferenceImageMedia 音频参考图格式与大小（IKSLLC）", () => {
  const TEN_MB = 10 * 1024 * 1024;

  it("jpeg / png / webp 放行", () => {
    expect(
      validateReferenceImageMedia(
        [
          { mime: "image/jpeg", size: 1024 },
          { mime: "image/png", size: TEN_MB },
          { mime: "image/webp", size: null },
        ],
        TEN_MB,
      ),
    ).toBeNull();
  });

  it("mime 带参数按主类型判定", () => {
    expect(
      validateReferenceImageMedia([{ mime: "image/png; charset=binary", size: 1 }], TEN_MB),
    ).toBeNull();
  });

  it("gif → invalid_reference_media", () => {
    expect(
      validateReferenceImageMedia([{ mime: "image/gif", size: 1024 }], TEN_MB),
    ).toEqual({
      code: "invalid_reference_media",
      message: "参考图仅支持 JPEG、PNG 或 WebP 格式",
    });
  });

  it("超过 10 MB → invalid_reference_media", () => {
    expect(
      validateReferenceImageMedia([{ mime: "image/png", size: TEN_MB + 1 }], TEN_MB),
    ).toEqual({
      code: "invalid_reference_media",
      message: "参考图不能超过 10 MB",
    });
  });

  it("mime 或大小未知 → 放行，不新增误拒", () => {
    expect(
      validateReferenceImageMedia([{ mime: null, size: null }], TEN_MB),
    ).toBeNull();
  });
});

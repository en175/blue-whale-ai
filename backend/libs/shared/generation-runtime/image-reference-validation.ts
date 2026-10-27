import {
  DEFAULT_MAX_REFERENCE_IMAGE_PIXELS,
  DEFAULT_MAX_REFERENCE_IMAGE_RATIO,
} from "../model-capability/constants.js";

export interface ReferenceImageLimitFeatures {
  max_reference_image_pixels?: number | null;
  max_reference_image_ratio?: number | null;
}

export interface ReferenceImageSize {
  width: number | null;
  height: number | null;
}

export interface ReferenceImageLimitError {
  message: string;
  params: Record<string, number>;
}

function formatPixels(value: number): string {
  return value % 10_000 === 0 ? `${value / 10_000} 万像素` : `${value} 像素`;
}

export function validateReferenceImages(
  assets: ReadonlyArray<ReferenceImageSize>,
  features?: ReferenceImageLimitFeatures | null,
): ReferenceImageLimitError | null {
  const maxPixels =
    features?.max_reference_image_pixels ?? DEFAULT_MAX_REFERENCE_IMAGE_PIXELS;
  const maxRatio =
    features?.max_reference_image_ratio ?? DEFAULT_MAX_REFERENCE_IMAGE_RATIO;
  for (const asset of assets) {
    const { width, height } = asset;
    if (width === null || height === null || width <= 0 || height <= 0) continue;
    if (width * height > maxPixels) {
      return {
        message: `参考图总像素超出当前模型限制（单张最多 ${formatPixels(maxPixels)}）`,
        params: { max_reference_pixels: maxPixels },
      };
    }
    const ratio = width / height;
    if (ratio > maxRatio || ratio < 1 / maxRatio) {
      return {
        message: `参考图宽高比超出当前模型限制（1/${maxRatio} 至 ${maxRatio}）`,
        params: { max_reference_ratio: maxRatio },
      };
    }
  }
  return null;
}

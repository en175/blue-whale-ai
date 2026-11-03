import { ERROR_INVALID_REFERENCE_MEDIA } from "@lib/contracts";

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

export interface ReferenceImageMedia {
  mime: string | null;
  size: number | null;
}

export interface ReferenceImageLimitError {
  message: string;
  params: Record<string, number>;
}

export interface ReferenceImageMediaError {
  code: string;
  message: string;
}

const REFERENCE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function formatPixels(value: number): string {
  return value % 10_000 === 0 ? `${value / 10_000} 万像素` : `${value} 像素`;
}

function formatMegabytes(value: number): string {
  return value % (1024 * 1024) === 0
    ? `${value / (1024 * 1024)} MB`
    : `${value} 字节`;
}

function positiveLimit(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : fallback;
}

function configuredLimit(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : null;
}

function checkReferenceImages(
  assets: ReadonlyArray<ReferenceImageSize>,
  maxPixels: number | null,
  ratioLimit: number | null,
): ReferenceImageLimitError | null {
  for (const asset of assets) {
    const { width, height } = asset;
    if (width === null || height === null || width <= 0 || height <= 0) continue;
    if (maxPixels !== null && width * height > maxPixels) {
      return {
        message: `参考图总像素超出当前模型限制（单张最多 ${formatPixels(maxPixels)}），请更换较小的图片后重试`,
        params: { max_reference_pixels: maxPixels },
      };
    }
    if (ratioLimit === null) continue;
    const ratio = width / height;
    if (ratio > ratioLimit || ratio < 1 / ratioLimit) {
      return {
        message: `参考图宽高比超出当前模型限制（1/${ratioLimit} 至 ${ratioLimit}），请更换尺寸比例更合适的图片后重试`,
        params: { max_reference_ratio: ratioLimit },
      };
    }
  }
  return null;
}

export function validateReferenceImages(
  assets: ReadonlyArray<ReferenceImageSize>,
  features?: ReferenceImageLimitFeatures | null,
): ReferenceImageLimitError | null {
  return checkReferenceImages(
    assets,
    positiveLimit(
      features?.max_reference_image_pixels,
      DEFAULT_MAX_REFERENCE_IMAGE_PIXELS,
    ),
    positiveLimit(
      features?.max_reference_image_ratio,
      DEFAULT_MAX_REFERENCE_IMAGE_RATIO,
    ),
  );
}

export function validateConfiguredReferenceImages(
  assets: ReadonlyArray<ReferenceImageSize>,
  features?: ReferenceImageLimitFeatures | null,
): ReferenceImageLimitError | null {
  const maxPixels = configuredLimit(features?.max_reference_image_pixels);
  const ratioLimit = configuredLimit(features?.max_reference_image_ratio);
  if (maxPixels === null && ratioLimit === null) return null;
  return checkReferenceImages(assets, maxPixels, ratioLimit);
}

export function validateReferenceImageMedia(
  assets: ReadonlyArray<ReferenceImageMedia>,
  maxBytes: number,
): ReferenceImageMediaError | null {
  for (const asset of assets) {
    const mime = asset.mime?.split(";", 1)[0]?.trim().toLowerCase();
    if (mime && !REFERENCE_IMAGE_MIMES.has(mime)) {
      return {
        code: ERROR_INVALID_REFERENCE_MEDIA,
        message: "参考图仅支持 JPEG、PNG 或 WebP 格式",
      };
    }
    if (asset.size !== null && asset.size > maxBytes) {
      return {
        code: ERROR_INVALID_REFERENCE_MEDIA,
        message: `参考图不能超过 ${formatMegabytes(maxBytes)}`,
      };
    }
  }
  return null;
}

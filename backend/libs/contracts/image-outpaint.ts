import { z } from "zod";


export const IMAGE_OUTPAINT_JOB_TYPE = "image_outpaint";

export const IMAGE_OUTPAINT_SOURCE = "image_outpaint";

export const IMAGE_OUTPAINT_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  expandTop: "expand_top",
  expandBottom: "expand_bottom",
  expandLeft: "expand_left",
  expandRight: "expand_right",
} as const;

export const IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS = {
  min: 0,
  max: 0.4,
} as const;

export const IMAGE_OUTPAINT_SOURCE_LIMITS = {
  maxLongSide: 4160,
  maxFileSizeBytes: 10 * 1024 * 1024,
  missingDimensionsText: "图片缺少真实尺寸信息，无法发起扩图，请重新上传该图片后再试",
  longSideRejectionText: "源图长边超过 4160px，无法发起扩图，请先压缩图片",
  fileSizeRejectionText: "源图文件超过 10MB，无法发起扩图，请先压缩图片",
} as const;

export function imageOutpaintSourceGate(
  width: number | null | undefined,
  height: number | null | undefined,
  fileSizeBytes: number | null | undefined,
): string | null {
  if (width == null || height == null || width <= 0 || height <= 0) {
    return IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText;
  }
  const longSide = Math.max(width, height);
  if (longSide > IMAGE_OUTPAINT_SOURCE_LIMITS.maxLongSide) {
    return IMAGE_OUTPAINT_SOURCE_LIMITS.longSideRejectionText;
  }
  if (
    fileSizeBytes != null &&
    fileSizeBytes > IMAGE_OUTPAINT_SOURCE_LIMITS.maxFileSizeBytes
  ) {
    return IMAGE_OUTPAINT_SOURCE_LIMITS.fileSizeRejectionText;
  }
  return null;
}

const expandRatioSchema = z
  .number()
  .min(IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS.min)
  .max(IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS.max);

export const imageOutpaintInputSchema = z
  .object({
    [IMAGE_OUTPAINT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_OUTPAINT_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_OUTPAINT_INPUT_KEYS.expandTop]: expandRatioSchema,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandBottom]: expandRatioSchema,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandLeft]: expandRatioSchema,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandRight]: expandRatioSchema,
  })
  .strict()
  .refine(
    (input) =>
      input[IMAGE_OUTPAINT_INPUT_KEYS.expandTop] > 0 ||
      input[IMAGE_OUTPAINT_INPUT_KEYS.expandBottom] > 0 ||
      input[IMAGE_OUTPAINT_INPUT_KEYS.expandLeft] > 0 ||
      input[IMAGE_OUTPAINT_INPUT_KEYS.expandRight] > 0,
    { message: "至少一个方向的扩展比例需大于 0" },
  );
export type ImageOutpaintInput = z.infer<typeof imageOutpaintInputSchema>;

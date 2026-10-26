import { z } from "zod";


export const IMAGE_ENHANCE_JOB_TYPE = "image_enhance";

export const IMAGE_ENHANCE_SOURCE = "image_enhance";

export const IMAGE_ENHANCE_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  versionTier: "version_tier",
  multiple: "multiple",
  generativeEnhanceMode: "generative_enhance_mode",
  enableCorrectColor: "enable_correct_color",
} as const;

export const IMAGE_ENHANCE_VERSION_TIERS = ["lite", "pro", "max"] as const;
export type ImageEnhanceVersionTier = (typeof IMAGE_ENHANCE_VERSION_TIERS)[number];

export const IMAGE_ENHANCE_TOOL_VERSION: Record<ImageEnhanceVersionTier, string> = {
  lite: "standard",
  pro: "professional",
  max: "max",
};

export const IMAGE_ENHANCE_MULTIPLES = [2, 4, 6] as const;

export const IMAGE_ENHANCE_MODES = ["fidelity_first", "generative_first"] as const;
export type ImageEnhanceMode = (typeof IMAGE_ENHANCE_MODES)[number];

export const IMAGE_ENHANCE_TIER_CAPABILITY: Record<
  ImageEnhanceVersionTier,
  { enhanceMode: boolean; correctColor: boolean }
> = {
  lite: { enhanceMode: false, correctColor: false },
  pro: { enhanceMode: true, correctColor: false },
  max: { enhanceMode: true, correctColor: true },
};

export const IMAGE_ENHANCE_DEFAULTS = {
  versionTier: "pro",
  multiple: 2,
  generativeEnhanceMode: "generative_first",
  enableCorrectColor: true,
} as const;

export const IMAGE_ENHANCE_TIER_SIZE_LIMITS: Record<
  ImageEnhanceVersionTier,
  {
    minShortSide: number;
    maxLongSide: number;
    maxAspectRatio?: number;
    rejectionText: string;
  }
> = {
  lite: {
    minShortSide: 16,
    maxLongSide: 2160,
    rejectionText:
      "源图尺寸不满足 Lite 版本门槛（要求长边不超过 2160px 且短边不低于 16px），请更换版本档或源图",
  },
  pro: {
    minShortSide: 256,
    maxLongSide: 2048,
    rejectionText:
      "源图尺寸不满足 Pro 版本门槛（要求短边不低于 256px 且长边不超过 2048px），请更换版本档或源图",
  },
  max: {
    minShortSide: 64,
    maxLongSide: 6240,
    maxAspectRatio: 32,
    rejectionText:
      "源图尺寸不满足 Max 版本门槛（要求短边不低于 64px、长边不超过 6240px 且宽高比不超过 32），请更换版本档或源图",
  },
};

export function imageEnhanceTierSizeGate(
  tier: ImageEnhanceVersionTier,
  width: number,
  height: number,
): string | null {
  const limits = IMAGE_ENHANCE_TIER_SIZE_LIMITS[tier];
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const withinLimits =
    shortSide >= limits.minShortSide &&
    longSide <= limits.maxLongSide &&
    (limits.maxAspectRatio == null ||
      longSide <= limits.maxAspectRatio * shortSide);
  return withinLimits ? null : limits.rejectionText;
}

export const imageEnhanceInputSchema = z
  .object({
    [IMAGE_ENHANCE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_ENHANCE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_ENHANCE_INPUT_KEYS.versionTier]: z.enum(IMAGE_ENHANCE_VERSION_TIERS),
    [IMAGE_ENHANCE_INPUT_KEYS.multiple]: z.union([
      z.literal(2),
      z.literal(4),
      z.literal(6),
    ]),
    [IMAGE_ENHANCE_INPUT_KEYS.generativeEnhanceMode]: z.enum(IMAGE_ENHANCE_MODES),
    [IMAGE_ENHANCE_INPUT_KEYS.enableCorrectColor]: z.boolean(),
  })
  .strict();
export type ImageEnhanceInput = z.infer<typeof imageEnhanceInputSchema>;

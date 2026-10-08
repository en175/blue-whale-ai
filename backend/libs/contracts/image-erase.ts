import { z } from "zod";


export const IMAGE_ERASE_JOB_TYPE = "image_erase";

export const IMAGE_ERASE_SOURCE = "image_erase";

export const IMAGE_ERASE_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  eraseScene: "erase_scene",
  maskAssetId: "mask_asset_id",
} as const;

export const IMAGE_ERASE_SCENES = ["full_screen_text_erase", "selected_area_erase"] as const;
export type ImageEraseScene = (typeof IMAGE_ERASE_SCENES)[number];

export const IMAGE_ERASE_TOOL_VERSION = "standard";

export const IMAGE_ERASE_OUTPUT_FORMAT = "png";

export const IMAGE_ERASE_MAX_LONG_SIDE_PX = 2560;
export const IMAGE_ERASE_MAX_SHORT_SIDE_PX = 1440;
export const IMAGE_ERASE_MIN_SIDE_PX = 10;
export const IMAGE_ERASE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const IMAGE_ERASE_INPUT_FORMATS = ["png", "jpg", "jpeg", "heic"] as const;

export const IMAGE_ERASE_MASK_ASSET_SOURCE = "mask_erase";

const fullScreenTextEraseInputSchema = z
  .object({
    [IMAGE_ERASE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_ERASE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_ERASE_INPUT_KEYS.eraseScene]: z.literal("full_screen_text_erase"),
  })
  .strict();

const selectedAreaEraseInputSchema = z
  .object({
    [IMAGE_ERASE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_ERASE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_ERASE_INPUT_KEYS.eraseScene]: z.literal("selected_area_erase"),
    [IMAGE_ERASE_INPUT_KEYS.maskAssetId]: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();

export const imageEraseInputSchema = z.discriminatedUnion(
  IMAGE_ERASE_INPUT_KEYS.eraseScene,
  [fullScreenTextEraseInputSchema, selectedAreaEraseInputSchema],
);
export type ImageEraseInput = z.infer<typeof imageEraseInputSchema>;

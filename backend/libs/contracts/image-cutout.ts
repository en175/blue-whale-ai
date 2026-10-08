import { z } from "zod";


export const IMAGE_CUTOUT_JOB_TYPE = "image_cutout";

export const IMAGE_CUTOUT_SOURCE = "image_cutout";

export const IMAGE_CUTOUT_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  cutoutScene: "cutout_scene",
  needContour: "need_contour",
  contourColor: "contour_color",
  contourSize: "contour_size",
  needCropBackground: "need_crop_background",
} as const;

export const IMAGE_CUTOUT_SCENES = ["general", "human", "product"] as const;
export type ImageCutoutScene = (typeof IMAGE_CUTOUT_SCENES)[number];

export const IMAGE_CUTOUT_OUTPUT_FORMAT = "png";

export const IMAGE_CUTOUT_CONTOUR_COLOR = "#FFFFFF";

export const IMAGE_CUTOUT_CONTOUR_SIZE_MIN = 1;
export const IMAGE_CUTOUT_CONTOUR_SIZE_MAX = 100;
export const IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT = 10;

export const IMAGE_CUTOUT_MAX_FILE_BYTES = 30 * 1024 * 1024;
export const IMAGE_CUTOUT_INPUT_FORMATS = ["png", "jpg", "jpeg", "heic"] as const;

export const IMAGE_CUTOUT_SCENE_SIZE_LIMITS: Record<
  ImageCutoutScene,
  {
    maxLongSide: number;
    maxShortSide: number;
    maxTotalPixels?: number;
  }
> = {
  general: {
    maxLongSide: 10240,
    maxShortSide: 6000,
    maxTotalPixels: 40 * 1000 * 1000,
  },
  human: {
    maxLongSide: 7680,
    maxShortSide: 4320,
  },
  product: {
    maxLongSide: 7680,
    maxShortSide: 4320,
  },
};

export const IMAGE_CUTOUT_EDGE_ORIGIN = "image-cutout";

const generalSceneInputSchema = z
  .object({
    [IMAGE_CUTOUT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_CUTOUT_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_CUTOUT_INPUT_KEYS.cutoutScene]: z.literal("general"),
  })
  .strict();

const subjectSceneInputSchema = (scene: "human" | "product") =>
  z
    .object({
      [IMAGE_CUTOUT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
      [IMAGE_CUTOUT_INPUT_KEYS.targetNodeId]: z.string().min(1),
      [IMAGE_CUTOUT_INPUT_KEYS.cutoutScene]: z.literal(scene),
      [IMAGE_CUTOUT_INPUT_KEYS.needContour]: z.boolean(),
      [IMAGE_CUTOUT_INPUT_KEYS.contourColor]: z.literal(IMAGE_CUTOUT_CONTOUR_COLOR),
      [IMAGE_CUTOUT_INPUT_KEYS.contourSize]: z
        .number()
        .int()
        .min(IMAGE_CUTOUT_CONTOUR_SIZE_MIN)
        .max(IMAGE_CUTOUT_CONTOUR_SIZE_MAX),
      [IMAGE_CUTOUT_INPUT_KEYS.needCropBackground]: z.boolean(),
    })
    .strict();

export const imageCutoutInputSchema = z.discriminatedUnion(
  IMAGE_CUTOUT_INPUT_KEYS.cutoutScene,
  [generalSceneInputSchema, subjectSceneInputSchema("human"), subjectSceneInputSchema("product")],
);
export type ImageCutoutInput = z.infer<typeof imageCutoutInputSchema>;

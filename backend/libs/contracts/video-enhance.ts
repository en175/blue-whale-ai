import { z } from "zod";


export const VIDEO_ENHANCE_JOB_TYPE = "video_enhance";

export const VIDEO_ENHANCE_SOURCE = "video_enhance";

export const VIDEO_ENHANCE_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  resolution: "resolution",
} as const;

export const VIDEO_ENHANCE_RESOLUTIONS = ["1080p", "2k", "4k"] as const;
export type VideoEnhanceResolution = (typeof VIDEO_ENHANCE_RESOLUTIONS)[number];

export const VIDEO_ENHANCE_DEFAULT_RESOLUTION: VideoEnhanceResolution = "1080p";

export const VIDEO_ENHANCE_SUBMIT_PATH = "/v1/mediakit/enhance-video-generative";

export const VIDEO_ENHANCE_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

export const VIDEO_ENHANCE_BITRATE_LEVEL = "medium";

export const VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX = 360;
export const VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX = 1080;
export const VIDEO_ENHANCE_MIN_INPUT_LONG_SIDE_PX = 360;
export const VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX = 1920;

export const videoEnhanceInputSchema = z
  .object({
    [VIDEO_ENHANCE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VIDEO_ENHANCE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [VIDEO_ENHANCE_INPUT_KEYS.resolution]: z.enum(VIDEO_ENHANCE_RESOLUTIONS),
  })
  .strict();
export type VideoEnhanceInput = z.infer<typeof videoEnhanceInputSchema>;

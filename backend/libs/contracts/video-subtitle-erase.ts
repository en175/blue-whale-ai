import { z } from "zod";


export const VIDEO_SUBTITLE_ERASE_JOB_TYPE = "video_subtitle_erase";

export const VIDEO_SUBTITLE_ERASE_SOURCE = "video_subtitle_erase";

export const VIDEO_SUBTITLE_ERASE_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  detectMode: "detect_mode",
  eraseBoxes: "erase_boxes",
} as const;

export const VIDEO_SUBTITLE_ERASE_BOX_KEYS = {
  topLeftX: "top_left_x",
  topLeftY: "top_left_y",
  bottomRightX: "bottom_right_x",
  bottomRightY: "bottom_right_y",
} as const;

export const VIDEO_SUBTITLE_ERASE_DETECT_MODES = ["subtitle_smart", "text_full"] as const;
export type VideoSubtitleEraseDetectMode = (typeof VIDEO_SUBTITLE_ERASE_DETECT_MODES)[number];

export const VIDEO_SUBTITLE_ERASE_MODE: Record<VideoSubtitleEraseDetectMode, string> = {
  subtitle_smart: "Subtitle",
  text_full: "Text",
};

export const VIDEO_SUBTITLE_ERASE_MAX_BOXES = 20;

export const VIDEO_SUBTITLE_ERASE_MODEL_VERSION = "v5";
export const VIDEO_SUBTITLE_ERASE_OUTPUT_ENCODE_MODE = "Quality";

export const videoSubtitleEraseInputSchema = z
  .object({
    [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.detectMode]: z.enum(VIDEO_SUBTITLE_ERASE_DETECT_MODES),
    [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.eraseBoxes]: z
      .array(
        z
          .object({
            [VIDEO_SUBTITLE_ERASE_BOX_KEYS.topLeftX]: z.number().min(0).max(1),
            [VIDEO_SUBTITLE_ERASE_BOX_KEYS.topLeftY]: z.number().min(0).max(1),
            [VIDEO_SUBTITLE_ERASE_BOX_KEYS.bottomRightX]: z.number().min(0).max(1),
            [VIDEO_SUBTITLE_ERASE_BOX_KEYS.bottomRightY]: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(VIDEO_SUBTITLE_ERASE_MAX_BOXES),
  })
  .strict();
export type VideoSubtitleEraseInput = z.infer<typeof videoSubtitleEraseInputSchema>;
export type VideoSubtitleEraseEraseBox = VideoSubtitleEraseInput["erase_boxes"][number];

export interface VideoSubtitleEraseTimeSegmentFilter {
  mode: "skip" | "selected";
  segments: {
    start_time: number;
    end_time: number;
    erase_ratio_location?: VideoSubtitleEraseEraseBox[];
  }[];
}

export const VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX = 1440;
export const VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX = 2560;
export const VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS = 10 * 60 * 1000;

export const VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN = "video-subtitle-erase";

import { z } from "zod";


export const VIDEO_SCENE_SPLIT_JOB_TYPE = "video_scene_split";

export const VIDEO_SCENE_SPLIT_SOURCE = "video_scene_split";

export const VIDEO_SCENE_SPLIT_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  granularity: "granularity",
} as const;

export const VIDEO_SCENE_SPLIT_GRANULARITIES = ["fine", "standard", "coarse"] as const;
export type VideoSceneSplitGranularity = (typeof VIDEO_SCENE_SPLIT_GRANULARITIES)[number];

export const VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD: Record<VideoSceneSplitGranularity, number> = {
  fine: 5,
  standard: 10,
  coarse: 20,
};

export const VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY: VideoSceneSplitGranularity = "standard";

export const VIDEO_SCENE_SPLIT_SUBMIT_PATH = "/v1/mediakit/segment-scenes";

export const VIDEO_SCENE_SPLIT_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

export const VIDEO_SCENE_SPLIT_MODEL_NAME = "mediakit-segment-scenes";

export const videoSceneSplitInputSchema = z
  .object({
    [VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VIDEO_SCENE_SPLIT_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [VIDEO_SCENE_SPLIT_INPUT_KEYS.granularity]: z.enum(VIDEO_SCENE_SPLIT_GRANULARITIES),
  })
  .strict();
export type VideoSceneSplitInput = z.infer<typeof videoSceneSplitInputSchema>;

export const VIDEO_SCENE_SPLIT_RESULT_KEYS = {
  duration: "duration",
  segments: "segments",
} as const;

export const VIDEO_SCENE_SPLIT_SEGMENT_KEYS = {
  segmentIndex: "segment_index",
  startTime: "start_time",
  endTime: "end_time",
  segmentAssetId: "segment_asset_id",
} as const;

export const videoSceneSplitResultSchema = z
  .object({
    [VIDEO_SCENE_SPLIT_RESULT_KEYS.duration]: z.number().nonnegative(),
    [VIDEO_SCENE_SPLIT_RESULT_KEYS.segments]: z
      .array(
        z
          .object({
            [VIDEO_SCENE_SPLIT_SEGMENT_KEYS.segmentIndex]: z.number().int().positive(),
            [VIDEO_SCENE_SPLIT_SEGMENT_KEYS.startTime]: z.number().nonnegative(),
            [VIDEO_SCENE_SPLIT_SEGMENT_KEYS.endTime]: z.number().positive(),
            [VIDEO_SCENE_SPLIT_SEGMENT_KEYS.segmentAssetId]: z.string().regex(/^[1-9][0-9]*$/),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type VideoSceneSplitResult = z.infer<typeof videoSceneSplitResultSchema>;
export type VideoSceneSplitSegment = VideoSceneSplitResult["segments"][number];

export const VIDEO_SCENE_SPLIT_MAX_DURATION_MS = 2 * 60 * 60 * 1000;

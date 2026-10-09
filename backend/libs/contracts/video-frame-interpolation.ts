import { z } from "zod";


export const VIDEO_FRAME_INTERPOLATION_JOB_TYPE = "video_frame_interpolation";

export const VIDEO_FRAME_INTERPOLATION_SOURCE = "video_frame_interpolation";

export const VIDEO_FRAME_INTERPOLATION_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  fps: "fps",
} as const;

export const VIDEO_FRAME_INTERPOLATION_FPS_VALUES = [30, 60, 120] as const;
export type VideoFrameInterpolationFps =
  (typeof VIDEO_FRAME_INTERPOLATION_FPS_VALUES)[number];

export const VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS: VideoFrameInterpolationFps = 60;

export const VIDEO_FRAME_INTERPOLATION_SUBMIT_PATH =
  "/v1/mediakit/video-frame-interpolation";

export const VIDEO_FRAME_INTERPOLATION_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

export const VIDEO_FRAME_INTERPOLATION_RESULT_KEYS = {
  videoUrl: "video_url",
  duration: "duration",
  resolution: "resolution",
  fps: "fps",
} as const;

export const videoFrameInterpolationInputSchema = z
  .object({
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.sourceAssetId]: z
      .string()
      .regex(/^[1-9][0-9]*$/),
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.fps]: z
      .literal([...VIDEO_FRAME_INTERPOLATION_FPS_VALUES])
      .default(VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS),
  })
  .strict();
export type VideoFrameInterpolationInput = z.infer<
  typeof videoFrameInterpolationInputSchema
>;

export const VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT = "current";

export const VIDEO_FRAME_INTERPOLATION_RECOVERY_RESPONSE_KEYS = {
  jobId: "job_id",
  status: "status",
  progress: "progress",
  createdAt: "created_at",
} as const;

export const videoFrameInterpolationRecoveryQuerySchema = z
  .object({
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]: z.string().min(1),
  })
  .strict();
export type VideoFrameInterpolationRecoveryQuery = z.infer<
  typeof videoFrameInterpolationRecoveryQuerySchema
>;

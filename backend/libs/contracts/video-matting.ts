import { z } from "zod";


export const VIDEO_MATTING_JOB_TYPE = "video_matting";

export const VIDEO_MATTING_SOURCE = "video_matting";

export const VIDEO_MATTING_MODES = ["portrait", "greenscreen"] as const;
export type VideoMattingMode = (typeof VIDEO_MATTING_MODES)[number];

export const VIDEO_MATTING_SUBMIT_PATHS: Record<VideoMattingMode, string> = {
  portrait: "/v1/mediakit/matte-portrait-video",
  greenscreen: "/v1/mediakit/matte-greenscreen-video",
};

export const VIDEO_MATTING_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

export const VIDEO_MATTING_MODEL_NAMES: Record<VideoMattingMode, string> = {
  portrait: "mediakit-matte-portrait-video",
  greenscreen: "mediakit-matte-greenscreen-video",
};

export const VIDEO_MATTING_FORMATS = ["WEBM", "MP4"] as const;
export type VideoMattingFormat = (typeof VIDEO_MATTING_FORMATS)[number];

export const VIDEO_MATTING_DEFAULT_FORMAT: VideoMattingFormat = "WEBM";

export const VIDEO_MATTING_BACKGROUND_COLORS = ["white", "black", "green"] as const;
export type VideoMattingBackgroundColor = (typeof VIDEO_MATTING_BACKGROUND_COLORS)[number];

export const VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR: VideoMattingBackgroundColor = "white";

export const VIDEO_MATTING_CLIENT_TOKEN_PATTERN = /^[\x20-\x7E]{1,64}$/;

export const VIDEO_MATTING_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  targetNodeId: "target_node_id",
  mode: "mode",
  format: "format",
  backgroundColor: "background_color",
} as const;

export const videoMattingInputSchema = z
  .object({
    [VIDEO_MATTING_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VIDEO_MATTING_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [VIDEO_MATTING_INPUT_KEYS.mode]: z.enum(VIDEO_MATTING_MODES),
    [VIDEO_MATTING_INPUT_KEYS.format]: z.enum(VIDEO_MATTING_FORMATS),
    [VIDEO_MATTING_INPUT_KEYS.backgroundColor]: z
      .enum(VIDEO_MATTING_BACKGROUND_COLORS)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.format === "MP4" && value.background_color == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "format 为 MP4（纯色背景）时 background_color 必填",
        path: ["background_color"],
      });
    }
    if (value.format === "WEBM" && value.background_color != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "format 为 WEBM（透明背景）时不接受 background_color",
        path: ["background_color"],
      });
    }
  });
export type VideoMattingInput = z.infer<typeof videoMattingInputSchema>;

export const VIDEO_MATTING_SUBMIT_KEYS = {
  videoUrl: "video_url",
  format: "format",
  backgroundColor: "background_color",
} as const;

export const videoMattingSubmitSchema = z
  .object({
    [VIDEO_MATTING_SUBMIT_KEYS.videoUrl]: z.string().min(1),
    [VIDEO_MATTING_SUBMIT_KEYS.format]: z.enum(VIDEO_MATTING_FORMATS),
    [VIDEO_MATTING_SUBMIT_KEYS.backgroundColor]: z
      .enum(VIDEO_MATTING_BACKGROUND_COLORS)
      .optional(),
    client_token: z.string().regex(VIDEO_MATTING_CLIENT_TOKEN_PATTERN),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.format === "MP4" && value.background_color == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "format 为 MP4（纯色背景）时 background_color 必填",
        path: ["background_color"],
      });
    }
    if (value.format === "WEBM" && value.background_color != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "format 为 WEBM（透明背景）时不接受 background_color",
        path: ["background_color"],
      });
    }
  });
export type VideoMattingSubmit = z.infer<typeof videoMattingSubmitSchema>;

export const VIDEO_MATTING_RESULT_KEYS = {
  videoUrl: "video_url",
  resolution: "resolution",
  duration: "duration",
} as const;

export const videoMattingResultSchema = z
  .object({
    [VIDEO_MATTING_RESULT_KEYS.videoUrl]: z.string().min(1),
    [VIDEO_MATTING_RESULT_KEYS.resolution]: z.string().min(1),
    [VIDEO_MATTING_RESULT_KEYS.duration]: z.number().nonnegative(),
  })
  .strict();
export type VideoMattingResult = z.infer<typeof videoMattingResultSchema>;

export const VIDEO_MATTING_MAX_DURATION_MS = 10 * 60 * 1000;

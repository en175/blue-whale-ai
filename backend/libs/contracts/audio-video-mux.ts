import { z } from "zod";
import { canvasBindingSchema } from "./canvas-recovery.js";

export const AUDIO_VIDEO_MUX_JOB_TYPE = "audio_video_mux";
export const AUDIO_VIDEO_MUX_SOURCE = "dock";
export const AUDIO_VIDEO_MUX_SUBMIT_PATH = "/v1/mediakit/mux-audio-video";
export const AUDIO_VIDEO_MUX_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";
export const AUDIO_VIDEO_MUX_MODEL = "mediakit-mux-audio-video";
export const AUDIO_VIDEO_MUX_SYNC_MODES = ["none", "video", "audio"] as const;

export const AUDIO_VIDEO_MUX_RESULT_NAME_SUFFIX = "(音视频合成).mp4";

export const AUDIO_VIDEO_MUX_CLIENT_TOKEN_PREFIX = "bwmux-";

export function audioVideoMuxClientToken(jobId: string, submitAttempt: number): string {
  return `${AUDIO_VIDEO_MUX_CLIENT_TOKEN_PREFIX}${jobId}-${submitAttempt}`;
}

const muxIdentitySchema = z.object({
  assetId: z.string().regex(/^[1-9][0-9]*$/),
  nodeId: z.string().min(1).optional(),
}).strict();

export const audioVideoMuxCreateSchema = z.object({
  audio: z.object({
    assetId: z.string().regex(/^[1-9][0-9]*$/),
    nodeId: z.string().min(1),
  }).strict(),
  video: muxIdentitySchema,
  is_audio_reserve: z.boolean().default(true),
  sync: z.enum(AUDIO_VIDEO_MUX_SYNC_MODES).default("none"),
  canvas_binding: canvasBindingSchema.optional(),
}).strict();

export type AudioVideoMuxCreate = z.infer<typeof audioVideoMuxCreateSchema>;

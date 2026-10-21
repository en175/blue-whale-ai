import {
  IMAGE_CUTOUT_JOB_TYPE,
  IMAGE_ENHANCE_JOB_TYPE,
  IMAGE_ERASE_JOB_TYPE,
  IMAGE_OUTPAINT_JOB_TYPE,
  MEDIA_EXTRACT_JOB_TYPE,
  VIDEO_ENHANCE_JOB_TYPE,
  VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
  VIDEO_MATTING_JOB_TYPE,
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VIDEO_SUBTITLE_ERASE_JOB_TYPE,
  VOCAL_SPLIT_JOB_TYPE,
} from "@lib/contracts";

export const SINGLE_SOURCE_SECONDS_TOOLS: ReadonlySet<string> = new Set([
  MEDIA_EXTRACT_JOB_TYPE,
  VIDEO_ENHANCE_JOB_TYPE,
  VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
  VIDEO_MATTING_JOB_TYPE,
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VIDEO_SUBTITLE_ERASE_JOB_TYPE,
  VOCAL_SPLIT_JOB_TYPE,
]);

export const CONSTANT_PRICING_TOOLS: ReadonlySet<string> = new Set([
  IMAGE_CUTOUT_JOB_TYPE,
  IMAGE_ENHANCE_JOB_TYPE,
  IMAGE_ERASE_JOB_TYPE,
  IMAGE_OUTPAINT_JOB_TYPE,
]);

export function trimChargeSeconds(
  start: number | undefined,
  end: number | undefined,
  sourceSeconds: number,
): number {
  const from = start ?? 0;
  const to = Math.min(end ?? sourceSeconds, sourceSeconds);
  return Math.ceil(to - from);
}

export function speedChargeSeconds(sourceSeconds: number, speed: number): number {
  return Math.max(1, Math.ceil(sourceSeconds / speed));
}

export function mixChargeSeconds(durationsMs: readonly number[]): number {
  return Math.max(1, Math.ceil(Math.max(...durationsMs) / 1000));
}

export const MUX_SYNC_MODES = ["none", "video", "audio"] as const;
export type MuxSyncMode = (typeof MUX_SYNC_MODES)[number];

export function muxResolution(longSide: number): string | null {
  if (longSide <= 0) return null;
  return longSide <= 1920 ? "1080p" : longSide <= 2560 ? "2k" : "4k";
}

export function muxChargeInput(args: {
  videoMs: number;
  audioMs: number;
  sync: MuxSyncMode;
  width: number | null;
  height: number | null;
}): { duration: number; resolution: string } | null {
  const outputMs =
    args.sync === "video"
      ? args.videoMs
      : args.sync === "audio"
        ? args.audioMs
        : Math.max(args.videoMs, args.audioMs);
  const resolution = muxResolution(Math.max(args.width ?? 0, args.height ?? 0));
  if (resolution === null) return null;
  return { duration: Math.max(1, Math.ceil(outputMs / 1000)), resolution };
}

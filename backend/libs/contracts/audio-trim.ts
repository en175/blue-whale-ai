import { z } from "zod";


export const AUDIO_TRIM_JOB_TYPE = "audio_trim";

export const AUDIO_TRIM_SOURCE = "dock";

export const AUDIO_TRIM_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  startTime: "start_time",
  endTime: "end_time",
  outputFormat: "output_format",
} as const;

export const AUDIO_TRIM_OUTPUT_FORMATS = ["mp3", "m4a", "ogg", "flac", "wav"] as const;
export type AudioTrimOutputFormat = (typeof AUDIO_TRIM_OUTPUT_FORMATS)[number];

export const AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT: AudioTrimOutputFormat = "m4a";

export const AUDIO_TRIM_SUBMIT_PATH = "/v1/mediakit/trim-audio";

export const AUDIO_TRIM_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

export function defaultAudioTrimOutputFormat(sourceFileName: string): AudioTrimOutputFormat {
  const dot = sourceFileName.lastIndexOf(".");
  const extension = dot >= 0 ? sourceFileName.slice(dot + 1).toLowerCase() : "";
  return (AUDIO_TRIM_OUTPUT_FORMATS as readonly string[]).includes(extension)
    ? (extension as AudioTrimOutputFormat)
    : AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT;
}

export function roundAudioTrimSeconds(seconds: number): number {
  return Number(seconds.toFixed(2));
}

export interface AudioTrimTimeRange {
  start: number;
  end: number;
  sourceDuration: number;
}

export function buildAudioTrimTimeParams({
  start,
  end,
  sourceDuration,
}: AudioTrimTimeRange): { start_time?: number; end_time?: number } {
  const params: { start_time?: number; end_time?: number } = {};
  if (start !== 0) {
    params.start_time = roundAudioTrimSeconds(start);
  }
  if (end !== sourceDuration) {
    params.end_time = roundAudioTrimSeconds(end);
  }
  return params;
}

const twoDecimalPlaces = z
  .number()
  .nonnegative()
  .refine((value) => roundAudioTrimSeconds(value) === value, {
    message: "最多两位小数（官方 API 精度上限）",
  });

export const audioTrimInputSchema = z
  .object({
    [AUDIO_TRIM_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [AUDIO_TRIM_INPUT_KEYS.startTime]: twoDecimalPlaces.optional(),
    [AUDIO_TRIM_INPUT_KEYS.endTime]: twoDecimalPlaces.optional(),
    [AUDIO_TRIM_INPUT_KEYS.outputFormat]: z.enum(AUDIO_TRIM_OUTPUT_FORMATS),
  })
  .strict()
  .refine(
    (input) =>
      input.start_time === undefined || input.end_time === undefined || input.start_time < input.end_time,
    { message: "start_time 必须小于 end_time" },
  );
export type AudioTrimInput = z.infer<typeof audioTrimInputSchema>;

export function buildAudioTrimInput({
  sourceAssetId,
  timeRange,
  outputFormat,
}: {
  sourceAssetId: string;
  timeRange: AudioTrimTimeRange;
  outputFormat: AudioTrimOutputFormat;
}): AudioTrimInput {
  return {
    [AUDIO_TRIM_INPUT_KEYS.sourceAssetId]: sourceAssetId,
    ...buildAudioTrimTimeParams(timeRange),
    [AUDIO_TRIM_INPUT_KEYS.outputFormat]: outputFormat,
  };
}

import { z } from "zod";


export const MEDIA_EXTRACT_JOB_TYPE = "media_extract";

export const MEDIA_EXTRACT_SOURCE = "dock";

export const MEDIA_EXTRACT_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  outputFormat: "output_format",
} as const;

export const MEDIA_EXTRACT_OUTPUT_FORMATS = ["m4a", "mp3", "ogg", "flac", "wav"] as const;
export type MediaExtractOutputFormat = (typeof MEDIA_EXTRACT_OUTPUT_FORMATS)[number];

export const MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT: MediaExtractOutputFormat = "m4a";

export const MEDIA_EXTRACT_SUBMIT_PATH = "/v1/mediakit/extract-audio";

export const MEDIA_EXTRACT_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

export const mediaExtractInputSchema = z
  .object({
    [MEDIA_EXTRACT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [MEDIA_EXTRACT_INPUT_KEYS.outputFormat]: z.enum(MEDIA_EXTRACT_OUTPUT_FORMATS),
  })
  .strict();
export type MediaExtractInput = z.infer<typeof mediaExtractInputSchema>;

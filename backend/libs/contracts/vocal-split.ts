import { z } from "zod";


export const VOCAL_SPLIT_JOB_TYPE = "vocal_split";

export const VOCAL_SPLIT_SOURCE = "vocal_split";

export const VOCAL_SPLIT_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  scene: "scene",
  outputFormat: "output_format",
} as const;

export const VOCAL_SPLIT_SCENES = ["audio", "music", "drama", "narrate"] as const;
export type VocalSplitScene = (typeof VOCAL_SPLIT_SCENES)[number];

export const VOCAL_SPLIT_DEFAULT_SCENE: VocalSplitScene = "audio";

export const VOCAL_SPLIT_SCENE_UPSTREAM_MAP: Record<VocalSplitScene, string> = {
  audio: "Audio",
  music: "Music",
  drama: "Drama",
  narrate: "Narrate",
};

export const VOCAL_SPLIT_OUTPUT_FORMATS = ["aac", "mp3", "wav", "m4a", "flac"] as const;
export type VocalSplitOutputFormat = (typeof VOCAL_SPLIT_OUTPUT_FORMATS)[number];

export const VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT: VocalSplitOutputFormat = "aac";

export const VOCAL_SPLIT_SUBMIT_PATH = "/v1/mediakit/separate-voice";

export const VOCAL_SPLIT_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

export const VOCAL_SPLIT_TRACK_TYPES = ["voice", "background", "music", "sfx"] as const;
export type VocalSplitTrackType = (typeof VOCAL_SPLIT_TRACK_TYPES)[number];

export const VOCAL_SPLIT_SCENE_TRACKS: Record<VocalSplitScene, readonly VocalSplitTrackType[]> = {
  audio: ["voice", "background"],
  music: ["voice", "background"],
  drama: ["voice", "music", "sfx"],
  narrate: ["voice", "music", "sfx"],
};

export interface VocalSplitTrackResult {
  track_type: VocalSplitTrackType;
  asset_id: string;
  url: string;
  duration: number;
}

export const vocalSplitInputSchema = z
  .object({
    [VOCAL_SPLIT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VOCAL_SPLIT_INPUT_KEYS.scene]: z.enum(VOCAL_SPLIT_SCENES),
    [VOCAL_SPLIT_INPUT_KEYS.outputFormat]: z.enum(VOCAL_SPLIT_OUTPUT_FORMATS),
  })
  .strict();
export type VocalSplitInput = z.infer<typeof vocalSplitInputSchema>;

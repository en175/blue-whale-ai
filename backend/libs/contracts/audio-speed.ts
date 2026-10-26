import { z } from "zod";


export const AUDIO_SPEED_JOB_TYPE = "audio_speed";
export const AUDIO_SPEED_SOURCE = "dock";

export const AUDIO_SPEED_OUTPUT_FORMAT = "m4a";

export const AUDIO_SPEED_INPUT_KEYS = {
  sourceAssetId: "source_asset_id",
  speed: "speed",
} as const;

export const AUDIO_SPEED_MIN_SPEED = 0.1;
export const AUDIO_SPEED_MAX_SPEED = 4.0;
export const AUDIO_SPEED_STEP = 0.05;

export const AUDIO_SPEED_SUBMIT_PATH = "/v1/mediakit/adjust-audio-speed";

export const AUDIO_SPEED_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

export const AUDIO_SPEED_SLIDER_MIN_POS = 0;
export const AUDIO_SPEED_SLIDER_MID_POS = 500;
export const AUDIO_SPEED_SLIDER_MAX_POS = 1000;

export function roundAudioSpeed(speed: number): number {
  return Number(speed.toFixed(2));
}

export function posToSpeed(pos: number): number {
  const raw = pos <= 500 ? 0.1 + (pos / 500) * 0.9 : 1.0 + ((pos - 500) / 500) * 3.0;
  const q = Math.round(raw / 0.05) * 0.05;
  return Math.min(4.0, Math.max(0.1, parseFloat(q.toFixed(2))));
}

export function speedToPos(speed: number): number {
  return speed <= 1 ? Math.round((speed - 0.1) / 0.9 * 500) : Math.round(500 + (speed - 1) / 3 * 500);
}

const twoDecimalSpeed = z
  .number()
  .min(AUDIO_SPEED_MIN_SPEED)
  .max(AUDIO_SPEED_MAX_SPEED)
  .refine((value) => roundAudioSpeed(value) === value, {
    message: "最多两位小数（产品契约精度口径，0.05 步进天然满足）",
  });

export const audioSpeedInputSchema = z
  .object({
    [AUDIO_SPEED_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [AUDIO_SPEED_INPUT_KEYS.speed]: twoDecimalSpeed.optional(),
  })
  .strict();
export type AudioSpeedInput = z.infer<typeof audioSpeedInputSchema>;

export function buildAudioSpeedInput({
  sourceAssetId,
  speed,
}: {
  sourceAssetId: string;
  speed: number;
}): AudioSpeedInput {
  const input: AudioSpeedInput = { [AUDIO_SPEED_INPUT_KEYS.sourceAssetId]: sourceAssetId };
  if (speed !== 1) {
    input[AUDIO_SPEED_INPUT_KEYS.speed] = roundAudioSpeed(speed);
  }
  return input;
}

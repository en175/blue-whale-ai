import type { ModelFeatures } from '@/custom/api/generation';

export const VIDEO_MODE_KEYS = [
  'text2video',
  'omni',
  'image_reference',
  'first_frame',
  'first_last_frame',
  'edit',
  'extend',
] as const;

export type VideoMode = (typeof VIDEO_MODE_KEYS)[number];

export const VIDEO_MODE_ORDER: readonly VideoMode[] = VIDEO_MODE_KEYS;

export const ORDINARY_VIDEO_MODE_ORDER: readonly VideoMode[] = [
  'text2video',
  'omni',
  'image_reference',
  'edit',
  'extend',
];

const LEGACY_VIDEO_MODE: Record<string, VideoMode> = {
  prompt: 'text2video',
  all: 'omni',
  keyframe: 'first_last_frame',
  default: 'text2video',
  prolong: 'extend',
};

export function isVideoMode(raw: unknown): raw is VideoMode {
  return typeof raw === 'string' && (VIDEO_MODE_KEYS as readonly string[]).includes(raw);
}

export function normalizeVideoMode(raw: unknown): VideoMode | null {
  if (typeof raw !== 'string') return null;
  if (isVideoMode(raw)) return raw;
  return LEGACY_VIDEO_MODE[raw] ?? null;
}

export function isFrameMode(mode: unknown): mode is 'first_frame' | 'first_last_frame' {
  return mode === 'first_frame' || mode === 'first_last_frame';
}

export function frameSlotCountOf(mode: unknown): 0 | 1 | 2 {
  if (mode === 'first_frame') return 1;
  if (mode === 'first_last_frame') return 2;
  return 0;
}

export type VideoModeFeatures = Pick<ModelFeatures, 'task_types'>;

export function configuredVideoModes(
  features: VideoModeFeatures | null | undefined,
): VideoMode[] {
  const raw = features?.task_types;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const keys = new Set(Object.keys(raw));
  return VIDEO_MODE_KEYS.filter((key) => keys.has(key));
}

export interface VideoModeConstraint {
  allowed_ratios?: unknown;
  allowed_durations?: unknown;
  allow_auto_duration?: unknown;
}

export function videoModeConstraintOf(
  features: VideoModeFeatures | null | undefined,
  mode: VideoMode | string | null | undefined,
): VideoModeConstraint | null {
  const taskTypes = features?.task_types;
  if (!mode || !taskTypes || typeof taskTypes !== 'object' || Array.isArray(taskTypes)) return null;
  const entry = (taskTypes as Record<string, unknown>)[mode];
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    ? (entry as VideoModeConstraint)
    : null;
}

function singleValueOf(raw: unknown): unknown[] | null {
  if (!Array.isArray(raw) || raw.length !== 1) return null;
  return raw;
}

export function lockedRatioOf(
  features: VideoModeFeatures | null | undefined,
  mode: VideoMode | string | null | undefined,
): string | null {
  const values = singleValueOf(videoModeConstraintOf(features, mode)?.allowed_ratios);
  return values && typeof values[0] === 'string' ? values[0] : null;
}

export function lockedDurationOf(
  features: VideoModeFeatures | null | undefined,
  mode: VideoMode | string | null | undefined,
): number | null {
  const values = singleValueOf(videoModeConstraintOf(features, mode)?.allowed_durations);
  return values && typeof values[0] === 'number' ? values[0] : null;
}

export function allowsAutoDurationOf(
  features: VideoModeFeatures | null | undefined,
  mode: VideoMode | string | null | undefined,
): boolean {
  return lockedDurationOf(features, mode) === -1
    || videoModeConstraintOf(features, mode)?.allow_auto_duration === true;
}

export interface VideoWireParams {
  aspect_ratio: string;
  duration: number;
}

export function effectiveVideoParams(
  features: VideoModeFeatures | null | undefined,
  mode: VideoMode | string | null | undefined,
  params: { aspectRatio: string; duration: number },
): VideoWireParams {
  return {
    aspect_ratio: lockedRatioOf(features, mode) ?? params.aspectRatio,
    duration: lockedDurationOf(features, mode) ?? params.duration,
  };
}

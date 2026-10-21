import type { MediaToolQuoteInput } from '@/custom/api/mediaToolQuote';

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function roundedSeconds(value: number | null | undefined): number | null {
  const seconds = positive(value);
  return seconds === null ? null : Math.max(1, Math.round(seconds));
}

export function videoToolQuoteInput(
  seconds: number | null | undefined,
): MediaToolQuoteInput | null {
  const rounded = roundedSeconds(seconds);
  return rounded === null ? null : { duration: rounded };
}

export function trimQuoteInput(
  start: number,
  end: number,
  sourceSeconds?: number | null,
): MediaToolQuoteInput | null {
  const source = roundedSeconds(sourceSeconds);
  const clampedEnd = source === null ? end : Math.min(end, source);
  const seconds = Math.ceil(clampedEnd - start);
  return seconds > 0 ? { duration: seconds } : null;
}

export function speedQuoteInput(
  sourceSeconds: number | null | undefined,
  speed: number,
): MediaToolQuoteInput | null {
  const seconds = roundedSeconds(sourceSeconds);
  if (seconds === null || !(speed > 0)) return null;
  return { duration: Math.max(1, Math.ceil(seconds / speed)) };
}

export function mixQuoteInput(
  durations: ReadonlyArray<number | null | undefined>,
): MediaToolQuoteInput | null {
  const valid = durations
    .map((value) => positive(value))
    .filter((value): value is number => value !== null);
  if (valid.length === 0) return null;
  return { duration: Math.max(1, Math.ceil(Math.max(...valid))) };
}

export interface MuxQuoteSource {
  videoSeconds?: number | null;
  audioSeconds?: number | null;
  sync: 'none' | 'video' | 'audio';
  width?: number | null;
  height?: number | null;
}

export function muxQuoteInput(source: MuxQuoteSource): MediaToolQuoteInput | null {
  const video = roundedSeconds(source.videoSeconds);
  const audio = roundedSeconds(source.audioSeconds);
  const output = source.sync === 'video'
    ? video
    : source.sync === 'audio'
      ? audio
      : video !== null && audio !== null
        ? Math.max(video, audio)
        : video ?? audio;
  if (output === null) return null;
  const longSide = Math.max(source.width ?? 0, source.height ?? 0);
  if (longSide <= 0) return null;
  const resolution = longSide <= 1920 ? '1080p' : longSide <= 2560 ? '2k' : '4k';
  return { duration: Math.max(1, Math.ceil(output)), resolution };
}

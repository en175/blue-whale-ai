
export const AUDIO_TRIM_MIN_SEGMENT_SECONDS = 0.1;

export interface AudioTrimSelection {
  start: number;
  end: number;
}

function clampTime(value: number, limit: number): number {
  return Math.min(Math.max(value, 0), limit);
}

export function fullAudioTrimSelection(duration: number): AudioTrimSelection {
  return { start: 0, end: duration };
}

export function clampAudioTrimSelection(
  selection: AudioTrimSelection,
  duration: number,
): AudioTrimSelection {
  const limit = duration > 0 ? duration : AUDIO_TRIM_MIN_SEGMENT_SECONDS;
  const start = clampTime(selection.start, limit);
  const end = clampTime(selection.end, limit);
  if (end - start < AUDIO_TRIM_MIN_SEGMENT_SECONDS) {
    if (start <= limit - AUDIO_TRIM_MIN_SEGMENT_SECONDS) {
      return { start, end: start + AUDIO_TRIM_MIN_SEGMENT_SECONDS };
    }
    return { start: limit - AUDIO_TRIM_MIN_SEGMENT_SECONDS, end: limit };
  }
  return { start, end };
}

export function dragAudioTrimHandleStart(
  time: number,
  selection: AudioTrimSelection,
): AudioTrimSelection {
  const start = clampTime(time, selection.end - AUDIO_TRIM_MIN_SEGMENT_SECONDS);
  return { start, end: selection.end };
}

export function dragAudioTrimHandleEnd(
  time: number,
  selection: AudioTrimSelection,
  duration: number,
): AudioTrimSelection {
  const end = Math.min(
    Math.max(time, selection.start + AUDIO_TRIM_MIN_SEGMENT_SECONDS),
    duration,
  );
  return { start: selection.start, end };
}

export function clampAudioTrimPlayhead(
  time: number,
  selection: AudioTrimSelection,
): number {
  return Math.min(Math.max(time, selection.start), selection.end);
}

export function isAudioTrimTimeInSelection(
  time: number,
  selection: AudioTrimSelection,
): boolean {
  return time >= selection.start - 1e-6 && time <= selection.end + 1e-6;
}

export function audioTrimTimePercent(time: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return (time / duration) * 100;
}

export function audioTrimDurationLabel(selection: AudioTrimSelection): string {
  return `${(selection.end - selection.start).toFixed(1)} s`;
}

export function formatAudioTrimClock(seconds: number): string {
  const s = Math.floor(seconds + 1e-6);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function audioTrimRangeLabel(selection: AudioTrimSelection): string {
  const pad = (seconds: number) => {
    const s = Math.floor(seconds + 1e-6);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  return `${pad(selection.start)} - ${pad(selection.end)}`;
}

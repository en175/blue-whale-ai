import { aspectRatioOptions } from './image-size-ratios';

const VIDEO_RATIO_DISPLAY_LABEL: Record<string, string> = {
  adaptive: 'auto',
};

export function videoRatioLabel(ratio: string): string {
  return VIDEO_RATIO_DISPLAY_LABEL[ratio] ?? ratio;
}

export function pickDefaultVideoRatio(supported: unknown, defaultRatio?: string | null): string {
  const ratioIds = aspectRatioOptions(supported).map((ratio) => ratio.id);
  if (ratioIds.includes('adaptive')) return 'adaptive';
  if (defaultRatio && ratioIds.includes(defaultRatio)) return defaultRatio;
  return ratioIds[0] ?? '';
}

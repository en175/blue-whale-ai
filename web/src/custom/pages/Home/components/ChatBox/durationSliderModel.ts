import { snapValue } from '@/custom/components/DragSlider/dragSliderModel';

export {
  clampValue as clampDuration,
  snapValue as snapDuration,
  ratioFromValue,
  valueFromRatio,
  valueFromPointer,
  stepSpring,
  springSettled,
} from '@/custom/components/DragSlider/dragSliderModel';

export const HOME_DURATION_MIN = 4;
export const HOME_DURATION_MAX = 15;
export const HOME_DURATION_STEP = 1;

export function parseDurationInput(
  raw: string,
  min: number,
  max: number,
  step: number,
): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return snapValue(parsed, min, max, step);
}

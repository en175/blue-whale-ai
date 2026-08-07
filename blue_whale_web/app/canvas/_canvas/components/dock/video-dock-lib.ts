// IK74V6：视频 Dock 纯函数（从 VideoDockContent 下沉）。
import {
  VIDEO_DURATION_MIN,
  VIDEO_DURATION_MAX,
  VIDEO_DURATION_STEP,
} from "../../constants";
import type { ImageModelCapability } from "../../api/generation";

/** 时长边界：优先用模型 supported_durations，缺省回落硬编码常量。 */
export function durationBounds(cap: ImageModelCapability | undefined) {
  const d = cap?.supported_durations;
  return d
    ? { min: d.min, max: d.max, step: d.step }
    : {
        min: VIDEO_DURATION_MIN,
        max: VIDEO_DURATION_MAX,
        step: VIDEO_DURATION_STEP,
      };
}
export function durationTicks(cap: ImageModelCapability | undefined) {
  const { min, max, step } = durationBounds(cap);
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  return ticks;
}
/** 切模型时把时长收进新区间：在区间内保留，否则回 default_duration（再不行回 min）。 */
export function resolveDuration(
  cap: ImageModelCapability | undefined,
  current: number,
) {
  const { min, max } = durationBounds(cap);
  if (current >= min && current <= max) return current;
  const def = cap?.default_duration;
  if (def != null && def >= min && def <= max) return def;
  return min;
}

/** 是否 Seedance 2.0 系模型——只有它们支持参考视频（对齐 worker validateReferences
 *  的 isSeedance2Model，video-job-runner.ts）。TODO: 改用 capability reference_video 字段。 */
export function isSeedance2Model(modelId: string | undefined): boolean {
  return (
    !!modelId &&
    (modelId === "seedance-2" || /^doubao-seedance-2-0(?:-|$)/.test(modelId))
  );
}

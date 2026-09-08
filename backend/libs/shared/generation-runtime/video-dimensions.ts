/** 视频尺寸换算：把创建任务时的 resolution/aspect_ratio 或 size 档换算为像素宽高。
 *  plan/scene_card 任务用 capabilities 的 "宽x高" size 档（如 1280x720）。 */
export function videoDimensions(
  resolution: unknown,
  aspectRatio: unknown,
): { width: number; height: number } | null {
  if (typeof resolution !== "string" || typeof aspectRatio !== "string") return null;
  const height = Number(/^([0-9]+)p$/.exec(resolution)?.[1]);
  const ratio = /^([1-9][0-9]*):([1-9][0-9]*)$/.exec(aspectRatio);
  if (!Number.isFinite(height) || height <= 0 || !ratio) return null;
  const width = Math.round((height * Number(ratio[1])) / Number(ratio[2]) / 2) * 2;
  return { width, height };
}

/** plan/scene_card 任务用 capabilities 的 "宽x高" size 档（如 1280x720）。 */
export function dimensionsFromSize(size: unknown): { width: number; height: number } | null {
  if (typeof size !== "string") return null;
  const match = /^([0-9]+)x([0-9]+)$/i.exec(size);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)
    return null;
  return { width, height };
}

import type { GenerationModel } from '@/custom/api/generation';
import { aspectRatioOptions, hasAspectRatio, ratiosForSelectedSize } from '@/custom/utils/image-size-ratios';
import { allowsAutoDurationOf, type VideoMode } from '@/custom/utils/video-modes';

export function videoParamsRejected(
  model: GenerationModel | undefined,
  params: { aspectRatio: string; resolution: string; duration: number; mode: VideoMode },
): boolean {
  if (!model) return false;
  if (
    aspectRatioOptions(model.supported_aspect_ratios).length > 0 &&
    !hasAspectRatio(model.supported_aspect_ratios, params.aspectRatio)
  ) {
    return true;
  }
  const sizeIds = model.supported_sizes.map((s) => s.id);
  if (sizeIds.length > 0 && !sizeIds.includes(params.resolution)) return true;
  const range = model.supported_durations;
  if (range) {
    if (params.duration === -1) {
      if (!allowsAutoDurationOf(model.features, params.mode)) return true;
    } else if (params.duration < range.min || params.duration > range.max) {
      return true;
    }
  }
  return false;
}

export function imageParamsRejected(
  model: GenerationModel | undefined,
  params: { ratio: string; size: string },
): boolean {
  if (!model) return false;
  const sizeIds = model.supported_sizes.map((s) => s.id);
  if (sizeIds.length > 0 && !sizeIds.includes(params.size)) return true;
  const ratioIds = ratiosForSelectedSize(model, params.size).map((r) => r.id);
  if (ratioIds.length > 0 && !ratioIds.includes(params.ratio)) return true;
  return false;
}

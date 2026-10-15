
import type { ModelFeatures } from '@/app/api/generation';

export const DEFAULT_VIDEO_REFERENCE_MAX = 3;
export const DEFAULT_AUDIO_REFERENCE_MAX = 3;
export const DEFAULT_IMAGE_REFERENCE_MAX = 10;
export const DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO = 1;

export const UNRESOLVED_IMAGE_REFERENCE_LIMIT = 10;

export function videoReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.video_reference_max ?? DEFAULT_VIDEO_REFERENCE_MAX;
}
export const EDIT_MODE_VIDEO_REFERENCE_MAX = 1;
export function videoReferenceMaxForMode(max: number, mode?: string | null): number {
  return mode === 'edit' ? Math.min(EDIT_MODE_VIDEO_REFERENCE_MAX, max) : max;
}
export function audioReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.audio_reference_max ?? DEFAULT_AUDIO_REFERENCE_MAX;
}
export function imageReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX;
}
export function imageReferenceMaxOfForAudio(features?: ModelFeatures | null): number {
  return features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO;
}
export function maxReferenceDurationSecOf(features?: ModelFeatures | null): number | null {
  return features?.max_reference_duration_sec ?? null;
}

export function supportsVideoReferenceOf(features?: ModelFeatures | null): boolean {
  return features?.video_reference === true;
}
export function supportsAudioReferenceOf(features?: ModelFeatures | null): boolean {
  return features?.audio_reference === true;
}

export function checkReferenceLimits(
  features: ModelFeatures | null | undefined,
  references: Array<{ type: 'image' | 'video' | 'audio'; duration?: number }>,
  kind: 'image' | 'video' | 'audio',
): string | null {
  const f = features ?? null;
  if (kind === 'image') {
    const imageCount = references.filter((r) => r.type === 'image').length;
    if (imageCount > imageReferenceMaxOf(f))
      return `参考图最多 ${imageReferenceMaxOf(f)} 张`;
    return null;
  }
  if (kind === 'audio') {
    const audioCount = references.filter((r) => r.type === 'audio').length;
    const imageCount = references.filter((r) => r.type === 'image').length;
    if (audioCount > audioReferenceMaxOf(f))
      return `参考音频最多 ${audioReferenceMaxOf(f)} 个`;
    if (imageCount > imageReferenceMaxOfForAudio(f))
      return `参考图最多 ${imageReferenceMaxOfForAudio(f)} 个`;
    if (audioCount > 0 && imageCount > 0) return '音频与图片参考不可混用';
    const totalDurAudio = maxReferenceDurationSecOf(f);
    if (totalDurAudio != null) {
      const total = references.reduce((sum, r) => sum + (r.duration ?? 0), 0);
      if (total > totalDurAudio)
        return `参考素材总时长超过 ${totalDurAudio} 秒，请减少素材`;
    }
    return null;
  }
  const imageRefs = references.filter((r) => r.type === 'image');
  const videoRefs = references.filter((r) => r.type === 'video');
  const audioRefs = references.filter((r) => r.type === 'audio');
  if (imageRefs.length > imageReferenceMaxOf(f))
    return `参考图最多 ${imageReferenceMaxOf(f)} 张`;
  if (videoRefs.length > 0 && !supportsVideoReferenceOf(f))
    return '当前模型不支持视频素材参考';
  if (audioRefs.length > 0 && !supportsAudioReferenceOf(f))
    return '当前模型不支持音频素材参考';
  if (videoRefs.length > videoReferenceMaxOf(f))
    return `参考视频最多 ${videoReferenceMaxOf(f)} 个`;
  if (audioRefs.length > audioReferenceMaxOf(f))
    return `参考音频最多 ${audioReferenceMaxOf(f)} 个`;
  const totalDur = maxReferenceDurationSecOf(f);
  if (totalDur != null) {
    const total = references.reduce((sum, r) => sum + (r.duration ?? 0), 0);
    if (total > totalDur)
      return `参考素材总时长超过 ${totalDur} 秒，请减少素材`;
  }
  return null;
}

// web/src/lib/model-reference-limits.ts
/** ADR-0086：参考素材分类限制读侧归一（web 独立纯函数，对齐后端响应形状）。
 *  前端各面板/校验统一从此读上限与门控，删除 REF_LIMITS / MAX_VIDEO_REFS / supportsVideoReferenceModel 硬编码。
 *  与后端 backend/libs/shared/persistence/model-capability-repo.ts toFeatures 默认值逐字对齐——
 *  跨进程契约 = HTTP JSON 形状，两端各自实现、靠验收测试锁一致，不共享 TS 包（前后端分离）。 */

import type { ModelFeatures } from '@/api/generation';

/** 缺省参考上限（与后端 toFeatures 默认值对齐） */
export const DEFAULT_VIDEO_REFERENCE_MAX = 3;
export const DEFAULT_AUDIO_REFERENCE_MAX = 3;
export const DEFAULT_IMAGE_REFERENCE_MAX = 1;

/** 读侧归一：能力行值或缺省（容忍后端未配置新键的旧行）。 */
export function videoReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.video_reference_max ?? DEFAULT_VIDEO_REFERENCE_MAX;
}
export function audioReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.audio_reference_max ?? DEFAULT_AUDIO_REFERENCE_MAX;
}
export function imageReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX;
}
export function imageReferenceMaxOfCap(features?: ModelFeatures | null): number {
  return features?.max_reference_images ?? 10;
}
export function maxReferenceDurationSecOf(features?: ModelFeatures | null): number | null {
  return features?.max_reference_duration_sec ?? null;
}

/** 视频生成是否接受视频素材作普通参考（替代旧 seedance-2 前缀特判，ADR-0086）。 */
export function supportsVideoReferenceOf(features?: ModelFeatures | null): boolean {
  return features?.video_reference === true;
}
/** 视频生成是否接受音频素材作参考（2.0 关 / 2.5 开）。 */
export function supportsAudioReferenceOf(features?: ModelFeatures | null): boolean {
  return features?.audio_reference === true;
}

/** 组合校验：参考素材清单是否落在能力行限制内；返回用户可读失败原因，通过返回 null。
 *  与服务端 handle-create-generation-job.ts checkReferenceLimits 同源语义（前端独立实现）。 */
export function checkReferenceLimits(
  features: ModelFeatures | null | undefined,
  references: Array<{ type: 'image' | 'video' | 'audio'; duration?: number }>,
  kind: 'image' | 'video' | 'audio',
): string | null {
  const f = features ?? null;
  if (kind === 'image') {
    const imageCount = references.filter((r) => r.type === 'image').length;
    if (imageCount > imageReferenceMaxOfCap(f))
      return `参考图最多 ${imageReferenceMaxOfCap(f)} 张`;
    return null;
  }
  if (kind === 'audio') {
    const audioCount = references.filter((r) => r.type === 'audio').length;
    const imageCount = references.filter((r) => r.type === 'image').length;
    if (audioCount > audioReferenceMaxOf(f))
      return `参考音频最多 ${audioReferenceMaxOf(f)} 个`;
    if (imageCount > imageReferenceMaxOf(f))
      return `参考图最多 ${imageReferenceMaxOf(f)} 个`;
    if (audioCount > 0 && imageCount > 0) return '音频与图片参考不可混用';
    return null;
  }
  // 视频
  const videoRefs = references.filter((r) => r.type === 'video');
  const audioRefs = references.filter((r) => r.type === 'audio');
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

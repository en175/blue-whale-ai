// web/src/lib/model-reference-limits.ts
/** ADR-0086：参考素材分类限制读侧归一（web 独立纯函数，对齐后端响应形状）。
 *  前端各面板/校验统一从此读上限与门控，删除 REF_LIMITS / MAX_VIDEO_REFS / supportsVideoReferenceModel 硬编码。
 *  与后端 backend/libs/shared/persistence/model-capability-repo.ts toFeatures 默认值逐字对齐——
 *  跨进程契约 = HTTP JSON 形状，两端各自实现、靠验收测试锁一致，不共享 TS 包（前后端分离）。 */

import type { ModelFeatures } from '@/api/generation';

/** 缺省参考上限（与后端 toFeatures 默认值逐字对齐，各自对齐官方口径）。
 *  `image_reference_max` 一把键服务三种生成、官方值按生成类型分叉，故与后端一样拆成两个常量。 */
export const DEFAULT_VIDEO_REFERENCE_MAX = 3;
export const DEFAULT_AUDIO_REFERENCE_MAX = 3;
/** 图片 / 视频生成的图参考上限缺省：网关 `maxImageEditImages=10` / 方舟 Seedream 复合编辑 10 张（IKA72G）。 */
export const DEFAULT_IMAGE_REFERENCE_MAX = 10;
/** **音频**生成的图参考上限缺省：官方音频接口只收 1 张图片参考（旧 `validateAudioReferences` 口径）。 */
export const DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO = 1;

/** 画布层「模型未解析」时的宽松兜底（IKHBO / ADR-0086 修订段口径）：能力列表未加载或
 *  草稿卡未绑定模型时**不阻断**用户操作，宁可交服务端 400 判定，也不做客户端假阴性拦截。
 *  ⚠️ 这**不是能力缺省**——它是「未知时不拦」的哨兵值。 */
export const UNRESOLVED_IMAGE_REFERENCE_LIMIT = 10;

/** 读侧归一：能力行值或缺省。 */
export function videoReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.video_reference_max ?? DEFAULT_VIDEO_REFERENCE_MAX;
}
export function audioReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.audio_reference_max ?? DEFAULT_AUDIO_REFERENCE_MAX;
}
/** 图参考上限：图片 / 视频 / 音频三种生成共用同一个键（IKHEXG 合并了旧的
 *  `max_reference_images`——它与 `image_reference_max` 字面撞车、语义不同，是误判之源）。
 *  缺省取图片/视频口径（10）；音频生成走 {@link imageReferenceMaxOfForAudio}。 */
export function imageReferenceMaxOf(features?: ModelFeatures | null): number {
  return features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX;
}
/** 音频生成用的图参考上限：键相同，缺省按官方音频口径（1）。 */
export function imageReferenceMaxOfForAudio(features?: ModelFeatures | null): number {
  return features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO;
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
    if (imageCount > imageReferenceMaxOf(f))
      return `参考图最多 ${imageReferenceMaxOf(f)} 张`;
    return null;
  }
  // 音频：只收 audio/image，不可混用；总时长上限同样生效（IKHEXG：此前本分支漏读
  // max_reference_duration_sec——后台对音频行开放了该键，代码却不读，配了不生效）。
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
  // 视频：普通参考按类型分类上限（图/视频/音频各自上限）+ 素材总时长。
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

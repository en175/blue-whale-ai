/* 视频生成参考：画布连线推导 → 单数组 references（保序） */
import type { GenerationRefItem } from '@/api/jobs';
import type { VideoMediaRef, VideoMediaRefs, VideoRefRole } from './videoMediaRefs';

function toJobRef(
  item: Pick<VideoMediaRef, 'assetId' | 'mediaType' | 'materialId' | 'duration'>,
  role: GenerationRefItem['role'],
): GenerationRefItem {
  const isMaterial = typeof item.materialId === 'string' && /^asset-/i.test(item.materialId);
  return {
    role,
    type: item.mediaType,
    ...(isMaterial ? { material_id: item.materialId } : { asset_id: item.assetId }),
    // ⚠️ 视频参考的时长要带上：视频按 token 计费，火山公式在「含视频输入」时把输入时长
    //    也算进 token（(输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024），而时长是参考项的标量属性。
    //    本地素材服务端还能自己查资产兜底，**素材库引用（material_id）只能靠这里带**。
    //    图片/音频参考不带（它们不进那条公式），与「只统计 type == video」的服务端口径一致。
    ...(item.mediaType === 'video' &&
    typeof item.duration === 'number' &&
    Number.isFinite(item.duration) &&
    item.duration > 0
      ? { duration: item.duration }
      : {}),
  };
}

function canvasRoleToJobRole(role: VideoRefRole): GenerationRefItem['role'] {
  if (role === 'first') return 'first_frame';
  if (role === 'last') return 'last_frame';
  return 'reference';
}

/** Dock / 连线推导结果组装为生成任务 references */
export function buildVideoJobReferences(refs: VideoMediaRefs): GenerationRefItem[] {
  const out: GenerationRefItem[] = [];
  if (refs.first) out.push(toJobRef(refs.first, 'first_frame'));
  if (refs.last) out.push(toJobRef(refs.last, 'last_frame'));
  for (const item of refs.reference) out.push(toJobRef(item, 'reference'));
  return out;
}

/** 首页交接等扁平列表组装 */
export function buildVideoJobReferencesFromList(
  list: Array<{ assetId: string; mediaType: 'image' | 'video'; role: VideoRefRole; materialId?: string }>,
): GenerationRefItem[] {
  return list.map((item) => toJobRef(item, canvasRoleToJobRole(item.role)));
}

/** 图片参考：与视频/音频同一单数组 references（role 恒 reference、type 恒 image） */
export function buildImageJobReferences(assetIds: readonly string[]): GenerationRefItem[] {
  return assetIds.map((assetId) => ({
    role: 'reference' as const,
    type: 'image' as const,
    asset_id: assetId,
  }));
}

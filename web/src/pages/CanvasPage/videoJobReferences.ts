/* 视频生成参考：画布连线推导 → 单数组 references（保序） */
import type { GenerationRefItem } from '@/api/jobs';
import type { VideoMediaRef, VideoMediaRefs, VideoRefRole } from './videoMediaRefs';

function toJobRef(
  item: Pick<VideoMediaRef, 'assetId' | 'mediaType' | 'materialId'>,
  role: GenerationRefItem['role'],
): GenerationRefItem {
  const isMaterial = typeof item.materialId === 'string' && /^asset-/i.test(item.materialId);
  return {
    role,
    type: item.mediaType,
    ...(isMaterial ? { material_id: item.materialId } : { asset_id: item.assetId }),
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
  list: Array<{ assetId: string; mediaType: 'image' | 'video'; role: VideoRefRole }>,
): GenerationRefItem[] {
  return list.map((item) => toJobRef(item, canvasRoleToJobRole(item.role)));
}

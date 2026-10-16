import { type VideoRefRole } from '@/custom/enums';
import type { GenerationRefItem } from '@/custom/api/jobs';
import type { VideoMediaRef, VideoMediaRefs } from './videoMediaRefs';

function toJobRef(
  item: Pick<VideoMediaRef, 'assetId' | 'mediaType' | 'materialId' | 'duration'>,
  role: GenerationRefItem['role'],
): GenerationRefItem {
  const isMaterial = typeof item.materialId === 'string' && /^asset-/i.test(item.materialId);
  return {
    role,
    type: item.mediaType,
    ...(isMaterial ? { material_id: item.materialId } : { asset_id: item.assetId }),
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

export function buildVideoJobReferences(refs: VideoMediaRefs): GenerationRefItem[] {
  const out: GenerationRefItem[] = [];
  if (refs.first) out.push(toJobRef(refs.first, 'first_frame'));
  if (refs.last) out.push(toJobRef(refs.last, 'last_frame'));
  for (const item of refs.reference) out.push(toJobRef(item, 'reference'));
  return out;
}

export function buildVideoJobReferencesFromList(
  list: Array<{ assetId: string; mediaType: 'image' | 'video'; role: VideoRefRole; materialId?: string }>,
): GenerationRefItem[] {
  return list.map((item) => toJobRef(item, canvasRoleToJobRole(item.role)));
}

export function buildImageJobReferences(assetIds: readonly string[]): GenerationRefItem[] {
  return assetIds.map((assetId) => ({
    role: 'reference' as const,
    type: 'image' as const,
    asset_id: assetId,
  }));
}

/* 画布节点合规校验：视为上传虚拟素材（CreateAsset 不传分组，由后端归组） */
import { createAsset, type MaterialAssetType } from '@/api/material';
import { isMaterialLibraryId } from './mediaRefs';

export const COMPLIANCE_SUCCESS_TOAST = '校验通过，可用于seedance2.0视频生成';

function readNonEmptyId(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  const id = String(raw);
  return id || undefined;
}

/** 图片/视频已入虚拟人像库的素材 id：快照 material_id > 节点已存 materialId > Asset- 前缀身份 */
export function resolveCharacterLibraryMaterialId(input: {
  mediaType?: unknown;
  snapshotMaterialId?: string | null;
  nodeMaterialId?: unknown;
  assetId?: unknown;
}): string | undefined {
  if (input.mediaType === 'audio') return undefined;
  const fromSnapshot = readNonEmptyId(input.snapshotMaterialId);
  if (fromSnapshot) return fromSnapshot;
  const fromNode = readNonEmptyId(input.nodeMaterialId);
  if (fromNode) return fromNode;
  const assetId = readNonEmptyId(input.assetId);
  return assetId && isMaterialLibraryId(assetId) ? assetId : undefined;
}

function toMaterialType(mediaType: 'image' | 'video' | 'audio'): MaterialAssetType {
  if (mediaType === 'video') return 'Video';
  if (mediaType === 'audio') return 'Audio';
  return 'Image';
}

/** 仅本地数字资产 id 可回写 SourceAssetId；素材库 Asset- 前缀不能当原始 id */
function numericSourceAssetId(assetId: string): string | undefined {
  return /^\d+$/.test(assetId) ? assetId : undefined;
}

/** 右键合规校验：按虚拟人像入库，不走 uploads/dedup */
export async function depositCanvasAssetToCharacterLibrary(input: {
  sourceAssetId: string;
  url: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
}): Promise<{ materialId?: string }> {
  const rawName = input.name || '素材';
  const finalName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;
  const sourceAssetId = numericSourceAssetId(input.sourceAssetId);
  const created = await createAsset({
    URL: input.url,
    Name: finalName,
    AssetType: toMaterialType(input.mediaType),
    ...(sourceAssetId ? { SourceAssetId: sourceAssetId } : {}),
  });
  return { materialId: created.Id };
}

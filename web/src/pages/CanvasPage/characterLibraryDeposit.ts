/* 画布节点合规校验：视为上传虚拟素材（CreateAsset 不传分组，由后端归组） */
import { createAsset, waitAssetReady, MaterialAssetFailedError, type MaterialAssetType } from '@/api/material';

export const COMPLIANCE_SUCCESS_TOAST = '校验通过，可用于seedance2.0视频生成';
export const COMPLIANCE_FAILED_TOAST = 'seedance2.0合规校验失败，不可用于视频生成';

export function isComplianceFailedError(err: unknown): boolean {
  return err instanceof MaterialAssetFailedError;
}

/** 轮询单条素材 GetAsset，直到 Active（通过）或 Failed（未通过） */
export function waitComplianceAssetReady(materialId: string) {
  return waitAssetReady(materialId);
}

function readNonEmptyId(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  const id = String(raw);
  return id || undefined;
}

/** 图片/视频已入虚拟人像库的素材 id：只认快照 assets[assetId].material_id */
export function resolveCharacterLibraryMaterialId(input: {
  mediaType?: unknown;
  snapshotMaterialId?: string | null;
}): string | undefined {
  if (input.mediaType === 'audio') return undefined;
  return readNonEmptyId(input.snapshotMaterialId);
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

/** 右键合规校验：按虚拟人像入库，再轮询 GetAsset 直到 Active/Failed */
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
  if (!created.Id) return {};
  await waitAssetReady(created.Id);
  return { materialId: created.Id };
}

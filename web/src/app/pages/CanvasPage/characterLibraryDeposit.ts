import { createAsset, waitAssetReady, MaterialAssetFailedError, type MaterialAssetType } from '@/app/api/material';

export const COMPLIANCE_SUCCESS_TOAST = '校验通过，可用于seedance视频生成';
export const COMPLIANCE_FAILED_TOAST = 'seedance合规校验失败，不可用于视频生成';

export function isComplianceFailedError(err: unknown): boolean {
  return err instanceof MaterialAssetFailedError;
}

export function waitComplianceAssetReady(materialId: string) {
  return waitAssetReady(materialId);
}

function readNonEmptyId(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  const id = String(raw);
  return id || undefined;
}

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

function numericSourceAssetId(assetId: string): string | undefined {
  return /^\d+$/.test(assetId) ? assetId : undefined;
}

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

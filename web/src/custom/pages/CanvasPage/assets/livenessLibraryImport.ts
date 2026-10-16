import { type AssetType } from '@/custom/enums';
import { UPLOAD_SIZE_LIMIT, completeUpload, dedupUpload, fetchUploadPresign, putToPresignedUrl, type AssetRecord, type UploadCompleteData } from '@/custom/api/assets';
import { computeFileMd5, probeMediaMeta } from '@/custom/utils/upload';
import { fetchRemoteMedia } from '../media/fetchRemoteMedia';
import { isMaterialLibraryId } from '../media/mediaRefs';

export function isPendingLivenessLibraryAsset(asset: AssetRecord): boolean {
  return asset.source === 'liveness' && isMaterialLibraryId(String(asset.id));
}

function asMediaType(type: AssetRecord['type']): 'image' | 'video' | null {
  if (type === 'video') return 'video';
  if (type === 'image') return 'image';
  return null;
}

function fileNameOf(asset: AssetRecord): string {
  try {
    const last = new URL(asset.url).pathname.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
  }
  return String(asset.id);
}

function mimeOf(blobType: string, type: 'image' | 'video'): string {
  if (blobType.startsWith(`${type}/`)) return blobType;
  return type === 'video' ? 'video/mp4' : 'image/jpeg';
}

async function fetchLibraryFile(url: string, name: string, type: 'image' | 'video'): Promise<File> {
  const res = await fetchRemoteMedia(url);
  if (!res.ok) throw new Error(`下载失败（${res.status}）`);
  const blob = await res.blob();
  return new File([blob], name, { type: mimeOf(blob.type, type) });
}

function toLocalAssetRecord(
  original: AssetRecord,
  uploaded: UploadCompleteData,
  libraryId: string,
): AssetRecord {
  return {
    ...original,
    id: uploaded.asset_id,
    url: uploaded.url,
    width: uploaded.width || original.width,
    height: uploaded.height || original.height,
    duration: uploaded.duration ?? original.duration,
    size: uploaded.size || original.size,
    material_id: libraryId,
    material_status: 'Active',
    source: 'uploaded',
  };
}

export async function importLivenessLibraryAsset(
  asset: AssetRecord,
  projectId: string,
): Promise<AssetRecord> {
  const libraryId = String(asset.id);
  const mediaType = asMediaType(asset.type);
  if (!mediaType) throw new Error('仅支持图片或视频');

  const fileName = fileNameOf(asset);
  const file = await fetchLibraryFile(asset.url, fileName, mediaType);
  const type: AssetType = mediaType;
  const limit = UPLOAD_SIZE_LIMIT[type];
  if (file.size > limit) {
    throw new Error(`超过 ${Math.floor(limit / 1024 / 1024)}MB 上限`);
  }

  const mime = mimeOf(file.type, mediaType);
  const md5 = await computeFileMd5(file).catch(() => undefined);
  if (md5) {
    const dedup = await dedupUpload({
      type,
      mime,
      size: file.size,
      md5,
      project_id: projectId,
      materialId: libraryId,
    }).catch(() => undefined);
    if (dedup?.dedup && dedup.asset) {
      return toLocalAssetRecord(asset, dedup.asset, libraryId);
    }
  }

  const presign = await fetchUploadPresign({ type, mime, size: file.size });
  await putToPresignedUrl(presign, file);
  const meta = await probeMediaMeta(file, type);
  const uploaded = await completeUpload({
    type,
    mime,
    size: file.size,
    storage_key: presign.storage_key,
    project_id: projectId,
    md5,
    materialId: libraryId,
    ...meta,
  });
  return toLocalAssetRecord(asset, uploaded, libraryId);
}

export async function importLivenessLibraryAssets(
  assets: AssetRecord[],
  projectId: string,
  onError: (name: string, message: string) => void,
): Promise<AssetRecord[]> {
  const result: AssetRecord[] = [];
  for (const asset of assets) {
    if (!isPendingLivenessLibraryAsset(asset)) {
      result.push(asset);
      continue;
    }
    try {
      result.push(await importLivenessLibraryAsset(asset, projectId));
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : '导入失败，请重试';
      onError(fileNameOf(asset), message);
    }
  }
  return result;
}

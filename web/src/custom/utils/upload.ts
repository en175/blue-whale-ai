import { type AssetType } from '@/custom/enums';
import SparkMD5 from 'spark-md5';
import { UPLOAD_SIZE_LIMIT, fetchUploadPresign, putToPresignedUrl, completeUpload, dedupUpload, type UploadCompleteData } from '@/custom/api/assets';
import { silentInit } from '@/shared/api/http';
import { FileRejectedError, checkFileBeforeUpload } from './fileSignature';

export async function computeFileMd5(file: File): Promise<string> {
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const spark = new SparkMD5.ArrayBuffer();
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    spark.append(chunk);
  }
  return spark.end().toLowerCase();
}

export function probeMediaMeta(
  file: File,
  type: AssetType
): Promise<{ width?: number; height?: number; duration?: number }> {
  return new Promise((resolve) => {
    if (type === 'image' || type === 'character') {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({});
        URL.revokeObjectURL(url);
      };
      img.src = url;
      return;
    }
    if (type === 'video' || type === 'audio') {
      const url = URL.createObjectURL(file);
      const el = document.createElement(type === 'video' ? 'video' : 'audio');
      el.preload = 'metadata';
      el.onloadedmetadata = () => {
        const meta: { width?: number; height?: number; duration?: number } = {};
        if (Number.isFinite(el.duration)) meta.duration = Math.round(el.duration);
        if (el instanceof HTMLVideoElement) {
          meta.width = el.videoWidth;
          meta.height = el.videoHeight;
        }
        URL.revokeObjectURL(url);
        resolve(meta);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      el.src = url;
      return;
    }
    resolve({});
  });
}

export function fileToAssetType(file: File): AssetType | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

export function uploadSizeLimitMessage(fileName: string, limit: number): string {
  return `「${fileName}」超过${Math.floor(limit / 1024 / 1024)}MB上限，请压缩或更换文件后上传。`;
}

export async function uploadAssetFile(
  file: File,
  opts?: { projectId?: string; assetSource?: 'mask_erase'; silent?: boolean },
): Promise<UploadCompleteData> {
  const type = fileToAssetType(file);
  if (!type) throw new FileRejectedError(`${file.name} 的格式不支持，请用 JPG、PNG、WebP、MP4 或常见音频格式。`);
  const limit = UPLOAD_SIZE_LIMIT[type];
  if (file.size > limit) {
    throw new FileRejectedError(uploadSizeLimitMessage(file.name, limit));
  }

  const rejection = await checkFileBeforeUpload(file, type);
  if (rejection) throw new FileRejectedError(rejection);

  const md5 = await computeFileMd5(file).catch(() => undefined);
  if (md5) {
    const dedup = await dedupUpload({
      type,
      mime: file.type,
      size: file.size,
      md5,
      project_id: opts?.projectId,
    }).catch(() => undefined);
    if (dedup?.dedup && dedup.asset) {
      console.log('[upload] md5 去重命中，复用已有资产:', dedup.asset.asset_id);
      return dedup.asset;
    }
  }

  const presign = await fetchUploadPresign({ type, mime: file.type, size: file.size }, silentInit(opts));
  console.log('[upload] presign 返回:', {
    storage_key: presign.storage_key,
    upload_url: presign.upload_url?.substring(0, 100) + '...',
    headers: presign.headers,
    expires_in: presign.expires_in,
  });
  await putToPresignedUrl(presign, file);
  const meta = await probeMediaMeta(file, type);
  const result = await completeUpload({
    type,
    mime: file.type,
    size: file.size,
    name: file.name,
    storage_key: presign.storage_key,
    project_id: opts?.projectId,
    md5,
    ...(opts?.assetSource ? { source: opts.assetSource } : {}),
    ...meta,
  }, silentInit(opts));
  console.log('[upload] complete 返回:', { url: result.url, asset_id: result.asset_id });
  return result;
}

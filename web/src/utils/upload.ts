/* ============================================
 * upload 工具：presign → PUT 直传 → complete 三步上传封装
 * ============================================ */
import {
  UPLOAD_SIZE_LIMIT,
  fetchUploadPresign,
  putToPresignedUrl,
  completeUpload,
  type AssetType,
  type UploadCompleteData,
} from '@/api/assets';

/** 探测媒体宽高/时长（失败返回空对象，不阻断上传；用于 complete 可选参数） */
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

/** 由 MIME 推断资产类型，不支持返回 null */
export function fileToAssetType(file: File): AssetType | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

/** 单文件三步上传：返回 complete 登记结果（含永久 url）
 *
 * 体积超限在发请求之前就挡掉（IKAL46）：presign 那一侧也会拒，但那要等一次网络往返，而且回来
 * 的是通用错误码，用户看不出是文件太大。本地先判一次，报得准也报得快。 */
export async function uploadAssetFile(
  file: File,
  opts?: { projectId?: string },
): Promise<UploadCompleteData> {
  const type = fileToAssetType(file);
  if (!type) throw new Error(`不支持的文件类型：${file.name}`);
  const limit = UPLOAD_SIZE_LIMIT[type];
  if (file.size > limit) {
    throw new Error(`文件超过 ${Math.floor(limit / 1024 / 1024)}MB 上限`);
  }
  const presign = await fetchUploadPresign({ type, mime: file.type, size: file.size });
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
    storage_key: presign.storage_key,
    project_id: opts?.projectId,
    ...meta,
  });
  console.log('[upload] complete 返回:', { url: result.url, asset_id: result.asset_id });
  return result;
}

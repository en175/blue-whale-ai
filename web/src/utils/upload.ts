/* ============================================
 * upload 工具：md5 查重 → presign → PUT 直传 → complete 上传封装
 * ============================================ */
import SparkMD5 from 'spark-md5';
import {
  UPLOAD_SIZE_LIMIT,
  fetchUploadPresign,
  putToPresignedUrl,
  completeUpload,
  dedupUpload,
  type AssetType,
  type UploadCompleteData,
} from '@/api/assets';
import { checkFileBeforeUpload } from './fileSignature';

/** 流式计算文件 MD5（32 位小写 hex）：4MB 分块增量计算，避免大文件一次性读入内存。
 *  SubtleCrypto 不支持 MD5 算法，这里使用 spark-md5 实现。 */
async function computeFileMd5(file: File): Promise<string> {
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const spark = new SparkMD5.ArrayBuffer();
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    spark.append(chunk);
  }
  return spark.end().toLowerCase();
}

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

/** 单文件上传：返回 complete 登记结果（含永久 url）
 *
 * IKCNLS md5 去重：presign 前先算 md5 调 dedup 预检——命中直接复用已有资产，跳过
 * TOS 三步上传；未命中走三步，并在 complete 时带上 md5 落库，供后续同内容文件查重。
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

  // 读一眼文件开头，认不出是媒体就不发请求（IKE53Z）。理由与上面的体积门一样，只是判据换成了
  // 内容：type 是从 file.type 推的，而 file.type 来自后缀，后缀是别人说的。测试站 2026-09-08
  // 那份 524 字节的假 JPEG 就是这么一路走到 Agent 读图才被发现的。
  const rejection = await checkFileBeforeUpload(file, type);
  if (rejection) throw new Error(rejection);

  // md5 计算或查重请求失败都不阻断上传：静默降级走原三步
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
    md5,
    ...meta,
  });
  console.log('[upload] complete 返回:', { url: result.url, asset_id: result.asset_id });
  return result;
}

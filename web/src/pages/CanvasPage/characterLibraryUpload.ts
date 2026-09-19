/* 角色库 / 虚拟人像库本地上传：uploadAssetFile → CreateAsset。
 * 失败必须带回可读原因（TC_DG_209/213/302），禁止静默。 */
import { toast } from 'sonner';
import { createAsset } from '@/api/material';
import { isApiError } from '@/api/http';
import { uploadAssetFile } from '@/utils/upload';
import { isFileRejected } from '@/utils/fileSignature';

export interface MaterialLibraryUploadResult {
  errors: string[];
  createdIds: string[];
}

function retryableFailure(fileName: string, detail?: string): string {
  const reason = detail?.trim() ? detail.trim() : `上传失败：${fileName}`;
  return reason.includes('请重试') ? reason : `${reason}，请重试`;
}

/** 批量入库虚拟/真人素材库。groupId 为空时不传分组（虚拟库由后端归组）。 */
export async function uploadMaterialLibraryFiles(
  files: File[],
  groupId: string | null,
): Promise<MaterialLibraryUploadResult> {
  const errors: string[] = [];
  const createdIds: string[] = [];
  for (const file of files) {
    let assetKind: 'Image' | 'Video';
    if (file.type.startsWith('image/')) assetKind = 'Image';
    else if (file.type.startsWith('video/')) assetKind = 'Video';
    else {
      errors.push(`${file.name}：仅支持图片和视频`);
      continue;
    }
    try {
      const uploadResult = await uploadAssetFile(file);
      const rawName = file.name;
      const finalName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;
      if (rawName.length > 30) toast('当前上传素材名称过长，已截取', { style: { textAlign: 'center' } });
      const created = await createAsset({
        ...(groupId ? { GroupId: groupId } : {}),
        URL: uploadResult.url,
        Name: finalName,
        AssetType: assetKind,
        SourceAssetId: String(uploadResult.asset_id),
      }, { silent: true });
      if (created.Id) createdIds.push(created.Id);
    } catch (err) {
      if (isFileRejected(err)) {
        errors.push(err.message);
        continue;
      }
      errors.push(retryableFailure(file.name, isApiError(err) ? err.message : undefined));
    }
  }
  return { errors, createdIds };
}

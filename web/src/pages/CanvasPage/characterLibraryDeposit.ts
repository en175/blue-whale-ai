/* 画布素材复制入角色库（CreateAsset + SourceAssetId）；虚拟人像库不传分组，由后端归组 */
import { createAsset, type MaterialAssetType } from '@/api/material';

/** 将本地画布资产复制进角色库；已绑定则跳过上传（静默去重） */
export async function depositCanvasAssetToCharacterLibrary(input: {
  sourceAssetId: string;
  url: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
  alreadyBound?: boolean;
}): Promise<'deposited' | 'skipped'> {
  if (input.alreadyBound) return 'skipped';
  const assetType: MaterialAssetType =
    input.mediaType === 'video' ? 'Video' : input.mediaType === 'audio' ? 'Audio' : 'Image';
  const rawName = input.name || '素材';
  const finalName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;
  await createAsset({
    URL: input.url,
    Name: finalName,
    AssetType: assetType,
    SourceAssetId: input.sourceAssetId,
  });
  return 'deposited';
}

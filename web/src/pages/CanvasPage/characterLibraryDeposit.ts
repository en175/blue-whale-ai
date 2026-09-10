/* 画布素材复制入角色库对应类型分区（CreateAsset + SourceAssetId） */
import {
  createAsset,
  createAssetGroup,
  listAssetGroups,
  type MaterialAssetType,
} from '@/api/material';

const GROUP_NAME: Record<MaterialAssetType, string> = {
  Image: '图片',
  Video: '视频',
  Audio: '音频',
};

/** 找到或创建角色库（AIGC）下对应类型分区 */
export async function ensureCharacterTypeGroup(assetType: MaterialAssetType): Promise<string> {
  const listed = await listAssetGroups({
    Filter: { GroupType: 'AIGC' },
    PageNumber: 1,
    PageSize: 50,
  });
  const name = GROUP_NAME[assetType];
  const found = listed.Items?.find((g) => g.Name === name || g.Description === name);
  if (found?.Id) return found.Id;
  const created = await createAssetGroup({ Name: name, GroupType: 'AIGC' });
  return created.Id;
}

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
  const groupId = await ensureCharacterTypeGroup(assetType);
  const rawName = input.name || '素材';
  const finalName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;
  await createAsset({
    GroupId: groupId,
    URL: input.url,
    Name: finalName,
    AssetType: assetType,
    SourceAssetId: input.sourceAssetId,
  });
  return 'deposited';
}

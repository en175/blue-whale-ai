import dayjs from 'dayjs';
import type { AssetRecord } from '@/app/api/assets';

export const EMPTY_ASSET_DETAIL = '暂无数据';

export function formatAssetSource(source: string | null): string {
  if (!source) return EMPTY_ASSET_DETAIL;
  if (source === 'uploaded') return '用户上传';
  if (source === 'generated') return 'AI 生成';
  return source;
}

export function formatAssetCreatedAt(createdAt: string | null): string {
  if (!createdAt) return EMPTY_ASSET_DETAIL;
  const date = dayjs(createdAt);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : EMPTY_ASSET_DETAIL;
}

export function formatAssetResolution(asset: AssetRecord): string {
  if (!asset.width || !asset.height) return EMPTY_ASSET_DETAIL;
  return `${asset.width} × ${asset.height}`;
}

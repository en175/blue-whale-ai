import type { AssetRecord, AssetType } from '@/api/assets';

export const typeLabel: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  character: '虚拟人像',
};

export function assetAspectRatio(asset: Pick<AssetRecord, 'width' | 'height'>): string {
  const width = Number(asset.width);
  const height = Number(asset.height);

  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? `${width} / ${height}`
    : '1 / 1';
}

export function appendUniqueAssets(current: AssetRecord[], incoming: AssetRecord[]): AssetRecord[] {
  const knownIds = new Set(current.map((asset) => String(asset.id)));
  const additions = incoming.filter((asset) => {
    const id = String(asset.id);
    if (knownIds.has(id)) return false;
    knownIds.add(id);
    return true;
  });

  return additions.length ? [...current, ...additions] : current;
}

export function hasNextAssetPage(
  loadedCount: number,
  total: number,
  receivedCount: number,
): boolean {
  return receivedCount > 0 && loadedCount < total;
}

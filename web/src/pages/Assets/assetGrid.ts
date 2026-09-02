import type { AssetRecord } from '@/api/assets';

/**
 * 瀑布流卡片的媒体比例。
 *
 * 资产接口中的宽高属于不可信展示数据：旧资产、音频和异常响应都可能缺失。
 * 所有无效值统一回退为 1:1，避免浏览器在加载时重新排版。
 */
export function assetAspectRatio(asset: Pick<AssetRecord, 'width' | 'height'>): string {
  const width = Number(asset.width);
  const height = Number(asset.height);

  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? `${width} / ${height}`
    : '1 / 1';
}

/**
 * 分页响应偶有重叠；按资产 ID 合并能保证无限加载不会产生重复卡片。
 */
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

/** 当前响应还能提供新数据时才继续请求，空页可防止错误响应造成加载循环。 */
export function hasNextAssetPage(
  loadedCount: number,
  total: number,
  receivedCount: number,
): boolean {
  return receivedCount > 0 && loadedCount < total;
}

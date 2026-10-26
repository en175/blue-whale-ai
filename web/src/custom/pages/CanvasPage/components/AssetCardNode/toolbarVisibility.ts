
import { KIND_META, type AssetCardKind } from '@/custom/enums';

const HIDE_ASSET_TOP_BAR = false;

export function assetCardToolbarVisible(kind: AssetCardKind | undefined, hideAssetTopBar = HIDE_ASSET_TOP_BAR): boolean {
  return (kind ?? 'custom') === 'generation' || !hideAssetTopBar;
}

export function assetCardKindOf(kind: AssetCardKind | undefined): AssetCardKind {
  return kind && kind in KIND_META ? kind : 'custom';
}

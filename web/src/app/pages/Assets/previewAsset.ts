import { useQuery } from '@tanstack/react-query';
import { assetDetailQueryOptions, type AssetRecord } from '@/api/assets';

export function usePreviewAsset(previewTarget: AssetRecord | null): AssetRecord | null {
  const detail = useQuery(assetDetailQueryOptions(previewTarget?.id ?? null));
  return detail.data ?? previewTarget;
}

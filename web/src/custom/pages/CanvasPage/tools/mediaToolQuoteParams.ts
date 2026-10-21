import type { MediaToolQuoteParams } from '@/custom/api/mediaToolQuote';

export function sourceQuoteParams(
  sourceAssetId: string | null | undefined,
): MediaToolQuoteParams | null {
  return sourceAssetId ? { source_asset_id: sourceAssetId } : null;
}

export function sourceQuoteParamsWith(
  sourceAssetId: string | null | undefined,
  extra: Record<string, unknown>,
): MediaToolQuoteParams | null {
  const base = sourceQuoteParams(sourceAssetId);
  return base ? { ...base, ...extra } : null;
}

export function mixQuoteParams(
  sourceAssetId: string | null | undefined,
  inputAssetIds: ReadonlyArray<string>,
): MediaToolQuoteParams | null {
  if (!sourceAssetId) return null;
  return {
    inputs: [sourceAssetId, ...inputAssetIds].map((assetId) => ({
      asset_id: assetId,
    })),
  };
}

export function muxQuoteParams(
  audioAssetId: string | null | undefined,
  videoAssetId: string | null | undefined,
  sync: string,
): MediaToolQuoteParams | null {
  if (!audioAssetId || !videoAssetId) return null;
  return {
    audio: { assetId: audioAssetId },
    video: { assetId: videoAssetId },
    sync,
  };
}

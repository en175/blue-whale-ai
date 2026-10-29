import { useRef } from 'react';
import { useCanvasDoc } from './useCanvasDoc';

export function useCanvasPageDocument(currentId: string) {
  const { doc, assets: snapshotAssets, loadFailed: canvasLoadFailed, refetch, acceptDoc, patchAsset, upsertAssets } = useCanvasDoc(currentId);
  const snapshotAssetsRef = useRef(snapshotAssets);
  snapshotAssetsRef.current = snapshotAssets;
  return {
    doc,
    snapshotAssets,
    snapshotAssetsRef,
    canvasLoadFailed,
    refetch,
    acceptDoc,
    patchAsset,
    upsertAssets,
  };
}

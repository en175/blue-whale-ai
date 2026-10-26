import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { legacyCardHistoryOptions } from '@/custom/api/canvas';
import { useCanvasDoc } from './useCanvasDoc';
import { useCanvasLegacyMigrationToast } from './useCanvasLegacyMigrationToast';

export function useCanvasPageDocument(
  currentId: string,
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void,
) {
  const { doc, assets: snapshotAssets, loadFailed: canvasLoadFailed, refetch, acceptDoc, legacyMigration, patchAsset, upsertAssets } = useCanvasDoc(currentId);
  const snapshotAssetsRef = useRef(snapshotAssets);
  snapshotAssetsRef.current = snapshotAssets;
  const historyQuery = useQuery({ ...legacyCardHistoryOptions(currentId), enabled: Boolean(doc && currentId) });
  useCanvasLegacyMigrationToast({ legacyMigration, showToast });
  return {
    doc,
    snapshotAssets,
    snapshotAssetsRef,
    canvasLoadFailed,
    refetch,
    acceptDoc,
    legacyHistory: historyQuery.data?.items,
    patchAsset,
    upsertAssets,
  };
}

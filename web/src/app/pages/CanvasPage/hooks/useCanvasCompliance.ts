import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import { isApiError } from '@/shared/api/http';
import type { SnapshotAsset } from '@/app/api/projects';
import {
  COMPLIANCE_FAILED_TOAST,
  COMPLIANCE_SUCCESS_TOAST,
  depositCanvasAssetToCharacterLibrary,
  isComplianceFailedError,
  resolveCharacterLibraryMaterialId,
  waitComplianceAssetReady,
} from '../characterLibraryDeposit';

export interface CanvasComplianceHost {
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  mediaNodesRef: RefObject<Node[]>;
  snapshotAssetsRef: RefObject<Record<string, SnapshotAsset>>;
  patchAsset?: (assetId: string, patch: Partial<SnapshotAsset>) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  complianceCheckRef?: RefObject<((id: string) => void) | undefined>;
}

export function useCanvasCompliance(host: CanvasComplianceHost) {
  const { setMediaNodes, mediaNodesRef, snapshotAssetsRef, patchAsset, showToast, complianceCheckRef } = host;

  const patchNodeCompliance = (id: string, patch: Record<string, unknown>) => {
    setMediaNodes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
      mediaNodesRef.current = next;
      return next;
    });
  };

  const startNodeCompliance = (id: string) => {
    patchNodeCompliance(id, {
      complianceBusy: true,
      compliancePassed: false,
      complianceFailed: false,
    });
  };

  const toastComplianceError = (err: unknown) => {
    if (isApiError(err)) return;
    showToast(
      'error',
      isComplianceFailedError(err)
        ? COMPLIANCE_FAILED_TOAST
        : err instanceof Error
          ? err.message
          : '校验失败，请重试',
    );
  };

  const failNodeCompliance = (id: string, err: unknown) => {
    patchNodeCompliance(id, {
      complianceBusy: false,
      compliancePassed: false,
      complianceFailed: isComplianceFailedError(err),
    });
    toastComplianceError(err);
  };

  const ensureMediaNodeCompliance = async (
    id: string,
    opts?: { toastSuccess?: boolean },
  ): Promise<string | undefined> => {
    const toastSuccess = opts?.toastSuccess !== false;
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node) return undefined;
    const d = (node.data ?? {}) as Record<string, unknown>;
    if (d.assetMissing === true) return undefined;
    const assetId = d.assetId != null ? String(d.assetId) : '';
    const url = typeof d.src === 'string' ? d.src : '';
    const mediaType = d.mediaType === 'video' || d.mediaType === 'audio' ? d.mediaType : 'image';
    const verifiedId = resolveCharacterLibraryMaterialId({
      mediaType,
      snapshotMaterialId: snapshotAssetsRef.current[assetId]?.material_id,
    });
    if (verifiedId) {
      startNodeCompliance(id);
      try {
        await waitComplianceAssetReady(verifiedId);
        if (toastSuccess) showToast('success', COMPLIANCE_SUCCESS_TOAST);
        if (assetId) {
          const current = snapshotAssetsRef.current[assetId];
          if (current) {
            snapshotAssetsRef.current = {
              ...snapshotAssetsRef.current,
              [assetId]: { ...current, material_id: verifiedId, material_status: 'Active' },
            };
          }
          patchAsset?.(assetId, { material_id: verifiedId, material_status: 'Active' });
        }
        patchNodeCompliance(id, {
          complianceBusy: false,
          compliancePassed: true,
          complianceFailed: false,
          materialId: verifiedId,
        });
        return verifiedId;
      } catch (err) {
        failNodeCompliance(id, err);
        return undefined;
      }
    }
    if (!url || url.startsWith('blob:')) {
      showToast('warn', '素材尚未上传完成，请稍后重试');
      return undefined;
    }
    startNodeCompliance(id);
    try {
      const result = await depositCanvasAssetToCharacterLibrary({
        sourceAssetId: assetId,
        url,
        name: typeof d.fileName === 'string' ? d.fileName : '素材',
        mediaType,
      });
      if (!result.materialId) {
        patchNodeCompliance(id, { complianceBusy: false, compliancePassed: false, complianceFailed: false });
        showToast('error', '校验失败，请重试');
        return undefined;
      }
      if (toastSuccess) showToast('success', COMPLIANCE_SUCCESS_TOAST);
      if (assetId && result.materialId) {
        const current = snapshotAssetsRef.current[assetId];
        if (current) {
          snapshotAssetsRef.current = {
            ...snapshotAssetsRef.current,
            [assetId]: { ...current, material_id: result.materialId, material_status: 'Active' },
          };
        }
        patchAsset?.(assetId, { material_id: result.materialId, material_status: 'Active' });
      }
      patchNodeCompliance(id, {
        complianceBusy: false,
        compliancePassed: true,
        complianceFailed: false,
        materialId: result.materialId,
      });
      return result.materialId;
    } catch (err) {
      failNodeCompliance(id, err);
      return undefined;
    }
  };

  const handleComplianceCheck = async (id: string) => {
    await ensureMediaNodeCompliance(id, { toastSuccess: true });
  };

  if (complianceCheckRef) {
    complianceCheckRef.current = (id) => { void handleComplianceCheck(id); };
  }
  return { patchNodeCompliance, startNodeCompliance, toastComplianceError, failNodeCompliance, ensureMediaNodeCompliance, handleComplianceCheck };
}

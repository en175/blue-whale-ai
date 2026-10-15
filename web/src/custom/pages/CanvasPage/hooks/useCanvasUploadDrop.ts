import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import { UPLOAD_SIZE_LIMIT } from '@/custom/api/assets';
import type { SnapshotAsset } from '@/custom/api/projects';
import { uploadAssetFile } from '@/custom/utils/upload';
import { compliancePatchFromMaterialStatus } from '@/custom/utils/video-reference-compliance';
import { isFileRejected } from '@/custom/utils/fileSignature';
import type { MediaDims } from '../components/MediaNode/mediaContentSize';
import { copyImageToClipboard, readCanvasClipboard } from '../clipboardPaste';
import { hasCustomName } from '../canvasNodeUtils';
import { newNodeId } from '../nodeId';
import type { CanvasNodeActions } from './useCanvasNodeFactories';

export type UploadDropActions = CanvasNodeActions & {
  cancelJob: (id: string) => void;
  retryJob: (id: string) => void;
  fixFollowVideo: (id: string) => void;
};

export interface CanvasUploadDropHost {
  currentId: string;
  toolMode: string;
  spawnPosition: () => { x: number; y: number };
  handleMediaDims: (id: string, dims: MediaDims) => void;
  handleSaveMediaToAssets: (id: string) => void;
  dockToolCallbacks: Record<string, unknown>;
  actionsRef: RefObject<UploadDropActions>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  historyRef: RefObject<{ pushAddNodes: (ids: string[]) => void } | null>;
  upsertAssets: (items: SnapshotAsset[]) => void;
  mediaNodesRef: RefObject<Node[]>;
  handleAddTextNode: (position?: { x: number; y: number }, text?: string) => string;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

export interface CanvasUploadDropHandles {
  placeFileOnCanvas: (
    file: File,
    opts?: { position?: { x: number; y: number }; replaceNodeId?: string },
  ) => Promise<{ asset_id: string; url: string; nodeId: string }>;
  handleUploadFile: (files: File[]) => void;
  handleCopyImage: (id: string) => Promise<void>;
  handleFillEmptyShell: (id: string, file: File) => void;
  applyClipboardAtFlow: (position: { x: number; y: number }) => Promise<void>;
}

export function useCanvasUploadDrop(host: CanvasUploadDropHost): CanvasUploadDropHandles {
  const {
    currentId,
    toolMode,
    spawnPosition,
    handleMediaDims,
    handleSaveMediaToAssets,
    dockToolCallbacks,
    actionsRef,
    setMediaNodes,
    pendingNodeIdsRef,
    historyRef,
    upsertAssets,
    mediaNodesRef,
    handleAddTextNode,
    showToast,
  } = host;

  const placeFileOnCanvas = (
    file: File,
    opts?: { position?: { x: number; y: number }; replaceNodeId?: string },
  ): Promise<{ asset_id: string; url: string; nodeId: string }> => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    if (!isImage && !isVideo && !isAudio) {
      return Promise.reject(new Error('只支持图片、视频或音频'));
    }
    const limit = UPLOAD_SIZE_LIMIT[isImage ? 'image' : isVideo ? 'video' : 'audio'];
    if (file.size > limit) {
      return Promise.reject(new Error(`文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限`));
    }
    const nodeId = opts?.replaceNodeId ?? newNodeId('media');
    const localSrc = URL.createObjectURL(file);
    pendingNodeIdsRef.current.add(nodeId);
    const mediaType = isVideo ? 'video' : isAudio ? 'audio' : 'image';
    const mediaCallbacks = {
      onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
      onDuplicate: (id: string) => actionsRef.current.duplicate(id),
      onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
      onAddToChat: (id: string) => actionsRef.current.addToChat(id),
      onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
      onCopyImage: (id: string) => actionsRef.current.copyImage(id),
      onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
      onFillEmptyShell: (id: string, next: File) => actionsRef.current.fillEmptyShell(id, next),
      onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
      onRetryJob: (id: string) => actionsRef.current.retryJob(id),
      onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
      onDownload: (id: string) => actionsRef.current.download(id),
      ...dockToolCallbacks,
      onShowDetails: (id: string) => actionsRef.current.showDetails(id),
      onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
      onMediaDims: handleMediaDims,
    };
    if (opts?.replaceNodeId) {
      setMediaNodes((prev) =>
        prev.map((n) =>
          n.id !== nodeId
            ? n
            : {
                ...n,
                data: {
                  ...n.data,
                  ...mediaCallbacks,
                  emptyShell: false,
                  src: localSrc,
                  ...(hasCustomName(n) ? {} : { fileName: file.name }),
                  mediaType,
                  toolMode,
                },
              },
        ),
      );
    } else {
    setMediaNodes((prev) => [
      ...prev,
      {
        id: nodeId,
        type: 'mediaNode',
        position: opts?.position ?? spawnPosition(),
        data: {
          src: localSrc,
          fileName: file.name,
          mediaType,
          toolMode,
          ...mediaCallbacks,
        },
      },
    ]);
    historyRef.current?.pushAddNodes([nodeId]);
    }
    return uploadAssetFile(file, { projectId: currentId || undefined })
      .then((done) => {
        const compliancePatch = compliancePatchFromMaterialStatus(
          mediaType,
          done.material_id,
          done.material_status,
        );
        setMediaNodes((prev) =>
          prev.map((n) => {
            if (n.id !== nodeId) return n;
            URL.revokeObjectURL(localSrc);
            return {
              ...n,
              data: {
                ...n.data,
                src: done.url || localSrc,
                assetId: done.asset_id,
                emptyShell: false,
                mime: done.mime,
                width: done.width,
                height: done.height,
                duration: done.duration ?? undefined,
                size: done.size,
                ...compliancePatch,
              },
            };
          }),
        );
        if (done.asset_id && done.url && typeof upsertAssets === 'function') {
          upsertAssets([{
            asset_id: Number(done.asset_id),
            type: mediaType,
            access_url: done.url,
            width: typeof done.width === 'number' ? done.width : null,
            height: typeof done.height === 'number' ? done.height : null,
            material_id: done.material_id ?? null,
            material_status: done.material_status ?? null,
          }]);
        }
        return { asset_id: done.asset_id, url: done.url, nodeId };
      })
      .catch((err) => {
        console.warn(`画布上传登记失败（${file.name}）：`, err);
        URL.revokeObjectURL(localSrc);
        pendingNodeIdsRef.current.delete(nodeId);
        if (opts?.replaceNodeId) {
          setMediaNodes((prev) =>
            prev.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, emptyShell: true, src: undefined } } : n,
            ),
          );
        } else {
          setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
        }
        showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
        throw err instanceof Error ? err : new Error('上传失败');
      });
  };

  const handleUploadFile = (files: File[]) => {
    files.forEach((file) => {
      void placeFileOnCanvas(file).catch((err) => {
        showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
      });
    });
  };

  const applyClipboardAtFlow = async (position: { x: number; y: number }) => {
    const payload = await readCanvasClipboard();
    if (!payload) {
      showToast('warn', '剪贴板无可粘贴内容');
      return;
    }
    if (payload.kind === 'image') {
      try {
        await placeFileOnCanvas(payload.file, { position });
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : '粘贴失败');
      }
      return;
    }
    handleAddTextNode(position, payload.text);
  };

  const handleCopyImage = async (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    const src = node?.data?.src as string | undefined;
    if (!src || (node?.data as { mediaType?: string })?.mediaType !== 'image') {
      showToast('warn', '当前节点没有可复制的图片');
      return;
    }
    try {
      await copyImageToClipboard(src);
      showToast('success', '已复制图片');
    } catch {
      showToast('error', '复制图片失败');
    }
  };

  const handleFillEmptyShell = (id: string, file: File) => {
    void placeFileOnCanvas(file, { replaceNodeId: id }).catch((err) => {
      showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
    });
  };

  return { placeFileOnCanvas, handleUploadFile, handleCopyImage, handleFillEmptyShell, applyClipboardAtFlow };
}

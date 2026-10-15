import type { RefObject } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { fetchUploadPresign, putToPresignedUrl, completeUpload, type AssetType, type UploadCompleteData } from '@/app/api/assets';
import { probeMediaMeta } from '@/app/utils/upload';
import { checkFileBeforeUpload } from '@/app/utils/fileSignature';
import { fetchUrlAsFile } from '../canvasPureNodeHelpers';
import { isImageDraftNode } from '../mediaRefs';
import { mergedImageRefsOf } from '../textIndexSync';
import type { UploadedFile, ImageTextAttachment } from '../components/ImageDialog';

export interface CanvasGenerationUploadsInput {
  currentId: string;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  mediaNodesRef: RefObject<Node[]>;
  textNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  findCanvasNode: (id: string) => Node | undefined;
  textAttachmentsOf: (targetNodeId: string) => ImageTextAttachment[];
}

export function useCanvasGenerationUploads(input: CanvasGenerationUploadsInput) {
  const uploadFileToAsset = async (file: File, type: 'image' | 'video' | 'audio'): Promise<UploadCompleteData | null> => {
    try {
      const assetType: AssetType = type;
      const rejection = await checkFileBeforeUpload(file, assetType);
      if (rejection) {
        input.showToast('warn', rejection);
        return null;
      }
      const presign = await fetchUploadPresign({ type: assetType, mime: file.type, size: file.size });
      await putToPresignedUrl(presign, file);
      const meta = await probeMediaMeta(file, assetType).catch(() => ({}));
      const complete = await completeUpload({
        type: assetType,
        mime: file.type,
        size: file.size,
        name: file.name,
        storage_key: presign.storage_key,
        project_id: input.currentId || undefined,
        ...meta,
      });
      return complete;
    } catch (e) {
      console.warn('上传文件失败:', e);
      return null;
    }
  };
  const collectImageInputAssetIds = async (
    targetNodeId: string | undefined,
    files: UploadedFile[],
    useEdgeRefs = false,
  ): Promise<string[]> => {
    if (
      targetNodeId &&
      (useEdgeRefs || input.textAttachmentsOf(targetNodeId).some(a => input.findCanvasNode(a.nodeId)?.data?.promptSource) || isImageDraftNode(input.mediaNodesRef.current.find((n) => n.id === targetNodeId)))
    ) {
      const ids: string[] = [];
      for (const ref of mergedImageRefsOf(
        targetNodeId,
        input.edgesRef.current,
        [...input.mediaNodesRef.current, ...input.textNodesRef.current],
      )) {
        if (!ids.includes(ref.assetId)) ids.push(ref.assetId);
      }
      return ids;
    }
    const ids: string[] = [];
    for (const f of files.filter((item) => item.type === 'image')) {
      if (f.assetId) {
        ids.push(String(f.assetId));
        continue;
      }
      let fileToUpload: File | null = f.file ?? null;
      if (!fileToUpload && f.url.startsWith('http')) {
        fileToUpload = await fetchUrlAsFile(f.url, f.name, 'image/*');
      }
      if (fileToUpload) {
        const uploaded = await uploadFileToAsset(fileToUpload, 'image');
        if (uploaded) ids.push(uploaded.asset_id);
      }
    }
    return ids;
  };
  return { uploadFileToAsset, collectImageInputAssetIds };
}

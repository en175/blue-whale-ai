import { type VideoRefRole, type PickChannel, PANEL_REF_MEDIA_TYPES } from '@/custom/enums';
import type { RefObject } from 'react';
import type { Node } from '@xyflow/react';
import type { SessionContentBlock } from '@/custom/api/agentSessions';
import type { CanvasGalleryRef } from '../collectMediaBlocks';
import { collectMediaBlocks } from '../collectMediaBlocks';
import { extractTextNodeText, quoteChipLabel } from '../quoteConversation';
import { hasGenerationRecord, isInPlaceRegenTarget } from '../mediaReEdit';
import { readNodeAssetId } from '../canvasNodeUtils';
import { readAssetId } from '../mediaRefs';

import { asVideoRefMediaType, videoRefSourceError, type VideoMediaRef } from '../videoMediaRefs';
import type { ToolSessionDeps } from '../toolSessionCoordinator';

type ProductPickResult = { ts: number; productId: string; image: { id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string } };

export interface CanvasNodeClickDispatchHost {
  toolRuntime: { onNodeClick: (nodeId: string, deps: ToolSessionDeps) => string };
  buildToolSessionDeps: () => ToolSessionDeps;

  showAgent: boolean;
  setAgentCandidate: (value: SessionContentBlock[] | null) => void;

  imagePickSessionActive: boolean;
  videoPickSessionActive: boolean;
  audioPickSessionActive: boolean;
  handleImagePickSessionClick: (node: Node) => void;
  handleVideoPickSessionClick: (node: Node) => void;
  handleAudioPickSessionClick: (node: Node) => void;

  pickMode: PickChannel | null;
  pickTarget: PickChannel | null;
  pickRefRole: VideoRefRole | null;
  pickProductId: string | null;
  pickAssetId: string | null;

  saveBlocked: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  editingTargetRef: RefObject<string | null>;

  toolSessions: { draft: (node: Node) => { open: () => void } | null };
  openCoordinatedToolDraft: (node: Node, open: () => void) => void;
  openImageDraftDialog: (nodeId: string) => void;
  openVideoDraftDialog: (nodeId: string) => void;
  openAudioDraftDialog: (nodeId: string) => void;
  openTextGenDialog: (nodeId: string, intent?: 'nodeClick') => void;
  openMediaDraftDialog: (nodeId: string, mediaType: unknown, intent?: 'selection') => void;

  videoDraftId: string | null;
  connectPair: (source: string, target: string) => boolean;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole) => void;
  validateVideoRefConnect: (source: string, target: string, role?: VideoRefRole) => boolean;
  appendVideoFreeRef: (item: VideoMediaRef, role: VideoRefRole) => void;

  generationDock: { referencePicked: (kind: 'video') => void };
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;

  setPickMode: (v: PickChannel | null) => void;
  setPickTarget: (v: PickChannel | null) => void;
  setPickRefRole: (v: VideoRefRole | null) => void;
  setPickProductId: (v: string | null) => void;
  setPickAssetId: (v: string | null) => void;
  setProductPickResult: (v: ProductPickResult | null) => void;
  setAssetPickResult: (v: { ts: number; assetId: string; ref: CanvasGalleryRef } | null) => void;
}

export interface CanvasNodeClickDispatchHandles {
  handleCanvasNodeClick: (node: Node) => void;
}

export function useCanvasNodeClickDispatch(host: CanvasNodeClickDispatchHost): CanvasNodeClickDispatchHandles {
  const {
    toolRuntime,
    buildToolSessionDeps,
    showAgent,
    setAgentCandidate,
    imagePickSessionActive,
    videoPickSessionActive,
    audioPickSessionActive,
    handleImagePickSessionClick,
    handleVideoPickSessionClick,
    handleAudioPickSessionClick,
    pickMode,
    pickTarget,
    pickRefRole,
    pickProductId,
    pickAssetId,
    saveBlocked,
    saveStatus,
    editingTargetRef,
    toolSessions,
    openCoordinatedToolDraft,
    openImageDraftDialog,
    openVideoDraftDialog,
    openAudioDraftDialog,
    openTextGenDialog,
    openMediaDraftDialog,
    videoDraftId,
    connectPair,
    addCanvasEdge,
    validateVideoRefConnect,
    appendVideoFreeRef,
    generationDock,
    showToast,
    setPickMode,
    setPickTarget,
    setPickRefRole,
    setPickProductId,
    setPickAssetId,
    setProductPickResult,
    setAssetPickResult,
  } = host;

  const clearPick = () => {
    setPickMode(null);
    setPickTarget(null);
    setPickRefRole(null);
    setPickProductId(null);
    setPickAssetId(null);
  };

  const handleCanvasNodeClick = (node: Node) => {
    if (toolRuntime.onNodeClick(node.id, buildToolSessionDeps()) === 'consumed') return;
    if (showAgent && node.type === 'textNode') {
      const text = extractTextNodeText(node.data);
      if (text) setAgentCandidate([{
        type: 'text', node_id: node.id, chip_id: `canvas:${node.id}`,
        display_label: quoteChipLabel(typeof node.data.title === 'string' ? node.data.title : '', text),
      }]);
    }
    if (showAgent && node.type === 'mediaNode') {
      const data = node.data ?? {};
      const blocks = collectMediaBlocks(node, `canvas:${node.id}`);
      if (
        !data.assetMissing &&
        !['draft', 'generating', 'failed', 'cancelled'].includes(String(data.genStatus)) &&
        blocks.length === 1 && blocks[0].asset_id &&
        ['image', 'video', 'audio'].includes(blocks[0].type) &&
        blocks[0].url && !blocks[0].url.startsWith('blob:')
      ) setAgentCandidate(blocks);
    }
    if (imagePickSessionActive) {
      handleImagePickSessionClick(node);
      return;
    }
    if (videoPickSessionActive) {
      handleVideoPickSessionClick(node);
      return;
    }
    if (audioPickSessionActive) {
      handleAudioPickSessionClick(node);
      return;
    }
    if (!pickMode || !pickTarget) {
      const data = (node.data ?? {}) as Record<string, unknown>;
      if (
        node.type === 'mediaNode' &&
        isInPlaceRegenTarget(node) &&
        (saveBlocked || saveStatus === 'error') &&
        node.id !== editingTargetRef.current
      ) {
        showToast('warn', '保存失败，请重试');
        return;
      }
      const toolDraft = toolSessions.draft(node);
      if (toolDraft) {
        openCoordinatedToolDraft(node, toolDraft.open);
      } else if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'image') {
        openImageDraftDialog(node.id);
      } else if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'video') {
        openVideoDraftDialog(node.id);
      } else if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'audio') {
        openAudioDraftDialog(node.id);
      } else if (node.type === 'textNode' && data.textGen === true) {
        openTextGenDialog(node.id, 'nodeClick');
      } else if (node.type === 'mediaNode' && hasGenerationRecord(node)) {
        openMediaDraftDialog(node.id, data.mediaType);
      }
      return;
    }
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (pickTarget === 'video' && (pickRefRole === 'first' || pickRefRole === 'last')
      && (node.type !== 'mediaNode' || data.mediaType !== 'image')) {
      showToast('warn', '首尾帧仅支持图片素材');
      return;
    }
    if (node.type === 'textNode' && pickTarget === 'video') {
      if (!videoDraftId) {
        showToast('warn', '文本参考需要绑定生成节点');
        return;
      }
      if (!connectPair(node.id, videoDraftId)) return;
      generationDock.referencePicked('video');
      setPickMode(null);
      setPickTarget(null);
      setPickRefRole(null);
      return;
    }
    if (pickTarget === 'video' && (pickMode === 'image' || pickMode === 'video')) {
      const isFrameSlot = pickRefRole === 'first' || pickRefRole === 'last';
      if ((isFrameSlot || pickMode === 'image') && (node.type !== 'mediaNode' || data.mediaType !== 'image')) {
        if (node.type === 'mediaNode') {
          showToast('warn', isFrameSlot ? '首尾帧仅支持图片素材' : PANEL_REF_MEDIA_TYPES.videoText2Video.canvasRefError);
          return;
        }
      } else if (videoDraftId) {
        if (node.type === 'mediaNode' && validateVideoRefConnect(node.id, videoDraftId, pickRefRole ?? undefined)) {
          addCanvasEdge(node.id, videoDraftId, pickRefRole ?? 'reference');
        }
      } else if (node.type === 'mediaNode') {
        const role = pickRefRole ?? 'reference';
        const err = videoRefSourceError(node, role);
        if (err) {
          showToast('warn', err);
        } else {
          const d = (node.data ?? {}) as Record<string, unknown>;
          const assetId = readAssetId(d);
          if (assetId != null) {
            appendVideoFreeRef(
              {
                nodeId: node.id,
                url: String(d.src ?? ''),
                name: typeof d.fileName === 'string' && d.fileName ? d.fileName : node.id,
                assetId: String(assetId),
                mediaType: asVideoRefMediaType(d.mediaType),
              },
              role,
            );
          }
        }
      }
      clearPick();
      generationDock.referencePicked('video');
      return;
    }
    const isReadyMedia =
      node.type === 'mediaNode' &&
      typeof data.src === 'string' &&
      !data.genStatus;
    if (isReadyMedia && data.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    if (isReadyMedia && (data.src as string).startsWith('blob:')) {
      showToast('warn', '素材上传中，请稍候再选择');
      return;
    }
    if (pickMode === 'product' && isReadyMedia && data.mediaType === 'image') {
      const targetId = pickProductId;
      if (targetId) {
        const newImage = {
          id: `node-${node.id}-${Date.now()}`,
          src: data.src as string,
          enabled: true,
          type: 'image' as const,
          ...(readNodeAssetId(data) ? { assetId: String(readNodeAssetId(data)!) } : {}),
        };
        setProductPickResult({ ts: Date.now(), productId: targetId, image: newImage });
      }
    } else if (pickMode === 'asset' && isReadyMedia && data.mediaType !== 'audio') {
      const targetId = pickAssetId;
      if (targetId) {
        const mediaType: 'image' | 'video' = data.mediaType === 'video' ? 'video' : 'image';
        const newRef = {
          id: `node-${node.id}-${Date.now()}`,
          src: data.src as string,
          type: mediaType,
          ...(readNodeAssetId(data) ? { assetId: String(readNodeAssetId(data)!) } : {}),
        };
        setAssetPickResult({ ts: Date.now(), assetId: targetId, ref: newRef });
      }
    }
    setPickMode(null);
    setPickTarget(null);
    setPickProductId(null);
    setPickAssetId(null);
  };

  return { handleCanvasNodeClick };
}

import { type VideoRefRole, PANEL_REF_MEDIA_TYPES } from '@/custom/enums';
import type { Node } from '@xyflow/react';
import { isFrameMode, normalizeVideoMode, frameSlotCountOf, type VideoMode } from '@/custom/utils/video-modes';
import { videoRefSourceError, type VideoMediaRef } from '../../tools/video/videoMediaRefs';

import type { AtMentionItem } from '../../agent/atMention';
import type { UploadedFile } from '../../components/ImageDialog';
import type { AudioRefItem } from '../../components/AudioDialog';
export interface CanvasAtMentionHandlersHost {
  imageDraftId: string | null | undefined;
  videoDraftId: string | null | undefined;
  audioDraftId: string | null | undefined;
  videoSeed: { params?: { mode?: string } } | null | undefined;
  videoFreeRefs: { first?: unknown; last?: unknown };
  findCanvasNode: (id: string) => Node | undefined;
  connectPair: (source: string, target: string) => boolean;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  validateImageRefConnect: (source: string, target: string) => boolean;
  validateVideoRefConnect: (source: string, target: string, role: VideoRefRole) => boolean;
  validateAudioRefConnect: (source: string, target: string) => boolean;
  draftModeOfNode: (nodeId: string) => VideoMode | null;
  videoEdgeRoleFor: (targetId: string) => VideoRefRole;
  mergedVideoRefsOf: (targetId: string) => { first?: unknown; last?: unknown };
  appendVideoFreeRef: (item: VideoMediaRef, role: VideoRefRole) => void;
  generationDock: { referencePicked: (kind: 'image') => void };
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  setImagePickResult: (result: { ts: number; files: UploadedFile[] }) => void;
  setAudioPickResult: (result: { ts: number; item: AudioRefItem }) => void;
  setMusicPickResult: (result: { ts: number; item: AudioRefItem }) => void;
}

export interface CanvasAtMentionHandlersHandles {
  handleImageAtMention: (item: AtMentionItem) => void;
  handleVideoAtMention: (item: AtMentionItem) => void;
  handleAudioAtMention: (item: AtMentionItem) => void;
  handleMusicAtMention: (item: AtMentionItem) => void;
}

export function useCanvasAtMentionHandlers(host: CanvasAtMentionHandlersHost): CanvasAtMentionHandlersHandles {
  const {
    imageDraftId,
    videoDraftId,
    audioDraftId,
    videoSeed,
    videoFreeRefs,
    findCanvasNode,
    connectPair,
    addCanvasEdge,
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    draftModeOfNode,
    videoEdgeRoleFor,
    mergedVideoRefsOf,
    appendVideoFreeRef,
    generationDock,
    showToast,
    setImagePickResult,
    setAudioPickResult,
    setMusicPickResult,
  } = host;

  const handleImageAtMention = (item: AtMentionItem) => {
    generationDock.referencePicked('image');
    if (item.kind === 'text') {
      if (imageDraftId) connectPair(item.id, imageDraftId);
      else showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (item.kind !== 'image' && item.kind !== 'video') {
      showToast('warn', '图片生成不支持该类型参考');
      return;
    }
    if (imageDraftId) {
      if (item.kind !== 'image') {
        showToast('warn', '图片参考仅支持图片素材');
        return;
      }
      if (!validateImageRefConnect(item.id, imageDraftId) || !item.assetId || !item.thumbUrl) return;
      addCanvasEdge(item.id, imageDraftId);
      return;
    }
    setImagePickResult({
      ts: Date.now(),
      files: [{
        id: `node-${item.id}`,
        url: item.thumbUrl ?? '',
        type: item.kind === 'video' ? 'video' : 'image',
        name: item.name,
        assetId: item.assetId,
      }],
    });
  };
  const handleVideoAtMention = (item: AtMentionItem) => {
    if (item.kind === 'text') {
      if (videoDraftId) connectPair(item.id, videoDraftId);
      else showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (item.kind === 'audio') {
      showToast('warn', '视频生成暂不支持音频参考');
      return;
    }
    if (item.kind !== 'image' && item.kind !== 'video') return;
    if (item.disabled) return;
    if (!item.assetId) return;
    const sourceNode = findCanvasNode(item.id);
    const roleCheck = videoDraftId ? videoEdgeRoleFor(videoDraftId) : 'reference';
    const blocked = videoRefSourceError(sourceNode, roleCheck);
    if (blocked) {
      showToast('warn', blocked);
      return;
    }
    const refItem: VideoMediaRef = {
      nodeId: item.id,
      url: item.thumbUrl ?? '',
      name: item.name,
      assetId: item.assetId,
      mediaType: item.kind,
    };
    if (videoDraftId) {
      const role = videoEdgeRoleFor(videoDraftId);
      if (role === 'reference' && isFrameMode(draftModeOfNode(videoDraftId))) {
        const refs = mergedVideoRefsOf(videoDraftId);
        if (refs.first || refs.last) {
          showToast('warn', '首帧和尾帧已指定，请先移除现有帧');
          return;
        }
      }
      if (!validateVideoRefConnect(item.id, videoDraftId, role)) return;
      addCanvasEdge(item.id, videoDraftId, role);
      return;
    }
    const freeMode = normalizeVideoMode(videoSeed?.params?.mode);
    const freeSlots = frameSlotCountOf(freeMode);
    const freeRole: VideoRefRole = freeSlots > 0
      ? (!videoFreeRefs.first ? 'first' : freeSlots === 2 && !videoFreeRefs.last ? 'last' : 'reference')
      : 'reference';
    if (freeRole === 'reference' && isFrameMode(freeMode) && (videoFreeRefs.first || videoFreeRefs.last)) {
      showToast('warn', '首帧和尾帧已指定，请先移除现有帧');
      return;
    }
    appendVideoFreeRef(refItem, freeRole);
  };
  const handleAudioAtMention = (item: AtMentionItem) => {
    if (item.kind === 'text') {
      if (audioDraftId) connectPair(item.id, audioDraftId);
      else showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if ((item.kind !== 'audio' && item.kind !== 'image') || !item.thumbUrl) {
      showToast('warn', PANEL_REF_MEDIA_TYPES.audio.canvasRefError);
      return;
    }
    if (audioDraftId) {
      if (validateAudioRefConnect(item.id, audioDraftId)) {
        addCanvasEdge(item.id, audioDraftId);
      }
      return;
    }
    setAudioPickResult({
      ts: Date.now(),
      item: {
        id: item.id,
        kind: item.kind,
        mediaType: item.kind,
        name: item.name,
        src: item.thumbUrl,
        source: 'canvas',
        assetId: item.assetId,
      },
    });
  };
  const handleMusicAtMention = (item: AtMentionItem) => {
    if (item.kind !== 'audio' || !item.thumbUrl) {
      showToast('warn', 'AI 音乐仅支持引用音频素材');
      return;
    }
    setMusicPickResult({
      ts: Date.now(),
      item: {
        id: item.id,
        kind: 'audio',
        name: item.name,
        src: item.thumbUrl,
        source: 'canvas',
        assetId: item.assetId,
      },
    });
  };

  return { handleImageAtMention, handleVideoAtMention, handleAudioAtMention, handleMusicAtMention };
}

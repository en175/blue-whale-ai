import { type VideoRefRole, type PickChannel, PANEL_REF_MEDIA_TYPES } from '@/custom/enums';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import type { UploadedFile } from '../../components/ImageDialog';
import type { AudioRefItem } from '../../components/AudioDialog';
import { readNodeAssetId } from '../../graph/canvasNodeUtils';
import { panelCanvasRefError } from '../../media/refSourceTypes';
import { readAssetId } from '../../media/mediaRefs';
import { audioRefMediaTypeOf, audioRefSourceError } from '../../tools/audio/audioMediaRefs';
import { videoFreeRefItemOf } from '../../graph/canvasPureNodeHelpers';
import { checkAddVideoRef, incomingVideoRefOccupied, isLibraryOnlyVideoRef, mergedVideoMediaRefsOf, videoRefSourceError, type VideoMediaRef, type VideoMediaRefs, type VideoRefCapabilities } from '../../tools/video/videoMediaRefs';

export interface CanvasPickSessionClickHost {
  mediaNodesRef: RefObject<Node[]>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;

  pickMode: PickChannel | null;
  pickTarget: PickChannel | null;
  pickRefRole: VideoRefRole | null;
  imagePickSessionActive: boolean;
  videoPickSessionActive: boolean;
  audioPickSessionActive: boolean;
  imagePickSession: string | null | undefined;
  videoPickSession: string | null | undefined;
  audioPickSession: string | null | undefined;
  endImagePickSession: () => void;
  endVideoPickSession: () => void;
  endAudioPickSession: () => void;

  connectPair: (source: string, target: string) => boolean;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  validateImageRefConnect: (source: string, target: string) => boolean;
  validateVideoRefConnect: (source: string, target: string, role?: VideoRefRole) => boolean;
  validateAudioRefConnect: (source: string, target: string) => boolean;
  validateAudioTextConnect: (source: string, target: string) => boolean;
  videoCapsOfDraft: (id: string | null) => VideoRefCapabilities | null;

  edgesRef: RefObject<Array<{ source: string; target: string; id: string }>>;
  videoFreeRefs: VideoMediaRefs;
  removeRefEdges: (draftId: string, sourceNodeId: string) => void;
  removeDraftMaterialRef: (draftId: string, materialId: string) => void;
  appendVideoFreeRef: (item: VideoMediaRef, role: VideoRefRole) => void;
  replaceFreeReference: (item: VideoMediaRef, role: 'first' | 'last') => void;

  setPickMode: (v: PickChannel | null) => void;
  setPickTarget: (v: PickChannel | null) => void;
  setPickRefRole: (v: VideoRefRole | null) => void;
  setPickProductId: (v: string | null) => void;
  setPickAssetId: (v: string | null) => void;
  setImagePickResult: Dispatch<SetStateAction<{ ts: number; files: UploadedFile[] } | null>>;
  setAudioPickResult: Dispatch<SetStateAction<{ ts: number; item: AudioRefItem } | null>>;
}

export interface CanvasPickSessionClickHandles {
  handleImagePickSessionClick: (node: Node) => void;
  handleVideoPickSessionClick: (node: Node) => void;
  handleAudioPickSessionClick: (node: Node) => void;
  resetPickState: () => void;
  clearPickState: () => void;
}

export function useCanvasPickSessionClick(host: CanvasPickSessionClickHost): CanvasPickSessionClickHandles {
  const {
    mediaNodesRef,
    showToast,
    pickMode,
    pickRefRole,
    imagePickSession,
    videoPickSession,
    audioPickSession,
    endImagePickSession,
    endVideoPickSession,
    endAudioPickSession,
    connectPair,
    addCanvasEdge,
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
    videoCapsOfDraft,
    edgesRef,
    videoFreeRefs,
    removeRefEdges,
    removeDraftMaterialRef,
    appendVideoFreeRef,
    replaceFreeReference,
    setPickMode,
    setPickTarget,
    setPickProductId,
    setPickAssetId,
    setImagePickResult,
    setAudioPickResult,
  } = host;

  const resetPickState = () => {
    setPickMode(null);
    setPickTarget(null);
    setPickProductId(null);
    setPickAssetId(null);
  };
  const clearPickState = () => {
    if (host.imagePickSessionActive) host.endImagePickSession();
    if (host.videoPickSessionActive) host.endVideoPickSession();
    if (host.audioPickSessionActive) host.endAudioPickSession();
    if (host.pickMode || host.pickTarget) {
      setPickMode(null);
      setPickTarget(null);
      host.setPickRefRole(null);
      setPickProductId(null);
      setPickAssetId(null);
    }
  };

  const handleImagePickSessionClick = (node: Node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (typeof imagePickSession === 'string') {
      if (!mediaNodesRef.current.some((n) => n.id === imagePickSession)) {
        endImagePickSession();
        return;
      }
      if (node.type === 'textNode') {
        connectPair(node.id, imagePickSession);
        return;
      }
      if (node.type === 'mediaNode') {
        if (connectPair(node.id, imagePickSession)) return;
        if (validateImageRefConnect(node.id, imagePickSession)) {
          addCanvasEdge(node.id, imagePickSession);
        }
        return;
      }
      showToast('warn', '图片参考仅支持图片素材');
      return;
    }
    if (node.type === 'textNode') {
      showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    const isReadyMedia = node.type === 'mediaNode' && typeof data.src === 'string' && !data.genStatus;
    if (!isReadyMedia) {
      showToast('warn', '图片参考仅支持图片素材');
      return;
    }
    if (data.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    if ((data.src as string).startsWith('blob:')) {
      showToast('warn', '素材上传中，请稍候再选择');
      return;
    }
    const typeErr = panelCanvasRefError('image', data.mediaType);
    if (typeErr) {
      showToast('warn', typeErr);
      return;
    }
    setImagePickResult({
      ts: Date.now(),
      files: [{
        id: `node-${node.id}`,
        url: data.src as string,
        type: 'image',
        name: (data.fileName as string) || node.id,
        assetId: readNodeAssetId(data),
      }],
    });
  };

  const checkVideoFrameReplace = (
    node: Node,
    refs: VideoMediaRefs,
    role: 'first' | 'last',
    caps?: VideoRefCapabilities | null,
  ): { current: VideoMediaRef | undefined } | null => {
    const err = videoRefSourceError(node, role);
    if (err) {
      showToast('warn', err);
      return null;
    }
    const data = (node.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data);
    if (assetId == null) {
      showToast('warn', '素材不存在');
      return null;
    }
    const current = role === 'first' ? refs.first : refs.last;
    const sourceMaterialId = typeof data.materialId === 'string' && data.materialId ? data.materialId : undefined;
    if (current && incomingVideoRefOccupied({ reference: [current] }, [assetId, sourceMaterialId])) return null;
    const sameIncoming = (r: VideoMediaRef) => incomingVideoRefOccupied({ reference: [r] }, [assetId, sourceMaterialId]);
    const slotCleared: VideoMediaRefs = {
      ...(role === 'first' ? { ...refs, first: undefined } : { ...refs, last: undefined }),
      reference: refs.reference.filter((r) => !sameIncoming(r)),
    };
    const msg = checkAddVideoRef(role, data.mediaType as 'image', assetId, slotCleared, caps, [sourceMaterialId]);
    if (msg) {
      showToast('warn', msg);
      return null;
    }
    return { current };
  };
  const replaceVideoFrameRefFromCanvas = (node: Node, targetId: string, role: 'first' | 'last'): boolean => {
    const refs = mergedVideoMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current);
    const check = checkVideoFrameReplace(node, refs, role, videoCapsOfDraft(targetId));
    if (!check) return false;
    if (check.current) {
      if (isLibraryOnlyVideoRef(check.current)) {
        removeDraftMaterialRef(targetId, check.current.materialId);
      } else {
        removeRefEdges(targetId, check.current.nodeId);
      }
    }
    const data = (node.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data);
    const occupiedReference = refs.reference.find((r) => r.assetId === assetId);
    if (occupiedReference && occupiedReference.nodeId !== node.id) {
      if (isLibraryOnlyVideoRef(occupiedReference)) {
        removeDraftMaterialRef(targetId, occupiedReference.materialId);
      } else {
        removeRefEdges(targetId, occupiedReference.nodeId);
      }
    }
    addCanvasEdge(node.id, targetId, role);
    return true;
  };
  const replaceVideoFreeFrameRef = (node: Node, role: 'first' | 'last') => {
    if (!checkVideoFrameReplace(node, videoFreeRefs, role)) return;
    const item = videoFreeRefItemOf(node);
    replaceFreeReference(item, role);
  };

  const handleVideoPickSessionClick = (node: Node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const role = pickRefRole ?? 'reference';
    const isFrameSession = role === 'first' || role === 'last';
    if (typeof videoPickSession === 'string') {
      if (!mediaNodesRef.current.some((n) => n.id === videoPickSession)) {
        endVideoPickSession();
        return;
      }
      if (node.type === 'textNode') {
        if (isFrameSession) {
          showToast('warn', '首尾帧仅支持图片素材');
          return;
        }
        connectPair(node.id, videoPickSession);
        return;
      }
      if (node.type === 'mediaNode') {
        if (isFrameSession) {
          if (replaceVideoFrameRefFromCanvas(node, videoPickSession, role)) {
            const filledRefs = mergedVideoMediaRefsOf(videoPickSession, edgesRef.current, mediaNodesRef.current);
            if (filledRefs.first && filledRefs.last) {
              endVideoPickSession();
              showToast('success', '首尾帧已就绪');
            }
          }
          return;
        }
        if (pickMode === 'image' && data.mediaType !== 'image') {
          showToast('warn', PANEL_REF_MEDIA_TYPES.videoText2Video.canvasRefError);
          return;
        }
        if (validateVideoRefConnect(node.id, videoPickSession, 'reference')) {
          addCanvasEdge(node.id, videoPickSession, 'reference');
        }
        return;
      }
      showToast('warn', '视频参考仅支持图片、视频或音频素材');
      return;
    }
    if (node.type === 'textNode') {
      showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (node.type !== 'mediaNode') {
      showToast('warn', '视频参考仅支持图片、视频或音频素材');
      return;
    }
    if (isFrameSession) {
      replaceVideoFreeFrameRef(node, role);
      return;
    }
    if (pickMode === 'image' && data.mediaType !== 'image') {
      showToast('warn', PANEL_REF_MEDIA_TYPES.videoText2Video.canvasRefError);
      return;
    }
    const err = videoRefSourceError(node, 'reference');
    if (err) {
      showToast('warn', err);
      return;
    }
    if (readAssetId(data) == null) return;
    appendVideoFreeRef(videoFreeRefItemOf(node), 'reference');
  };

  const handleAudioPickSessionClick = (node: Node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (typeof audioPickSession === 'string') {
      if (!mediaNodesRef.current.some((n) => n.id === audioPickSession)) {
        endAudioPickSession();
        return;
      }
      if (node.type === 'textNode') {
        if (!validateAudioTextConnect(node.id, audioPickSession)) return;
        addCanvasEdge(node.id, audioPickSession);
        return;
      }
      if (node.type === 'mediaNode') {
        if (validateAudioRefConnect(node.id, audioPickSession)) {
          addCanvasEdge(node.id, audioPickSession);
        }
        return;
      }
      showToast('warn', PANEL_REF_MEDIA_TYPES.audio.canvasRefError);
      return;
    }
    if (node.type === 'textNode') {
      showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (node.type !== 'mediaNode') {
      showToast('warn', PANEL_REF_MEDIA_TYPES.audio.canvasRefError);
      return;
    }
    const err = audioRefSourceError(node);
    if (err) {
      showToast('warn', err);
      return;
    }
    const incomingType = audioRefMediaTypeOf(data) ?? 'audio';
    setAudioPickResult({
      ts: Date.now(),
      item: {
        id: node.id,
        kind: incomingType,
        mediaType: incomingType,
        name: (data.fileName as string) || node.id,
        src: data.src as string,
        source: 'canvas',
        assetId: readAssetId(data),
      },
    });
  };

  return { handleImagePickSessionClick, handleVideoPickSessionClick, handleAudioPickSessionClick, resetPickState, clearPickState };
}

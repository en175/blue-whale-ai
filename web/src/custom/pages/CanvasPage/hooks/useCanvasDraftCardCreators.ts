import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import type { MediaMention, MediaRef } from '@lib/contracts/text-node-media';
import type { MediaDims } from '../components/MediaNode/mediaContentSize';
import { newNodeId } from '../graph/nodeId';
import { defaultVideoModeFor } from '../tools/video/videoModes';
import type { CanvasNodeActions } from './useCanvasNodeFactories';

export type DraftCardActions = CanvasNodeActions & {
  cancelJob: (id: string) => void;
  retryJob: (id: string) => void;
  fixFollowVideo: (id: string) => void;
};

export interface CanvasDraftCardCreatorsHost {
  toolMode: string;
  spawnDraftPosition: () => { x: number; y: number };
  mediaNodesRef: RefObject<Node[]>;
  actionsRef: RefObject<DraftCardActions>;
  historyRef: RefObject<{ pushAddNodes: (ids: string[]) => void } | null>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  dockToolCallbacks: Record<string, unknown>;
  handleMediaDims: (id: string, dims: MediaDims) => void;
  handleMediaIndexChange: (
    id: string,
    mediaMentions: MediaMention[],
    mediaRefs: MediaRef[],
    delta: { added: string[]; removed: string[] },
  ) => void;
  handleDraftError: (id: string, error: string) => void;
  removeCanvasNodes: (ids: string[]) => void;
  handleSaveMediaToAssets: (id: string) => void;
  handleSaveTextToAssets: (id: string) => void;
  generationDock: { writeSelf: (kind: 'text') => void };
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  setProductNodes: Dispatch<SetStateAction<Node[]>>;
  setAssetNodes: Dispatch<SetStateAction<Node[]>>;
  setSelectRequest: (value: { id: string; ts: number } | null) => void;
}

export interface CanvasDraftCardCreatorsHandles {
  createVideoDraftCard: (
    seed?: { modelId?: string; ratio?: string; size?: string; duration?: number; mode?: string; generateAudio?: boolean },
    position?: { x: number; y: number },
    overrides?: { fileName?: string; data?: Record<string, unknown>; recordHistory?: boolean },
  ) => string;
  createAudioDraftCard: (
    position?: { x: number; y: number },
    opts?: { recordHistory?: boolean },
  ) => string;
  createImageDraftCard: (
    position?: { x: number; y: number },
    overrides?: { fileName?: string; data?: Record<string, unknown>; nodeId?: string; skipSelect?: boolean; recordHistory?: boolean },
  ) => string;
  createTextGenDraft: (position?: { x: number; y: number }) => string;
}

export function useCanvasDraftCardCreators(host: CanvasDraftCardCreatorsHost): CanvasDraftCardCreatorsHandles {
  const {
    toolMode,
    spawnDraftPosition,
    mediaNodesRef,
    actionsRef,
    historyRef,
    pendingNodeIdsRef,
    dockToolCallbacks,
    handleMediaDims,
    handleMediaIndexChange,
    handleDraftError,
    removeCanvasNodes,
    handleSaveMediaToAssets,
    handleSaveTextToAssets,
    generationDock,
    showToast,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    setSelectRequest,
  } = host;

  const pushAddNodesHistory = (nodeId: string) => {
    historyRef.current?.pushAddNodes([nodeId]);
  };

  const createVideoDraftCard = (seed?: {
    modelId?: string;
    ratio?: string;
    size?: string;
    duration?: number;
    mode?: string;
    generateAudio?: boolean;
  }, position?: { x: number; y: number }, overrides?: { fileName?: string; data?: Record<string, unknown>; recordHistory?: boolean }): string => {
    const nodeId = newNodeId('media-draft');
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: position ?? spawnDraftPosition(),
      selected: true,
      data: {
        src: '',
        mediaType: 'video',
        fileName: overrides?.fileName ?? '视频草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        ...(overrides?.data ?? {}),
        toolMode,
        ...(seed?.modelId != null ? { draftModelId: seed.modelId } : {}),
        ...(seed?.ratio != null ? { draftRatio: seed.ratio, targetRatio: seed.ratio } : {}),
        ...(seed?.size != null ? { draftSize: seed.size } : {}),
        ...(seed?.duration != null ? { draftDuration: seed.duration } : {}),
        draftMode: seed?.mode ?? defaultVideoModeFor({ reference: [] }),
        ...(seed?.generateAudio != null ? { draftGenerateAudio: seed.generateAudio } : {}),
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        ...dockToolCallbacks,
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setTextNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    const nextMedia = [...deselect(mediaNodesRef.current), node];
    mediaNodesRef.current = nextMedia;
    setMediaNodes(nextMedia);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    if (overrides?.recordHistory) pushAddNodesHistory(nodeId);
    return nodeId;
  };
  const createAudioDraftCard = (
    position?: { x: number; y: number },
    opts?: { recordHistory?: boolean },
  ): string => {
    const nodeId = newNodeId('media-draft');
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: position ?? spawnDraftPosition(),
      selected: true,
      data: {
        src: '',
        mediaType: 'audio',
        fileName: '音频草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        toolMode,
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        ...dockToolCallbacks,
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setTextNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    const nextMedia = [...deselect(mediaNodesRef.current), node];
    mediaNodesRef.current = nextMedia;
    setMediaNodes(nextMedia);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    if (opts?.recordHistory) pushAddNodesHistory(nodeId);
    return nodeId;
  };
  const createImageDraftCard = (
    position?: { x: number; y: number },
    overrides?: { fileName?: string; data?: Record<string, unknown>; nodeId?: string; skipSelect?: boolean; recordHistory?: boolean },
  ): string => {
    const nodeId = overrides?.nodeId ?? newNodeId('media-draft');
    const skipSelect = overrides?.skipSelect === true;
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: position ?? spawnDraftPosition(),
      selected: !skipSelect,
      data: {
        src: '',
        mediaType: 'image',
        fileName: overrides?.fileName ?? '图片草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        ...(overrides?.data ?? {}),
        toolMode,
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        ...dockToolCallbacks,
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    if (skipSelect) {
      const nextMedia = [...mediaNodesRef.current, node];
      mediaNodesRef.current = nextMedia;
      setMediaNodes(nextMedia);
    } else {
      setTextNodes(deselect);
      setProductNodes(deselect);
      setAssetNodes(deselect);
      const nextMedia = [...deselect(mediaNodesRef.current), node];
      mediaNodesRef.current = nextMedia;
      setMediaNodes(nextMedia);
      setSelectRequest({ id: nodeId, ts: Date.now() });
    }
    if (overrides?.recordHistory) pushAddNodesHistory(nodeId);
    return nodeId;
  };
  const createTextGenDraft = (position?: { x: number; y: number }): string => {
    const nodeId = newNodeId('text');
    const node: Node = {
      id: nodeId,
      type: 'textNode',
      position: position ?? spawnDraftPosition(),
      selected: true,
      data: {
        text: '',
        title: '文本生成',
        textGen: true,
        onDraftError: handleDraftError,
        toolMode,
        onDelete: (id: string) => removeCanvasNodes([id]),
        onTextChange: (id: string, text: string) => {
          setTextNodes((prev) =>
            prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n)),
          );
        },
        onMediaIndexChange: handleMediaIndexChange,
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
        onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
        onWriteSelf: () => {
          generationDock.writeSelf('text');
        },
      },
    };
    pendingNodeIdsRef.current.add(nodeId);
    pushAddNodesHistory(nodeId);
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setMediaNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    setTextNodes((prev) => [...deselect(prev), node]);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    return nodeId;
  };

  return { createVideoDraftCard, createAudioDraftCard, createImageDraftCard, createTextGenDraft };
}

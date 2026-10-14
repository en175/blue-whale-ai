import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { releaseRemovedPromptSources } from '@lib/contracts/prompt-target';
import { isAudioMixNodeId } from '../audioMix';
import type { GenerationRuntime } from '../generationRuntime/runtime';
import type { CanvasHistoryApi } from './useCanvasHistory';

export interface CanvasNodeDeletionHost {
  currentId: string;
  mediaNodesRef: RefObject<Node[]>;
  textNodesRef: RefObject<Node[]>;
  productNodesRef: RefObject<Node[]>;
  assetNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  historyRef: RefObject<CanvasHistoryApi | null>;
  generationRuntimeRef: RefObject<GenerationRuntime | null>;
  activeJobByNodeRef: RefObject<Map<string, string>>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  isGeneratingNode: (id: string) => boolean;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  setProductNodes: Dispatch<SetStateAction<Node[]>>;
  setAssetNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  flushCanvasSave: (projectId: string) => Promise<unknown>;
}

export interface CanvasNodeDeletionHandles {
  removeAudioMixCardNow: (nodeId: string) => void;
  removeCanvasNodes: (ids: string[]) => void;
  handleRemoveMediaNode: (nodeId: string) => void;
}

export function useCanvasNodeDeletion(host: CanvasNodeDeletionHost): CanvasNodeDeletionHandles {
  const {
    currentId,
    mediaNodesRef,
    textNodesRef,
    productNodesRef,
    assetNodesRef,
    edgesRef,
    historyRef,
    generationRuntimeRef,
    activeJobByNodeRef,
    pendingNodeIdsRef,
    isGeneratingNode,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    setEdges,
    flushCanvasSave,
  } = host;

  const removeMediaNodeNow = (nodeId: string) => {
    setMediaNodes((prev) => {
      const target = prev.find((n) => n.id === nodeId);
      const src = target?.data?.src;
      if (typeof src === 'string' && src.startsWith('blob:')) URL.revokeObjectURL(src);
      return prev.filter((n) => n.id !== nodeId);
    });
  };
  const removeAudioMixCardNow = (nodeId: string) => {
    const nextNodes = mediaNodesRef.current.filter((node) => node.id !== nodeId);
    const nextEdges = edgesRef.current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    mediaNodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setMediaNodes(nextNodes);
    setEdges(nextEdges);
    activeJobByNodeRef.current.delete(nodeId);
    if (currentId) void flushCanvasSave(currentId).catch(() => {});
  };
  const deleteGeneratingNode = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (node && generationRuntimeRef.current?.claims(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      generationRuntimeRef.current.remove(nodeId);
      return;
    }
    removeMediaNodeNow(nodeId);
  };
  const removeCanvasNodes = (ids: string[]) => {
    if (ids.length === 0) return;
    const generating = ids.filter((id) => mediaNodesRef.current.some((n) => n.id === id) && isGeneratingNode(id));
    generating.forEach((id) => void deleteGeneratingNode(id));
    const idSet = new Set(ids.filter((id) => !generating.includes(id)));
    if (idSet.size === 0) return;
    const allNodes = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const removedNodes = allNodes.filter((n) => idSet.has(n.id));
    const removedEdges = edgesRef.current.filter((e) => idSet.has(e.source) || idSet.has(e.target));
    const remainingEdges = releaseRemovedPromptSources(edgesRef.current, edgesRef.current.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)));
    removedNodes.forEach((n) => {
      const src = (n.data as Record<string, unknown> | undefined)?.src;
      if (typeof src === 'string' && src.startsWith('blob:')) URL.revokeObjectURL(src);
    });
    const undoableNodes = removedNodes.filter((n) => {
      const src = (n.data as Record<string, unknown> | undefined)?.src;
      return !(typeof src === 'string' && src.startsWith('blob:'));
    });
    const undoableIds = new Set(undoableNodes.map((n) => n.id));
    const survivingIds = new Set(allNodes.map((n) => n.id).filter((id) => !idSet.has(id)));
    const undoableEdges = removedEdges.filter(
      (e) =>
        (undoableIds.has(e.source) || survivingIds.has(e.source)) &&
        (undoableIds.has(e.target) || survivingIds.has(e.target)),
    );
    if (undoableNodes.length > 0) {
      historyRef.current?.pushDelete(undoableNodes, undoableEdges, undefined, {
        before: edgesRef.current.filter(e =>
          (undoableIds.has(e.source) || survivingIds.has(e.source)) &&
          (undoableIds.has(e.target) || survivingIds.has(e.target))),
        after: remainingEdges,
      });
    }
    idSet.forEach((id) => pendingNodeIdsRef.current.delete(id));
    const filter = (prev: Node[]) => prev.filter((n) => !idSet.has(n.id));
    setTextNodes(filter);
    setMediaNodes(filter);
    setProductNodes(filter);
    setAssetNodes(filter);
    if (removedEdges.length > 0) {
      setEdges(remainingEdges);
    }
    if (Array.from(idSet).some(isAudioMixNodeId)) {
      mediaNodesRef.current = filter(mediaNodesRef.current);
      edgesRef.current = remainingEdges;
      if (currentId) void flushCanvasSave(currentId).catch(() => {});
    }
  };
  const handleRemoveMediaNode = (nodeId: string) => {
    removeCanvasNodes([nodeId]);
  };

  return { removeAudioMixCardNow, removeCanvasNodes, handleRemoveMediaNode };
}

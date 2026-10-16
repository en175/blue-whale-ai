import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { ImageTextAttachment } from '../components/ImageDialog';
import type { createGenerationDockCoordinator } from '../generationDockCoordinator';
import { mergedVideoMediaRefsOf, readDraftMaterialRefs } from '../tools/video/videoMediaRefs';

export interface CanvasRefStripOrderHost {
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  edgesRef: RefObject<Edge[]>;
  mediaNodesRef: RefObject<Node[]>;
  edges: Edge[];
  mediaNodes: Node[];
  textNodes: Node[];
  isGeneratingNode: (id: string) => boolean;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  textAttachmentsOf: (targetNodeId: string) => ImageTextAttachment[];
  generationDock: ReturnType<typeof createGenerationDockCoordinator>;
}

export function useCanvasRefStripOrder(host: CanvasRefStripOrderHost) {
  const {
    setEdges,
    edgesRef,
    mediaNodesRef,
    edges,
    mediaNodes,
    textNodes,
    isGeneratingNode,
    patchMediaNode,
    textAttachmentsOf,
    generationDock,
  } = host;

  const reorderTargetEdges = (targetNodeId: string, orderedSources: string[]) => {
    setEdges((prev) => {
      const slots = prev
        .map((e, i) => (e.target === targetNodeId && orderedSources.includes(e.source) ? i : -1))
        .filter((i) => i >= 0);
      if (slots.length !== orderedSources.length) return prev;
      const edgeBySource = new Map(slots.map((i) => [prev[i]!.source, prev[i]!]));
      const next = [...prev];
      slots.forEach((slot, k) => {
        next[slot] = edgeBySource.get(orderedSources[k]!)!;
      });
      return next;
    });
  };

  const refStripOrderOf = (targetId: string | null | undefined): string[] | undefined => {
    const value = mediaNodes.find(node => node.id === targetId)?.data.referenceStripOrder;
    if (Array.isArray(value) && value.every(key => typeof key === 'string')) return value;
    if (!targetId) return undefined;
    return edges.filter(edge => edge.target === targetId).map(edge =>
      textNodes.some(node => node.id === edge.source) ? `text:${edge.source}` : `media:node:${edge.source}`,
    );
  };

  const handleRefStripOrderChange = (targetId: string, orderedKeys: string[]) => {
    if (isGeneratingNode(targetId)) return;
    patchMediaNode(targetId, { referenceStripOrder: orderedKeys });
    const sources = orderedKeys.flatMap(key => {
      const source = key.startsWith('text:') ? key.slice(5)
        : key.startsWith('media:node:') ? key.slice(11)
        : key.startsWith('media:canvas:') ? key.slice(13) : undefined;
      return source && edgesRef.current.some(edge => edge.target === targetId && edge.source === source) ? [source] : [];
    });
    if (sources.length) reorderTargetEdges(targetId, sources);
  };

  const handleReorderAttachments = (targetNodeId: string, orderedNodeIds: string[]) => {
    const liveIds = textAttachmentsOf(targetNodeId).map((a) => a.nodeId);
    if (
      liveIds.length !== orderedNodeIds.length ||
      !orderedNodeIds.every((id) => liveIds.includes(id))
    )
      return;
    reorderTargetEdges(targetNodeId, orderedNodeIds);
    generationDock.updateDraft('image', { attachments: { targetNodeId, orderedNodeIds } });
    generationDock.updateDraft('video', { attachments: { targetNodeId, orderedNodeIds } });
  };

  const handleReorderVideoMediaRefs = (draftId: string, orderedKeys: string[]) => {
    const current = mergedVideoMediaRefsOf(draftId, edgesRef.current, mediaNodesRef.current);
    const currentKeys = current.reference.map((r) => r.materialId ?? r.nodeId);
    if (currentKeys.length !== orderedKeys.length || !orderedKeys.every((k) => currentKeys.includes(k))) return;
    const materialIds = new Set(current.reference.filter((r) => r.materialId != null).map((r) => r.materialId!));
    const edgeIds = orderedKeys.filter((k) => !materialIds.has(k));
    const materialOrdered = orderedKeys.filter((k) => materialIds.has(k));
    if (edgeIds.length) reorderTargetEdges(draftId, edgeIds);
    if (materialOrdered.length) {
      const node = mediaNodesRef.current.find((n) => n.id === draftId);
      const existing = readDraftMaterialRefs(node);
      const existingIds = existing.map((m) => m.materialId);
      if (existingIds.length === materialOrdered.length && materialOrdered.every((id) => existingIds.includes(id))) {
        const byId = new Map(existing.map((m) => [m.materialId, m]));
        patchMediaNode(draftId, { draftMaterialRefs: materialOrdered.map((id) => byId.get(id)!) });
      }
    }
  };

  const reorderVideoFreeRefs = (keys: string[]) => generationDock.updateDraft('video', { freeReference: { operation: 'reorder', keys } });

  return {
    reorderTargetEdges,
    refStripOrderOf,
    handleRefStripOrderChange,
    handleReorderAttachments,
    handleReorderVideoMediaRefs,
    reorderVideoFreeRefs,
  };
}

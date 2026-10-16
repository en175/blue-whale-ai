import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node, OnEdgesChange } from '@xyflow/react';
import type { MediaMention, MediaRef } from '@lib/contracts/text-node-media';
import type { GenerationModel } from '@/custom/api/generation';
import { createConnectValidators } from '../graph/canvasConnectValidation';
import type { CanvasHistoryApi } from './useCanvasHistory';
import { useCanvasConnectPair } from './useCanvasConnectPair';
import { useCanvasEdgeOps } from './useCanvasEdgeOps';

type ShowToast = (type: 'success' | 'error' | 'warn', msg: string) => void;

export function useCanvasConnectSurface(input: {
  edgesRef: RefObject<Edge[]>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  historyRef: RefObject<CanvasHistoryApi | null>;
  isApplying: () => boolean;
  findCanvasNode: (id: string) => Node | undefined;
  textNodesRef: RefObject<Node[]>;
  mediaNodesRef: RefObject<Node[]>;
  videoModelsRef: RefObject<GenerationModel[]>;
  imageModelsRef: RefObject<GenerationModel[]>;
  isGeneratingNode: (id: string) => boolean;
  showToast: ShowToast;
  toolConnect: (source: Node, target: Node) => boolean | null;
  withHistoryBatch: (fn: () => void) => void;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  onEdgesChange: OnEdgesChange<Edge>;
  submittingNodeId: string | null;
}) {
  const {
    addCanvasEdge,
    connectPlanToDraft,
    syncPlanEdgeBindingsOnShrink,
    removeTargetInputs,
    syncTextIndexEdges,
  } = useCanvasEdgeOps({
    edgesRef: input.edgesRef,
    setEdges: input.setEdges,
    historyRef: input.historyRef,
    isApplying: () => input.isApplying(),
    findCanvasNode: (id) => input.findCanvasNode(id),
    getTextNodes: () => input.textNodesRef.current,
  });
  const {
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
    draftModelOf,
    videoCapsOfDraft,
    imageRefMaxOfDraft,
    videoRefUnsupportedByModel,
  } = createConnectValidators({
    getMediaNodes: () => input.mediaNodesRef.current,
    getTextNodes: () => input.textNodesRef.current,
    getEdges: () => input.edgesRef.current,
    getVideoModels: () => input.videoModelsRef.current,
    getImageModels: () => input.imageModelsRef.current,
    findCanvasNode: (id) => input.findCanvasNode(id),
    isGeneratingNode: (id) => input.isGeneratingNode(id),
    showToast: (type, msg) => input.showToast(type, msg),
  });
  const pair = useCanvasConnectPair({
    isApplying: () => input.isApplying(),
    showToast: (type, msg) => input.showToast(type, msg),
    isGeneratingNode: (id) => input.isGeneratingNode(id),
    findCanvasNode: (id) => input.findCanvasNode(id),
    edgesRef: input.edgesRef,
    getMediaNodes: () => input.mediaNodesRef.current,
    toolConnect: (source, target) => input.toolConnect(source, target),
    addCanvasEdge: (source, target, refRole, marker) => addCanvasEdge(source, target, refRole, marker),
    connectPlanToDraft,
    removeTargetInputs,
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
    withHistoryBatch: input.withHistoryBatch,
    patchMediaNode: (nodeId, patch) => input.patchMediaNode(nodeId, patch),
    onEdgesChange: input.onEdgesChange,
    setEdges: input.setEdges,
    submittingNodeId: input.submittingNodeId,
  });
  const handleMediaIndexChange = (id: string, mediaMentions: MediaMention[], mediaRefs: MediaRef[], delta: { added: string[]; removed: string[] }) => {
    input.setTextNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, mediaMentions, mediaRefs } } : n));
    syncTextIndexEdges(id, delta);
  };
  const removePlanAttachment = (targetId: string | undefined, planNodeId: string) => {
    if (!targetId || input.isGeneratingNode(targetId)) return;
    removeTargetInputs(input.edgesRef.current.filter((edge) => edge.source === planNodeId && edge.target === targetId).map((edge) => edge.id));
  };
  return {
    addCanvasEdge,
    connectPlanToDraft,
    syncPlanEdgeBindingsOnShrink,
    removeTargetInputs,
    syncTextIndexEdges,
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
    draftModelOf,
    videoCapsOfDraft,
    imageRefMaxOfDraft,
    videoRefUnsupportedByModel,
    ...pair,
    handleMediaIndexChange,
    removePlanAttachment,
  };
}

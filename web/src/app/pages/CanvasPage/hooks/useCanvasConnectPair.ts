import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Connection, Edge, Node, OnEdgesChange } from '@xyflow/react';
import { draftVideoModeOf } from '../videoModes';
import { frameSlotCountOf, isFrameMode, type VideoMode } from '@/app/utils/video-modes';
import { canConnectSourcesToGen, genKindOf, isConnectableSource, wouldCreateCycle } from '../connectAbility';
import { imageRefSourceError } from '../mediaRefs';
import { mergedVideoMediaRefsOf, type VideoRefRole } from '../videoMediaRefs';
import {
  AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON,
  audioVideoMuxIdentityOf,
  isAudioVideoMuxAudioEdge,
  isAudioVideoMuxBindEdge,
} from '../audioVideoMux';

type ShowToast = (type: 'success' | 'error' | 'warn', msg: string) => void;

export interface CanvasConnectPairHost {
  isApplying: () => boolean;
  showToast: ShowToast;
  isGeneratingNode: (id: string) => boolean;
  findCanvasNode: (id: string) => Node | undefined;
  edgesRef: RefObject<Edge[]>;
  getMediaNodes: () => Node[];
  toolConnect: (source: Node, target: Node) => boolean | null;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  connectPlanToDraft: (planNodeId: string, targetId: string) => void;
  removeTargetInputs: (edgeIds: string[]) => void;
  validateImageRefConnect: (source: string, target: string) => boolean;
  validateVideoRefConnect: (source: string, target: string, role: VideoRefRole) => boolean;
  validateAudioRefConnect: (source: string, target: string) => boolean;
  validateAudioTextConnect: (source: string, target: string) => boolean;
  withHistoryBatch: (fn: () => void) => void;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  onEdgesChange: OnEdgesChange<Edge>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  submittingNodeId: string | null;
}

export interface CanvasConnectPairHandles {
  connectPair: (source: string, target: string) => boolean;
  draftModeOfNode: (nodeId: string, data?: Record<string, unknown> | undefined) => VideoMode | null;
  videoEdgeRoleFor: (targetId: string, requested?: VideoRefRole | null) => VideoRefRole;
  handleConnect: (params: Connection) => void;
  handleConnectGroupToTarget: (memberIds: string[], targetId: string) => void;
  handleConnectSourceToGroup: (sourceId: string, memberIds: string[]) => void;
  guardEdgesChange: OnEdgesChange<Edge>;
}

export function useCanvasConnectPair(host: CanvasConnectPairHost): CanvasConnectPairHandles {
  const {
    isApplying,
    showToast,
    isGeneratingNode,
    findCanvasNode,
    edgesRef,
    getMediaNodes,
    toolConnect,
    addCanvasEdge,
    connectPlanToDraft,
    removeTargetInputs,
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
    withHistoryBatch,
    patchMediaNode,
    onEdgesChange,
    setEdges,
    submittingNodeId,
  } = host;

  const draftModeOfNode = (nodeId: string, data?: Record<string, unknown> | undefined): VideoMode | null =>
    draftVideoModeOf(
      data ?? (getMediaNodes().find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined),
      mergedVideoMediaRefsOf(nodeId, edgesRef.current, getMediaNodes()),
    );

  const videoEdgeRoleFor = (targetId: string, requested?: VideoRefRole | null): VideoRefRole => {
    if (requested === 'first' || requested === 'last') return requested;
    const slots = frameSlotCountOf(draftModeOfNode(targetId));
    if (slots === 0) return 'reference';
    const refs = mergedVideoMediaRefsOf(targetId, edgesRef.current, getMediaNodes());
    if (!refs.first) return 'first';
    if (slots === 2 && !refs.last) return 'last';
    return 'reference';
  };

  const connectPair = (source: string, target: string): boolean => {
    if (isApplying() || !source || !target || source === target) return false;
    if (isGeneratingNode(target)) {
      showToast('warn', '生成中，输入连线只读');
      return false;
    }
    const sourceNode = findCanvasNode(source);
    const targetNode = findCanvasNode(target);
    if (!sourceNode || !targetNode) return false;
    const sourceData = sourceNode.data as Record<string, unknown> | undefined;
    const targetData = targetNode.data as Record<string, unknown> | undefined;
    if (sourceData?.emptyShell || targetData?.emptyShell) return false;
    const toolConnection = toolConnect(sourceNode, targetNode);
    if (toolConnection !== null) return toolConnection;
    const imageRefOk = genKindOf(targetNode) === 'image' && sourceNode.type === 'mediaNode'
      && imageRefSourceError(sourceNode) === null;
    if (!imageRefOk && !isConnectableSource(sourceNode)) return false;
    if (wouldCreateCycle(source, target, edgesRef.current)) return false;
    if (sourceNode.type === 'mediaNode' && targetNode.type === 'textNode') {
      showToast('warn', '媒体到文本卡的关系线由正文 @ 索引建立');
      return false;
    }
    const targetKind = genKindOf(targetNode);
    const videoRole = targetKind === 'video' && sourceNode.type === 'mediaNode'
      ? videoEdgeRoleFor(target)
      : undefined;
    if (targetKind) {
      if (!imageRefOk && !canConnectSourcesToGen([sourceNode], targetKind)) return false;
      if (sourceNode?.type === 'textNode' && sourceData?.promptSource && (targetKind === 'image' || targetKind === 'video')) {
        connectPlanToDraft(source, target);
        return true;
      }
      if (!validateImageRefConnect(source, target)) return false;
      if (targetKind === 'video' && videoRole === 'reference' && isFrameMode(draftModeOfNode(target, targetData))) {
        const refs = mergedVideoMediaRefsOf(target, edgesRef.current, getMediaNodes());
        if (refs.first || refs.last) {
          showToast('warn', '首帧和尾帧已指定，请先移除现有帧');
          return false;
        }
      }
      if (!validateVideoRefConnect(source, target, videoRole ?? 'reference')) return false;
      if (sourceNode.type === 'textNode') {
        if (!validateAudioTextConnect(source, target)) return false;
      } else if (!validateAudioRefConnect(source, target)) return false;
    }
    addCanvasEdge(source, target, videoRole);
    return true;
  };

  const handleConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      connectPair(params.source, params.target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, submittingNodeId],
  );
  const handleConnectGroupToTarget = useCallback(
    (memberIds: string[], targetId: string) => {
      if (memberIds.length === 0 || !targetId) return;
      withHistoryBatch(() => {
        memberIds.forEach((m) => connectPair(m, targetId));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, submittingNodeId],
  );
  const handleConnectSourceToGroup = useCallback(
    (sourceId: string, memberIds: string[]) => {
      if (!sourceId || memberIds.length === 0) return;
      withHistoryBatch(() => {
        memberIds.forEach((m) => connectPair(sourceId, m));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, submittingNodeId],
  );

  const guardEdgesChange: OnEdgesChange<Edge> = (changes) => {
    const allowed = changes.filter((c) => {
      if (c.type !== 'remove') return true;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      if (!edge) return true;
      if (isGeneratingNode(edge.target)) return false;
      const muxDraft = getMediaNodes().find((n) => n.id === edge.target);
      if (isAudioVideoMuxAudioEdge(edge, muxDraft)) return false;
      return true;
    });
    if (allowed.length < changes.length) {
      const blockedMuxAudioEdge = changes.some((c) => {
        if (c.type !== 'remove') return false;
        const edge = edgesRef.current.find((e) => e.id === c.id);
        if (!edge) return false;
        const muxDraft = getMediaNodes().find((n) => n.id === edge.target);
        return isAudioVideoMuxAudioEdge(edge, muxDraft);
      });
      showToast('warn', blockedMuxAudioEdge ? AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON : '生成中，输入连线只读');
    }
    const removedEdges: Edge[] = [];
    for (const c of allowed) {
      if (c.type !== 'remove') continue;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      if (edge) removedEdges.push(edge);
    }
    if (removedEdges.length > 0) removeTargetInputs(removedEdges.map(edge => edge.id));
    for (const edge of removedEdges) {
      const muxDraft = getMediaNodes().find((n) => n.id === edge.target);
      const identity = audioVideoMuxIdentityOf(muxDraft);
      if (!muxDraft || !identity || !isAudioVideoMuxBindEdge(edge, muxDraft)) continue;
      const nextIdentity = { ...identity };
      delete nextIdentity.video;
      patchMediaNode(muxDraft.id, { audioVideoMux: nextIdentity });
    }
    const otherChanges = allowed.filter(change => change.type !== 'remove');
    if (otherChanges.length > 0) onEdgesChange(otherChanges);
  };

  return { connectPair, draftModeOfNode, videoEdgeRoleFor, handleConnect, handleConnectGroupToTarget, handleConnectSourceToGroup, guardEdgesChange };
}

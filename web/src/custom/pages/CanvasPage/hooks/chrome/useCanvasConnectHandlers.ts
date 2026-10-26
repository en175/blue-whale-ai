import { type ConnectGenKind, type VideoRefRole } from '@/custom/enums';
import type { RefObject } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { canConnectSourcesToGen, genKindOf, wouldCreateCycle } from '../../graph/connectAbility';
import { audioVideoMuxVideoError, isAudioVideoMuxDraftNode } from '../../tools/audio/audioVideoMux';

import type { CanvasDraftCardCreatorsHandles } from '../tools/useCanvasDraftCardCreators';

type ToolSessionsWire = { wireStart: (id: string | null) => void };

export interface CanvasConnectHandlersHost {
  connectMenu: { sourceIds: string[]; x: number; y: number } | null;
  connectingSourceRef: RefObject<string | null>;
  edgesRef: RefObject<Edge[]>;
  findCanvasNode: (id: string) => Node | undefined;
  isConnectableSource: (node: Node | undefined) => boolean;
  availableGenKinds: (sources: Node[]) => Set<ConnectGenKind>;
  setConnectMenu: (menu: { sourceIds: string[]; x: number; y: number } | null) => void;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  connectPlanToDraft: (planNodeId: string, targetId: string) => void;
  connectPair: (source: string, target: string) => boolean;
  videoRefSourceError: (node: Node | undefined, role: VideoRefRole) => string | null;
  imageRefSourceError: (node: Node) => string | null;
  audioRefSourceError: (node: Node) => string | null;
  spawnNearScreen: (screenPt: { x: number; y: number }) => { x: number; y: number };
  withHistoryBatch: (fn: () => void) => void;
  creators: CanvasDraftCardCreatorsHandles;
  openVideoDraftDialog: (nodeId: string) => void;
  openImageDraftDialog: (nodeId: string) => void;
  openAudioDraftDialog: (nodeId: string) => void;
  openTextGenDialog: (nodeId: string, intent?: 'nodeClick') => void;
  toolSessions: ToolSessionsWire;
}

export interface CanvasConnectHandlersHandles {
  applyConnectType: (kind: ConnectGenKind) => void;
  handleConnectEnd: (
    event: MouseEvent | TouchEvent,
    state?: {
      fromNode?: Node | null;
      toNode?: Node | null;
      isValid?: boolean | null;
      toHandle?: { nodeId?: string | null } | null;
    },
  ) => void;
  handleConnectGroupDrop: (memberIds: string[], _targetId: string | null, client: { x: number; y: number }) => void;
  isValidCanvasConnection: (connection: { source: string | null; target: string | null }) => boolean;
}

export function useCanvasConnectHandlers(host: CanvasConnectHandlersHost): CanvasConnectHandlersHandles {
  const {
    connectMenu,
    connectingSourceRef,
    edgesRef,
    findCanvasNode,
    isConnectableSource,
    availableGenKinds,
    setConnectMenu,
    addCanvasEdge,
    connectPlanToDraft,
    connectPair,
    videoRefSourceError,
    imageRefSourceError,
    audioRefSourceError,
    spawnNearScreen,
    withHistoryBatch,
    creators,
    openVideoDraftDialog,
    openImageDraftDialog,
    openAudioDraftDialog,
    openTextGenDialog,
    toolSessions,
  } = host;
  const { createVideoDraftCard, createImageDraftCard, createAudioDraftCard, createTextGenDraft } = creators;

  const openConnectTypeMenu = (sourceIds: string[], clientX: number, clientY: number) => {
    const sources = sourceIds.map(findCanvasNode).filter((n): n is Node => isConnectableSource(n));
    if (sources.length === 0) return;
    if (availableGenKinds(sources).size === 0) return;
    setConnectMenu({ sourceIds: sources.map((n) => n.id), x: clientX, y: clientY });
  };
  const connectMenuSourcesToDraft = (sourceIds: string[], targetId: string, kind: ConnectGenKind) => {
    sourceIds.forEach((id) => {
      const source = findCanvasNode(id);
      if (!source || !isConnectableSource(source)) return;
      if (source.type === 'mediaNode') {
        if (kind === 'video' && videoRefSourceError(source, 'reference')) return;
        if (kind === 'image' && imageRefSourceError(source)) return;
        if (kind === 'audio' && audioRefSourceError(source)) return;
        addCanvasEdge(id, targetId, kind === 'video' ? 'reference' : undefined);
        return;
      }
      const sourceData = source.data as Record<string, unknown> | undefined;
      if (source.type === 'textNode' && sourceData?.promptSource && (kind === 'image' || kind === 'video')) {
        connectPlanToDraft(id, targetId);
        return;
      }
      addCanvasEdge(id, targetId);
    });
  };
  const applyConnectType = (kind: ConnectGenKind) => {
    if (!connectMenu) return;
    const sourceIds = connectMenu.sourceIds;
    const position = spawnNearScreen({ x: connectMenu.x, y: connectMenu.y });
    setConnectMenu(null);
    withHistoryBatch(() => {
      let targetId = '';
      if (kind === 'video') {
        targetId = createVideoDraftCard(undefined, position, { recordHistory: true });
        connectMenuSourcesToDraft(sourceIds, targetId, 'video');
        openVideoDraftDialog(targetId);
        return;
      }
      if (kind === 'image') {
        targetId = createImageDraftCard(position, { recordHistory: true });
        connectMenuSourcesToDraft(sourceIds, targetId, 'image');
        openImageDraftDialog(targetId);
        return;
      }
      if (kind === 'audio') {
        targetId = createAudioDraftCard(position, { recordHistory: true });
        connectMenuSourcesToDraft(sourceIds, targetId, 'audio');
        openAudioDraftDialog(targetId);
        return;
      }
      targetId = createTextGenDraft(position);
      sourceIds.forEach((id) => addCanvasEdge(id, targetId));
      openTextGenDialog(targetId);
    });
  };
  const canvasNodeIdAtScreen = (clientX: number, clientY: number): string | null => {
    const stacked = document.elementsFromPoint(clientX, clientY);
    for (const el of stacked) {
      if (!(el instanceof Element)) continue;
      const handleEl = el.closest('.react-flow__handle') as HTMLElement | null;
      if (handleEl) {
        const handleNodeId = handleEl.getAttribute('data-nodeid') || handleEl.getAttribute('data-node-id');
        if (handleNodeId && findCanvasNode(handleNodeId)) return handleNodeId;
      }
      const nodeEl = el.closest('.react-flow__node') as HTMLElement | null;
      if (!nodeEl) continue;
      const id = nodeEl.getAttribute('data-id');
      if (id && findCanvasNode(id)) return id;
    }
    return null;
  };
  const handleConnectEnd = (
    event: MouseEvent | TouchEvent,
    state?: {
      fromNode?: Node | null;
      toNode?: Node | null;
      isValid?: boolean | null;
      toHandle?: { nodeId?: string | null } | null;
    },
  ) => {
    const fromId = state?.fromNode?.id ?? connectingSourceRef.current;
    connectingSourceRef.current = null;
    toolSessions.wireStart(null);
    if (state?.isValid) return;
    const from = fromId ? findCanvasNode(fromId) ?? state?.fromNode ?? undefined : undefined;
    if (!from) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const handleNodeId = state?.toHandle?.nodeId ?? null;
    const droppedId =
      (handleNodeId && handleNodeId !== from.id && findCanvasNode(handleNodeId) ? handleNodeId : null)
      ?? (state?.toNode && state.toNode.id !== from.id && findCanvasNode(state.toNode.id) ? state.toNode.id : null)
      ?? canvasNodeIdAtScreen(point.clientX, point.clientY);
    if (droppedId && droppedId !== from.id) {
      connectPair(from.id, droppedId);
      return;
    }
    if (!isConnectableSource(from)) return;
    openConnectTypeMenu([from.id], point.clientX, point.clientY);
  };
  const handleConnectGroupDrop = (
    memberIds: string[],
    _targetId: string | null,
    client: { x: number; y: number },
  ) => {
    const sources = memberIds.filter((id) => isConnectableSource(findCanvasNode(id)));
    if (sources.length === 0) return;
    openConnectTypeMenu(sources, client.x, client.y);
  };
  const isValidCanvasConnection = (connection: { source: string | null; target: string | null }) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const sourceNode = findCanvasNode(connection.source);
    const targetNode = findCanvasNode(connection.target);
    if (!sourceNode || !targetNode) return false;
    const sourceData = sourceNode.data as Record<string, unknown> | undefined;
    const targetData = targetNode.data as Record<string, unknown> | undefined;
    if (sourceData?.emptyShell || targetData?.emptyShell) return false;
    if (isAudioVideoMuxDraftNode(targetNode)) return audioVideoMuxVideoError(sourceNode) === null;
    if (wouldCreateCycle(connection.source, connection.target, edgesRef.current)) return false;
    const kind = genKindOf(targetNode);
    if (kind === 'image' && sourceNode.type === 'mediaNode') {
      return imageRefSourceError(sourceNode) === null;
    }
    if (!isConnectableSource(sourceNode)) return false;
    if (kind && !canConnectSourcesToGen([sourceNode], kind)) return false;
    return true;
  };

  return { applyConnectType, handleConnectEnd, handleConnectGroupDrop, isValidCanvasConnection };
}

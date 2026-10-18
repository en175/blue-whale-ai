import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node, Viewport } from '@xyflow/react';
import type { CanvasDoc } from '@/custom/api/canvas';
import type { SnapshotAsset } from '@/custom/api/projects';
import { exclusiveMembersInGroup, type CanvasGroup } from '../../graph/canvasGroups';
import type { GenerationRuntime } from '../../generation/runtime';
import type { CanvasGraph } from './useCanvasGraph';

export interface CanvasHydrationHost {
  currentId: string;
  doc: CanvasDoc | null;
  snapshotAssets: Record<string, SnapshotAsset>;
  canvasLoadFailed: boolean;
  graph: CanvasGraph;
  recoverFrameInterpolationRef: RefObject<(nodeId: string, savedJobId?: unknown) => void>;
  attachCallbacks: (node: Node) => Node;
  resolveNodeAssets: (node: Node, assets: Record<string, SnapshotAsset>, fromHistory?: boolean) => Node;
  mapBackendNode: (node: Node, assets: Record<string, SnapshotAsset>) => Node | null;
  parseGroupsFromNodes: (nodes: Node[]) => { groups: CanvasGroup[]; contentNodes: Node[] };
  groupToNode: (group: CanvasGroup) => Node;
  serializeNodes: (nodes: Node[]) => string;
  serializeEdges: (edges: Edge[]) => string;
  generationRuntimeRef: RefObject<GenerationRuntime | null>;
  hydratedDocRef: RefObject<CanvasDoc | null>;
  hydratedProjectRef: RefObject<string | null>;
  confirmedNonEmptyRef: RefObject<boolean>;
  emptyClearConflictRef: RefObject<boolean>;
  emptyOverwriteRejectedRef: RefObject<boolean>;
  recoverySaveConflictRef: RefObject<boolean>;
  docLoadEpochRef: RefObject<object>;
  productSeq: RefObject<number>;
  versionRef: RefObject<number | null>;
  lastSavedRef: RefObject<string>;
  settledExtractNodesRef: RefObject<Set<string>>;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  setProductNodes: Dispatch<SetStateAction<Node[]>>;
  setAssetNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setGroups: Dispatch<SetStateAction<CanvasGroup[]>>;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  setSaveStatus: Dispatch<SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>;
}

export function useCanvasHydration(host: CanvasHydrationHost) {
  const {
    currentId,
    doc,
    snapshotAssets,
    canvasLoadFailed,
    graph,
    recoverFrameInterpolationRef,
    attachCallbacks,
    resolveNodeAssets,
    mapBackendNode,
    parseGroupsFromNodes,
    groupToNode,
    serializeNodes,
    serializeEdges,
    generationRuntimeRef,
    hydratedDocRef,
    hydratedProjectRef,
    confirmedNonEmptyRef,
    emptyClearConflictRef,
    emptyOverwriteRejectedRef,
    recoverySaveConflictRef,
    docLoadEpochRef,
    productSeq,
    versionRef,
    lastSavedRef,
    settledExtractNodesRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    setEdges,
    setGroups,
    setViewport,
    setSaveStatus,
  } = host;

  const groupCleanupRef = useRef<{ projectId: string; nodes: Node[]; groups: CanvasGroup[] } | null>(null);
  const handleNodesMeasured = (measuredNodes: Node[]) => {
    const pending = groupCleanupRef.current;
    if (!pending || pending.projectId !== currentId || hydratedProjectRef.current !== pending.projectId) return;
    const measuredById = new Map(measuredNodes.map((node) => [node.id, node]));
    const currentById = new Map(graph.allNodes().map((node) => [node.id, node]));
    const surviving = pending.nodes.filter((node) => currentById.has(node.id));
    if (!surviving.every((node) => {
      const measured = measuredById.get(node.id);
      const current = currentById.get(node.id)!;
      return measured?.measured?.width != null && measured.measured.height != null
        && measured.position.x === current.position.x && measured.position.y === current.position.y;
    })) return;
    const restored = surviving.map((node) => ({ ...node, measured: measuredById.get(node.id)!.measured }));
    const deleted = pending.nodes.filter((node) => !currentById.has(node.id));
    const emptyIds = new Set(pending.groups.filter((group) => !deleted.some((node) => !group.excludedIds.includes(node.id)
      && node.position.x <= group.box.x + group.box.w && node.position.y <= group.box.y + group.box.h)
      && exclusiveMembersInGroup(restored, group, pending.groups).length === 0).map((group) => group.id));
    groupCleanupRef.current = null;
    setGroups((previous) => {
      const next = previous.filter((group) => !emptyIds.has(group.id));
      return next.length === previous.length ? previous : next;
    });
  };

  useEffect(() => {
    if (!doc) {
      setTextNodes([]);
      setMediaNodes([]);
      setProductNodes([]);
      setAssetNodes([]);
      setEdges([]);
      setGroups([]);
      versionRef.current = null;
      lastSavedRef.current = '';
      hydratedDocRef.current = null;
      hydratedProjectRef.current = null;
      groupCleanupRef.current = null;
      confirmedNonEmptyRef.current = false;
      emptyClearConflictRef.current = false;
      emptyOverwriteRejectedRef.current = false;
      recoverySaveConflictRef.current = false;
      setSaveStatus('idle');
      return;
    }
    const docChanged = hydratedDocRef.current !== doc;
    hydratedDocRef.current = doc;
    if (!docChanged) {
      const refresh = (prev: Node[]) => {
        const next = prev.map((node) => resolveNodeAssets(node, snapshotAssets));
        return next.some((node, index) => node !== prev[index]) ? next : prev;
      };
      setMediaNodes(refresh);
      setProductNodes(refresh);
      setAssetNodes(refresh);
      return;
    }
    hydratedProjectRef.current = canvasLoadFailed ? null : currentId;
    confirmedNonEmptyRef.current = doc.nodes.length > 0;
    docLoadEpochRef.current = {};
    generationRuntimeRef.current?.reset();
    if (!canvasLoadFailed) {
      emptyClearConflictRef.current = false;
      emptyOverwriteRejectedRef.current = false;
      recoverySaveConflictRef.current = false;
    }
    const t: Node[] = [];
    const m: Node[] = [];
    const p: Node[] = [];
    const a: Node[] = [];
    const { groups: hydratedGroups, contentNodes } = parseGroupsFromNodes(doc.nodes);
    contentNodes.forEach((node) => {
      if (node.type === 'textNode') t.push(attachCallbacks(node));
      else if (node.type === 'mediaNode') m.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets, true)));
      else if (node.type === 'productNode') p.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets)));
      else if (node.type === 'assetNode') a.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets)));
      else {
        const mapped = mapBackendNode(node, snapshotAssets);
        if (mapped) {
          const attached = attachCallbacks(resolveNodeAssets(mapped, snapshotAssets, true));
          if (mapped.type === 'assetNode') a.push(attached);
          else if (mapped.type === 'textNode') t.push(attached);
          else m.push(attached);
        } else if (import.meta.env.DEV) {
          console.warn('[canvas] 无法映射的后端节点:', JSON.stringify(node).slice(0, 800));
        }
      }
    });
    productSeq.current = p.length;
    if (import.meta.env.DEV) {
      console.info(`[canvas] 水合节点：text ${t.length} / media ${m.length} / product ${p.length} / asset ${a.length}（version=${doc.version}）`);
    }
    setTextNodes(t);
    setMediaNodes(m);
    setProductNodes(p);
    setAssetNodes(a);
    const hydratedAll = [...t, ...m, ...p, ...a];
    const cleanedEmptyCanvasGroups = !canvasLoadFailed && hydratedAll.length === 0 && hydratedGroups.length > 0;
    setGroups(cleanedEmptyCanvasGroups ? [] : hydratedGroups);
    groupCleanupRef.current = !canvasLoadFailed && hydratedAll.length > 0 && hydratedGroups.length > 0
      ? { projectId: currentId, nodes: hydratedAll, groups: hydratedGroups }
      : null;
    if (import.meta.env.DEV && hydratedGroups.length > 0) {
      console.info(`[canvas] 水合成组：${hydratedGroups.length} 个组`);
    }
    const hydratedIds = new Set([...t, ...m, ...p, ...a].map((n) => n.id));
    const hydratedEdges: Edge[] = doc.edges
      .filter((e) => hydratedIds.has(e.source) && hydratedIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'custom',
        style: { stroke: '#444' },
        ...(e.data ? { data: e.data } : {}),
      }));
    setEdges(hydratedEdges);
    versionRef.current = doc.version;
    setViewport(doc.viewport);
    const upgradedTextNodes = contentNodes.some(
      (node) => node.type === 'textNode' && typeof (node.data as Record<string, unknown> | undefined)?.html === 'string',
    );
    lastSavedRef.current = cleanedEmptyCanvasGroups || upgradedTextNodes
      ? ''
      : JSON.stringify(doc.viewport) +
        serializeNodes([...hydratedAll, ...hydratedGroups.map((g) => groupToNode(g))]) +
        serializeEdges(hydratedEdges);
    m
      .filter(
        (n) =>
          (n.data.genStatus === 'generating' || n.data.genStatus === 'checking') &&
          !((n.data ?? {}) as Record<string, unknown>).frameInterpolation &&
          (typeof n.data.jobId === 'number' || typeof n.data.jobId === 'string') &&
          !settledExtractNodesRef.current.has(n.id),
      )
      .forEach((n) => {
        generationRuntimeRef.current?.resumeFromHydration(n.id, String(n.data.jobId), (n.data ?? {}) as Record<string, unknown>);
      });
    m
      .filter(
        (n) =>
          ((n.data ?? {}) as Record<string, unknown>).frameInterpolation != null,
      )
      .forEach((n) => recoverFrameInterpolationRef.current(n.id, n.data.jobId));
    if (currentId && !canvasLoadFailed) void generationRuntimeRef.current?.recover(currentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, snapshotAssets]);

  return { handleNodesMeasured };
}

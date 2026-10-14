import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node, Viewport } from '@xyflow/react';
import type { CanvasDoc } from '@/api/canvas';
import type { SnapshotAsset } from '@/api/projects';
import type { CanvasGroup } from '../canvasGroups';
import type { GenerationRuntime } from '../generationRuntime/runtime';

export interface CanvasHydrationHost {
  currentId: string;
  doc: CanvasDoc | null;
  snapshotAssets: Record<string, SnapshotAsset>;
  canvasLoadFailed: boolean;
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

export function useCanvasHydration(host: CanvasHydrationHost): void {
  const {
    currentId,
    doc,
    snapshotAssets,
    canvasLoadFailed,
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
    setGroups(hydratedGroups);
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
    const hydratedAll = [...t, ...m, ...p, ...a];
    const upgradedTextNodes = contentNodes.some(
      (node) => node.type === 'textNode' && typeof (node.data as Record<string, unknown> | undefined)?.html === 'string',
    );
    lastSavedRef.current = upgradedTextNodes
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
}

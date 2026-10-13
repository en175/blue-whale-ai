import type { RefObject } from 'react';
import type { Edge, Node, Viewport } from '@xyflow/react';
import type { PromptPreviewSource } from '@lib/contracts/prompt-preview';
import type { GenerationCardBlock } from '@/api/agentSessions';
import type { CanvasDoc, CanvasRecord } from '@/api/canvas';
import { saveCanvasDoc } from '@/api/canvas';
import type { SnapshotAsset } from '@/api/projects';
import { newNodeId } from '../nodeId';
import { appliedPlanAssetIds, dropReversedTextIndexEdges, replaceMissingPlanMediaNodes, textIndexEdgesForAppliedPlan } from '../planApplyEdges';

export interface CanvasApplyAgentCardHost {
  currentId: string;
  viewport: Viewport;
  mediaNodesRef: RefObject<Node[]>;
  applyingRef: RefObject<boolean>;
  activeProjectRef: RefObject<string>;
  setApplying: (value: boolean) => void;
  setSaveStatus: (value: 'idle' | 'saving' | 'saved' | 'error') => void;
  setSavedAt: (value: string) => void;
  setFocusViewport: (value: Viewport | undefined) => void;
  spawnPosition: () => { x: number; y: number };
  flushCanvasSave: (projectId: string) => Promise<boolean>;
  applyMutation: {
    mutateAsync: (input: { projectId: string; source: PromptPreviewSource; position: { x: number; y: number } }) => Promise<{ node: Node; canvas: CanvasRecord; reused: boolean }>;
  };
  acceptDoc: (doc: CanvasDoc) => void;
  upsertAssets: (items: SnapshotAsset[]) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

export interface CanvasApplyAgentCardHandles {
  handleAgentCardApply: (payload: GenerationCardBlock) => Promise<void>;
}

export function useCanvasApplyAgentCard(host: CanvasApplyAgentCardHost): CanvasApplyAgentCardHandles {
  const {
    currentId,
    viewport,
    mediaNodesRef,
    applyingRef,
    activeProjectRef,
    setApplying,
    setSaveStatus,
    setSavedAt,
    setFocusViewport,
    spawnPosition,
    flushCanvasSave,
    applyMutation,
    acceptDoc,
    upsertAssets,
    showToast,
  } = host;

  const handleAgentCardApply = async (payload: GenerationCardBlock) => {
    if (applyingRef.current || !currentId || !payload.source) return;
    const projectId = currentId;
    applyingRef.current = true;
    setApplying(true);
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      const missingNodeIds = new Set(
        mediaNodesRef.current
          .filter((node) => (node.data as { assetMissing?: boolean }).assetMissing === true)
          .map((node) => node.id),
      );
      if (!(await flushCanvasSave(projectId))) return;
      const result = await applyMutation.mutateAsync({ projectId, source: payload.source, position: spawnPosition() });
      if (activeProjectRef.current !== projectId) return;
      const savedNodes = JSON.parse(result.canvas.nodes ?? '[]') as Node[];
      const savedEdges = JSON.parse(result.canvas.edges ?? '[]') as Edge[];
      const savedViewport = JSON.parse(result.canvas.viewport ?? 'null') as Viewport | null;
      const textNodeId = result.node.id;
      const extraAssetIds = (payload.assetRefItems ?? []).map((item) => item.assetId);
      const assetIds = appliedPlanAssetIds(result.node as Node, extraAssetIds);
      const rebuilt = replaceMissingPlanMediaNodes({
        textNodeId,
        assetIds,
        nodes: savedNodes.map((node) => (
          node.id === result.node.id
            ? { ...node, data: { ...(node.data ?? {}), ...((result.node as Node).data ?? {}) } }
            : node
        )),
        missingNodeIds,
        createNodeId: () => newNodeId('media'),
      });
      const keptEdges = savedEdges.filter((edge) => !rebuilt.removedNodeIds.has(edge.source) && !rebuilt.removedNodeIds.has(edge.target));
      const oriented = dropReversedTextIndexEdges(textNodeId, keptEdges);
      const indexEdges = textIndexEdgesForAppliedPlan(textNodeId, assetIds, rebuilt.nodes, oriented);
      let nextNodes = rebuilt.nodes;
      let nextEdges = [...oriented, ...indexEdges];
      let nextVersion = result.canvas.version;
      if (indexEdges.length > 0 || oriented.length !== savedEdges.length || rebuilt.replaced) {
        try {
          const persisted = await saveCanvasDoc(
            projectId,
            { viewport: savedViewport ?? viewport, nodes: nextNodes, edges: nextEdges },
            result.canvas.version,
          );
          nextVersion = persisted.version;
          nextNodes = JSON.parse(persisted.nodes ?? '[]') as Node[];
          nextEdges = JSON.parse(persisted.edges ?? '[]') as Edge[];
        } catch {
        }
      }
      const newAssets: SnapshotAsset[] = [];
      for (const n of nextNodes) {
        if (n.type !== 'mediaNode') continue;
        const d = (n.data ?? {}) as Record<string, unknown>;
        const aid = d.assetId ?? d.asset_id ?? d.assetID;
        if (aid == null || aid === '') continue;
        const src = typeof d.src === 'string' ? d.src : '';
        if (!src || src.startsWith('blob:')) continue;
        const mediaType = d.mediaType;
        if (mediaType !== 'image' && mediaType !== 'video' && mediaType !== 'audio') continue;
        newAssets.push({
          asset_id: Number(aid),
          type: mediaType,
          access_url: src,
          width: typeof d.width === 'number' ? d.width : null,
          height: typeof d.height === 'number' ? d.height : null,
          material_id: null,
          material_status: null,
        });
      }
      upsertAssets(newAssets);
      acceptDoc({ id: result.canvas.id, version: nextVersion, nodes: nextNodes, edges: nextEdges, viewport: savedViewport ?? viewport });
      const target = result.node.position;
      setFocusViewport({ x: window.innerWidth / 3 - target.x, y: window.innerHeight / 2 - target.y - 135, zoom: 1 });
      setSaveStatus('saved');
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) {
      setSaveStatus('error');
      showToast('error', error instanceof Error ? error.message : '应用失败，请重试');
    } finally { applyingRef.current = false; setApplying(false); }
  };

  return { handleAgentCardApply };
}

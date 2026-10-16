import { type VideoRefRole } from '@/custom/enums';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { promptMentionSchema, validPromptMentions, type PromptMention } from '@lib/contracts/prompt-preview';
import { promptBindingList, promptBindingsSchema, releaseRemovedPromptSources } from '@lib/contracts/prompt-target';
import { readAssetId } from '../../media/mediaRefs';
import { extractTextNodeText } from '../../agent/quoteConversation';
import { planBindingsCoveredBy } from '../../graph/canvasNodeUtils';

import type { CanvasHistoryApi } from '../document/useCanvasHistory';

export interface CanvasEdgeOpsHost {
  edgesRef: RefObject<Edge[]>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  historyRef: RefObject<CanvasHistoryApi | null>;
  isApplying: () => boolean;
  findCanvasNode: (id: string) => Node | undefined;
  getTextNodes: () => Node[];
}

export interface CanvasEdgeOpsHandles {
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  connectPlanToDraft: (planNodeId: string, targetId: string) => void;
  syncPlanEdgeBindingsOnShrink: (planNodeId: string, mentions: PromptMention[]) => void;
  removeTargetInputs: (edgeIds: string[]) => void;
  syncTextIndexEdges: (textId: string, delta: { added: string[]; removed: string[] }) => void;
}

export function useCanvasEdgeOps(host: CanvasEdgeOpsHost): CanvasEdgeOpsHandles {
  const { edgesRef, setEdges, historyRef, isApplying, findCanvasNode, getTextNodes } = host;

  const removeTargetInputs = (edgeIds: string[]) => {
    if (isApplying()) return;
    const before = edgesRef.current;
    const after = releaseRemovedPromptSources(before, before.filter(edge => !edgeIds.includes(edge.id)));
    historyRef.current?.pushReplaceEdges(before, after);
    edgesRef.current = after;
    setEdges(after);
  };

  const addCanvasEdge = (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => {
    const existing = edgesRef.current.find(e => e.target === target && (e.source === source || (
      e.data?.inputSources && readAssetId((findCanvasNode(e.source)?.data ?? {}) as Record<string, unknown>) === readAssetId((findCanvasNode(source)?.data ?? {}) as Record<string, unknown>)
    )));
    if (existing) {
      const sources = existing.data?.inputSources as { manual: boolean; planNodeIds: string[] } | undefined;
      const markManual = !!(sources && !sources.manual);
      const currentRole = (existing.data as Record<string, unknown> | undefined)?.refRole;
      const nextRole = refRole && refRole !== 'reference' ? refRole : undefined;
      const roleChanged = refRole === 'reference'
        ? currentRole === 'first' || currentRole === 'last'
        : Boolean(nextRole) && currentRole !== nextRole;
      if (!markManual && !roleChanged) return;
      const next = edgesRef.current.map((e) => {
        if (e.id !== existing.id) return e;
        const data: Record<string, unknown> = { ...(e.data ?? {}) };
        if (markManual && sources) data.inputSources = { ...sources, manual: true };
        if (refRole === 'reference') delete data.refRole;
        else if (nextRole) data.refRole = nextRole;
        return { ...e, data };
      });
      historyRef.current?.pushReplaceEdges(edgesRef.current, next);
      edgesRef.current = next;
      setEdges(next);
      return;
    }
    const edgeData: Record<string, unknown> = {
      ...(refRole && refRole !== 'reference' ? { refRole } : {}),
      ...(marker ?? {}),
    };
    const edge: Edge = {
      id: `e-${source}-${target}`,
      source,
      target,
      sourceHandle: null,
      targetHandle: null,
      type: 'custom',
      style: { stroke: '#444' },
      ...(Object.keys(edgeData).length > 0 ? { data: edgeData } : {}),
    };
    historyRef.current?.pushAddEdges([edge]);
    const next = [...edgesRef.current, edge];
    edgesRef.current = next;
    setEdges(next);
  };

  const connectPlanToDraft = (planNodeId: string, targetId: string) => {
    const node = getTextNodes().find((n) => n.id === planNodeId);
    const mentions = promptMentionSchema.array().safeParse(node?.data.promptMentions ?? []);
    const marker = node && mentions.success && validPromptMentions(extractTextNodeText(node.data), mentions.data)
      ? { promptReference: { bindings: promptBindingList(mentions.data) } }
      : undefined;
    addCanvasEdge(planNodeId, targetId, undefined, marker);
    if (!marker) return;
    const next = edgesRef.current.map((edge) => (
      edge.source === planNodeId && edge.target === targetId
        ? { ...edge, data: { ...edge.data, ...marker } }
        : edge
    ));
    edgesRef.current = next;
    setEdges(next);
  };

  const syncPlanEdgeBindingsOnShrink = (planNodeId: string, mentions: import('@lib/contracts/prompt-preview').PromptMention[]) => {
    const nextBindings = promptBindingList(mentions);
    let changed = false;
    const next = edgesRef.current.map((edge) => {
      if (edge.source !== planNodeId) return edge;
      const confirmed = promptBindingsSchema.safeParse(
        (edge.data?.promptReference as { bindings?: unknown } | undefined)?.bindings,
      );
      if (!confirmed.success) return edge;
      if (JSON.stringify(confirmed.data) === JSON.stringify(nextBindings)) return edge;
      if (!planBindingsCoveredBy(nextBindings, confirmed.data)) return edge;
      changed = true;
      return { ...edge, data: { ...edge.data, promptReference: { bindings: nextBindings } } };
    });
    if (!changed) return;
    edgesRef.current = next;
    setEdges(next);
  };

  const syncTextIndexEdges = (textId: string, delta: { added: string[]; removed: string[] }) => {
    if (isApplying()) return;
    const removeIds = delta.removed.map(source => `e-${source}-${textId}`).filter(id => edgesRef.current.some(edge => edge.id === id));
    if (removeIds.length > 0) removeTargetInputs(removeIds);
    const additions = delta.added.filter(source => !edgesRef.current.some(edge => edge.source === source && edge.target === textId));
    if (additions.length === 0) return;
    const newEdges: Edge[] = additions.map(source => ({
      id: `e-${source}-${textId}`,
      source,
      target: textId,
      sourceHandle: null,
      targetHandle: null,
      type: 'custom',
      style: { stroke: '#444' },
      data: { textIndex: true },
    }));
    historyRef.current?.pushAddEdges(newEdges);
    const next = [...edgesRef.current, ...newEdges];
    edgesRef.current = next;
    setEdges(next);
  };

  return { addCanvasEdge, connectPlanToDraft, syncPlanEdgeBindingsOnShrink, removeTargetInputs, syncTextIndexEdges };
}

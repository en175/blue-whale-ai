import { useMutation } from '@tanstack/react-query';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { PromptBinding } from '@lib/contracts/prompt-target';
import { referencePromptPlan, serializeEdges, serializeNodes } from '@/api/canvas';
import { normalizeVideoMode } from '@/lib/video-modes';
import type { CanvasHistoryApi } from './useCanvasHistory';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ShowToast = (type: 'success' | 'error' | 'warn', msg: string) => void;

export function useCanvasReferencePlan(input: {
  referencePlanRef: MutableRefObject<(source: string, target: string, syncBindings?: PromptBinding[]) => Promise<void>>;
  activeProjectRef: { current: string | null };
  applyingRef: RefObject<boolean>;
  versionRef: RefObject<number | null>;
  lastSavedRef: MutableRefObject<string>;
  edgesRef: RefObject<Edge[]>;
  mediaNodesRef: RefObject<Node[]>;
  historyRef: RefObject<CanvasHistoryApi | null>;
  isGeneratingNode: (id: string) => boolean;
  flushCanvasSave: (projectId: string) => Promise<boolean>;
  setApplying: Dispatch<SetStateAction<boolean>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  setSaveEpoch: Dispatch<SetStateAction<number>>;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  showToast: ShowToast;
}) {
  const referencePlanMutation = useMutation({
    mutationFn: (vars: Parameters<typeof referencePromptPlan>[0]) => referencePromptPlan(vars),
  });
  input.referencePlanRef.current = async (planNodeId, targetNodeId, syncBindings) => {
    const projectId = input.activeProjectRef.current;
    if (!projectId || input.applyingRef.current || input.isGeneratingNode(targetNodeId)) return;
    input.applyingRef.current = true;
    input.setApplying(true);
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      if (!(await input.flushCanvasSave(projectId)) || input.versionRef.current === null) return;
      const saved = await referencePlanMutation.mutateAsync({
        projectId,
        planNodeId,
        targetNodeId,
        expectedVersion: input.versionRef.current,
        ...(syncBindings !== undefined ? { syncBindings } : {}),
      });
      if (input.activeProjectRef.current !== projectId) return;
      const next = (JSON.parse(saved.edges ?? '[]') as Edge[]).map((edge) => ({
        ...input.edgesRef.current.find((old) => old.id === edge.id), ...edge, type: 'custom',
      }));
      input.historyRef.current?.pushReplaceEdges(input.edgesRef.current, next);
      input.edgesRef.current = next;
      input.setEdges(next);
      const savedNodes = JSON.parse(saved.nodes ?? '[]') as Node[];
      const serverMode = normalizeVideoMode((savedNodes.find((n) => n.id === targetNodeId)?.data as Record<string, unknown> | undefined)?.draftMode);
      const localMode = normalizeVideoMode((input.mediaNodesRef.current.find((n) => n.id === targetNodeId)?.data as Record<string, unknown> | undefined)?.draftMode);
      if (serverMode && serverMode !== localMode) input.patchMediaNode(targetNodeId, { draftMode: serverMode });
      input.versionRef.current = saved.version;
      input.lastSavedRef.current = JSON.stringify(JSON.parse(saved.viewport ?? 'null')) + serializeNodes(savedNodes) + serializeEdges(next);
      input.setSaveStatus('saved');
      input.setSaveEpoch((value) => value + 1);
    } catch (error) {
      input.showToast('error', error instanceof Error ? error.message : '方案引用失败，请重试');
    } finally {
      input.applyingRef.current = false;
      input.setApplying(false);
    }
  };
}

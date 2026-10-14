import { useCallback, useRef, useState, type RefObject } from 'react';
import type { Edge, Node, Viewport } from '@xyflow/react';
import type { RecoveryChange } from '@/api/canvasRecovery';
import type { CanvasGraph } from './useCanvasGraph';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useCanvasSaveSession(input: {
  currentId: string;
  graph: CanvasGraph;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  submittingNodeId: string | null;
  editingTargetRef: RefObject<string | null>;
}) {
  const { currentId, graph, showToast, submittingNodeId, editingTargetRef } = input;
  const draftErrorsRef = useRef(new Map<string, string>());
  const applyingRef = useRef(false);
  const updateGenerateRef = useRef<(nodeId: string) => void>(() => {});
  const onUpdateGenerate = useCallback((nodeId: string) => {
    updateGenerateRef.current(nodeId);
  }, []);
  const [applying, setApplying] = useState(false);
  const [saveEpoch, setSaveEpoch] = useState(0);
  const savePromiseRef = useRef<Promise<unknown> | null>(null);
  const activeProjectRef = useRef(currentId);
  activeProjectRef.current = currentId;
  const [focusViewport, setFocusViewport] = useState<Viewport>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const versionRef = useRef<number | null>(null);
  const lastSavedRef = useRef('');
  const retainedRecoverySaveRef = useRef<{
    projectId: string;
    commandId: string;
    recoveryChanges: RecoveryChange[];
    payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean };
    version: number | null;
    signature: string;
  } | null>(null);
  const pendingNodeIdsRef = useRef<Set<string>>(new Set());
  const rollbackPendingNodes = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    graph.allNodes().forEach((n) => {
      if (ids.has(n.id)) {
        const src = n.data?.src as string | undefined;
        if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
      }
    });
    graph.setAll((prev) => prev.filter((n) => !ids.has(n.id)));
    ids.forEach((id) => pendingNodeIdsRef.current.delete(id));
  }, [graph]);
  const handleDraftError = (id: string, error: string) => {
    if (error) draftErrorsRef.current.set(id, error);
    else draftErrorsRef.current.delete(id);
    setSaveStatus(error ? 'error' : 'idle');
    setSaveEpoch((value) => value + 1);
  };
  const blockInvalidDraft = (ids: string[]) => {
    const id = ids.find((item) => draftErrorsRef.current.has(item));
    if (!id) return false;
    showToast('warn', `文本节点 ${id}：${draftErrorsRef.current.get(id)}，请修正后继续`);
    return true;
  };
  const canOpenEditor = (nodeId?: string): boolean => {
    if (submittingNodeId && nodeId !== submittingNodeId) {
      showToast('warn', '正在保存并提交，请稍候');
      return false;
    }
    if ((saveBlocked || saveStatus === 'error') && nodeId !== editingTargetRef.current) {
      showToast('warn', '保存失败，请重试');
      return false;
    }
    return true;
  };
  return {
    draftErrorsRef,
    handleDraftError,
    blockInvalidDraft,
    canOpenEditor,
    applyingRef,
    updateGenerateRef,
    onUpdateGenerate,
    applying,
    setApplying,
    saveEpoch,
    setSaveEpoch,
    savePromiseRef,
    activeProjectRef,
    focusViewport,
    setFocusViewport,
    saveStatus,
    setSaveStatus,
    saveBlocked,
    setSaveBlocked,
    savedAt,
    setSavedAt,
    versionRef,
    lastSavedRef,
    retainedRecoverySaveRef,
    pendingNodeIdsRef,
    rollbackPendingNodes,
  };
}

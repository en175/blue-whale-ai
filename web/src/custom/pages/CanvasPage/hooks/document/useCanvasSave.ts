import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Edge, Node, Viewport } from '@xyflow/react';
import {
  readCanvasConflictVersion,
  saveCanvasDoc,
  serializeEdges,
  serializeNodes,
} from '@/custom/api/canvas';
import { isApiError } from '@/shared/api/http';
import {
  putCanvasDocWithRecovery,
  type CanvasRecoverySaveData,
  type RecoveryChange,
} from '@/custom/api/canvasRecovery';
import { readRecoveryErrorReason } from '../../graph/canvasPureNodeHelpers';
import { groupToNode, type CanvasGroup } from '../../graph/canvasGroups';
import type { GenerationRuntime } from '../../generation/runtime';

export const EMPTY_CLEAR_CONFLICT_TOAST = '画布已被其他会话更新，本次清空未保存，请刷新页面复核';
export const EMPTY_OVERWRITE_REJECTED_TOAST = '画布内容与服务端不一致，已阻止清空保存，请刷新页面复核';

type RetainedRecoverySave = {
  projectId: string;
  commandId: string;
  recoveryChanges: RecoveryChange[];
  payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean };
  version: number | null;
  signature: string;
};

export interface CanvasSaveHost {
  activeProjectRef: RefObject<string | null>;
  hydratedProjectRef: RefObject<string | null>;
  textNodesRef: RefObject<Node[]>;
  mediaNodesRef: RefObject<Node[]>;
  productNodesRef: RefObject<Node[]>;
  assetNodesRef: RefObject<Node[]>;
  groupsRef: RefObject<CanvasGroup[]>;
  edgesRef: RefObject<Edge[]>;
  draftErrorsRef: RefObject<Map<string, string>>;
  versionRef: RefObject<number | null>;
  lastSavedRef: RefObject<string>;
  retainedRecoverySaveRef: RefObject<RetainedRecoverySave | null>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  savePromiseRef: RefObject<Promise<unknown> | null>;
  generationRuntimeRef: RefObject<GenerationRuntime | null>;
  confirmedNonEmptyRef: RefObject<boolean>;
  emptyClearConflictRef: RefObject<boolean>;
  emptyOverwriteRejectedRef: RefObject<boolean>;
  recoverySaveConflictRef: RefObject<boolean>;
  viewportRef: RefObject<Viewport>;
  setSaveEpoch: Dispatch<SetStateAction<number>>;
  setSaveStatus: Dispatch<SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>;
  setSaveBlocked: Dispatch<SetStateAction<boolean>>;
  setSavedAt: Dispatch<SetStateAction<string>>;
  saveBlocked: boolean;
  submittingNodeId: string | null;
  audioMixInFlightRef: RefObject<boolean>;
  currentId: string | null;
  doc: unknown | null;
  applyingRef: RefObject<boolean>;
  blockInvalidDraft: (ids: string[]) => boolean;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  graph?: { allNodes: () => Node[] };
  groups?: CanvasGroup[];
  viewport?: Viewport;
  edges?: Edge[];
  applying?: boolean;
  saveEpoch?: number;
  rollbackPendingNodes?: (ids: Set<string>) => void;
  textNodes?: Node[];
  mediaNodes?: Node[];
  productNodes?: Node[];
  assetNodes?: Node[];
  refetch?: unknown;
  blockedByPendingCanvasReviewRef?: RefObject<() => boolean>;
}

export function useCanvasSave(host: CanvasSaveHost) {
  const {
    activeProjectRef,
    hydratedProjectRef,
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    groupsRef,
    edgesRef,
    draftErrorsRef,
    versionRef,
    lastSavedRef,
    retainedRecoverySaveRef,
    pendingNodeIdsRef,
    savePromiseRef,
    generationRuntimeRef,
    confirmedNonEmptyRef,
    emptyClearConflictRef,
    emptyOverwriteRejectedRef,
    recoverySaveConflictRef,
    viewportRef,
    setSaveEpoch,
    setSaveStatus,
    setSaveBlocked,
    setSavedAt,
    saveBlocked,
    submittingNodeId,
    audioMixInFlightRef,
    currentId,
    doc,
    applyingRef,
    blockInvalidDraft,
    showToast,
    graph,
    groups = [],
    viewport,
    edges = [],
    applying,
    saveEpoch,
    rollbackPendingNodes,
    textNodes,
    mediaNodes,
    productNodes,
    assetNodes,
    refetch,
    blockedByPendingCanvasReviewRef,
  } = host;

  const adoptCanvasConflictVersion = (error: unknown): boolean => {
    const recovered = readCanvasConflictVersion(error);
    if (recovered === undefined) return false;
    versionRef.current = recovered;
    return true;
  };

  const trackCanvasSave = <T,>(promise: Promise<T>): Promise<T> => {
    savePromiseRef.current = promise;
    const release = () => {
      if (savePromiseRef.current === promise) savePromiseRef.current = null;
    };
    promise.then(release, release);
    return promise;
  };

  const settleRetainedRecoverySave = (projectId: string, commandId: string, failure?: unknown): void => {
    const retained = retainedRecoverySaveRef.current;
    if (!retained || retained.projectId !== projectId || retained.commandId !== commandId) return;
    const definitiveRejection = failure !== undefined
      && isApiError(failure) && failure.status >= 400 && failure.status < 500;
    if (failure === undefined || definitiveRejection) retainedRecoverySaveRef.current = null;
  };

  const planRecoverySave = (
    projectId: string,
    signature: string,
    payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean },
  ): {
    recoveryFields: { commandId: string; recoveryChanges: RecoveryChange[] } | null;
    payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean };
    ifMatch: number | null;
    sentSignature: string;
  } => {
    const retained = retainedRecoverySaveRef.current;
    if (retained != null && retained.projectId === projectId) {
      return {
        recoveryFields: { commandId: retained.commandId, recoveryChanges: retained.recoveryChanges },
        payload: retained.payload,
        ifMatch: retained.version,
        sentSignature: retained.signature,
      };
    }
    if (retained != null) retainedRecoverySaveRef.current = null;
    const recoveryFields = generationRuntimeRef.current?.composeSaveFields() ?? null;
    if (recoveryFields != null) {
      retainedRecoverySaveRef.current = {
        projectId, commandId: recoveryFields.commandId, recoveryChanges: recoveryFields.recoveryChanges,
        payload, version: versionRef.current, signature,
      };
    }
    return { recoveryFields, payload, ifMatch: versionRef.current, sentSignature: signature };
  };

  const blockedByPendingCanvasReview = (): boolean => {
    if (emptyClearConflictRef.current) {
      showToast('warn', EMPTY_CLEAR_CONFLICT_TOAST);
      return true;
    }
    if (emptyOverwriteRejectedRef.current) {
      showToast('warn', EMPTY_OVERWRITE_REJECTED_TOAST);
      return true;
    }
    if (recoverySaveConflictRef.current) {
      showToast('warn', '画布保存冲突，当前内容已保留，请刷新后复核');
      return true;
    }
    return false;
  };

  const showCanvasSaveFailureToast = (e: unknown) => {
    if (emptyClearConflictRef.current) showToast('warn', EMPTY_CLEAR_CONFLICT_TOAST);
    else if (isApiError(e) && e.status === 422) showToast('warn', EMPTY_OVERWRITE_REJECTED_TOAST);
    else showToast('error', '保存失败，请重试');
  };

  const shouldConfirmEmptyClear = (nodes: Node[]): boolean =>
    nodes.length === 0 && confirmedNonEmptyRef.current;

  const registerConfirmedNonEmpty = (nodes: Node[]): void => {
    if (nodes.length > 0) confirmedNonEmptyRef.current = true;
  };

  const settleSavedCanvas = (
    plan: ReturnType<typeof planRecoverySave>,
    signature: string,
    settlePendingNodes: () => void,
  ): boolean => {
    registerConfirmedNonEmpty(plan.payload.nodes);
    lastSavedRef.current = plan.sentSignature;
    if (plan.sentSignature === signature) {
      settlePendingNodes();
      return true;
    }
    return false;
  };

  const flushCanvasSave = (projectId: string): Promise<boolean> => {
    const runFlush = async (): Promise<boolean> => {
      if (activeProjectRef.current !== projectId) return false;
      if (hydratedProjectRef.current === null) return false;
      if (blockInvalidDraft(textNodesRef.current.map(n => n.id))) return false;
      let persisted = false;
      for (;;) {
        const contentNodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
        const nodes = [...contentNodes, ...groupsRef.current.map((g) => groupToNode(g))];
        if (emptyClearConflictRef.current || emptyOverwriteRejectedRef.current || recoverySaveConflictRef.current) return false;
        const viewport = viewportRef.current;
        const signature = serializeNodes(nodes) + serializeEdges(edgesRef.current);
        if (signature === lastSavedRef.current && retainedRecoverySaveRef.current?.projectId !== projectId) break;
        const confirmEmpty = shouldConfirmEmptyClear(nodes);
        const plan = planRecoverySave(
          projectId, signature, { viewport, nodes, edges: edgesRef.current, confirmEmpty },
        );
        const { recoveryFields, payload: recoveryPayload } = plan;
        try {
          const saved = recoveryFields
            ? await putCanvasDocWithRecovery(
              projectId,
              recoveryPayload,
              plan.ifMatch,
              { recoveryProtocolVersion: 1, commandId: recoveryFields.commandId, recoveryChanges: recoveryFields.recoveryChanges },
            )
            : await saveCanvasDoc(projectId, { viewport, nodes, edges: edgesRef.current, confirmEmpty }, versionRef.current);
          if (recoveryFields) {
            generationRuntimeRef.current?.onSaveReceipt((saved as CanvasRecoverySaveData).recoveryReceipt);
            settleRetainedRecoverySave(projectId, recoveryFields.commandId);
          }
          if (activeProjectRef.current !== projectId) {
            setSaveEpoch((value) => value + 1);
            return false;
          }
          versionRef.current = saved.version;
          persisted = true;
          if (!settleSavedCanvas(plan, signature, () => { pendingNodeIdsRef.current.clear(); })) continue;
        } catch (error) {
          if (activeProjectRef.current !== projectId) {
            setSaveEpoch((value) => value + 1);
            throw error;
          }
          if (recoveryFields) settleRetainedRecoverySave(projectId, recoveryFields.commandId, error);
          const flushRecoveryReason = readRecoveryErrorReason(error);
          if (recoveryFields && flushRecoveryReason === 'recovery_item_conflict') {
            void generationRuntimeRef.current?.reconcileConflictItems(projectId);
            setSaveBlocked(true);
            setSaveStatus('error');
            throw error;
          }
          if (recoveryFields && flushRecoveryReason != null) {
            recoverySaveConflictRef.current = true;
            setSaveBlocked(true);
            setSaveStatus('error');
            throw error;
          }
          if (!recoveryFields && readRecoveryErrorReason(error) === 'recovery_protocol_required') {
            void generationRuntimeRef.current?.recover(projectId);
          }
          const aligned = adoptCanvasConflictVersion(error);
          if (aligned && confirmEmpty) {
            emptyClearConflictRef.current = true;
          }
          if (isApiError(error) && error.status === 422) {
            emptyOverwriteRejectedRef.current = true;
          }
          setSaveBlocked(true);
          setSaveStatus('error');
          throw error;
        }
        break;
      }
      if (!persisted) return true;
      setSaveBlocked(false);
      setSaveStatus('saved');
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      setSaveEpoch(value => value + 1);
      return true;
    };
    const previous = savePromiseRef.current;
    const queued = previous ? previous.then(runFlush, runFlush) : runFlush();
    trackCanvasSave(queued.then(() => undefined, () => undefined));
    return queued;
  };

  const handleRetryCanvasSave = async () => {
    if (!currentId || applyingRef.current) return;
    if (blockedByPendingCanvasReview()) return;
    applyingRef.current = true;
    setSaveStatus('saving');
    try {
      if (!(await flushCanvasSave(currentId))) setSaveStatus('error');
      else setSaveEpoch(value => value + 1);
    } catch (e) {
      setSaveStatus('error');
      showCanvasSaveFailureToast(e);
    } finally {
      applyingRef.current = false;
    }
  };

  const ensureSavedBeforeProjectSwitch = async (): Promise<boolean> => {
    if (submittingNodeId || audioMixInFlightRef.current) {
      showToast('warn', '正在保存并提交，请稍候');
      return false;
    }
    if (blockedByPendingCanvasReview()) return false;
    if (saveBlocked) {
      showToast('warn', '保存失败，请重试');
      return false;
    }
    if (!currentId || !doc) return true;
    const projectId = currentId;
    applyingRef.current = true;
    try {
      const saved = await flushCanvasSave(projectId);
      if (audioMixInFlightRef.current) {
        showToast('warn', '正在保存并提交，请稍候');
        return false;
      }
      return saved;
    } catch (e) {
      showCanvasSaveFailureToast(e);
      console.warn('项目切换前画布落盘失败:', e);
      return false;
    } finally {
      applyingRef.current = false;
    }
  };

  useEffect(() => {
    if (!graph || !rollbackPendingNodes || viewport == null) return;
    if (!currentId || !doc || applyingRef.current) return;
    const timer = window.setTimeout(() => {
      if (applyingRef.current || savePromiseRef.current) return;
      if (hydratedProjectRef.current === null) return;
      if (textNodesRef.current.some(node => draftErrorsRef.current.has(node.id))) return;
      const contentNodes = graph.allNodes();
      const nodes = [...contentNodes, ...groups.map((g) => groupToNode(g))];
      const sig = serializeNodes(nodes) + serializeEdges(edges);
      if (sig === lastSavedRef.current) return;
      if (emptyClearConflictRef.current || emptyOverwriteRejectedRef.current || recoverySaveConflictRef.current) return;
      if (import.meta.env.DEV) {
        console.info(`[canvas] 自动保存：${nodes.length} 个节点 / ${edges.length} 条连线（version=${versionRef.current}）`);
      }
      lastSavedRef.current = sig;
      setSaveStatus('saving');
      const confirmEmpty = shouldConfirmEmptyClear(nodes);
      const pendingSnapshot = new Set(pendingNodeIdsRef.current);
      const plan = planRecoverySave(
        currentId, sig, { viewport, nodes, edges, confirmEmpty },
      );
      const { recoveryFields, payload: recoveryPayload } = plan;
      trackCanvasSave(
        (recoveryFields
          ? putCanvasDocWithRecovery(
            currentId,
            recoveryPayload,
            plan.ifMatch,
            { recoveryProtocolVersion: 1, commandId: recoveryFields.commandId, recoveryChanges: recoveryFields.recoveryChanges },
          )
          : saveCanvasDoc(currentId, { viewport, nodes, edges, confirmEmpty }, versionRef.current)
        ).then((saved) => {
          if (recoveryFields) {
            generationRuntimeRef.current?.onSaveReceipt((saved as CanvasRecoverySaveData).recoveryReceipt);
            settleRetainedRecoverySave(currentId, recoveryFields.commandId);
          }
          return saved;
        })
          .then((saved) => {
            versionRef.current = saved.version;
            settleSavedCanvas(plan, sig, () => pendingSnapshot.forEach((id) => pendingNodeIdsRef.current.delete(id)));
            setSaveBlocked(false);
            setSaveStatus(textNodesRef.current.some(node => draftErrorsRef.current.has(node.id)) ? 'error' : 'saved');
            setSaveEpoch(value => value + 1);
            setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
          })
          .catch((e) => {
            lastSavedRef.current = '';
            if (recoveryFields) settleRetainedRecoverySave(currentId, recoveryFields.commandId, e);
            const hadPendingAdds = pendingSnapshot.size > 0 && plan.sentSignature === sig;
            const recoveryReason = readRecoveryErrorReason(e);
            if (recoveryFields && recoveryReason === 'recovery_item_conflict') {
              void generationRuntimeRef.current?.reconcileConflictItems(currentId);
              setSaveBlocked(true);
              setSaveStatus('error');
              showToast('warn', '任务状态已被其他操作更新，已同步最新状态，请重试保存');
              return;
            }
            if (recoveryFields && recoveryReason != null) {
              recoverySaveConflictRef.current = true;
              setSaveBlocked(true);
              setSaveStatus('error');
              showToast('warn', '画布保存冲突，当前内容已保留，请刷新后复核');
              return;
            }
            if (!recoveryFields && readRecoveryErrorReason(e) === 'recovery_protocol_required') {
              void generationRuntimeRef.current?.recover(currentId);
              setSaveBlocked(true);
              setSaveStatus('error');
              showToast('warn', '画布包含任务恢复保护内容，正在同步状态，请稍后重试保存');
              return;
            }
            const aligned = adoptCanvasConflictVersion(e);
            if (aligned) {
              if (confirmEmpty) {
                emptyClearConflictRef.current = true;
                showToast('warn', EMPTY_CLEAR_CONFLICT_TOAST);
              }
              setSaveBlocked(true);
              setSaveStatus('error');
              return;
            }
            setSaveBlocked(true);
            if (isApiError(e) && e.status === 412) {
              setSaveStatus('error');
              showToast('warn', '画布版本冲突，当前编辑已保留，请先复制正文再刷新复核');
            } else if (isApiError(e) && e.status === 422) {
              emptyOverwriteRejectedRef.current = true;
              setSaveStatus('error');
              showToast('warn', EMPTY_OVERWRITE_REJECTED_TOAST);
            } else {
              if (hadPendingAdds) rollbackPendingNodes(pendingSnapshot);
              setSaveStatus('error');
              showToast('error', hadPendingAdds ? '添加失败，请重试' : '保存失败，请重试');
              console.warn('画布自动保存失败:', e);
            }
          }),
      );
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textNodes, mediaNodes, productNodes, assetNodes, edges, groups, currentId, doc, refetch, applying, saveEpoch, rollbackPendingNodes, showToast, graph]);

  if (blockedByPendingCanvasReviewRef) {
    blockedByPendingCanvasReviewRef.current = blockedByPendingCanvasReview;
  }
  return {
    flushCanvasSave,
    handleRetryCanvasSave,
    ensureSavedBeforeProjectSwitch,
    blockedByPendingCanvasReview,
    showCanvasSaveFailureToast,
    shouldConfirmEmptyClear,
    registerConfirmedNonEmpty,
    planRecoverySave,
    trackCanvasSave,
    settleSavedCanvas,
    adoptCanvasConflictVersion,
    settleRetainedRecoverySave,
  };
}

import { isApiError, envelopeErrorCode } from '@/shared/api/http';
import type { JobDetail } from '@/custom/api/jobs';
import type { CanvasBinding } from '@/custom/api/canvasRecovery';
import type {
  GenerationTaskDefinition, SubmitOptions, TaskSubmissionInput, CreateJobOutcome,
} from './types';
import { seedTargetOfNode, seedSourcesOfNode } from './seedFacts';
import { TARGET_OUTPUT_KEY, type ActiveExecution, type RuntimeContext } from './runtimeState';

const STALE = Symbol('generation-submit-stale');

export function createActions(ctx: RuntimeContext, polling: { poll: (execution: ActiveExecution, jobId: string) => void; converge: (execution: ActiveExecution, jobId: string, detail: JobDetail) => void }) {
  const {
    host, doFetchJobStatus, active, ledger, nodeBindings, boundJobIds, deleting,
    retryAttempts, retryInFlight, submitAttempts, nextRound, newId, readMarker,
    defForNode, owns, recoveryItemIdOf, adoptBindingView, adoptConflictBindingRevision,
    queueSettleIntent,
  } = ctx;
  const { poll, converge } = polling;

  const submit = <TPayload,>(def: GenerationTaskDefinition<TPayload>, input: TaskSubmissionInput<TPayload>, options?: SubmitOptions): boolean => {
    const projectId = host.getProjectId();
    if (!projectId) return false;
    const target = input.target;
    if (!target) return false;
    const nodeId = target.targetNodeId;
    const existing = active.get(nodeId);
    if (existing && existing.phase === 'submitting') {
      if (!options?.replaceSubmitting) return false;
      submitAttempts.delete(nodeId);
      retryAttempts.delete(nodeId);
      retryInFlight.delete(nodeId);
    }
    const execution: ActiveExecution = {
      round: nextRound(), projectId, loadEpoch: host.getLoadEpoch(), nodeId,
      phase: 'submitting', targetRole: target.seedTarget.role, def,
    };
    host.setActiveJob(nodeId, execution.round);
    active.set(nodeId, execution);

    const signature = JSON.stringify(input.payload);
    const previousAttempt = submitAttempts.get(nodeId);
    const binding: CanvasBinding = previousAttempt && previousAttempt.signature === signature
      ? previousAttempt.binding
      : {
        protocol_version: 1,
        submission_id: newId(),
        target_node_id: target.targetNodeId,
        expected_binding_revision: Math.max(nodeBindings.get(nodeId) ?? 0, target.expectedBindingRevision),
        recovery_seed: structuredClone({ target: target.seedTarget, sources: target.seedSources }),
      };
    const key = binding.submission_id;
    submitAttempts.set(nodeId, { signature, binding });
    execution.targetRole = binding.recovery_seed.target.role;
    nodeBindings.set(nodeId, Math.max(nodeBindings.get(nodeId) ?? 0, target.expectedBindingRevision));

    const sendOnce = async (binding: CanvasBinding | null): Promise<CreateJobOutcome | null | typeof STALE> => {
      if (binding && binding.recovery_seed.target.role !== 'result-placeholder') {
        const saved = await host.saveCanvas(projectId).catch(() => false);
        if (!saved) return null;
        if (!owns(execution)) return STALE;
      }
      return def.create(projectId, input, binding, key, () => owns(execution));
    };
    const send = (): Promise<CreateJobOutcome | null | typeof STALE> => sendOnce(binding);
    send()
      .then(async (created) => {
        if (created === STALE) { options?.onStale?.({ nodeId }); return; }
        if (created === null) {
          throw Object.assign(new Error('画布保存失败，未提交生成任务'), { _skipped: true });
        }
        if (!owns(execution)) { options?.onStale?.({ nodeId }); return; }
        const view = created.canvasBinding ?? null;
        if (view && view.is_current === false) {
          active.delete(nodeId);
          host.clearActiveJob(nodeId);
          submitAttempts.delete(nodeId);
          options?.onStale?.({ nodeId });
          return;
        }
        if (view) {
          execution.submissionId = view.submission_id;
          adoptBindingView(view);
        }
        submitAttempts.delete(nodeId);
        execution.jobId = String(created.jobId);
        execution.phase = 'generating';
        host.patchNode(nodeId, { jobId: created.jobId });
        options?.onAccepted?.({ nodeId, jobId: String(created.jobId), submissionId: execution.submissionId ?? null });
        poll(execution, String(created.jobId));
      })
      .catch((e: unknown) => {
        if (!owns(execution)) { options?.onStale?.({ nodeId }); return; }
        host.openRechargeForCreditsError(e);
        const bindingConflict = adoptConflictBindingRevision(nodeId, e);
        active.delete(nodeId);
        if (bindingConflict) submitAttempts.delete(nodeId);
        if ((e as { _skipped?: boolean })._skipped) {
          host.toast('error', '画布保存失败，生成任务未提交，请重试保存后再发送');
          options?.onCreateFailure?.(e, { nodeId, target });
          options?.onStale?.({ nodeId });
          return;
        }
        const handled = options?.onCreateFailure?.(e, { nodeId, target });
        if (handled) return;
        if (host.findNode(nodeId) == null) return;
        host.patchNode(nodeId, {
          genStatus: 'failed',
          errorText: bindingConflict ? '卡片归属已变化，请复核后再发送' : (isApiError(e) ? e.message : '创建任务失败'),
          errorCode: isApiError(e) ? envelopeErrorCode(e) : undefined,
        });
      });
    return true;
  };

  const retry = (nodeId: string, options?: SubmitOptions): boolean => {
    const claimed = defForNode(nodeId);
    if (!claimed) return false;
    const { def, node } = claimed;
    const data = node.data ?? {};
    if (data.genStatus === 'generating' || data.genStatus === 'checking') return true;
    if (retryInFlight.has(nodeId)) return true;
    retryInFlight.add(nodeId);
    const jobIdRaw = data.jobId;
    const projectId = host.getProjectId();
    if (!projectId) { host.toast('warn', '未选中项目，无法重试'); return true; }
    const jobId = jobIdRaw == null ? '' : String(jobIdRaw);
    const frozen = def.frozenInput?.(nodeId, data);
    if (frozen === null) {
      host.toast('warn', '原任务输入已不可信，请重新编辑后再发送');
      return true;
    }
    if (!def.retry) {
      host.toast('warn', '该任务暂不支持失败重试，请重新发送');
      return true;
    }
    const marker = readMarker(data);
    const canBind = marker != null || (jobId !== '' && boundJobIds.has(jobId));
    const targetEntry = marker != null ? ledger.get(recoveryItemIdOf(marker.submissionId, TARGET_OUTPUT_KEY)) : undefined;
    const expectedRevision = nodeBindings.get(nodeId) ?? targetEntry?.nodeBindingRevision ?? 0;
    const previous = retryAttempts.get(nodeId);
    const sameIntent = previous != null && previous.jobId === jobId && previous.bound === canBind;
    const key = sameIntent ? previous.key : newId();
    const seedTarget = seedTargetOfNode(node);
    const binding = canBind
      ? (sameIntent && previous.binding != null ? previous.binding : {
        protocol_version: 1 as const,
        submission_id: key,
        target_node_id: nodeId,
        expected_binding_revision: expectedRevision,
        recovery_seed: { target: seedTarget, sources: seedSourcesOfNode(nodeId, host) },
      })
      : null;
    retryAttempts.set(nodeId, { jobId, key, bound: canBind, binding });
    const execution: ActiveExecution = {
      round: nextRound(), projectId, loadEpoch: host.getLoadEpoch(), nodeId,
      phase: 'submitting', targetRole: seedTarget.role, def,
    };
    host.setActiveJob(nodeId, execution.round);
    active.set(nodeId, execution);
    if (!options?.deferGeneratingUntilAccepted) {
      host.patchNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '', errorCode: undefined });
    }

    def.retry!(projectId, jobId, { nodeId, nodeData: data }, binding, key)
      .then((created) => {
        if (!owns(execution)) { options?.onStale?.({ nodeId }); return; }
        retryInFlight.delete(nodeId);
        retryAttempts.delete(nodeId);
        const view = created.canvasBinding ?? null;
        if (view && view.is_current === false) {
          active.delete(nodeId);
          host.clearActiveJob(nodeId);
          options?.onStale?.({ nodeId });
          return;
        }
        if (view) { execution.submissionId = view.submission_id; adoptBindingView(view); }
        execution.jobId = String(created.jobId);
        execution.phase = 'generating';
        host.patchNode(nodeId, {
          jobId: created.jobId,
          ...(options?.deferGeneratingUntilAccepted ? { genStatus: 'generating', progress: 0, errorText: '', errorCode: undefined } : {}),
        });
        options?.onAccepted?.({ nodeId, jobId: String(created.jobId), submissionId: execution.submissionId ?? null });
        poll(execution, String(created.jobId));
      })
      .catch((e: unknown) => {
        if (!owns(execution)) { options?.onStale?.({ nodeId }); return; }
        retryInFlight.delete(nodeId);
        active.delete(nodeId);
        const bindingConflict = adoptConflictBindingRevision(nodeId, e);
        if (bindingConflict) retryAttempts.delete(nodeId);
        const handled = options?.onCreateFailure?.(e, { nodeId });
        if (handled) return;
        if (host.openRechargeForCreditsError(e)) {
          host.patchNode(nodeId, {
            genStatus: 'failed',
            errorText: isApiError(e) ? e.message : '余额不足',
            errorCode: isApiError(e) ? envelopeErrorCode(e) : undefined,
          });
          return;
        }
        if (isApiError(e) && e.status === 401) {
          host.patchNode(nodeId, { genStatus: 'failed', errorText: '', errorCode: undefined });
          host.addAuthResume(() => { retry(nodeId); });
          return;
        }
        if (host.findNode(nodeId) == null) return;
        host.patchNode(nodeId, {
          genStatus: 'failed',
          errorText: bindingConflict ? '卡片归属已变化，请复核后再发送' : (isApiError(e) ? e.message : '重试失败'),
          errorCode: isApiError(e) ? envelopeErrorCode(e) : undefined,
        });
      });
    return true;
  };

  const cancel = (nodeId: string): boolean => {
    const claimed = defForNode(nodeId);
    if (!claimed) return false;
    const cancelMarker = readMarker(claimed.node.data);
    if (cancelMarker != null && cancelMarker.outputKey !== TARGET_OUTPUT_KEY) return true;
    const jobIdRaw = claimed.node.data?.jobId;
    if (jobIdRaw == null || !host.getProjectId() || !claimed.def.cancel) return true;
    const projectId = host.getProjectId()!;
    const jobId = String(jobIdRaw);
    const execution = ensureExecution(nodeId, claimed.def, jobId);
    claimed.def.cancel(projectId, jobId)
      .then(() => doFetchJobStatus(jobId).catch(() => null))
      .then((detail) => {
        if (!owns(execution, jobId)) return;
        if (detail && (detail.status === 'succeeded' || detail.status === 'failed')) {
          converge(execution, jobId, detail);
          return;
        }
        if (detail?.status === 'cancelled') {
          active.delete(nodeId);
          host.clearActiveJob(nodeId);
          host.settleCancelled(nodeId);
          queueSettleIntent(execution);
          return;
        }
        host.toast('warn', '取消已请求，正在等待任务停止');
      })
      .catch((e: unknown) => {
        host.toast('error', isApiError(e) ? `取消失败：${e.message}` : '取消失败，请稍后重试');
      });
    return true;
  };

  const remove = (nodeId: string): boolean => {
    const claimed = defForNode(nodeId);
    if (!claimed) return false;
    const claimedMarker = readMarker(claimed.node.data);
    if (claimedMarker != null && claimedMarker.outputKey !== TARGET_OUTPUT_KEY) {
      host.markLocallyRemoved(nodeId);
      ctx.noteRemovedOutput(nodeId, claimed.node.data);
      host.removeMediaNode(nodeId);
      return true;
    }
    const jobIdRaw = claimed.node.data?.jobId;
    if (jobIdRaw == null || !host.getProjectId() || !claimed.def.cancel) {
      ctx.noteRemovedOutput(nodeId, claimed.node.data);
      host.removeMediaNode(nodeId);
      return true;
    }
    const projectId = host.getProjectId()!;
    const jobId = String(jobIdRaw);
    if (deleting.has(nodeId)) return true;
    deleting.add(nodeId);
    const finish = () => { deleting.delete(nodeId); };
    const execution = ensureExecution(nodeId, claimed.def, jobId);
    const stopWithCompleted = (detail: JobDetail) => {
      converge(execution, jobId, detail);
      host.toast('warn', '任务已完成，已停止删除；如需删除请再次操作');
      finish();
    };
    const judge = (detail: JobDetail | null) => {
      if (!owns(execution, jobId)) { finish(); return; }
      if (detail?.status === 'succeeded') { stopWithCompleted(detail); return; }
      if (detail?.status === 'cancelled' || detail?.status === 'failed') {
        host.markLocallyRemoved(nodeId);
        ctx.noteRemovedOutput(nodeId, claimed.node.data);
        host.removeMediaNode(nodeId);
        finish();
        return;
      }
      host.registerPendingDelete(nodeId);
      finish();
    };
    claimed.def.cancel(projectId, jobId)
      .then(() => doFetchJobStatus(jobId).catch(() => null))
      .then(judge)
      .catch(async (e: unknown) => {
        const detail = await doFetchJobStatus(jobId).catch(() => null);
        if (detail?.status === 'succeeded' && owns(execution, jobId)) {
          stopWithCompleted(detail);
          return;
        }
        host.toast('error', isApiError(e) ? `取消失败，卡片已保留：${e.message}` : '取消失败，卡片已保留，请稍后重试');
        finish();
      });
    return true;
  };

  const ensureExecution = (nodeId: string, def: GenerationTaskDefinition, jobId: string): ActiveExecution => {
    const existing = active.get(nodeId);
    if (existing) {
      if (existing.def == null) existing.def = def;
      return existing;
    }
    const execution: ActiveExecution = {
      round: nextRound(),
      projectId: host.getProjectId()!,
      loadEpoch: host.getLoadEpoch(),
      nodeId, def, phase: 'generating', jobId,
      submissionId: readMarker(host.findNode(nodeId)?.data)?.submissionId,
    };
    host.setActiveJob(nodeId, execution.round);
    active.set(nodeId, execution);
    return execution;
  };

  return { submit, retry, cancel, remove };
}

import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import type { JobDetail } from '@/custom/api/jobs';
import {
  isJobInFlight, isRecoveryOutputIdentity, isRecoveryOutputOnCanvas, type GenerationTaskDefinition, type RecoveryRecordFacts,
} from './types';
import { TARGET_OUTPUT_KEY, type ActiveExecution, type RuntimeContext } from './runtimeState';

export function createRecovery(ctx: RuntimeContext, polling: { poll: (execution: ActiveExecution, jobId: string) => void; fanOutOutputs: (execution: ActiveExecution, submissionId: string, jobId: string, knownDetail?: JobDetail, knownRecord?: GenerationRecoveryRecord) => Promise<void> }) {
  const {
    host, doResolveItems, active, ledger, reconciledSubmissions, nodeBindings, boundJobIds,
    nextRound, readMarker, defForNode, defForRecord, owns, clearTimer, setLedger, removedOutputs,
  } = ctx;
  const { fanOutOutputs } = polling;

  let scanningEpoch: object | null = null;
  let scanningRun: Promise<void> | null = null;
  let failedEpoch: object | null = null;
  const recover = (projectId: string): Promise<void> => {
    const loadEpoch = host.getLoadEpoch();
    const isCurrentCanvasLoad = () => host.getProjectId() === projectId && host.getLoadEpoch() === loadEpoch;
    if (scanningEpoch === loadEpoch) return scanningRun ?? Promise.resolve();
    scanningEpoch = loadEpoch;
    const run = (async () => {
      try {
        let cursor: string | null = null;
        do {
          const page = await host.fetchRecoveryPage(projectId, { cursor });
          if (!isCurrentCanvasLoad()) return;
          for (const record of page.records) reconcileRecord(record);
          cursor = page.next_cursor;
        } while (cursor != null);
        failedEpoch = null;
      } catch (e) {
        if (isCurrentCanvasLoad()) failedEpoch = loadEpoch;
        console.warn('[generation-runtime] 恢复扫描失败（下轮水合重试）:', e);
      } finally {
        if (scanningEpoch === loadEpoch) scanningEpoch = null;
      }
    })();
    scanningRun = run;
    return run;
  };

  const isRecoverySettled = () => scanningEpoch == null && failedEpoch !== host.getLoadEpoch();

  const resumeFromRecord = (record: GenerationRecoveryRecord, def?: GenerationTaskDefinition) => {
    resumeFromHydration(record.target_node_id, record.job_id, undefined, {
      def, submissionId: record.submission_id,
    });
  };

  const reconcileRecord = (record: GenerationRecoveryRecord) => {
    const claiming = active.get(record.target_node_id);
    const currentRound = host.getActiveJob(record.target_node_id);
    const targetItem = record.items.find((item) => item.output_key === TARGET_OUTPUT_KEY);
    const ledgerOnly = host.isLocallyRemoved(record.target_node_id)
      || (claiming != null && currentRound != null && currentRound !== claiming.round)
      || (claiming != null && (!owns(claiming)
        || (!claiming.optimisticHydration && (claiming.jobId !== record.job_id
          || (claiming.submissionId != null && claiming.submissionId !== record.submission_id)))))
      || (nodeBindings.get(record.target_node_id) ?? 0)
        > (targetItem?.node_binding_revision ?? record.binding_revision);
    const appliedOnCanvas = (item: GenerationRecoveryRecord['items'][number]): boolean =>
      isRecoveryOutputOnCanvas(record, item, host.findNode(item.node_id));
    const explicitlyRemoved = (item: GenerationRecoveryRecord['items'][number]): boolean => {
      const removed = removedOutputs.get(item.node_id);
      return removed != null && isRecoveryOutputIdentity(record, item, removed.marker, removed.assetId);
    };
    for (const item of record.items) {
      if (item.asset_deleted === true
        && !(item.state === 'present' && (appliedOnCanvas(item) || explicitlyRemoved(item)))) continue;
      setLedger({
        recoveryItemId: item.recovery_item_id,
        submissionId: record.submission_id,
        outputKey: item.output_key,
        nodeId: item.node_id,
        state: item.state,
        revision: item.revision,
        nodeBindingRevision: item.node_binding_revision,
      });
    }
    boundJobIds.add(record.job_id);
    reconciledSubmissions.add(record.submission_id);
    if (targetItem && !ledgerOnly) nodeBindings.set(targetItem.node_id, targetItem.node_binding_revision);
    if (!record.is_current || ledgerOnly) return;
    const def = defForRecord(record);
    const plan = def?.planRecovery?.(record, host) ?? { kind: 'none' as const };
    switch (plan.kind) {
      case 'restore-target': {
        if (host.findNode(record.target_node_id) != null) break;
        host.insertMediaNode(plan.node);
        for (const edge of plan.edges ?? []) {
          host.addEdge(edge.source, edge.target, undefined, edge.origin ? { origin: edge.origin } : undefined);
        }
        const restoreProject = host.getProjectId();
        if (restoreProject) void host.saveCanvas(restoreProject).catch(() => {});
        if (def && isJobInFlight(record.job?.status)) resumeFromRecord(record, def);
        break;
      }
      case 'apply-outputs': {
        const entry = active.get(record.target_node_id);
        if (entry && entry.jobId === record.job_id && entry.submissionId === record.submission_id) break;
        void applyRecoveredOutputs(record);
        break;
      }
      case 'resume-polling': {
        resumeFromRecord(record, def);
        break;
      }
      case 'none':
      default:
        break;
    }
  };

  const applyRecoveredOutputs = async (record: GenerationRecoveryRecord) => {
    const projectId = host.getProjectId();
    if (!projectId) return;
    try {
      clearTimer(record.target_node_id);
      const execution: ActiveExecution = {
        round: nextRound(), projectId, loadEpoch: host.getLoadEpoch(),
        nodeId: record.target_node_id, def: defForRecord(record)!, phase: 'generating',
        jobId: record.job_id, submissionId: record.submission_id,
      };
      host.setActiveJob(record.target_node_id, execution.round);
      active.set(record.target_node_id, execution);
      if (host.findNode(record.target_node_id) == null) {
        const def = defForRecord(record);
        const plan = def?.planRecovery?.(record, host);
        if (plan?.kind === 'restore-target') host.insertMediaNode(plan.node);
      }
      await fanOutOutputs(execution, record.submission_id, record.job_id, undefined, record);
    } catch (e) {
      console.warn('[generation-runtime] 恢复输出应用失败:', e);
    }
  };

  const resumeFromHydration = (
    nodeId: string,
    jobId: string,
    nodeData?: Record<string, unknown>,
    known?: RecoveryRecordFacts,
  ) => {
    const defs = ctx.defs;
    const def = known?.def ?? (nodeData
      ? defs.find((candidate) => candidate.identify(nodeId, nodeData))
      : defForNode(nodeId)?.def);
    if (!def) return;
    const entry = active.get(nodeId);
    if (entry) {
      if (known == null && (nodeData != null || entry.jobId === jobId)) return;
      if (known != null && !entry.optimisticHydration) return;
      if (known != null && entry.jobId === jobId && entry.submissionId === known.submissionId) {
        entry.optimisticHydration = false;
        return;
      }
    }
    const execution: ActiveExecution = {
      round: nextRound(), projectId: host.getProjectId() ?? '', loadEpoch: host.getLoadEpoch(), nodeId,
      def, phase: 'generating', jobId, optimisticHydration: known == null,
      submissionId: known?.submissionId
        ?? readMarker(nodeData)?.submissionId
        ?? readMarker(host.findNode(nodeId)?.data)?.submissionId,
    };
    const node = host.findNode(nodeId);
    if (node != null && node.data?.jobId == null) host.patchNode(nodeId, { jobId });
    host.setActiveJob(nodeId, execution.round);
    active.set(nodeId, execution);
    polling.poll(execution, jobId);
  };

  const reconcileConflictItems = async (projectId: string): Promise<void> => {
    const loadEpoch = host.getLoadEpoch();
    const ids = [...ledger.keys()].filter((recoveryItemId) => {
      const entry = ledger.get(recoveryItemId);
      return entry && reconciledSubmissions.has(entry.submissionId)
        && entry.state !== 'replaced' && entry.state !== 'transferred';
    }).slice(0, 100);
    if (ids.length === 0) return;
    try {
      const resolved = await doResolveItems(projectId, ids);
      if (host.getProjectId() !== projectId || host.getLoadEpoch() !== loadEpoch) return;
      for (const record of resolved.records) reconcileRecord(record);
    } catch {
    }
  };

  return { recover, isRecoverySettled, resumeFromHydration, reconcileConflictItems };
}

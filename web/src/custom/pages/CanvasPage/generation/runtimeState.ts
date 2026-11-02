import { fetchJobStatus } from '@/custom/api/jobs';
import { isApiError } from '@/shared/api/http';
import {
  fetchGenerationRecoveryPage, resolveGenerationRecovery,
  type CanvasBinding, type GenerationRecoveryRecord,
} from '@/custom/api/canvasRecovery';
import { newIdempotencyKey } from '@/shared/api/idempotencyKey';
import { readMarker } from './types';
import type {
  GenerationRecoveryMarker, GenerationRuntimeHost, GenerationTaskDefinition,
  LedgerEntry, RuntimeNodeView,
} from './types';

export const TARGET_OUTPUT_KEY = '$target';
export const PRIMARY_OUTPUT_KEY = 'primary';

export interface GenerationRuntimeDeps {
  fetchJobStatus?: typeof fetchJobStatus;
  fetchRecoveryPage?: typeof fetchGenerationRecoveryPage;
  resolveItems?: typeof resolveGenerationRecovery;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  newId?: () => string;
}

export interface RemovedOutput {
  marker: GenerationRecoveryMarker;
  assetId: string | null;
}

export interface ActiveExecution {
  round: string;
  projectId: string;
  loadEpoch: object;
  nodeId: string;
  phase: 'submitting' | 'generating' | 'checking';
  jobId?: string;
  submissionId?: string;
  optimisticHydration?: boolean;
  targetRole?: 'draft' | 'existing-media' | 'result-placeholder';
  def?: GenerationTaskDefinition;
}

export type ExplicitIntent =
  | { kind: 'convert' }
  | { kind: 'settle' };

export interface RuntimeContext {
  host: GenerationRuntimeHost;
  doFetchJobStatus: typeof fetchJobStatus;
  doFetchRecoveryPage: typeof fetchGenerationRecoveryPage;
  doResolveItems: typeof resolveGenerationRecovery;
  schedule: (fn: () => void, ms: number) => unknown;
  unschedule: (id: unknown) => void;
  newId: () => string;
  defs: GenerationTaskDefinition[];
  active: Map<string, ActiveExecution>;
  timers: Map<string, unknown>;
  ledger: Map<string, LedgerEntry>;
  reconciledSubmissions: Set<string>;
  unavailableOutputItems: Set<string>;
  intents: Map<string, ExplicitIntent>;
  nodeBindings: Map<string, number>;
  boundJobIds: Set<string>;
  removedOutputs: Map<string, RemovedOutput>;
  noteRemovedOutput: (nodeId: string, nodeData: Record<string, unknown> | undefined) => void;
  deleting: Set<string>;
  retryAttempts: Map<string, { jobId: string; key: string; bound: boolean; binding: CanvasBinding | null }>;
  retryInFlight: Set<string>;
  submitAttempts: Map<string, { signature: string; binding: CanvasBinding }>;
  nextRound: () => string;
  recoveryItemIdOf: (submissionId: string, outputKey: string) => string;
  readMarker: (data: Record<string, unknown> | undefined) => GenerationRecoveryMarker | null;
  defForNode: (nodeId: string) => { def: GenerationTaskDefinition; node: RuntimeNodeView } | null;
  defForRecord: (record: GenerationRecoveryRecord) => GenerationTaskDefinition | undefined;
  owns: (execution: ActiveExecution, jobId?: string) => boolean;
  clearTimer: (nodeId: string) => void;
  setLedger: (entry: LedgerEntry) => void;
  adoptBindingView: (view: { submission_id: string; target_node_id: string; binding_revision: number; job_id: string }) => void;
  recoveryReason: (e: unknown) => string | null;
  adoptConflictBindingRevision: (nodeId: string, e: unknown) => boolean;
  queueSettleIntent: (execution: ActiveExecution) => void;
}

export function createContext(host: GenerationRuntimeHost, deps: GenerationRuntimeDeps = {}): RuntimeContext {
  const doFetchJobStatus = deps.fetchJobStatus ?? fetchJobStatus;
  const doFetchRecoveryPage = deps.fetchRecoveryPage ?? fetchGenerationRecoveryPage;
  const doResolveItems = deps.resolveItems ?? resolveGenerationRecovery;
  const schedule = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const unschedule = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>));
  const newId = deps.newId ?? newIdempotencyKey;

  const defs: GenerationTaskDefinition[] = [];
  const active = new Map<string, ActiveExecution>();
  const timers = new Map<string, unknown>();
  const ledger = new Map<string, LedgerEntry>();
  const reconciledSubmissions = new Set<string>();
  const unavailableOutputItems = new Set<string>();
  const intents = new Map<string, ExplicitIntent>();
  const nodeBindings = new Map<string, number>();
  const boundJobIds = new Set<string>();
  const removedOutputs = new Map<string, RemovedOutput>();
  const noteRemovedOutput = (nodeId: string, nodeData: Record<string, unknown> | undefined) => {
    const marker = readMarker(nodeData);
    if (marker == null) return;
    removedOutputs.set(nodeId, {
      marker,
      assetId: nodeData?.assetId == null ? null : String(nodeData.assetId),
    });
  };
  const deleting = new Set<string>();
  const retryAttempts = new Map<string, { jobId: string; key: string; bound: boolean; binding: CanvasBinding | null }>();
  const retryInFlight = new Set<string>();
  const submitAttempts = new Map<string, { signature: string; binding: CanvasBinding }>();
  let roundCounter = 0;
  const nextRound = () => `grt-${++roundCounter}-${newId().slice(0, 8)}`;

  const recoveryItemIdOf = (submissionId: string, outputKey: string) => `gcr:${submissionId}:${outputKey}`;
  const defForNode = (nodeId: string): { def: GenerationTaskDefinition; node: RuntimeNodeView } | null => {
    const node = host.findNode(nodeId);
    if (!node) return null;
    const def = defs.find((candidate) => candidate.identify(node.id, node.data ?? {}));
    return def ? { def, node } : null;
  };
  const defForRecord = (record: GenerationRecoveryRecord): GenerationTaskDefinition | undefined =>
    defs.find((candidate) => candidate.taskTypes.includes(record.task_type));
  const owns = (execution: ActiveExecution, jobId?: string): boolean => {
    if (execution.projectId !== '' && host.getProjectId() !== execution.projectId) return false;
    if (host.getLoadEpoch() !== execution.loadEpoch) return false;
    if (host.isLocallyRemoved(execution.nodeId)) return false;
    const entry = active.get(execution.nodeId);
    if (entry !== execution) return false;
    if (jobId !== undefined && entry.jobId !== undefined && entry.jobId !== jobId) return false;
    return true;
  };
  const clearTimer = (nodeId: string) => {
    const timer = timers.get(nodeId);
    if (timer !== undefined) {
      unschedule(timer);
      timers.delete(nodeId);
    }
  };
  const setLedger = (entry: LedgerEntry) => { ledger.set(entry.recoveryItemId, entry); };
  const adoptBindingView = (view: { submission_id: string; target_node_id: string; binding_revision: number; job_id: string }) => {
    nodeBindings.set(view.target_node_id, view.binding_revision);
    boundJobIds.add(String(view.job_id));
    reconciledSubmissions.add(view.submission_id);
    const adoptedMarker = readMarker(host.findNode(view.target_node_id)?.data);
    if (adoptedMarker !== null
      && (adoptedMarker.submissionId !== view.submission_id || adoptedMarker.outputKey !== TARGET_OUTPUT_KEY)) {
      host.patchNode(view.target_node_id, {
        generationRecovery: { protocolVersion: 1, submissionId: view.submission_id, outputKey: TARGET_OUTPUT_KEY },
      });
    }
    setLedger({
      recoveryItemId: recoveryItemIdOf(view.submission_id, TARGET_OUTPUT_KEY),
      submissionId: view.submission_id,
      outputKey: TARGET_OUTPUT_KEY,
      nodeId: view.target_node_id,
      state: 'pending',
      revision: 1,
      nodeBindingRevision: view.binding_revision,
    });
  };
  const recoveryReason = (e: unknown): string | null => {
    if (!isApiError(e) || typeof (e.data as { reason?: unknown } | null)?.reason !== 'string') return null;
    return (e.data as { reason: string }).reason;
  };
  const adoptConflictBindingRevision = (nodeId: string, e: unknown): boolean => {
    const bindingConflict = isApiError(e) && e.status === 409 && recoveryReason(e) === 'canvas_binding_conflict';
    if (!bindingConflict) return false;
    const current = (e.data as { currentBindingRevision?: unknown }).currentBindingRevision;
    if (typeof current === 'number' && current > (nodeBindings.get(nodeId) ?? 0)) {
      nodeBindings.set(nodeId, current);
    }
    return true;
  };

  const queueSettleIntent = (execution: ActiveExecution) => {
    if (host.findNode(execution.nodeId) == null || execution.submissionId == null) return;
    if (execution.targetRole !== 'draft' && execution.targetRole !== 'existing-media') return;
    intents.set(execution.submissionId, { kind: 'settle' });
  };

  return {
    host, doFetchJobStatus, doFetchRecoveryPage, doResolveItems, schedule, unschedule, newId,
    defs, active, timers, ledger, reconciledSubmissions, unavailableOutputItems, intents,
    nodeBindings, boundJobIds, removedOutputs, noteRemovedOutput, deleting, retryAttempts,
    retryInFlight, submitAttempts,
    nextRound, recoveryItemIdOf, readMarker, defForNode, defForRecord, owns, clearTimer,
    setLedger, adoptBindingView, recoveryReason, adoptConflictBindingRevision, queueSettleIntent,
  };
}

export function resetContext(ctx: RuntimeContext) {
  for (const timer of ctx.timers.values()) ctx.unschedule(timer);
  ctx.timers.clear();
  ctx.active.clear();
  ctx.ledger.clear();
  ctx.intents.clear();
  ctx.nodeBindings.clear();
  ctx.boundJobIds.clear();
  ctx.removedOutputs.clear();
  ctx.reconciledSubmissions.clear();
  ctx.unavailableOutputItems.clear();
  ctx.deleting.clear();
  ctx.retryAttempts.clear();
  ctx.retryInFlight.clear();
  ctx.submitAttempts.clear();
}

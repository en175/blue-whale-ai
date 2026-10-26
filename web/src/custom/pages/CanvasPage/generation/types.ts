import type {
  CanvasBinding, GenerationRecoveryItem, GenerationRecoveryPage, GenerationRecoveryRecord,
} from '@/custom/api/canvasRecovery';
import type { JobDetail } from '@/custom/api/jobs';

export interface RuntimeNodeView {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  data: Record<string, unknown>;
}

export function isJobInFlight(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'processing' || status === 'checking';
}

export function isRecoveryTargetSettled(target: RuntimeNodeView, record: GenerationRecoveryRecord): boolean {
  const marker = readMarker(target.data);
  return marker != null && marker.submissionId === record.submission_id
    && (marker.outputKey !== '$target'
      || (target.data?.genStatus === 'failed' && String(target.data?.jobId) === record.job_id));
}

export function isRecoveryTargetRestorable(record: GenerationRecoveryRecord): boolean {
  const targetItem = record.items.find((item) => item.output_key === '$target');
  return targetItem == null || targetItem.state === 'pending' || targetItem.state === 'present';
}

export interface GenerationRecoveryMarker {
  protocolVersion: 1;
  submissionId: string;
  outputKey: string;
}

export function isRecoveryOutputIdentity(
  record: GenerationRecoveryRecord,
  item: GenerationRecoveryItem,
  marker: GenerationRecoveryMarker | null,
  assetId: string | null,
): boolean {
  return marker != null && marker.submissionId === record.submission_id && marker.outputKey === item.output_key
    && (item.asset_id == null || assetId === item.asset_id);
}

export function isRecoveryOutputOnCanvas(
  record: GenerationRecoveryRecord,
  item: GenerationRecoveryItem,
  node: RuntimeNodeView | null,
): boolean {
  return isRecoveryOutputIdentity(
    record, item, readMarker(node?.data), node?.data.assetId == null ? null : String(node.data.assetId),
  );
}

export function readMarker(data: Record<string, unknown> | undefined): GenerationRecoveryMarker | null {
  const marker = data?.generationRecovery;
  if (marker == null || typeof marker !== 'object') return null;
  const { protocolVersion, submissionId, outputKey } = marker as Record<string, unknown>;
  if (protocolVersion !== 1 || typeof submissionId !== 'string' || typeof outputKey !== 'string') return null;
  return { protocolVersion: 1, submissionId, outputKey };
}

export interface RecoverySeedTarget {
  role: 'draft' | 'existing-media' | 'result-placeholder';
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

export interface RecoverySeedSource {
  node_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

export interface BindingTargetFacts {
  targetNodeId: string;
  seedTarget: RecoverySeedTarget;
  seedSources: RecoverySeedSource[];
  expectedBindingRevision: number;
}

export interface CreateJobOutcome {
  jobId: string;
  cursor?: number;
  canvasBinding?: {
    protocol_version: number;
    submission_id: string;
    target_node_id: string;
    binding_revision: number;
    job_id: string;
    is_current: boolean;
  } | null;
}

export type SuccessProjection =
  | { kind: 'one-to-one' }
  | { kind: 'multi-output'; outputs: Array<{ outputKey: string; nodeId: string; assetId: string; url: string; mediaType: 'image' | 'video' | 'audio' }> }
  | { kind: 'keep-target' };

export interface SuccessContext {
  nodeId: string;
  jobId: string;
  detail: JobDetail;
  marker: GenerationRecoveryMarker | null;
}

export interface TaskSubmissionInput<TPayload = unknown> {
  payload: TPayload;
  target?: BindingTargetFacts;
}

export interface GenerationTaskDefinition<TPayload = unknown> {
  readonly taskTypes: readonly string[];
  identify(nodeId: string, nodeData: Record<string, unknown>): boolean;
  frozenInput?(nodeId: string, nodeData: Record<string, unknown>): unknown | null;
  create(projectId: string, input: TaskSubmissionInput<TPayload>, binding: CanvasBinding | null, key: string, ownsExecution?: () => boolean): Promise<CreateJobOutcome>;
  retry?(projectId: string, jobId: string, ctx: { nodeId: string; nodeData: Record<string, unknown> }, binding: CanvasBinding | null, key: string): Promise<CreateJobOutcome>;
  cancel?(projectId: string, jobId: string): Promise<unknown>;
  planRecovery?(record: GenerationRecoveryRecord, host: GenerationRuntimeHost): RecoveryCardPlan;
  isMultiOutputSuccess?(detail: JobDetail): boolean;
  planFanoutCards?(ctx: FanoutContext): FanoutCardPlan;
}

export interface FanoutContext {
  jobId: string;
  submissionId: string;
  anchor: RuntimeNodeView | null;
  host: GenerationRuntimeHost;
  outputs: FanoutOutputView[];
  detail: JobDetail;
}

export interface FanoutOutputView {
  outputKey: string;
  nodeId: string;
  assetId: string | null;
  url: string;
  mediaType: 'image' | 'video' | 'audio';
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

export interface FanoutCardPlan {
  nodes: Array<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; origin?: string }>;
}

export type RecoveryCardPlan =
  | { kind: 'restore-target'; node: RuntimeNodeView; edges?: Array<{ source: string; target: string; origin?: string }> }
  | { kind: 'apply-outputs'; projection: Extract<SuccessProjection, { kind: 'multi-output' }>; unavailableTarget?: RuntimeNodeView }
  | { kind: 'resume-polling' }
  | { kind: 'none' };

export interface GenerationRuntimeHost {
  getProjectId(): string | null;
  getLoadEpoch(): object;
  getMediaNodes(): RuntimeNodeView[];
  findNode(nodeId: string): RuntimeNodeView | null;
  patchNode(nodeId: string, patch: Record<string, unknown>): void;
  insertMediaNode(node: RuntimeNodeView): void;
  removeMediaNode(nodeId: string): void;
  getEdges(): Array<{ source: string; target: string }>;
  addEdge(source: string, target: string, role?: unknown, marker?: Record<string, unknown>): void;
  getActiveJob(nodeId: string): string | undefined;
  setActiveJob(nodeId: string, token: string): void;
  clearActiveJob(nodeId: string): void;
  isLocallyRemoved(nodeId: string): boolean;
  markLocallyRemoved(nodeId: string): void;
  registerPendingDelete(nodeId: string): void;
  isPendingDelete(nodeId: string): boolean;
  applyTerminal(nodeId: string, jobId: string, detail: JobDetail): 'terminal' | 'processing';
  settleCancelled(nodeId: string): void;
  saveCanvas(projectId: string): Promise<boolean>;
  fetchRecoveryPage(
    projectId: string,
    options: { limit?: number; cursor?: string | null },
  ): Promise<GenerationRecoveryPage>;
  toast(kind: 'success' | 'warn' | 'error', message: string): void;
  openRechargeForCreditsError(e: unknown): boolean;
  addAuthResume(fn: () => void): void;
  rememberAsset(asset: unknown, fallbackType: 'image' | 'video' | 'audio'): void;
}

export interface InFlightTaskState {
  phase: 'submitting' | 'generating' | 'checking';
  jobId?: string;
  submissionId?: string;
}

export interface LedgerEntry {
  recoveryItemId: string;
  submissionId: string;
  outputKey: string;
  nodeId: string;
  state: GenerationRecoveryItem['state'];
  revision: number;
  nodeBindingRevision?: number;
}

export interface RecoveryRecordFacts {
  def?: GenerationTaskDefinition;
  submissionId?: string;
}

export interface GenerationRuntime {
  register(def: GenerationTaskDefinition): void;
  claims(nodeId: string, nodeData: Record<string, unknown>): boolean;
  submit<TPayload>(def: GenerationTaskDefinition<TPayload>, input: TaskSubmissionInput<TPayload>, options?: SubmitOptions): boolean;
  retry(nodeId: string, options?: SubmitOptions): boolean;
  cancel(nodeId: string): boolean;
  remove(nodeId: string): boolean;
  noteRemovedOutput(nodeId: string, nodeData: Record<string, unknown> | undefined): void;
  markLocallyRemoved(nodeId: string): void;
  recover(projectId: string): Promise<void>;
  isRecoverySettled(): boolean;
  resumeFromHydration(
    nodeId: string, jobId: string, nodeData?: Record<string, unknown>,
    known?: RecoveryRecordFacts,
  ): void;
  statusOf(nodeId: string): InFlightTaskState | null;
  bindingRevisionOf(nodeId: string): number;
  composeSaveFields(): { commandId: string; recoveryChanges: import('@/custom/api/canvasRecovery').RecoveryChange[] } | null;
  onSaveReceipt(receipt: { commandId: string; replayed: boolean; changes: Array<{ recoveryItemId: string; revision: number; nodeBindingRevision: number; state: string }> }): void;
  reconcileConflictItems(projectId: string): Promise<void>;
  reset(): void;
}

export interface SubmitOptions {
  replaceSubmitting?: boolean;
  deferGeneratingUntilAccepted?: boolean;
  onCreateFailure?(e: unknown, ctx: { nodeId: string; target?: BindingTargetFacts }): boolean;
  onAccepted?(ctx: { nodeId: string; jobId: string; submissionId: string | null }): void;
  onStale?(ctx: { nodeId: string }): void;
}

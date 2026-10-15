import { vi } from 'vitest';
import { canvasBindingSchema } from '@lib/contracts/canvas-recovery';
import { ApiError } from '@/shared/api/http';
import { retryAudioMix, retryAudioVideoMux, type JobDetail } from '@/app/api/jobs';
import type { GenerationRecoveryRecord } from '@/app/api/canvasRecovery';
import { createGenerationRuntime, type GenerationRuntimeDeps } from './runtime';
import { audioMixTask, audioVideoMuxTask } from './mixMuxTasks';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

export const NODE_ID = 'audio-mix-501';
export const SRC_ID = 'audio-source-1';
export const MUX_NODE_ID = 'mux-node-601';
export const SID_A = '12345678-0000-4000-8000-000000000001';
export const SID_M = '12345678-0000-4000-8000-00000000000a';
export const SID_B = '12345678-0000-4000-8000-000000000002';
export const SID_C = '12345678-0000-4000-8000-000000000003';
export const MIX_SEED = { role: 'result-placeholder' as const, x: 5, y: 6, width: 320, height: 320, name: '混合结果.mp3' };
const MUX_SEED = { role: 'draft' as const, x: 15, y: 16, width: 320, height: 320, name: '合成结果.mp4' };

export const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

export const conflict = (revision: number) => new ApiError(409, '归属已变化', 409, {
  reason: 'canvas_binding_conflict', currentBindingRevision: revision,
});

export const bindingView = (submissionId: string, nodeId: string, jobId: string, revision: number) => ({
  protocol_version: 1 as const, submission_id: submissionId, target_node_id: nodeId,
  binding_revision: revision, job_id: jobId, is_current: true,
});

export const mixRecord = (revision = 1, jobId = '501'): GenerationRecoveryRecord => ({
  submission_id: SID_A, target_node_id: NODE_ID, job_id: jobId, task_type: 'audio_mix',
  binding_revision: revision, is_current: true,
  job: { job_id: jobId, type: 'audio_mix', status: 'failed', progress: 0, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
  recovery_seed: { target: MIX_SEED, sources: [] }, previous_target_snapshot: null,
  items: [{ recovery_item_id: `gcr:${SID_A}:$target`, output_key: '$target', node_id: NODE_ID,
    state: 'pending', revision: 1, node_binding_revision: revision, asset_id: null, slot_id: null }],
});

const muxRecord = (revision = 1): GenerationRecoveryRecord => ({
  submission_id: SID_M, target_node_id: MUX_NODE_ID, job_id: '601', task_type: 'audio_video_mux',
  binding_revision: revision, is_current: true,
  job: { job_id: '601', type: 'audio_video_mux', status: 'failed', progress: 0, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
  recovery_seed: { target: MUX_SEED, sources: [] }, previous_target_snapshot: null,
  items: [{ recovery_item_id: `gcr:${SID_M}:$target`, output_key: '$target', node_id: MUX_NODE_ID,
    state: 'pending', revision: 1, node_binding_revision: revision, asset_id: null, slot_id: null }],
});

export function createControlledHost(overrides: {
  getProjectId: GenerationRuntimeHost['getProjectId'];
  getLoadEpoch: GenerationRuntimeHost['getLoadEpoch'];
  fetchRecoveryPage: GenerationRuntimeHost['fetchRecoveryPage'];
  patchNode?: GenerationRuntimeHost['patchNode'];
  applyTerminal?: GenerationRuntimeHost['applyTerminal'];
  saveCanvas?: GenerationRuntimeHost['saveCanvas'];
  edges?: Array<{ source: string; target: string }>;
}) {
  const nodes = new Map<string, RuntimeNodeView>();
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  const authResume: Array<() => void> = [];
  const host: GenerationRuntimeHost = {
    getProjectId: overrides.getProjectId, getLoadEpoch: overrides.getLoadEpoch,
    getMediaNodes: () => [...nodes.values()], findNode: (id) => nodes.get(id) ?? null,
    patchNode: overrides.patchNode ?? ((id, patch) => { const node = nodes.get(id); if (node) nodes.set(id, { ...node, data: { ...node.data, ...patch } }); }),
    insertMediaNode: (node) => { nodes.set(node.id, node); }, removeMediaNode: (id) => { nodes.delete(id); },
    getEdges: () => overrides.edges ?? [], addEdge: () => {},
    getActiveJob: (id) => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); }, clearActiveJob: (id) => { owners.delete(id); },
    isLocallyRemoved: (id) => removed.has(id), markLocallyRemoved: (id) => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: overrides.applyTerminal ?? ((id, _jobId, detail) => { host.patchNode(id, { genStatus: detail.status }); return 'terminal'; }),
    settleCancelled: () => {}, saveCanvas: overrides.saveCanvas ?? (async () => true),
    fetchRecoveryPage: overrides.fetchRecoveryPage,
    toast: () => {}, openRechargeForCreditsError: () => false,
    addAuthResume: (resume) => { authResume.push(resume); }, rememberAsset: () => {},
  };
  return { host, nodes, owners, removed, authResume };
}

export function createHarnessRuntime(host: GenerationRuntimeHost, options: {
  fetchJobStatus?: GenerationRuntimeDeps['fetchJobStatus'];
  deps?: GenerationRuntimeDeps;
} = {}) {
  const fetchJobStatus = vi.fn(options.fetchJobStatus
    ?? (async (jobId: string | number): Promise<JobDetail> => ({ job_id: String(jobId), status: 'processing', progress: 1, asset: null })));
  let nextId = SID_B;
  const runtime = createGenerationRuntime(host, {
    ...options.deps, fetchJobStatus, newId: () => nextId, setTimeout: () => 1, clearTimeout: () => {},
  });
  runtime.register(audioMixTask);
  runtime.register(audioVideoMuxTask);
  return { runtime, fetchJobStatus, nextSubmission: () => { nextId = SID_C; } };
}

export function setupRecoveryScenario(options: {
  revision?: number;
  withSourceWire?: boolean;
  muxAsDraft?: boolean;
} = {}) {
  const { revision = 1, withSourceWire = false, muxAsDraft = false } = options;
  let epoch = {};
  const { host, nodes, owners, authResume } = createControlledHost({
    getProjectId: () => '1', getLoadEpoch: () => epoch,
    edges: withSourceWire ? [{ source: SRC_ID, target: NODE_ID }] : undefined,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 3, records: [mixRecord(revision), muxRecord(revision)], next_cursor: null }),
  });
  nodes.set(NODE_ID, { id: NODE_ID, type: 'mediaNode', position: { x: 5, y: 6 },
    data: { jobId: '501', mediaType: 'audio', genStatus: 'failed', fileName: '用户改名.mp3',
      generationRecovery: { protocolVersion: 1, submissionId: SID_A, outputKey: '$target' } } });
  nodes.set(MUX_NODE_ID, { id: MUX_NODE_ID, type: 'mediaNode', position: { x: 15, y: 16 },
    data: { jobId: '601', mediaType: 'video', genStatus: 'failed', fileName: '合成草稿.mp4',
      ...(muxAsDraft ? { draft: true } : {}),
      audioVideoMux: { sourceNodeId: SRC_ID, sourceAssetId: '111', reserveAudio: true, sync: 'none' },
      generationRecovery: { protocolVersion: 1, submissionId: SID_M, outputKey: '$target' } } });
  if (withSourceWire) {
    nodes.set(SRC_ID, { id: SRC_ID, type: 'mediaNode', position: { x: 1, y: 2 },
      data: { assetId: '111', mediaType: 'audio', fileName: '原声.mp3', width: 300, height: 80 } });
  }
  const { runtime, fetchJobStatus, nextSubmission } = createHarnessRuntime(host);
  return {
    runtime, host, nodes, owners, authResume, fetchJobStatus,
    reload: () => { epoch = {}; },
    nextSubmission,
    retryCall: (index: number) => {
      const [projectId, jobId, key, , binding] = vi.mocked(retryAudioMix).mock.calls[index]!;
      return { projectId, jobId, key, binding: canvasBindingSchema.parse(binding) };
    },
    muxRetryCall: (index: number) => {
      const [projectId, jobId, key, , binding] = vi.mocked(retryAudioVideoMux).mock.calls[index]!;
      return { projectId, jobId, key, binding: canvasBindingSchema.parse(binding) };
    },
  };
}

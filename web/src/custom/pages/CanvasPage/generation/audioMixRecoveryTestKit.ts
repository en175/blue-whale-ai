import { expect, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { createAudioMix, type JobDetail } from '@/custom/api/jobs';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import { createGenerationRuntime } from './runtime';
import { audioMixTask, staleMixSubmitError, watchMixSubmit } from './mixMuxTasks';
import { seedSourcesOfNode } from './seedFacts';
import { createAudioMixSession, type AudioMixHost } from '../tools/compound/compoundToolSessions';
import { createToolSessionRuntime } from '../tool-runtime/toolSessionRuntime';
import type { ToolSessionDeps } from '../tool-runtime/toolSessionCoordinator';
import { buildAudioMixPlaceholderNode, findAudioMixPosition } from '../tools/audio/audioMix';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

export const DEPS: ToolSessionDeps = { dismissGenPanels() {}, selectNode() {} };
export const flush = async (rounds = 30) => { for (let i = 0; i < rounds; i += 1) await Promise.resolve(); };

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export const bindingView = (submissionId: string, nodeId: string, jobId: string, revision = 1, isCurrent = true) => ({
  protocol_version: 1 as const, submission_id: submissionId, target_node_id: nodeId,
  binding_revision: revision, job_id: jobId, is_current: isCurrent,
});
export type MixCreateResult = Awaited<ReturnType<typeof createAudioMix>>;
export const mixCreated = (jobId: string, view: ReturnType<typeof bindingView>): MixCreateResult =>
  ({ job_id: jobId, status: 'queued', canvas_binding: view });

const readCreateRequest = ([projectId, body, options]: Parameters<typeof createAudioMix>) => {
  const parsed = audioMixCreateSchema.parse(body);
  const binding = parsed.canvas_binding!;
  expect(options?.idempotencyKey).toBe(binding.submission_id);
  return { projectId, payload: parsed, binding };
};

type FakeEdge = { id: string; source: string; target: string; data?: Record<string, unknown> };

export function setupAudioMixRecovery(options: {
  reuseUnacceptedCard: boolean;
  edgeOrigin?: string;
  rollbackOnFailure: boolean;
  terminalPatch: (detail: JobDetail) => Record<string, unknown> | null;
}) {
  const nodeNamespace = crypto.randomUUID();
  const requestNodeIds = new Set<string>();
  const nodes = new Map<string, Node>([
    ['audio-a', {
      id: 'audio-a', type: 'mediaNode', position: { x: 0, y: 0 },
      data: { mediaType: 'audio', assetId: '11', src: 'https://assets/a.mp3', fileName: '原音频A.mp3' },
    }],
    ['audio-b', {
      id: 'audio-b', type: 'mediaNode', position: { x: 0, y: 400 },
      data: { mediaType: 'audio', assetId: '22', src: 'https://assets/b.mp3', fileName: '原音频B.mp3' },
    }],
  ]);
  let edges: FakeEdge[] = [];
  const project: string | null = 'p1';
  let epoch = {};
  let inFlight = false;
  let nodeSeq = 0;
  let submitCard: { projectId: string; payload: string; nodeId: string; accepted: boolean } | null = null;
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];
  const toasts: string[] = [];
  const recoveryRecords: GenerationRecoveryRecord[] = [];
  const patch = (id: string, data: Record<string, unknown>) => {
    const node = nodes.get(id);
    if (node) nodes.set(id, { ...node, data: { ...node.data, ...data } });
  };
  const genHost: GenerationRuntimeHost = {
    getProjectId: () => project, getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()] as unknown as RuntimeNodeView[],
    findNode: (id) => (nodes.get(id) as unknown as RuntimeNodeView | undefined) ?? null,
    patchNode: (id, data) => patch(id, data),
    insertMediaNode: (node) => { nodes.set(node.id, node as unknown as Node); },
    removeMediaNode: (id) => { nodes.delete(id); },
    getEdges: () => edges.map((edge) => ({ source: edge.source, target: edge.target })),
    addEdge: (source, target, _role, marker) => {
      edges = [...edges, { id: `e-${source}-${target}`, source, target, ...(marker ? { data: marker } : {}) }];
    },
    getActiveJob: (id) => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); },
    clearActiveJob: (id) => { owners.delete(id); },
    isLocallyRemoved: (id) => removed.has(id), markLocallyRemoved: (id) => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: (id, _jobId, detail) => {
      const terminalPatch = options.terminalPatch(detail);
      if (terminalPatch) patch(id, terminalPatch);
      return 'terminal';
    },
    settleCancelled: () => {},
    saveCanvas: async () => true,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 2, records: recoveryRecords, next_cursor: null }),
    toast: (kind, message) => { toasts.push(`${kind}:${message}`); },
    openRechargeForCreditsError: () => false, addAuthResume: () => {}, rememberAsset: () => {},
  };
  const fetchJobStatus = vi.fn(async (jobId: string | number): Promise<JobDetail> =>
    ({ job_id: String(jobId), status: 'processing', progress: 40, asset: null }));
  const timers = new Map<number, () => void>();
  let timerSeq = 0;
  const runtime = createGenerationRuntime(genHost, {
    fetchJobStatus,
    newId: () => crypto.randomUUID(),
    setTimeout: (callback) => { const id = ++timerSeq; timers.set(id, callback); return id; },
    clearTimeout: (id) => { if (typeof id === 'number') timers.delete(id); },
  });
  runtime.register(audioMixTask);

  const mixHost: AudioMixHost = {
    getProjectId: () => project,
    getNode: (id) => nodes.get(id),
    isInFlight: () => inFlight, setInFlight: (value) => { inFlight = value; },
    canApply: (projectId) => project === projectId,
    linkAssets: async () => {},
    createTask: async ({ projectId, payload, source }) => {
      const submitEpoch = epoch;
      const payloadText = JSON.stringify(payload);
      const previousCard = submitCard;
      const nodeId = options.reuseUnacceptedCard && previousCard && previousCard.projectId === projectId
        && previousCard.payload === payloadText && !previousCard.accepted
        ? previousCard.nodeId
        : `audio-mix-${nodeNamespace}-${++nodeSeq}`;
      requestNodeIds.add(nodeId);
      submitCard = { projectId, payload: payloadText, nodeId, accepted: false };
      const position = findAudioMixPosition(source, [...nodes.values()]);
      if (!nodes.has(nodeId)) nodes.set(nodeId, buildAudioMixPlaceholderNode(nodeId, payload.output_format, position));
      for (const input of payload.inputs) {
        if (input.node_id && input.node_id !== nodeId && nodes.has(input.node_id)
          && !edges.some((edge) => edge.source === input.node_id && edge.target === nodeId)) {
          edges = [...edges, {
            id: `e-${input.node_id}-${nodeId}`, source: input.node_id, target: nodeId,
            ...(options.edgeOrigin ? { data: { origin: options.edgeOrigin } } : {}),
          }];
        }
      }
      const rollbackPlaceholder = () => {
        if (!options.rollbackOnFailure) return;
        if (project !== projectId) return;
        if (epoch !== submitEpoch) return;
        const current = nodes.get(nodeId);
        if (!current || (current.data as { jobId?: unknown } | undefined)?.jobId != null) return;
        if (runtime.statusOf(nodeId) != null) return;
        nodes.delete(nodeId);
        edges = edges.filter((edge) => !(edge.target === nodeId && edge.data?.origin === options.edgeOrigin));
      };
      return await new Promise<{ job_id: string }>((resolve, reject) => {
        const unwatch = watchMixSubmit(nodeId, {
          accepted: (jobId) => {
            const entry = submitCard;
            if (entry?.nodeId === nodeId) submitCard = { ...entry, accepted: true };
            unwatch();
            resolve({ job_id: jobId });
          },
          failed: (error) => { unwatch(); reject(error); },
        });
        const issued = runtime.submit(
          audioMixTask,
          {
            payload,
            target: {
              targetNodeId: nodeId,
              seedTarget: {
                role: 'result-placeholder', x: position.x, y: position.y,
                width: 480, height: 284, name: `混合结果.${payload.output_format}`,
              },
              seedSources: seedSourcesOfNode(nodeId, genHost),
              expectedBindingRevision: runtime.bindingRevisionOf(nodeId),
            },
          },
          {
            onCreateFailure: () => { rollbackPlaceholder(); return true; },
            onStale: () => { unwatch(); rollbackPlaceholder(); reject(staleMixSubmitError()); },
          },
        );
        if (!issued) { unwatch(); rollbackPlaceholder(); reject(new Error('音频混合任务未受理，请重试')); }
      });
    },
    handoff: async (_input, _task, context) => { context.exitForSubmission(); },
    warn: (message) => { warnings.push(message); },
    error: (message) => { errors.push(message); },
  };
  const sessionRuntime = createToolSessionRuntime();
  const mix = sessionRuntime.register(createAudioMixSession(() => mixHost));
  const openWithInput = () => {
    expect(mix.open('audio-a', DEPS)).toBe(true);
    mix.edit((state) => ({ ...state, selectedInputs: [{ assetId: '22', nodeId: 'audio-b', name: '原音频B.mp3' }] }));
  };
  return {
    runtime, mix, nodes, errors, warnings, toasts, recoveryRecords, fetchJobStatus, openWithInput, mixCreated, bindingView,
    host: genHost,
    advancePolling: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback()); },
    createRequest: (index: number) => readCreateRequest(vi.mocked(createAudioMix).mock.calls
      .filter(([, body]) => requestNodeIds.has(body.canvas_binding?.target_node_id ?? ''))[index]!),
    edges: () => edges,
    inFlight: () => inFlight,
    drawEdge: (source: string, target: string) => {
      edges = [...edges, { id: `e-${source}-${target}`, source, target }];
    },
    reload: () => { epoch = {}; runtime.reset(); },
    dropFromHydration: (nodeId: string) => {
      nodes.delete(nodeId);
      edges = edges.filter((edge) => edge.target !== nodeId && edge.source !== nodeId);
    },
  };
}

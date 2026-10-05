/* ============================================
 * 音频混合恢复测试共同构造（IKJQ06）：真实请求 Schema 与双层画布/会话宿主。
 * 每次构造独立节点、连线、归属、响应与锁；撤回、身份复用及终态差异由场景声明。
 * ============================================ */
import { expect, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { createAudioMix, type JobDetail } from '@/api/jobs';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { createGenerationRuntime } from './runtime';
import { audioMixTask, staleMixSubmitError, watchMixSubmit } from './mixMuxTasks';
import { seedSourcesOfNode } from './seedFacts';
import { createAudioMixSession, type AudioMixHost } from '../compoundToolSessions';
import { createToolSessionRuntime } from '../toolSessionRuntime';
import type { ToolSessionDeps } from '../toolSessionCoordinator';
import { buildAudioMixPlaceholderNode, findAudioMixPosition } from '../audioMix';
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

/** 受理回执前的真实请求读取：真实 Schema 校验 + 幂等键 = submission_id 口径核对。 */
const readCreateRequest = (index: number) => {
  const [projectId, body, options] = vi.mocked(createAudioMix).mock.calls[index]!;
  const parsed = audioMixCreateSchema.parse(body);
  const binding = parsed.canvas_binding!;
  expect(options?.idempotencyKey).toBe(binding.submission_id);
  return { projectId, payload: parsed, binding };
};

type FakeEdge = { id: string; source: string; target: string; data?: Record<string, unknown> };

/** 画布 + 双层宿主（生成运行时宿主 + 会话宿主共享同一节点/连线表），桥复刻 CanvasPage。 */
export function setupAudioMixRecovery(options: {
  reuseUnacceptedCard: boolean;
  edgeOrigin?: string;
  rollbackOnFailure: boolean;
  terminalPatch: (detail: JobDetail) => Record<string, unknown> | null;
}) {
  const requestOffset = vi.mocked(createAudioMix).mock.calls.length;
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
  let project: string | null = 'p1';
  let epoch = {};
  let inFlight = false;
  let idSeq = 0;
  let nodeSeq = 0;
  /** audioMixSubmitCardRef：页面 ref，同项目文档重载（存活页面）后仍存活。 */
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
  const runtime = createGenerationRuntime(genHost, {
    fetchJobStatus,
    newId: () => `12345678-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`,
    setTimeout: () => 1, clearTimeout: () => {},
  });
  runtime.register(audioMixTask);

  // 页面桥同款（index.tsx audioMix.createTask/handoff）：占位身份复用 + 占位卡预建 +
  // 场景指定的来源线标记 + watcher 桥 + runtime.submit。
  const mixHost: AudioMixHost = {
    getProjectId: () => project,
    getNode: (id) => nodes.get(id),
    isInFlight: () => inFlight, setInFlight: (value) => { inFlight = value; },
    canApply: (projectId) => project === projectId,
    linkAssets: async () => {},
    createTask: async ({ projectId, payload, source }) => {
      const submitEpoch = epoch; // 页面桥同款：提交时加载身份（docLoadEpochRef 快照）
      const payloadText = JSON.stringify(payload);
      const previousCard = submitCard;
      const nodeId = options.reuseUnacceptedCard && previousCard && previousCard.projectId === projectId
        && previousCard.payload === payloadText && !previousCard.accepted
        ? previousCard.nodeId
        : `audio-mix-t${++nodeSeq}`;
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
      // 页面桥同款（修复后 index.tsx）：撤回前归属核对——项目/加载身份未变、同 id 卡
      // 仍是未受理占位形态（无 jobId）、公开运行时无执行接管；连线只删本次提交经
      // 场景指定标记建的来源边。
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
    createRequest: (index: number) => readCreateRequest(requestOffset + index),
    edges: () => edges,
    inFlight: () => inFlight,
    /** 用户拖线建的可靠来源边（无提交标记）。 */
    drawEdge: (source: string, target: string) => {
      edges = [...edges, { id: `e-${source}-${target}`, source, target }];
    },
    /** 同项目文档重载：加载身份推进 + 运行时重置；画布内容由水合结果决定。 */
    reload: () => { epoch = {}; runtime.reset(); },
    /** 水合结果无此卡（占位未随保存落盘）：连同其连线一并缺席。 */
    dropFromHydration: (nodeId: string) => {
      nodes.delete(nodeId);
      edges = edges.filter((edge) => edge.target !== nodeId && edge.source !== nodeId);
    },
  };
}


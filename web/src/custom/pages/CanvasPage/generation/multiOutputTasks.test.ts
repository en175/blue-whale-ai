import { describe, expect, it, vi, beforeEach } from 'vitest';

type CreatedWithBindingView = { job_id: string; status: string; canvas_binding?: unknown };
const apiMocks = vi.hoisted(() => ({
  createVideoSceneSplit: vi.fn(async (): Promise<CreatedWithBindingView> => ({ job_id: 'sj1', status: 'queued' })),
  createVocalSplit: vi.fn(async (): Promise<CreatedWithBindingView> => ({ job_id: 'vj1', status: 'queued' })),
  cancelGenerationJob: vi.fn(async () => null),
  fetchJobStatus: vi.fn(),
}));

vi.mock('@/custom/api/jobs', () => ({
  createVideoSceneSplit: apiMocks.createVideoSceneSplit,
  createVocalSplit: apiMocks.createVocalSplit,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  isApiError: vi.fn(() => false),
}));
vi.mock('@/shared/api/idempotencyKey', () => ({ newIdempotencyKey: vi.fn(() => 'fresh-token') }));

import {
  sceneSplitTask, vocalSplitTask, isSceneSplitCard, isVocalSplitCard,
  type SceneSplitTaskPayload,
} from './multiOutputTasks';
import { isNormalGenerationCard } from './normalGeneration';
import { createGenerationRuntime } from './runtime';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';
import type { GenerationRecoveryPage, GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';

const SUBMISSION = '11111111-1111-4111-8111-111111111111';
const BINDING = {
  protocol_version: 1 as const,
  submission_id: SUBMISSION,
  target_node_id: 'ph-1',
  expected_binding_revision: 0,
  recovery_seed: {
    target: { role: 'result-placeholder' as const, x: 1, y: 2, width: 320, height: 320, name: '卡' },
    sources: [],
  },
};
const BINDING_VIEW = {
  protocol_version: 1,
  submission_id: SUBMISSION,
  target_node_id: 'ph-1',
  binding_revision: 1,
  job_id: 'sj1',
  is_current: true,
};

describe('多结果家族：身份识别', () => {
  it('占位卡：sceneSplit 身份 / vocal-split- 前缀（或 vocalSplit 身份）各自归族', () => {
    expect(isSceneSplitCard('scene-split-1', { sceneSplit: { sourceAssetId: '5', lastInput: {} } })).toBe(true);
    expect(isVocalSplitCard('vocal-split-9', { jobId: '9' })).toBe(true);
    expect(isVocalSplitCard('n1', { vocalSplit: { sourceAssetId: '5', lastInput: {} } })).toBe(true);
  });

  it('规范结果卡：generation-result: 前缀按 marker outputKey 分派（segment:/track:）', () => {
    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    const trackId = `generation-result:${SUBMISSION}:track:voice`;
    expect(isSceneSplitCard(segmentId, { generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' } })).toBe(true);
    expect(isVocalSplitCard(trackId, { generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'track:voice' } })).toBe(true);
    expect(isVocalSplitCard(segmentId, { generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' } })).toBe(false);
    expect(isSceneSplitCard(trackId, { generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'track:voice' } })).toBe(false);
    expect(isSceneSplitCard(segmentId, {})).toBe(false);
    expect(isVocalSplitCard(trackId, {})).toBe(false);
  });

  it('普通生成不认领规范结果卡（marker 归多结果家族）；旧轨卡（vocal-track-*）保持历史口径归普通生成', () => {
    const segmentId = `generation-result:${SUBMISSION}:segment:2`;
    expect(isNormalGenerationCard(segmentId, { jobId: 'j1', generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:2' } })).toBe(false);
    expect(isNormalGenerationCard('vocal-track-9-voice', { jobId: '9' })).toBe(true);
  });

  it('无身份占位卡（未受理提交中）不误认普通卡', () => {
    expect(isSceneSplitCard('n1', { jobId: 'j1' })).toBe(false);
    expect(isVocalSplitCard('n1', { jobId: 'j1' })).toBe(false);
  });
});

describe('多结果家族：创建/重试/冻结输入', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('场景切分创建：binding 时 client_token = submission_id 且 target_node_id 对齐；历史兼容另生成 token', async () => {
    await sceneSplitTask.create('p1', { payload: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard' } }, BINDING, SUBMISSION);
    expect(apiMocks.createVideoSceneSplit).toHaveBeenCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard',
      client_token: SUBMISSION, canvas_binding: BINDING,
    }, { silent: true });

    await sceneSplitTask.create('p1', { payload: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'fine' } }, null, 'ignored-key');
    expect(apiMocks.createVideoSceneSplit).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'ph-1', granularity: 'fine', client_token: 'fresh-token',
    }, { silent: true });
  });

  it('人声分离创建：canvas_binding 注入业务载荷 + Idempotency-Key 头 = submission_id', async () => {
    await vocalSplitTask.create('p1', { payload: { source_asset_id: '5', scene: 'drama', output_format: 'flac' } }, BINDING, SUBMISSION);
    expect(apiMocks.createVocalSplit).toHaveBeenCalledWith('p1', {
      source_asset_id: '5', scene: 'drama', output_format: 'flac', canvas_binding: BINDING,
    }, { silent: true, idempotencyKey: SUBMISSION });
    await vocalSplitTask.create('p1', { payload: { source_asset_id: '5', scene: 'audio', output_format: 'aac' } }, null, 'k');
    expect(apiMocks.createVocalSplit).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', scene: 'audio', output_format: 'aac',
    }, { silent: true });
  });

  it('失败卡重试按 identity.lastInput 原参数重发；无身份（恢复补卡）不可信返回 null', async () => {
    const lastInput = { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'coarse' as const };
    await sceneSplitTask.retry!('p1', 'sj1', { nodeId: 'ph-1', nodeData: { sceneSplit: { sourceAssetId: '5', lastInput } } }, BINDING, SUBMISSION);
    expect(apiMocks.createVideoSceneSplit).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'ph-1', granularity: 'coarse',
      client_token: SUBMISSION, canvas_binding: BINDING,
    }, { silent: true });

    expect(sceneSplitTask.frozenInput!('ph-1', {})).toBeNull();
    expect(sceneSplitTask.frozenInput!('ph-1', { sceneSplit: { sourceAssetId: '5', lastInput } })).toEqual(lastInput);
    expect(vocalSplitTask.frozenInput!('ph-1', {})).toBeNull();
  });

  it('取消走通用 generation-jobs cancel 端点', async () => {
    await sceneSplitTask.cancel!('p1', 'sj1');
    await vocalSplitTask.cancel!('p1', 'vj1');
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'sj1');
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'vj1');
  });
});

describe('多结果家族：成功判定与恢复规划', () => {
  const hostOf = (ids: string[]): GenerationRuntimeHost => ({
    findNode: (id: string) => (ids.includes(id) ? { id, type: 'mediaNode', position: { x: 0, y: 0 }, data: {} } : null),
  } as unknown as GenerationRuntimeHost);

  const record = (overrides: Partial<GenerationRecoveryRecord> = {}): GenerationRecoveryRecord => ({
    submission_id: SUBMISSION, target_node_id: 'ph-1', job_id: 'sj1', task_type: 'video_scene_split',
    binding_revision: 1, is_current: true,
    job: { job_id: 'sj1', type: 'video_scene_split', status: 'processing', progress: 10, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: { target: { role: 'result-placeholder', x: 5, y: 6, width: 320, height: 320, name: '场景切分 · 标准' }, sources: [{ node_id: 'v1', x: 0, y: 0, width: 320, height: 320, name: '源视频' }] },
    previous_target_snapshot: null,
    items: [{ recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'ph-1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
    ...overrides,
  });

  it('isMultiOutputSuccess：场景切分 1 段仍为多结果（不落入一对一 primary）；result 缺失走投影路径', () => {
    expect(sceneSplitTask.isMultiOutputSuccess!({ result: { duration: 10, segments: [{ segment_index: 1, start_time: 0, end_time: 10, segment_asset_id: 'a1' }] } } as never)).toBe(true);
    expect(sceneSplitTask.isMultiOutputSuccess!({ result: null } as never)).toBe(true);
    expect(vocalSplitTask.isMultiOutputSuccess!({ tracks: null } as never)).toBe(true);
    expect(vocalSplitTask.isMultiOutputSuccess!({ tracks: [{ track_type: 'voice', asset_id: '1', url: 'u', duration: 1 }] } as never)).toBe(true);
  });

  it('planRecovery：进行中卡缺失补占位卡（种子几何 + 在场来源线）；卡在续轮询', () => {
    const plan = sceneSplitTask.planRecovery!(record(), hostOf(['v1']));
    expect(plan.kind).toBe('restore-target');
    if (plan.kind !== 'restore-target') return;
    expect(plan.node).toMatchObject({ id: 'ph-1', position: { x: 5, y: 6 } });
    expect(plan.node.data).toMatchObject({ genStatus: 'generating', jobId: 'sj1', mediaType: 'video', fileName: '场景切分 · 标准' });
    expect(plan.edges).toEqual([{ source: 'v1', target: 'ph-1', origin: 'scene-split' }]);
    expect(sceneSplitTask.planRecovery!(record(), hostOf(['ph-1']))).toEqual({ kind: 'resume-polling' });
  });

  it('planRecovery：succeeded 且有未应用输出 → apply-outputs 投影（track:/segment: 规范身份）', () => {
    const plan = vocalSplitTask.planRecovery!(record({
      task_type: 'vocal_split', job_id: 'vj1',
      job: { job_id: 'vj1', type: 'vocal_split', status: 'succeeded', progress: 100, output_asset_ids: ['11', '12'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [
        { recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'ph-1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
        { recovery_item_id: `gcr:${SUBMISSION}:track:voice`, output_key: 'track:voice', node_id: `generation-result:${SUBMISSION}:track:voice`, state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '11', slot_id: null },
        { recovery_item_id: `gcr:${SUBMISSION}:track:background`, output_key: 'track:background', node_id: `generation-result:${SUBMISSION}:track:background`, state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '12', slot_id: null },
      ],
    }), hostOf(['ph-1']));
    expect(plan).toMatchObject({ kind: 'apply-outputs' });
    if (plan.kind !== 'apply-outputs') return;
    expect(plan.projection.outputs).toEqual([
      { outputKey: 'track:voice', nodeId: `generation-result:${SUBMISSION}:track:voice`, assetId: '11', url: '', mediaType: 'audio' },
      { outputKey: 'track:background', nodeId: `generation-result:${SUBMISSION}:track:background`, assetId: '12', url: '', mediaType: 'audio' },
    ]);
  });

  it('planRecovery：present 且画布已有匹配标记与素材不再回填；明确软删项不进入投影，全删即不动作', () => {
    const segmentId = (index: number) => `generation-result:${SUBMISSION}:segment:${index}`;
    const succeeded = {
      job_id: 'sj1', type: 'video_scene_split', status: 'succeeded', progress: 100,
      output_asset_ids: ['11', '12'], stored_error: null, created_at: '2026-10-01T00:00:00Z',
    };
    const targetItem = { recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'ph-1',
      state: 'present' as const, revision: 2, node_binding_revision: 1, asset_id: null, slot_id: null };
    const outputItem = (index: number, assetId: string, assetDeleted: boolean | null = null) => ({
      recovery_item_id: `gcr:${SUBMISSION}:segment:${index}`, output_key: `segment:${index}`,
      node_id: segmentId(index), state: 'present' as const, revision: 1, node_binding_revision: 1,
      asset_id: assetId, asset_deleted: assetDeleted, slot_id: null,
    });
    const host = (nodes: Record<string, Record<string, unknown>>) => {
      const fake = createFakeHost();
      for (const [id, data] of Object.entries(nodes)) {
        fake.nodes.set(id, { id, type: 'mediaNode', position: { x: 0, y: 0 }, data });
      }
      return fake.host;
    };
    const marker = (index: number) => ({ generationRecovery: {
      protocolVersion: 1, submissionId: SUBMISSION, outputKey: `segment:${index}` } });

    expect(sceneSplitTask.planRecovery!(record({ job: succeeded, items: [targetItem, outputItem(1, '11')] }),
      host({ 'ph-1': {}, [segmentId(1)]: { ...marker(1), assetId: '11' } }))).toEqual({ kind: 'none' });

    expect(sceneSplitTask.planRecovery!(record({ job: succeeded, items: [targetItem, outputItem(1, '8127', true)] }),
      host({ 'ph-1': {} }))).toEqual({ kind: 'none' });

    const mixed = sceneSplitTask.planRecovery!(record({ job: succeeded,
      items: [targetItem, outputItem(1, '8127', true), outputItem(2, '12')] }), host({ 'ph-1': {} }));
    expect(mixed).toMatchObject({ kind: 'apply-outputs' });
    if (mixed.kind !== 'apply-outputs') return;
    expect(mixed.projection.outputs).toEqual([
      { outputKey: 'segment:2', nodeId: segmentId(2), assetId: '12', url: '', mediaType: 'video' },
    ]);
  });

  it('planRecovery：标记一致但卡片素材与可信值不同 → 仍按可信值回填（不误判已落地）', () => {
    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    const succeeded = {
      job_id: 'sj1', type: 'video_scene_split', status: 'succeeded', progress: 100,
      output_asset_ids: ['8215'], stored_error: null, created_at: '2026-10-01T00:00:00Z',
    };
    const fake = createFakeHost();
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} });
    fake.nodes.set(segmentId, { id: segmentId, type: 'mediaNode', position: { x: 0, y: 0 }, data: {
      assetId: '9999',
      generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' },
    } });
    const plan = sceneSplitTask.planRecovery!(record({ job: succeeded, items: [
      { recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'ph-1',
        state: 'present', revision: 2, node_binding_revision: 1, asset_id: null, slot_id: null },
      { recovery_item_id: `gcr:${SUBMISSION}:segment:1`, output_key: 'segment:1', node_id: segmentId,
        state: 'present', revision: 1, node_binding_revision: 1, asset_id: '8215', asset_deleted: false, slot_id: null },
    ] }), fake.host);
    expect(plan).toMatchObject({ kind: 'apply-outputs' });
    if (plan.kind !== 'apply-outputs') return;
    expect(plan.projection.outputs).toEqual([
      { outputKey: 'segment:1', nodeId: segmentId, assetId: '8215', url: '', mediaType: 'video' },
    ]);
  });

  it('planRecovery：失败且卡缺失补失败卡（恢复卡无业务参数，重试提示重新编辑）', () => {
    const plan = sceneSplitTask.planRecovery!(record({
      job: { job_id: 'sj1', type: 'video_scene_split', status: 'failed', progress: 0, output_asset_ids: [], stored_error: { code: 1, msg: '切分失败' }, created_at: '2026-10-01T00:00:00Z' },
    }), hostOf([]));
    expect(plan.kind).toBe('restore-target');
    if (plan.kind !== 'restore-target') return;
    expect(plan.node.data).toMatchObject({ genStatus: 'failed', errorText: '切分失败' });
  });

  it('planRecovery：失败但目标恢复项已被删除（removed）→ 不补卡', () => {
    const plan = sceneSplitTask.planRecovery!(record({
      job: { job_id: 'sj1', type: 'video_scene_split', status: 'failed', progress: 0, output_asset_ids: [], stored_error: { code: 1, msg: '切分失败' }, created_at: '2026-10-01T00:00:00Z' },
      items: [
        { recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'ph-1', state: 'removed', revision: 8, node_binding_revision: 1, asset_id: null, slot_id: null },
      ],
    }), hostOf([]));
    expect(plan).toEqual({ kind: 'none' });
  });
});

describe('多结果家族：扇出落卡（既有排列规则）', () => {
  const hostOf = (nodes: RuntimeNodeView[], edges: Array<{ source: string; target: string }> = []): GenerationRuntimeHost => ({
    getEdges: () => edges,
    findNode: (id: string) => nodes.find((n) => n.id === id) ?? null,
    getMediaNodes: () => nodes,
  } as unknown as GenerationRuntimeHost);

  it('场景切分：段卡「第 N 段 起止时间」命名 + 段资产宽高 + jobId（来源线 Handle）+ 源卡来源边', () => {
    const placeholder: RuntimeNodeView = { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 }, data: { fileName: '场景切分 · 标准', mediaType: 'video' } };
    const source: RuntimeNodeView = { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { fileName: '源视频', mediaType: 'video', width: 1920, height: 1080 } };
    const host = hostOf([placeholder, source], [{ source: 'v1', target: 'ph-1' }]);
    const plan = sceneSplitTask.planFanoutCards!({
      jobId: 'sj1', submissionId: SUBMISSION, anchor: placeholder, host,
      outputs: [
        { outputKey: 'segment:1', nodeId: `generation-result:${SUBMISSION}:segment:1`, assetId: 'a1', url: 'http://t/1.mp4', mediaType: 'video', width: 1280, height: 720 },
        { outputKey: 'segment:2', nodeId: `generation-result:${SUBMISSION}:segment:2`, assetId: 'a2', url: 'http://t/2.mp4', mediaType: 'video', width: 1280, height: 720 },
      ],
      detail: {
        result: {
          duration: 30,
          segments: [
            { segment_index: 1, start_time: 0, end_time: 15.4, segment_asset_id: 'a1' },
            { segment_index: 2, start_time: 15.4, end_time: 30, segment_asset_id: 'a2' },
          ],
        },
      } as never,
    });
    expect(plan.nodes.map((node) => node.id)).toEqual([`generation-result:${SUBMISSION}:segment:1`, `generation-result:${SUBMISSION}:segment:2`]);
    expect(plan.nodes[0]!.data).toMatchObject({ fileName: '第 1 段 00:00-00:15', mediaType: 'video', width: 1280, height: 720, jobId: 'sj1' });
    expect(plan.nodes[1]!.data).toMatchObject({ fileName: '第 2 段 00:15-00:30' });
    expect(plan.nodes[1]!.position.x).toBeGreaterThan(plan.nodes[0]!.position.x);
    expect(plan.edges).toEqual([
      { source: 'v1', target: `generation-result:${SUBMISSION}:segment:1`, origin: 'scene-split' },
      { source: 'v1', target: `generation-result:${SUBMISSION}:segment:2`, origin: 'scene-split' },
    ]);
  });

  it('人声分离：轨卡「源名(轨词).格式」命名 + 纵向步长（内容区高 240 + 间距 60）+ 不带 jobId', () => {
    const placeholder: RuntimeNodeView = {
      id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 },
      data: { fileName: '素材视频(人声背景分离)', vocalSplit: { sourceAssetId: '5', lastInput: { source_asset_id: '5', scene: 'drama', output_format: 'flac' } } },
    };
    const source: RuntimeNodeView = { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { fileName: '素材视频.mp4', mediaType: 'video' } };
    const host = hostOf([placeholder, source], [{ source: 'v1', target: 'ph-1' }]);
    const plan = vocalSplitTask.planFanoutCards!({
      jobId: 'vj1', submissionId: SUBMISSION, anchor: placeholder, host,
      outputs: [
        { outputKey: 'track:voice', nodeId: `generation-result:${SUBMISSION}:track:voice`, assetId: 't1', url: 'http://t/v.flac', mediaType: 'audio', duration: 8 },
        { outputKey: 'track:music', nodeId: `generation-result:${SUBMISSION}:track:music`, assetId: 't2', url: 'http://t/m.flac', mediaType: 'audio', duration: 8 },
      ],
      detail: {} as never,
    });
    expect(plan.nodes[0]!.data).toMatchObject({ fileName: '素材视频(人声).flac', mediaType: 'audio', progress: 100, duration: 8 });
    expect(plan.nodes[1]!.data).toMatchObject({ fileName: '素材视频(音乐).flac' });
    expect('jobId' in plan.nodes[0]!.data).toBe(false);
    expect(plan.nodes[0]!.position).toEqual({ x: 958, y: 0 });
    expect(plan.nodes[1]!.position).toEqual({ x: 958, y: 300 });
    expect(plan.edges).toEqual([
      { source: 'v1', target: `generation-result:${SUBMISSION}:track:voice`, origin: 'vocal-split' },
      { source: 'v1', target: `generation-result:${SUBMISSION}:track:music`, origin: 'vocal-split' },
    ]);
  });
});


interface FakeHost {
  host: GenerationRuntimeHost;
  nodes: Map<string, RuntimeNodeView>;
  edges: Array<{ source: string; target: string }>;
  inserts: RuntimeNodeView[];
  removes: string[];
  toasts: string[];
  saves: number;
}

function createFakeHost(): FakeHost {
  const nodes = new Map<string, RuntimeNodeView>();
  const edges: Array<{ source: string; target: string }> = [];
  const inserts: RuntimeNodeView[] = [];
  const removes: string[] = [];
  const toasts: string[] = [];
  const counters = { saves: 0 };
  const loadEpoch = {};
  const host: GenerationRuntimeHost = {
    getProjectId: () => 'p1',
    getLoadEpoch: () => loadEpoch,
    getMediaNodes: () => [...nodes.values()],
    findNode: (id) => nodes.get(id) ?? null,
    patchNode: (nodeId, patch) => {
      const node = nodes.get(nodeId);
      if (node) nodes.set(nodeId, { ...node, data: { ...node.data, ...patch } });
    },
    insertMediaNode: (node) => { inserts.push(node); nodes.set(node.id, node); },
    removeMediaNode: (nodeId) => { removes.push(nodeId); nodes.delete(nodeId); },
    getEdges: () => edges,
    addEdge: (source, target) => { edges.push({ source, target }); },
    getActiveJob: () => undefined,
    setActiveJob: () => {},
    clearActiveJob: () => {},
    isLocallyRemoved: () => false,
    markLocallyRemoved: () => {},
    registerPendingDelete: () => {},
    isPendingDelete: () => false,
    applyTerminal: () => 'terminal',
    settleCancelled: () => {},
    saveCanvas: async () => { counters.saves += 1; return true; },
    toast: (kind, message) => { toasts.push(`${kind}:${message}`); },
    openRechargeForCreditsError: () => false,
    addAuthResume: () => {},
    rememberAsset: () => {},
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  };
  return { host, nodes, edges, inserts, removes, toasts, get saves() { return counters.saves; } };
}

const flushMicrotasks = async (rounds = 16) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

const oneSegmentDetail = () => ({
  job_id: 'sj1', status: 'succeeded', progress: 100, asset: null,
  output_assets: [{ id: 'a1', url: 'http://t/1.mp4', type: 'video' }],
  result: { duration: 10, segments: [{ segment_index: 1, start_time: 0, end_time: 10, segment_asset_id: 'a1' }] },
});

const oneSegmentPage = (): GenerationRecoveryPage => ({
  protocol_version: 1, canvas_version: 1, next_cursor: null,
  records: [{
    submission_id: SUBMISSION, target_node_id: 'ph-1', job_id: 'sj1', task_type: 'video_scene_split',
    binding_revision: 1, is_current: true,
    job: { job_id: 'sj1', type: 'video_scene_split', status: 'succeeded', progress: 100, output_asset_ids: ['a1'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: { target: { role: 'result-placeholder', x: 958, y: 0, width: 320, height: 320, name: '场景切分 · 标准' }, sources: [] },
    previous_target_snapshot: null,
    items: [
      { recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'ph-1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
      { recovery_item_id: `gcr:${SUBMISSION}:segment:1`, output_key: 'segment:1', node_id: `generation-result:${SUBMISSION}:segment:1`, state: 'pending', revision: 0, node_binding_revision: 0, asset_id: 'a1', slot_id: null },
    ],
  }],
});

function setupRuntime(fake: FakeHost, statusScript: Array<Record<string, unknown>>, page: GenerationRecoveryPage) {
  let statusIndex = 0;
  fake.host.fetchRecoveryPage = vi.fn(async () => JSON.parse(JSON.stringify(page))) as never;
  const runtime = createGenerationRuntime(fake.host, {
    fetchJobStatus: (vi.fn(async () => {
      const item = statusScript[Math.min(statusIndex, statusScript.length - 1)];
      statusIndex += 1;
      return JSON.parse(JSON.stringify(item));
    })) as never,
    fetchRecoveryPage: vi.fn(async () => JSON.parse(JSON.stringify(page))) as never,
    setTimeout: () => 0 as never,
    clearTimeout: () => {},
    newId: () => SUBMISSION,
  });
  runtime.register(sceneSplitTask);
  runtime.register(vocalSplitTask);
  return runtime;
}

const sceneTargetFacts = () => ({
  targetNodeId: 'ph-1',
  seedTarget: { role: 'result-placeholder' as const, x: 958, y: 0, width: 320, height: 320, name: '场景切分 · 标准' },
  seedSources: [],
  expectedBindingRevision: 0,
});

describe('多结果家族：运行时集成', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('场景切分 1 段成功：受理→扇出规范 node_id 段卡（marker）→一笔保存差分 replaceTarget + apply；占位卡移除', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 }, data: { genStatus: 'generating', sceneSplit: { sourceAssetId: '5', lastInput: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard' } } } });
    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'sj1', status: 'queued', canvas_binding: BINDING_VIEW });
    const runtime = setupRuntime(fake, [oneSegmentDetail()], oneSegmentPage());

    expect(runtime.submit(sceneSplitTask, { payload: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard' } as SceneSplitTaskPayload, target: sceneTargetFacts() })).toBe(true);
    await flushMicrotasks(20);

    expect(fake.removes).toContain('ph-1');
    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    expect(fake.nodes.get(segmentId)).toBeTruthy();
    expect(fake.nodes.get(segmentId)!.data).toMatchObject({
      fileName: '第 1 段 00:00-00:10',
      assetId: 'a1',
      src: 'http://t/1.mp4',
      generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' },
    });
    const fields = runtime.composeSaveFields();
    expect(fields!.recoveryChanges.map((change) => `${change.action}:${change.recoveryItemId}`).sort()).toEqual([
      `apply:gcr:${SUBMISSION}:segment:1`,
      `replaceTarget:gcr:${SUBMISSION}:$target`,
    ]);
    expect(fake.saves).toBeGreaterThan(0);
  });

  it('部分删除：段卡删除后差分 remove（其余输出不动）；撤销恢复差分 restore', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 }, data: { genStatus: 'generating', sceneSplit: { sourceAssetId: '5', lastInput: {} } } });
    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'sj1', status: 'queued', canvas_binding: BINDING_VIEW });
    const runtime = setupRuntime(fake, [oneSegmentDetail()], oneSegmentPage());
    runtime.submit(sceneSplitTask, { payload: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard' } as SceneSplitTaskPayload, target: sceneTargetFacts() });
    await flushMicrotasks(20);

    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();
    expect(runtime.remove(segmentId)).toBe(true);
    expect(fake.removes).toContain(segmentId);
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:$target`, expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: `gcr:${SUBMISSION}:segment:1`, expectedRevision: 0, action: 'remove' },
    ]);
    fake.nodes.set(segmentId, { id: segmentId, type: 'mediaNode', position: { x: 0, y: 0 }, data: { generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' } } });
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:$target`, expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: `gcr:${SUBMISSION}:segment:1`, expectedRevision: 0, action: 'apply' },
    ]);
    runtime.onSaveReceipt({ commandId: 'cmd-x', replayed: false, changes: [
      { recoveryItemId: `gcr:${SUBMISSION}:$target`, revision: 2, nodeBindingRevision: 1, state: 'replaced' },
      { recoveryItemId: `gcr:${SUBMISSION}:segment:1`, revision: 2, nodeBindingRevision: 1, state: 'removed' },
    ] });
    fake.nodes.delete(segmentId);
    const removedFields = runtime.composeSaveFields()!;
    expect(removedFields).toBeNull();
    fake.nodes.set(segmentId, { id: segmentId, type: 'mediaNode', position: { x: 0, y: 0 }, data: { generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' } } });
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:segment:1`, expectedRevision: 2, action: 'restore' },
    ]);
  });

  it('恢复扫描：succeeded 且未应用输出 → 扇出补段卡；重复扫描按规范 node_id 判重不重复建卡', async () => {
    const fake = createFakeHost();
    const runtime = setupRuntime(fake, [oneSegmentDetail()], oneSegmentPage());
    await runtime.recover('p1');
    await flushMicrotasks(20);
    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    expect(fake.nodes.get(segmentId)).toBeTruthy();
    expect(fake.inserts.filter((node) => node.id === segmentId)).toHaveLength(1);
    await runtime.recover('p1');
    await flushMicrotasks(20);
    expect(fake.inserts.filter((node) => node.id === segmentId)).toHaveLength(1);
  });

  it('取消抢先成功：保留作品（收敛器挂载），不转为自动删除结果', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 }, data: { genStatus: 'generating', sceneSplit: { sourceAssetId: '5', lastInput: {} } } });
    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'sj1', status: 'queued', canvas_binding: BINDING_VIEW });
    const runtime = setupRuntime(fake, [{ status: 'processing', progress: 10, asset: null }, oneSegmentDetail()], oneSegmentPage());
    runtime.submit(sceneSplitTask, { payload: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard' } as SceneSplitTaskPayload, target: sceneTargetFacts() });
    await flushMicrotasks(20);
    apiMocks.fetchJobStatus.mockImplementation(async () => JSON.parse(JSON.stringify(oneSegmentDetail())) as never);
    expect(runtime.remove('ph-1')).toBe(true);
    await flushMicrotasks(30);
    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    expect(fake.nodes.get(segmentId)).toBeTruthy();
    expect(fake.removes).not.toContain(segmentId);
  });

  it.each([false, true])('任务 3416 四段恢复后删除一段，首次保存已完成=%s，重新打开三次不复活或覆盖位置', async (savedBeforeDelete) => {
    const fake = createFakeHost();
    const source: RuntimeNodeView = { id: 'v1', type: 'mediaNode', position: { x: 100, y: 200 }, data: { assetId: '8166', mediaType: 'video', fileName: '源视频' } };
    fake.nodes.set(source.id, source);
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 }, data: { sceneSplit: { sourceAssetId: '8166', lastInput: {} } } });
    fake.edges.push({ source: 'v1', target: 'ph-1' });
    const segments = [
      { segment_index: 1, start_time: 0, end_time: 2.0416667, segment_asset_id: '8215' },
      { segment_index: 2, start_time: 2.0416667, end_time: 3.5, segment_asset_id: '8216' },
      { segment_index: 3, start_time: 3.5, end_time: 4.75, segment_asset_id: '8217' },
      { segment_index: 4, start_time: 4.75, end_time: 30.041666, segment_asset_id: '8218' },
    ];
    const detail = {
      job_id: '3416', status: 'succeeded', progress: 100, asset: null,
      result: { duration: 30.08, segments },
      output_assets: segments.map(segment => ({ id: segment.segment_asset_id, url: `http://t/${segment.segment_asset_id}.mp4`, type: 'video', width: 480, height: 854 })),
    };
    const page = oneSegmentPage();
    const record = page.records[0]!;
    record.job_id = '3416';
    record.job = { ...record.job!, job_id: '3416', output_asset_ids: ['8215', '8216', '8217', '8218'] };
    record.recovery_seed!.sources = [{ node_id: 'v1', x: 100, y: 200, width: 480, height: 854, name: '源视频' }];
    record.items = [record.items[0]!, ...segments.map(segment => ({
      recovery_item_id: `gcr:${SUBMISSION}:segment:${segment.segment_index}`,
      output_key: `segment:${segment.segment_index}`,
      node_id: `generation-result:${SUBMISSION}:segment:${segment.segment_index}`,
      state: 'pending' as const, revision: 0, node_binding_revision: 0,
      asset_id: segment.segment_asset_id, slot_id: null,
    }))];
    const runtime = setupRuntime(fake, [detail], page);
    await runtime.recover('p1');
    await flushMicrotasks(20);
    const ids = [1, 2, 3, 4].map(index => `generation-result:${SUBMISSION}:segment:${index}`);
    expect(fake.nodes.has('ph-1')).toBe(false);
    expect(ids.map(id => fake.nodes.get(id)?.data)).toEqual([
      expect.objectContaining({ assetId: '8215', src: 'http://t/8215.mp4', fileName: '第 1 段 00:00-00:02' }),
      expect.objectContaining({ assetId: '8216', src: 'http://t/8216.mp4', fileName: '第 2 段 00:02-00:03' }),
      expect.objectContaining({ assetId: '8217', src: 'http://t/8217.mp4', fileName: '第 3 段 00:03-00:04' }),
      expect.objectContaining({ assetId: '8218', src: 'http://t/8218.mp4', fileName: '第 4 段 00:04-00:30' }),
    ]);
    expect(fake.edges).toEqual(expect.arrayContaining(ids.map(target => ({ source: 'v1', target }))));
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:$target`, expectedRevision: 1, action: 'replaceTarget' },
      ...[1, 2, 3, 4].map(index => ({ recoveryItemId: `gcr:${SUBMISSION}:segment:${index}`, expectedRevision: 0, action: 'apply' })),
    ]);
    const receipt = () => ({
      commandId: 'cmd-3416', replayed: false,
      changes: record.items.map(item => ({ recoveryItemId: item.recovery_item_id, revision: item.revision, nodeBindingRevision: item.node_binding_revision, state: item.state })),
    });
    if (savedBeforeDelete) {
      record.items.forEach(item => {
        item.state = item.output_key === '$target' ? 'replaced' : 'present';
        item.revision = item.output_key === '$target' ? 2 : 1;
        item.node_binding_revision = 1;
      });
      runtime.onSaveReceipt(receipt());
      expect(runtime.composeSaveFields()).toBeNull();
    }
    fake.nodes.get(ids[2]!)!.position = { x: 1500, y: 700 };
    expect(runtime.remove(ids[1]!)).toBe(true);
    expect(runtime.composeSaveFields()!.recoveryChanges).toContainEqual({
      recoveryItemId: `gcr:${SUBMISSION}:segment:2`, expectedRevision: savedBeforeDelete ? 1 : 0, action: 'remove',
    });
    record.items.forEach(item => {
      item.state = item.output_key === '$target' ? 'replaced' : item.output_key === 'segment:2' ? 'removed' : 'present';
      item.revision = item.output_key === '$target' || (savedBeforeDelete && item.output_key === 'segment:2') ? 2 : 1;
      item.node_binding_revision = 1;
    });
    runtime.onSaveReceipt(receipt());
    expect(runtime.composeSaveFields()).toBeNull();
    const savedNodes = structuredClone([...fake.nodes.values()]);
    expect(savedNodes.map(node => node.id)).toEqual(['v1', ids[0], ids[2], ids[3]]);
    runtime.reset();
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const reopened = createFakeHost();
      for (const node of structuredClone(savedNodes)) reopened.nodes.set(node.id, node);
      const reopenedRuntime = setupRuntime(reopened, [detail], page);
      await reopenedRuntime.recover('p1');
      await flushMicrotasks(20);
      expect([...reopened.nodes.values()]).toEqual(savedNodes);
      expect(reopened.nodes.get('v1')).toEqual(source);
      expect(reopened.nodes.get(ids[2]!)?.position).toEqual({ x: 1500, y: 700 });
      expect(reopened.inserts).toHaveLength(0);
      expect(reopenedRuntime.composeSaveFields()).toBeNull();
      reopenedRuntime.reset();
    }
    expect(apiMocks.createVideoSceneSplit).not.toHaveBeenCalled();
    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();
  });


  const sceneSplitFailedCard = () => ({
    id: 'ph-1', type: 'mediaNode' as const, position: { x: 958, y: 0 },
    data: {
      jobId: 'sj0', genStatus: 'failed' as const,
      sceneSplit: { sourceAssetId: '5', lastInput: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard' as const } },
      generationRecovery: { protocolVersion: 1 as const, submissionId: SUBMISSION, outputKey: '$target' },
    },
  });

  const twoSegmentDetail = () => ({
    job_id: 'sj1', status: 'succeeded', progress: 100, asset: null,
    output_assets: [
      { id: 'a1', url: 'http://t/1.mp4', type: 'video' },
      { id: 'a2', url: 'http://t/2.mp4', type: 'video' },
    ],
    result: { duration: 30, segments: [
      { segment_index: 1, start_time: 0, end_time: 15, segment_asset_id: 'a1' },
      { segment_index: 2, start_time: 15, end_time: 30, segment_asset_id: 'a2' },
    ] },
  });

  const twoSegmentPage = (): GenerationRecoveryPage => ({
    protocol_version: 1, canvas_version: 1, next_cursor: null,
    records: [{
      submission_id: SUBMISSION, target_node_id: 'ph-1', job_id: 'sj1', task_type: 'video_scene_split',
      binding_revision: 1, is_current: true,
      job: { job_id: 'sj1', type: 'video_scene_split', status: 'succeeded', progress: 100, output_asset_ids: ['a1', 'a2'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      recovery_seed: { target: { role: 'result-placeholder', x: 958, y: 0, width: 320, height: 320, name: '场景切分 · 标准' }, sources: [] },
      previous_target_snapshot: null,
      items: [
        { recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'ph-1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
        { recovery_item_id: `gcr:${SUBMISSION}:segment:1`, output_key: 'segment:1', node_id: `generation-result:${SUBMISSION}:segment:1`, state: 'pending', revision: 0, node_binding_revision: 0, asset_id: 'a1', slot_id: null },
        { recovery_item_id: `gcr:${SUBMISSION}:segment:2`, output_key: 'segment:2', node_id: `generation-result:${SUBMISSION}:segment:2`, state: 'pending', revision: 0, node_binding_revision: 0, asset_id: 'a2', slot_id: null },
      ],
    }],
  });

  it('重试成功仅 1 段：扇出 1 张规范段卡（marker segment:1），不落 primary', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', sceneSplitFailedCard());
    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'sj1', status: 'queued', canvas_binding: BINDING_VIEW });
    const runtime = setupRuntime(fake, [oneSegmentDetail()], oneSegmentPage());

    expect(runtime.retry('ph-1')).toBe(true);
    await flushMicrotasks(20);

    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    expect(fake.removes).toContain('ph-1');
    expect(fake.nodes.get(segmentId)!.data).toMatchObject({
      fileName: '第 1 段 00:00-00:10',
      generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' },
    });
    expect(runtime.composeSaveFields()!.recoveryChanges.map((change) => `${change.action}:${change.recoveryItemId}`).sort()).toEqual([
      `apply:gcr:${SUBMISSION}:segment:1`,
      `replaceTarget:gcr:${SUBMISSION}:$target`,
    ]);
  });

  it('重试成功多段：段命名与网格布局（planFanoutCards）生效', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', sceneSplitFailedCard());
    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'sj1', status: 'queued', canvas_binding: BINDING_VIEW });
    const runtime = setupRuntime(fake, [twoSegmentDetail()], twoSegmentPage());

    expect(runtime.retry('ph-1')).toBe(true);
    await flushMicrotasks(20);

    const first = fake.nodes.get(`generation-result:${SUBMISSION}:segment:1`);
    const second = fake.nodes.get(`generation-result:${SUBMISSION}:segment:2`);
    expect(first!.data).toMatchObject({ fileName: '第 1 段 00:00-00:15', generationRecovery: { outputKey: 'segment:1' } });
    expect(second!.data).toMatchObject({ fileName: '第 2 段 00:15-00:30', generationRecovery: { outputKey: 'segment:2' } });
    expect(second!.position.x).toBeGreaterThan(first!.position.x);
    expect(runtime.composeSaveFields()!.recoveryChanges.map((change) => `${change.action}:${change.recoveryItemId}`).sort()).toEqual([
      `apply:gcr:${SUBMISSION}:segment:1`,
      `apply:gcr:${SUBMISSION}:segment:2`,
      `replaceTarget:gcr:${SUBMISSION}:$target`,
    ]);
  });

  it('人声分离重试成功：轨卡「源名(轨词).格式」命名与纵向轨列（planFanoutCards）生效', async () => {
    const fake = createFakeHost();
    fake.nodes.set('vs-1', {
      id: 'vs-1', type: 'mediaNode', position: { x: 958, y: 0 },
      data: {
        jobId: 'vj0', genStatus: 'failed', fileName: '素材视频(人声背景分离)',
        vocalSplit: { sourceAssetId: '5', lastInput: { source_asset_id: '5', scene: 'drama', output_format: 'flac' } },
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: '$target' },
      },
    });
    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'vj1', status: 'queued', canvas_binding: { ...BINDING_VIEW, target_node_id: 'vs-1', job_id: 'vj1' } });
    const detail = {
      job_id: 'vj1', status: 'succeeded', progress: 100, asset: null,
      output_assets: [
        { id: 't1', url: 'http://t/v.flac', type: 'audio' },
        { id: 't2', url: 'http://t/m.flac', type: 'audio' },
      ],
      tracks: [
        { track_type: 'voice', asset_id: 't1', url: 'http://t/v.flac', duration: 8 },
        { track_type: 'music', asset_id: 't2', url: 'http://t/m.flac', duration: 8 },
      ],
    };
    const page: GenerationRecoveryPage = {
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [{
        submission_id: SUBMISSION, target_node_id: 'vs-1', job_id: 'vj1', task_type: 'vocal_split',
        binding_revision: 1, is_current: true,
        job: { job_id: 'vj1', type: 'vocal_split', status: 'succeeded', progress: 100, output_asset_ids: ['t1', 't2'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        recovery_seed: { target: { role: 'result-placeholder', x: 958, y: 0, width: 320, height: 320, name: '素材视频(人声背景分离)' }, sources: [] },
        previous_target_snapshot: null,
        items: [
          { recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'vs-1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
          { recovery_item_id: `gcr:${SUBMISSION}:track:voice`, output_key: 'track:voice', node_id: `generation-result:${SUBMISSION}:track:voice`, state: 'pending', revision: 0, node_binding_revision: 0, asset_id: 't1', slot_id: null },
          { recovery_item_id: `gcr:${SUBMISSION}:track:music`, output_key: 'track:music', node_id: `generation-result:${SUBMISSION}:track:music`, state: 'pending', revision: 0, node_binding_revision: 0, asset_id: 't2', slot_id: null },
        ],
      }],
    };
    const runtime = setupRuntime(fake, [detail], page);

    expect(runtime.retry('vs-1')).toBe(true);
    await flushMicrotasks(20);

    const voice = fake.nodes.get(`generation-result:${SUBMISSION}:track:voice`);
    const music = fake.nodes.get(`generation-result:${SUBMISSION}:track:music`);
    expect(voice!.data).toMatchObject({ fileName: '素材视频(人声).flac', generationRecovery: { outputKey: 'track:voice' } });
    expect(music!.data).toMatchObject({ fileName: '素材视频(音乐).flac' });
    expect('jobId' in voice!.data).toBe(false);
    expect(voice!.position).toEqual({ x: 958, y: 0 });
    expect(music!.position).toEqual({ x: 958, y: 300 });
    expect(fake.removes).toContain('vs-1');
  });

  it('明确软删的段：恢复零警告、零建卡、零差分，任务卡保持不动', async () => {
    const fake = createFakeHost();
    const targetCard: RuntimeNodeView = {
      id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 },
      data: { fileName: '用户任务卡', mediaType: 'video', sceneSplit: { sourceAssetId: '5', lastInput: {} } },
    };
    fake.nodes.set(targetCard.id, targetCard);
    const page = oneSegmentPage();
    const record = page.records[0]!;
    record.items[1]!.asset_id = '8127';
    record.items[1]!.asset_deleted = true;
    const runtime = setupRuntime(fake, [oneSegmentDetail()], page);
    await runtime.recover('p1');
    await flushMicrotasks(20);
    expect(fake.toasts).toEqual([]);
    expect(fake.inserts).toHaveLength(0);
    expect(fake.removes).toHaveLength(0);
    expect(fake.nodes.get('ph-1')).toEqual(targetCard);
    expect(runtime.composeSaveFields()).toBeNull();
  });

  it('轮询收敛遇明确软删：清掉进行中态、零警告、不建卡也不复活素材', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 },
      data: { genStatus: 'generating', jobId: 'sj1', mediaType: 'video', fileName: '用户任务卡',
        sceneSplit: { sourceAssetId: '5', lastInput: {} },
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: '$target' } } });
    const page = oneSegmentPage();
    const record = page.records[0]!;
    record.items[1]!.asset_id = '8127';
    record.items[1]!.asset_deleted = true;
    const detail = { job_id: 'sj1', status: 'succeeded', progress: 100, asset: null, output_assets: [], result: null };
    const runtime = setupRuntime(fake, [detail], page);
    runtime.resumeFromHydration('ph-1', 'sj1', fake.nodes.get('ph-1')!.data);
    await flushMicrotasks(30);
    expect(fake.toasts).toEqual([]);
    expect(fake.inserts).toHaveLength(0);
    expect(fake.nodes.get('ph-1')).toMatchObject({ data: {
      fileName: '用户任务卡', progress: 100, sceneSplit: { sourceAssetId: '5' },
    } });
    expect(fake.nodes.get('ph-1')!.data.genStatus).toBeUndefined();
    expect(runtime.composeSaveFields()).toBeNull();
  });

  it('部分段明确软删：只按存活可信产物落卡，保留原卡不转换目标，差分不声明已删段', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 },
      data: { sceneSplit: { sourceAssetId: '5', lastInput: {} } } });
    const page = twoSegmentPage();
    const record = page.records[0]!;
    record.items[1]!.asset_id = '8127';
    record.items[1]!.asset_deleted = true;
    const detail = {
      job_id: 'sj1', status: 'succeeded', progress: 100, asset: null,
      output_assets: [{ id: 'a2', url: 'http://t/2.mp4', type: 'video' }],
      result: { duration: 30, segments: [
        { segment_index: 1, start_time: 0, end_time: 15, segment_asset_id: '8127' },
        { segment_index: 2, start_time: 15, end_time: 30, segment_asset_id: 'a2' },
      ] },
    };
    const runtime = setupRuntime(fake, [detail], page);
    await runtime.recover('p1');
    await flushMicrotasks(20);
    expect(fake.toasts).toEqual([]);
    expect(fake.nodes.get(`generation-result:${SUBMISSION}:segment:2`)).toMatchObject({
      data: { assetId: 'a2', src: 'http://t/2.mp4' },
    });
    expect(fake.nodes.has(`generation-result:${SUBMISSION}:segment:1`)).toBe(false);
    expect(fake.removes).not.toContain('ph-1');
    expect(fake.nodes.get('ph-1')).toMatchObject({ data: { progress: 100, sceneSplit: { sourceAssetId: '5' } } });
    expect(fake.nodes.get('ph-1')!.data.genStatus).toBeUndefined();
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:segment:2`, expectedRevision: 0, action: 'apply' },
    ]);
  });

  it('已持久化的软删段卡：扫描不自动删卡，显式删除生成合法 remove 且不动存活段', async () => {
    const fake = createFakeHost();
    const page = twoSegmentPage();
    const record = page.records[0]!;
    record.items[0]!.state = 'replaced';
    record.items[1]!.state = 'present';
    record.items[1]!.revision = 1;
    record.items[1]!.asset_deleted = true;
    record.items[2]!.state = 'present';
    record.items[2]!.revision = 1;
    const card = (key: string, assetId: string): RuntimeNodeView => ({
      id: `generation-result:${SUBMISSION}:${key}`, type: 'mediaNode', position: { x: 958, y: 0 },
      data: { assetId, src: `http://t/${assetId}.mp4`, mediaType: 'video',
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: key } },
    });
    fake.nodes.set(`generation-result:${SUBMISSION}:segment:1`, card('segment:1', 'a1'));
    fake.nodes.set(`generation-result:${SUBMISSION}:segment:2`, card('segment:2', 'a2'));
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 },
      data: { sceneSplit: { sourceAssetId: '5', lastInput: {} },
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: '$target' } } });
    const runtime = setupRuntime(fake, [twoSegmentDetail()], page);

    await runtime.recover('p1');
    await flushMicrotasks(20);
    expect(fake.toasts).toEqual([]);
    expect(fake.removes).toEqual([]);
    expect(runtime.composeSaveFields()).toBeNull();

    expect(runtime.remove(`generation-result:${SUBMISSION}:segment:1`)).toBe(true);
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:segment:1`, expectedRevision: 1, action: 'remove' },
    ]);
  });

  it('人声分离：已持久化的软删轨卡同样只能由显式删除生成 remove', async () => {
    const fake = createFakeHost();
    const card = (track: string, assetId: string): RuntimeNodeView => ({
      id: `generation-result:${SUBMISSION}:track:${track}`, type: 'mediaNode', position: { x: 958, y: 0 },
      data: { assetId, src: `http://t/${assetId}.flac`, mediaType: 'audio',
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: `track:${track}` } },
    });
    fake.nodes.set(`generation-result:${SUBMISSION}:track:voice`, card('voice', 't1'));
    fake.nodes.set(`generation-result:${SUBMISSION}:track:music`, card('music', 't2'));
    const page: GenerationRecoveryPage = {
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [{
        submission_id: SUBMISSION, target_node_id: 'vs-1', job_id: 'vj1', task_type: 'vocal_split',
        binding_revision: 1, is_current: true,
        job: { job_id: 'vj1', type: 'vocal_split', status: 'succeeded', progress: 100, output_asset_ids: ['t1', 't2'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        recovery_seed: { target: { role: 'result-placeholder', x: 958, y: 0, width: 320, height: 320, name: '素材视频(人声背景分离)' }, sources: [] },
        previous_target_snapshot: null,
        items: [
          { recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: 'vs-1', state: 'replaced', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
          { recovery_item_id: `gcr:${SUBMISSION}:track:voice`, output_key: 'track:voice', node_id: `generation-result:${SUBMISSION}:track:voice`, state: 'present', revision: 1, node_binding_revision: 1, asset_id: 't1', asset_deleted: true, slot_id: null },
          { recovery_item_id: `gcr:${SUBMISSION}:track:music`, output_key: 'track:music', node_id: `generation-result:${SUBMISSION}:track:music`, state: 'present', revision: 1, node_binding_revision: 1, asset_id: 't2', asset_deleted: false, slot_id: null },
        ],
      }],
    };
    const runtime = setupRuntime(fake, [{ status: 'succeeded' }], page);

    await runtime.recover('p1');
    await flushMicrotasks(20);
    expect(fake.toasts).toEqual([]);
    expect(fake.removes).toEqual([]);
    expect(runtime.composeSaveFields()).toBeNull();

    expect(runtime.remove(`generation-result:${SUBMISSION}:track:voice`)).toBe(true);
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:track:voice`, expectedRevision: 1, action: 'remove' },
    ]);
  });

  it('已软删但卡缺失或素材身份不符的 present 项：扫描与保存都不声明删除', async () => {
    const persistedPage = () => {
      const page = twoSegmentPage();
      const target = page.records[0]!;
      target.items[0]!.state = 'replaced';
      target.items[1]!.state = 'present';
      target.items[1]!.revision = 1;
      target.items[1]!.asset_deleted = true;
      target.items[2]!.state = 'present';
      target.items[2]!.revision = 1;
      return page;
    };
    const card = (key: string, assetId: string): RuntimeNodeView => ({
      id: `generation-result:${SUBMISSION}:${key}`, type: 'mediaNode', position: { x: 958, y: 0 },
      data: { assetId, src: `http://t/${assetId}.mp4`, mediaType: 'video',
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: key } },
    });
    for (const build of [
      (fake: FakeHost) => { fake.nodes.set(`generation-result:${SUBMISSION}:segment:2`, card('segment:2', 'a2')); },
      (fake: FakeHost) => {
        fake.nodes.set(`generation-result:${SUBMISSION}:segment:1`, card('segment:1', 'other'));
        fake.nodes.set(`generation-result:${SUBMISSION}:segment:2`, card('segment:2', 'a2'));
      },
    ]) {
      const fake = createFakeHost();
      build(fake);
      const runtime = setupRuntime(fake, [twoSegmentDetail()], persistedPage());
      await runtime.recover('p1');
      await flushMicrotasks(20);
      expect(fake.removes).toEqual([]);
      expect(fake.toasts).toEqual([]);
      expect(runtime.composeSaveFields()).toBeNull();
    }
  });
});

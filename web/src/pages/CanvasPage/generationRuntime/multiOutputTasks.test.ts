/* ============================================
 * 多结果家族（场景切分/人声分离）类型定义契约测试（IKJJR5）：身份识别（占位卡 +
 * 规范结果卡）、冻结输入、创建/重试协议（client_token/Idempotency-Key = submission_id）、
 * 多结果成功判定（1 段场景切分仍走扇出）、恢复规划、扇出落卡（既有排列/命名/来源线），
 * 以及运行时集成：规范 node_id 扇出、一笔原子保存、逐项删除/撤销差分、恢复扫描判重、
 * marker 成品卡直接删除（不走取消流）。
 * ============================================ */
import { describe, expect, it, vi, beforeEach } from 'vitest';

type CreatedWithBindingView = { job_id: string; status: string; canvas_binding?: unknown };
const apiMocks = vi.hoisted(() => ({
  createVideoSceneSplit: vi.fn(async (): Promise<CreatedWithBindingView> => ({ job_id: 'sj1', status: 'queued' })),
  createVocalSplit: vi.fn(async (): Promise<CreatedWithBindingView> => ({ job_id: 'vj1', status: 'queued' })),
  cancelGenerationJob: vi.fn(async () => null),
  fetchJobStatus: vi.fn(),
}));

vi.mock('@/api/jobs', () => ({
  createVideoSceneSplit: apiMocks.createVideoSceneSplit,
  createVocalSplit: apiMocks.createVocalSplit,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  isApiError: vi.fn(() => false),
}));
vi.mock('@/api/idempotencyKey', () => ({ newIdempotencyKey: vi.fn(() => 'fresh-token') }));

import {
  sceneSplitTask, vocalSplitTask, isSceneSplitCard, isVocalSplitCard,
  type SceneSplitTaskPayload,
} from './multiOutputTasks';
import { isNormalGenerationCard } from './normalGeneration';
import { createGenerationRuntime } from './runtime';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';
import type { GenerationRecoveryPage, GenerationRecoveryRecord } from '@/api/canvasRecovery';

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
    // 交叉不认领；无 marker 的前缀卡不认领
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
    // 历史兼容（binding=null）不带幂等头（旧请求零变化）
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

  it('planRecovery：失败且卡缺失补失败卡（恢复卡无业务参数，重试提示重新编辑）', () => {
    const plan = sceneSplitTask.planRecovery!(record({
      job: { job_id: 'sj1', type: 'video_scene_split', status: 'failed', progress: 0, output_asset_ids: [], stored_error: { code: 1, msg: '切分失败' }, created_at: '2026-10-01T00:00:00Z' },
    }), hostOf([]));
    expect(plan.kind).toBe('restore-target');
    if (plan.kind !== 'restore-target') return;
    expect(plan.node.data).toMatchObject({ genStatus: 'failed', errorText: '切分失败' });
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
    // 网格排布在源卡（锚点）右侧、第 2 段在第 1 段右侧（列数 = ceil(√2) = 2）
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

// ── 运行时集成（提交→受理→成功扇出→保存差分；恢复扫描；marker 成品卡删除） ──────────

interface FakeHost {
  host: GenerationRuntimeHost;
  nodes: Map<string, RuntimeNodeView>;
  edges: Array<{ source: string; target: string }>;
  inserts: RuntimeNodeView[];
  removes: string[];
  saves: number;
}

function createFakeHost(): FakeHost {
  const nodes = new Map<string, RuntimeNodeView>();
  const edges: Array<{ source: string; target: string }> = [];
  const inserts: RuntimeNodeView[] = [];
  const removes: string[] = [];
  const counters = { saves: 0 };
  const loadEpoch = {}; // 稳定加载身份（普通重渲染不推进）
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
    stopLegacyPolling: () => {},
    isLocallyRemoved: () => false,
    markLocallyRemoved: () => {},
    registerPendingDelete: () => {},
    isPendingDelete: () => false,
    applyTerminal: () => 'terminal',
    settleCancelled: () => {},
    saveCanvas: async () => { counters.saves += 1; return true; },
    toast: () => {},
    openRechargeForCreditsError: () => false,
    addAuthResume: () => {},
    rememberAsset: () => {},
  };
  return { host, nodes, edges, inserts, removes, get saves() { return counters.saves; } };
}

const flushMicrotasks = async (rounds = 16) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

/** 场景切分成功终态（1 段 + 1 段资产）与恢复页投影（segment:1 规范身份）。 */
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
    expect(fake.saves).toBeGreaterThan(0); // 扇出同笔落盘
  });

  it('部分删除：段卡删除后差分 remove（其余输出不动）；撤销恢复差分 restore', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 }, data: { genStatus: 'generating', sceneSplit: { sourceAssetId: '5', lastInput: {} } } });
    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'sj1', status: 'queued', canvas_binding: BINDING_VIEW });
    const runtime = setupRuntime(fake, [oneSegmentDetail()], oneSegmentPage());
    runtime.submit(sceneSplitTask, { payload: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard' } as SceneSplitTaskPayload, target: sceneTargetFacts() });
    await flushMicrotasks(20);

    // marker 成品卡删除：不走取消流（任务已终态），直接移除 + 差分 remove
    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();
    expect(runtime.remove(segmentId)).toBe(true);
    expect(fake.removes).toContain(segmentId);
    // 首次保存前删除（B.6）：该项差分 remove、目标项照常 replaceTarget——一笔保存里
    // 「每项明确 apply 或用户 remove」，不能只删占位遗漏结果
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:$target`, expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: `gcr:${SUBMISSION}:segment:1`, expectedRevision: 0, action: 'remove' },
    ]);
    // 撤销：段卡带 marker 回画布 → 差分 restore
    fake.nodes.set(segmentId, { id: segmentId, type: 'mediaNode', position: { x: 0, y: 0 }, data: { generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' } } });
    expect(runtime.composeSaveFields()!.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION}:$target`, expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: `gcr:${SUBMISSION}:segment:1`, expectedRevision: 0, action: 'apply' }, // 撤销后该项回到 apply
    ]);
    // 已确认 removed 的项经撤销（marker 回画布）→ 差分 restore（显式撤销恢复同一结果）
    runtime.onSaveReceipt({ commandId: 'cmd-x', replayed: false, changes: [
      { recoveryItemId: `gcr:${SUBMISSION}:$target`, revision: 2, nodeBindingRevision: 1, state: 'replaced' },
      { recoveryItemId: `gcr:${SUBMISSION}:segment:1`, revision: 2, nodeBindingRevision: 1, state: 'removed' },
    ] });
    fake.nodes.delete(segmentId);
    const removedFields = runtime.composeSaveFields()!;
    expect(removedFields).toBeNull(); // removed 已确认且卡缺席：无待确认动作
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
    expect(fake.inserts.filter((node) => node.id === segmentId)).toHaveLength(1); // 判重：不重复建卡
  });

  it('取消抢先成功：保留作品（收敛器挂载），不转为自动删除结果', async () => {
    const fake = createFakeHost();
    fake.nodes.set('ph-1', { id: 'ph-1', type: 'mediaNode', position: { x: 958, y: 0 }, data: { genStatus: 'generating', sceneSplit: { sourceAssetId: '5', lastInput: {} } } });
    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'sj1', status: 'queued', canvas_binding: BINDING_VIEW });
    const runtime = setupRuntime(fake, [{ status: 'processing', progress: 10, asset: null }, oneSegmentDetail()], oneSegmentPage());
    runtime.submit(sceneSplitTask, { payload: { source_asset_id: '5', target_node_id: 'ph-1', granularity: 'standard' } as SceneSplitTaskPayload, target: sceneTargetFacts() });
    await flushMicrotasks(20);
    // 删除流程发起（轮询 processing 中登记意图）后任务抢先成功：converge 挂载作品并提示
    apiMocks.fetchJobStatus.mockImplementation(async () => JSON.parse(JSON.stringify(oneSegmentDetail())) as never);
    expect(runtime.remove('ph-1')).toBe(true);
    await flushMicrotasks(30);
    const segmentId = `generation-result:${SUBMISSION}:segment:1`;
    expect(fake.nodes.get(segmentId)).toBeTruthy(); // 作品保留（扇出成功）
    expect(fake.removes).not.toContain(segmentId);
  });
});

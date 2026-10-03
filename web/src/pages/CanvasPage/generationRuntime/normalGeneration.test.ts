/* ============================================
 * 普通生成类型定义契约测试（IKJJR1）：身份识别（排除工具家族）、创建/重试/取消协议、
 * 输出槽投影与恢复落卡规划。「新增类型 = 一份类型定义」的接入基准。
 * ============================================ */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  createGenerationJob: vi.fn(async () => ({ generation_job_id: 'j1', cursor: 1 })),
  retryGenerationJob: vi.fn(async () => ({ generation_job_id: 'j2', cursor: 2 })),
  cancelGenerationJob: vi.fn(async () => null),
  fetchJobStatus: vi.fn(),
}));

vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
}));

import {
  normalGenerationTask, isNormalGenerationCard, buildRecoveryTargetNode, mediaTypeOfTask,
} from './normalGeneration';
import { createGenerationRuntime } from './runtime';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';
import type { GenerationRecoveryPage, GenerationRecoveryRecord } from '@/api/canvasRecovery';

const BINDING = {
  protocol_version: 1 as const,
  submission_id: '11111111-1111-4111-8111-111111111111',
  target_node_id: 'n1',
  expected_binding_revision: 2,
  recovery_seed: {
    target: { role: 'result-placeholder' as const, x: 1, y: 2, width: 320, height: 320, name: '卡' },
    sources: [],
  },
};

describe('普通生成类型定义：身份识别', () => {
  it('媒体卡 + jobId + 无工具身份 → 本类型', () => {
    expect(isNormalGenerationCard('n1', { jobId: 'j1', genStatus: 'failed' })).toBe(true);
    expect(isNormalGenerationCard('n1', { jobId: 'j1', mediaType: 'image' })).toBe(true);
  });

  it('工具家族身份键或节点 id 前缀 → 排除（归各自家族）', () => {
    for (const key of ['imageEnhance', 'videoEnhance', 'frameInterpolation', 'imageErase', 'videoSubtitleErase',
      'imageCutout', 'imageOutpaint', 'vocalSplit', 'sceneSplit', 'smartMatting', 'mediaExtract',
      'audioTrim', 'audioSpeed', 'audioVideoMux']) {
      expect(isNormalGenerationCard('n1', { jobId: 'j1', [key]: { last: true } })).toBe(false);
    }
    expect(isNormalGenerationCard('audio-mix-9', { jobId: '9' })).toBe(false);
    expect(isNormalGenerationCard('media-extract-9', { jobId: '9' })).toBe(false);
    expect(isNormalGenerationCard('audio-trim-9', { jobId: '9' })).toBe(false);
    expect(isNormalGenerationCard('audio-speed-9', { jobId: '9' })).toBe(false);
    expect(isNormalGenerationCard('vocal-split-9', { jobId: '9' })).toBe(false);
    // 人声轨卡（vocal-track-*）无家族身份键，基线即走通用重试——同样归本类型承接
    expect(isNormalGenerationCard('vocal-track-9-voice', { jobId: '9' })).toBe(true);
  });

  it('无 jobId 的卡（未受理/纯素材）不归本类型', () => {
    expect(isNormalGenerationCard('n1', { genStatus: 'failed' })).toBe(false);
    expect(isNormalGenerationCard('n1', {})).toBe(false);
  });

  it('task_type → 媒体类型映射（恢复补卡形态）', () => {
    expect(mediaTypeOfTask('image')).toBe('image');
    expect(mediaTypeOfTask('video')).toBe('video');
    expect(mediaTypeOfTask('audio')).toBe('audio');
  });
});

describe('普通生成类型定义：创建/重试/取消协议', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('创建：canvas_binding 注入业务载荷，Idempotency-Key = submission_id，回执视图透传', async () => {
    apiMocks.createGenerationJob.mockResolvedValueOnce({
      generation_job_id: 'j1',
      cursor: 1,
      canvas_binding: { protocol_version: 1, submission_id: BINDING.submission_id, target_node_id: 'n1', binding_revision: 3, job_id: 'j1', is_current: true },
    } as never);
    const outcome = await normalGenerationTask.create('p1', { payload: { type: 'image', expected_output_count: 1 } as never, target: undefined }, BINDING, 'key-1');
    expect(apiMocks.createGenerationJob).toHaveBeenCalledWith(
      'p1',
      { type: 'image', expected_output_count: 1, canvas_binding: BINDING },
      'key-1',
    );
    expect(outcome).toMatchObject({ jobId: 'j1', canvasBinding: { binding_revision: 3, is_current: true } });
  });

  it('重试：无 canvas_binding 走历史兼容三参调用；携带时第四参为 binding', async () => {
    // IKJJR3：第三参为重试上下文（nodeId + nodeData），服务端冻结输入的类型忽略 nodeId
    await normalGenerationTask.retry!('p1', 'j9', { nodeId: 'n9', nodeData: {} }, null, 'k-legacy');
    expect(apiMocks.retryGenerationJob).toHaveBeenCalledWith('p1', 'j9', 'k-legacy');
    await normalGenerationTask.retry!('p1', 'j9', { nodeId: 'n9', nodeData: {} }, BINDING, BINDING.submission_id);
    expect(apiMocks.retryGenerationJob).toHaveBeenLastCalledWith('p1', 'j9', BINDING.submission_id, BINDING);
  });

  it('取消：走 generation-jobs cancel 端点', async () => {
    await normalGenerationTask.cancel!('p1', 'j9');
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j9');
  });

  it('冻结输入：服务端持有（retry 端点按原任务读取），类型不实现 frozenInput', () => {
    expect(normalGenerationTask.frozenInput).toBeUndefined();
  });
});

describe('普通生成类型定义：恢复规划与输出槽', () => {
  const hostOf = (ids: string[], dataById: Record<string, Record<string, unknown>> = {}): GenerationRuntimeHost => ({
    findNode: (id: string) => (ids.includes(id)
      ? { id, type: 'mediaNode', position: { x: 0, y: 0 }, data: dataById[id] ?? {} }
      : null),
  } as unknown as GenerationRuntimeHost);

  const record = (overrides: Partial<GenerationRecoveryRecord> = {}): GenerationRecoveryRecord => ({
    submission_id: 'sub-1', target_node_id: 'n1', job_id: 'j1', task_type: 'image',
    binding_revision: 1, is_current: true,
    job: { job_id: 'j1', type: 'image', status: 'processing', progress: 10, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: { target: { role: 'result-placeholder', x: 5, y: 6, width: 300, height: 200, name: '图片生成中' }, sources: [] },
    previous_target_snapshot: null,
    items: [{ recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
    ...overrides,
  });

  it('进行中且卡在 → 续轮询；卡缺失 → 按恢复种子补卡', () => {
    expect(normalGenerationTask.planRecovery!(record(), hostOf(['n1']))).toEqual({ kind: 'resume-polling' });
    const plan = normalGenerationTask.planRecovery!(record(), hostOf([]));
    expect(plan.kind).toBe('restore-target');
    if (plan.kind !== 'restore-target') return;
    expect(plan.node).toMatchObject({ id: 'n1', type: 'mediaNode', position: { x: 5, y: 6 } });
    expect(plan.node.data).toMatchObject({ genStatus: 'generating', jobId: 'j1', mediaType: 'image' });
  });

  it('succeeded 且有未应用输出（slot: 输出槽）→ 多结果投影（node_id 用服务端规范身份）', () => {
    const plan = normalGenerationTask.planRecovery!(record({
      job: { job_id: 'j1', type: 'image', status: 'succeeded', progress: 100, output_asset_ids: ['11', '12'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [
        { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
        { recovery_item_id: 'gcr:sub-1:slot:77', output_key: 'slot:77', node_id: 'generation-output:77', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '11', slot_id: '77' },
      ],
    }), hostOf(['n1']));
    expect(plan).toMatchObject({ kind: 'apply-outputs' });
    if (plan.kind !== 'apply-outputs') return;
    expect(plan.projection.outputs).toEqual([
      { outputKey: 'slot:77', nodeId: 'generation-output:77', assetId: '11', url: '', mediaType: 'image' },
    ]);
  });

  it('已失败且卡缺失 → 补失败卡（保留重试入口）；removed/transferred 输出不投影', () => {
    const plan = normalGenerationTask.planRecovery!(record({
      task_type: 'video',
      job: { job_id: 'j1', type: 'video', status: 'failed', progress: 0, output_asset_ids: [], stored_error: { code: 1, msg: '上游失败' }, created_at: '2026-10-01T00:00:00Z' },
    }), hostOf([]));
    expect(plan.kind).toBe('restore-target');
    if (plan.kind !== 'restore-target') return;
    expect(plan.node.data).toMatchObject({ genStatus: 'failed', errorText: '上游失败', mediaType: 'video' });
  });

  it('恢复种子缺失时回落原目标快照位置；无快照回落原点', () => {
    const node = buildRecoveryTargetNode(record({
      recovery_seed: null,
      previous_target_snapshot: { id: 'n1', type: 'mediaNode', position: { x: 42, y: 24 } },
    }));
    expect(node.position).toEqual({ x: 42, y: 24 });
    expect(buildRecoveryTargetNode(record({ recovery_seed: null, previous_target_snapshot: null })).position).toEqual({ x: 0, y: 0 });
  });

  it('B.3 优先级：已保存快照的位置/名称/尺寸优先于种子；快照缺字段时种子回退', () => {
    const node = buildRecoveryTargetNode(record({
      recovery_seed: { target: { role: 'result-placeholder', x: 5, y: 6, width: 300, height: 200, name: '种子名' }, sources: [] },
      previous_target_snapshot: {
        id: 'n1', type: 'mediaNode', position: { x: 42, y: 24 }, width: 640, height: 480,
        data: { fileName: '用户改名.png' },
      },
    }));
    expect(node.position).toEqual({ x: 42, y: 24 });
    expect(node.data).toMatchObject({ fileName: '用户改名.png', width: 640, height: 480 });
    // 快照无位置/尺寸/名称 → 种子回退（发送时形态）
    const fallback = buildRecoveryTargetNode(record({
      recovery_seed: { target: { role: 'result-placeholder', x: 5, y: 6, width: 300, height: 200, name: '种子名' }, sources: [] },
      previous_target_snapshot: { id: 'n1', type: 'mediaNode', data: {} },
    }));
    expect(fallback.position).toEqual({ x: 5, y: 6 });
    expect(fallback.data).toMatchObject({ fileName: '种子名', width: 300, height: 200 });
  });

  it('succeeded 且输出 present 而卡仍在画布 → none（一对一已保存成品卡不被扇出重建）', () => {
    const plan = normalGenerationTask.planRecovery!(record({
      job: { job_id: 'j1', type: 'image', status: 'succeeded', progress: 100, output_asset_ids: ['9'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [
        { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
        { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'n1', state: 'present', revision: 1, node_binding_revision: 1, asset_id: '9', slot_id: null },
      ],
    }), hostOf(['n1'], { n1: { generationRecovery: { protocolVersion: 1, submissionId: 'sub-1', outputKey: 'primary' } } }));
    expect(plan).toEqual({ kind: 'none' });
    // 同项卡缺席（误删/丢失）→ 仍按投影补出
    const restore = normalGenerationTask.planRecovery!(record({
      job: { job_id: 'j1', type: 'image', status: 'succeeded', progress: 100, output_asset_ids: ['9'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [
        { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
        { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'n1', state: 'present', revision: 1, node_binding_revision: 1, asset_id: '9', slot_id: null },
      ],
    }), hostOf([]));
    expect(restore.kind).toBe('apply-outputs');
  });

  it('IKJKU3 pending 判定区分「已应用成品在场」与「待转换原卡在场」：present 且卡在场看 marker', () => {
    const succeededJob = { job_id: 'j1', type: 'image', status: 'succeeded', progress: 100, output_asset_ids: ['9'], stored_error: null, created_at: '2026-10-01T00:00:00Z' };
    const items = [
      { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending' as const, revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
      { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'n1', state: 'present' as const, revision: 1, node_binding_revision: 1, asset_id: '9', slot_id: null },
    ];
    // 待转换原卡在场（无 marker——受理回执丢失后的空卡）→ 仍 apply-outputs 原位写入
    const plainHost = hostOf(['n1'], { n1: { fileName: '原卡' } });
    expect(normalGenerationTask.planRecovery!(record({ job: succeededJob, items }), plainHost).kind).toBe('apply-outputs');
    // marker 属他提交（旧任务转换过的卡）→ 不算本输出已应用
    const staleHost = hostOf(['n1'], { n1: { generationRecovery: { protocolVersion: 1, submissionId: 'sub-other', outputKey: 'primary' } } });
    expect(normalGenerationTask.planRecovery!(record({ job: succeededJob, items }), staleHost).kind).toBe('apply-outputs');
    // pending 一律待应用（原卡在场不豁免）
    const pendingItems = [items[0]!, { ...items[1]!, state: 'pending' as const }];
    expect(normalGenerationTask.planRecovery!(record({ job: succeededJob, items: pendingItems }), plainHost).kind).toBe('apply-outputs');
  });
});

// ── IKJKU6 不回归网：普通单结果重试保留 def 后仍走一对一 primary 转换 ──────────────

describe('普通生成类型定义：重试运行时回归', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('普通单结果重试成功：仍走一对一 primary 转换（目标卡保留、差分 replaceTarget+apply）', async () => {
    const nodes = new Map<string, RuntimeNodeView>();
    nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { jobId: 'j1', genStatus: 'failed' } });
    const loadEpoch = {}; // 稳定加载身份（重渲染不推进）
    const host: GenerationRuntimeHost = {
      getProjectId: () => 'p1',
      getLoadEpoch: () => loadEpoch,
      getMediaNodes: () => [...nodes.values()],
      findNode: (id) => nodes.get(id) ?? null,
      patchNode: (nodeId, patch) => {
        const node = nodes.get(nodeId);
        if (node) nodes.set(nodeId, { ...node, data: { ...node.data, ...patch } });
      },
      insertMediaNode: (node) => { nodes.set(node.id, node); },
      removeMediaNode: (nodeId) => { nodes.delete(nodeId); },
      getEdges: () => [],
      addEdge: () => {},
      getActiveJob: () => undefined,
      setActiveJob: () => {},
      clearActiveJob: () => {},
      isLocallyRemoved: () => false,
      markLocallyRemoved: () => {},
      registerPendingDelete: () => {},
      isPendingDelete: () => false,
      applyTerminal: (nodeId, _jobId, detail) => {
        if (detail.status === 'succeeded') {
          const node = nodes.get(nodeId);
          if (node) nodes.set(nodeId, { ...node, data: { ...node.data, genStatus: undefined, src: detail.asset?.url ?? '' } });
        }
        return 'terminal';
      },
      settleCancelled: () => {},
      saveCanvas: async () => true,
      toast: () => {},
      openRechargeForCreditsError: () => false,
      addAuthResume: () => {},
      rememberAsset: () => {},
    };
    const emptyPage: GenerationRecoveryPage = { protocol_version: 1, canvas_version: 1, records: [], next_cursor: null };
    const runtime = createGenerationRuntime(host, {
      fetchJobStatus: (async () => ({
        status: 'succeeded', progress: 100,
        asset: { id: '9', url: 'https://a/9.png', type: 'image' },
        output_assets: [{ id: '9', url: 'https://a/9.png', type: 'image' }],
      })) as never,
      fetchRecoveryPage: (async () => JSON.parse(JSON.stringify(emptyPage))) as never,
      setTimeout: (() => 0) as never,
      clearTimeout: () => {},
      newId: () => 'sub-retry-1',
    });
    runtime.register(normalGenerationTask);
    apiMocks.retryGenerationJob.mockResolvedValueOnce({
      generation_job_id: 'j2', cursor: 2,
      canvas_binding: { protocol_version: 1, submission_id: 'sub-retry-1', target_node_id: 'n1', binding_revision: 1, job_id: 'j2', is_current: true },
    } as never);

    expect(runtime.retry('n1')).toBe(true);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();

    const data = nodes.get('n1')!.data;
    expect(data.jobId).toBe('j2');
    expect(data.generationRecovery).toEqual({ protocolVersion: 1, submissionId: 'sub-retry-1', outputKey: 'primary' });
    expect(runtime.composeSaveFields()!.recoveryChanges.map((change) => `${change.action}:${change.recoveryItemId}`).sort()).toEqual([
      'apply:gcr:sub-retry-1:primary',
      'replaceTarget:gcr:sub-retry-1:$target',
    ]);
    expect(nodes.has('n1')).toBe(true); // 一对一：目标卡保留为结果卡（不扇出移除）
  });
});

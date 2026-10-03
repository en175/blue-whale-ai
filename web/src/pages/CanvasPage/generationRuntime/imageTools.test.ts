/* ============================================
 * 图像工具类型定义契约测试（IKJJR2）：四键身份识别（排除姊妹家族）、冻结输入可信判定、
 * 创建/重试/取消协议（四专属端点 + 通用取消）、恢复规划（复用普通生成 + 来源线补边）、
 * 与运行时的组合冒烟（受理台账 → 轮询成功 → primary marker）。
 * ============================================ */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  createImageEnhancement: vi.fn(async () => ({ job_id: 'e1', status: 'queued' })),
  createImageErase: vi.fn(async () => ({ job_id: 'e2', status: 'queued' })),
  createImageCutout: vi.fn(async () => ({ job_id: 'e3', status: 'queued' })),
  createImageOutpaint: vi.fn(async () => ({ job_id: 'e4', status: 'queued' })),
  cancelGenerationJob: vi.fn(async () => null),
  fetchJobStatus: vi.fn(async () => ({ status: 'processing', progress: 0, asset: null })),
  createGenerationJob: vi.fn(async () => ({ generation_job_id: 'j1', cursor: 1 })),
  retryGenerationJob: vi.fn(async () => ({ generation_job_id: 'j2', cursor: 2 })),
}));

vi.mock('@/api/jobs', () => ({
  createImageEnhancement: apiMocks.createImageEnhancement,
  createImageErase: apiMocks.createImageErase,
  createImageCutout: apiMocks.createImageCutout,
  createImageOutpaint: apiMocks.createImageOutpaint,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createGenerationJob: apiMocks.createGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
}));

import { createImageToolsTask, isImageToolsCard } from './imageTools';
import { createGenerationRuntime, type GenerationRuntimeDeps } from './runtime';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

const BINDING = {
  protocol_version: 1 as const,
  submission_id: '22222222-2222-4222-8222-222222222222',
  target_node_id: 'n1',
  expected_binding_revision: 1,
  recovery_seed: {
    target: { role: 'result-placeholder' as const, x: 1, y: 2, width: 320, height: 320, name: '擦除' },
    sources: [{ node_id: 'src-1', x: 0, y: 0, width: 300, height: 200, name: '源图' }],
  },
};

describe('图像工具类型定义：身份识别', () => {
  it('四键任一在卡 data → 本家族（含未提交草稿卡——cancel/remove 由运行时退回无 jobId 路径）', () => {
    expect(isImageToolsCard('n1', { imageEnhance: { sourceAssetId: '5' } })).toBe(true);
    expect(isImageToolsCard('n1', { imageErase: { sourceAssetId: '5', lastInput: {} } })).toBe(true);
    expect(isImageToolsCard('n1', { imageCutout: { sourceAssetId: '5' } })).toBe(true);
    expect(isImageToolsCard('n1', { imageOutpaint: { sourceAssetId: '5' } })).toBe(true);
  });

  it('姊妹家族与普通生成卡 → 排除', () => {
    for (const key of ['videoEnhance', 'frameInterpolation', 'videoSubtitleErase', 'vocalSplit', 'sceneSplit', 'smartMatting', 'audioVideoMux']) {
      expect(isImageToolsCard('n1', { jobId: 'j1', [key]: { last: true } })).toBe(false);
    }
    expect(isImageToolsCard('n1', { jobId: 'j1', genStatus: 'failed' })).toBe(false);
    expect(isImageToolsCard('n1', {})).toBe(false);
  });
});

describe('图像工具类型定义：冻结输入（失败卡重试只用可信冻结输入）', () => {
  const def = createImageToolsTask();

  it('lastInput / lastParams 按 identity 键读取；source_asset_id + target 指向本卡 → 可信', () => {
    const input = { source_asset_id: '5', target_node_id: 'n1', erase_scene: 'full_screen_text_erase' };
    expect(def.frozenInput!('n1', { imageErase: { lastInput: input } })).toEqual({ kind: 'imageErase', input });
    const params = { source_asset_id: '5', target_node_id: 'n1', version_tier: 'pro', multiple: 2, generative_enhance_mode: 'generative_first', enable_correct_color: false };
    expect(def.frozenInput!('n1', { imageEnhance: { lastParams: params } })).toEqual({ kind: 'imageEnhance', input: params });
  });

  it('缺失 / 空源素材 / 承接目标不是本卡 → null（保留失败卡提示重新编辑，不补默认值）', () => {
    expect(def.frozenInput!('n1', { imageErase: {} })).toBeNull();
    expect(def.frozenInput!('n1', { imageErase: { lastInput: { target_node_id: 'n1' } } })).toBeNull();
    expect(def.frozenInput!('n1', { imageErase: { lastInput: { source_asset_id: '', target_node_id: 'n1' } } })).toBeNull();
    expect(def.frozenInput!('n1', { imageErase: { lastInput: { source_asset_id: '5', target_node_id: 'other' } } })).toBeNull();
  });
});

describe('图像工具类型定义：创建/重试/取消协议', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const def = createImageToolsTask();

  it('四 kind 分派各自创建端点；binding/key 经 init 下传（body 注入与幂等头归 jobs 层，另有契约测试）；回执透传并通知受理', async () => {
    apiMocks.createImageErase.mockResolvedValueOnce({
      job_id: 'e2', status: 'queued',
      canvas_binding: { protocol_version: 1, submission_id: BINDING.submission_id, target_node_id: 'n1', binding_revision: 3, job_id: 'e2', is_current: true },
    } as never);
    const notified: Array<[string, unknown]> = [];
    const notifyingDef = createImageToolsTask((nodeId, settled) => notified.push([nodeId, settled]));
    const outcome = await notifyingDef.create!('p1', {
      payload: { kind: 'imageErase', input: { source_asset_id: '5', target_node_id: 'n1', erase_scene: 'full_screen_text_erase' } as never },
      target: { targetNodeId: 'n1', seedTarget: BINDING.recovery_seed.target, seedSources: [], expectedBindingRevision: 0 },
    }, BINDING, BINDING.submission_id);
    expect(apiMocks.createImageErase).toHaveBeenCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'n1', erase_scene: 'full_screen_text_erase',
    }, { silent: true, canvasBinding: BINDING, idempotencyKey: BINDING.submission_id });
    expect(outcome).toMatchObject({ jobId: 'e2', canvasBinding: { binding_revision: 3, is_current: true } });
    expect(notified).toEqual([['n1', { jobId: 'e2' }]]);
  });

  it('无 canvas_binding 的历史兼容提交：body 不带绑定、无幂等头（请求形态与接入前一致）', async () => {
    await def.create!('p1', {
      payload: { kind: 'imageOutpaint', input: { source_asset_id: '5', target_node_id: 'n1', top: 0.1 } as never },
      target: { targetNodeId: 'n1', seedTarget: BINDING.recovery_seed.target, seedSources: [], expectedBindingRevision: 0 },
    }, null, '');
    expect(apiMocks.createImageOutpaint).toHaveBeenCalledWith('p1', { source_asset_id: '5', target_node_id: 'n1', top: 0.1 }, { silent: true });
  });

  it('创建失败：通知受理 error 且原样抛出', async () => {
    apiMocks.createImageCutout.mockRejectedValueOnce(new Error('boom') as never);
    const notified: Array<[string, unknown]> = [];
    const notifyingDef = createImageToolsTask((nodeId, settled) => notified.push([nodeId, settled]));
    await expect(notifyingDef.create!('p1', {
      payload: { kind: 'imageCutout', input: { source_asset_id: '5', target_node_id: 'n1', scene: 'general' } as never },
      target: { targetNodeId: 'n1', seedTarget: BINDING.recovery_seed.target, seedSources: [], expectedBindingRevision: 0 },
    }, null, '')).rejects.toThrow('boom');
    expect(notified).toEqual([['n1', { error: expect.objectContaining({ message: 'boom' }) }]]);
  });

  it('重试 = 冻结输入原样重发创建端点（四工具契约无 retry 端点），不走通用重试', async () => {
    const lastInput = { source_asset_id: '5', target_node_id: 'n1', erase_scene: 'selected_area_erase', mask_asset_id: '9' };
    await def.retry!('p1', 'j401', { nodeId: 'n1', nodeData: { imageErase: { lastInput } } }, BINDING, BINDING.submission_id);
    expect(apiMocks.createImageErase).toHaveBeenCalledWith('p1', lastInput, { silent: true, canvasBinding: BINDING, idempotencyKey: BINDING.submission_id });
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
  });

  it('取消：走通用 generation-jobs cancel 端点', async () => {
    await def.cancel!('p1', 'j9');
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j9');
  });
});

describe('图像工具类型定义：恢复规划', () => {
  const def = createImageToolsTask();

  const record = (overrides: Partial<GenerationRecoveryRecord> = {}): GenerationRecoveryRecord => ({
    submission_id: 'sub-1', target_node_id: 'n1', job_id: 'j1', task_type: 'image_erase',
    binding_revision: 1, is_current: true,
    job: { job_id: 'j1', type: 'image_erase', status: 'processing', progress: 10, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: { target: { role: 'result-placeholder', x: 5, y: 6, width: 300, height: 200, name: '擦除' }, sources: [{ node_id: 'src-1', x: 0, y: 0, width: 300, height: 200, name: '源图' }] },
    previous_target_snapshot: null,
    items: [{ recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
    ...overrides,
  });

  const hostOf = (ids: string[]): GenerationRuntimeHost => ({
    findNode: (id: string) => (ids.includes(id) ? { id, type: 'mediaNode', position: { x: 0, y: 0 }, data: {} } : null),
  } as unknown as GenerationRuntimeHost);

  it('进行中且卡在 → 续轮询；卡缺失 → 按种子补卡（fileName 取提交时快照名）并从种子补来源线', () => {
    expect(def.planRecovery!(record(), hostOf(['n1']))).toEqual({ kind: 'resume-polling' });
    const plan = def.planRecovery!(record(), hostOf(['src-1']));
    expect(plan.kind).toBe('restore-target');
    if (plan.kind !== 'restore-target') return;
    expect(plan.node).toMatchObject({ id: 'n1', position: { x: 5, y: 6 } });
    expect(plan.node.data).toMatchObject({ genStatus: 'generating', jobId: 'j1', mediaType: 'image', fileName: '擦除' });
    expect(plan.edges).toEqual([{ source: 'src-1', target: 'n1' }]);
  });

  it('种子来源节点已不在画布 → 不补来源线（不伪造悬空边）', () => {
    const plan = def.planRecovery!(record(), hostOf([]));
    expect(plan.kind).toBe('restore-target');
    if (plan.kind !== 'restore-target') return;
    expect(plan.edges ?? []).toEqual([]);
  });

  it('succeeded 且 primary 输出未应用 → 复用普通生成的输出投影（一对一/扇出同构）', () => {
    const plan = def.planRecovery!(record({
      job: { job_id: 'j1', type: 'image_enhance', status: 'succeeded', progress: 100, output_asset_ids: ['11'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [
        { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
        { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'n1', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '11', slot_id: null },
      ],
    }), hostOf(['n1']));
    expect(plan).toMatchObject({ kind: 'apply-outputs' });
    if (plan.kind !== 'apply-outputs') return;
    expect(plan.projection.outputs).toEqual([
      { outputKey: 'primary', nodeId: 'n1', assetId: '11', url: '', mediaType: 'image' },
    ]);
  });
});

describe('图像工具类型定义：与运行时组合冒烟（真实 def 接 runtime）', () => {
  /** 手动时钟：轮询续链只在 fireNext 时推进（口径同 runtime.test.ts）。 */
  class ManualClock {
    private seq = 0;
    private timers = new Map<number, { fn: () => void; at: number }>();
    setTimeout = (fn: () => void, ms: number) => {
      const id = ++this.seq;
      this.timers.set(id, { fn, at: ms });
      return id;
    };
    clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
    fireNext(): boolean {
      for (const [id, timer] of this.timers) {
        this.timers.delete(id);
        timer.fn();
        return true;
      }
      return false;
    }
  }
  const flushMicrotasks = async (rounds = 12) => {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  };

  it('擦除提交（受理回执 + 卡为受理后建）→ 台账落归属版本，轮询成功后原卡写 primary marker', async () => {
    vi.clearAllMocks();
    const nodes = new Map<string, RuntimeNodeView>();
    const epoch = {};
    const host: GenerationRuntimeHost = {
      getProjectId: () => 'p1',
      getLoadEpoch: () => epoch,
      getMediaNodes: () => [...nodes.values()],
      findNode: (id) => nodes.get(id) ?? null,
      patchNode: (id, patch) => {
        const node = nodes.get(id);
        if (node) nodes.set(id, { ...node, data: { ...node.data, ...patch } });
      },
      insertMediaNode: (node) => { nodes.set(node.id, node); },
      removeMediaNode: (id) => { nodes.delete(id); },
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
        const node = nodes.get(nodeId);
        if (node && detail.status === 'succeeded') {
          nodes.set(nodeId, { ...node, data: { ...node.data, genStatus: undefined, src: detail.asset?.url ?? '' } });
        }
        return 'terminal';
      },
      settleCancelled: () => {},
      saveCanvas: async () => true,
      toast: () => {},
      openRechargeForCreditsError: () => false,
      addAuthResume: () => {},
      rememberAsset: () => {},
      fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
    };
    const clock = new ManualClock();
    let pollCount = 0;
    const deps: GenerationRuntimeDeps = {
      fetchJobStatus: (async () => {
        pollCount += 1;
        return pollCount === 1
          ? { status: 'processing', progress: 10, asset: null } as never
          : { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } } as never;
      }) as never,
      setTimeout: clock.setTimeout as never,
      clearTimeout: clock.clearTimeout as never,
      newId: (() => { let n = 0; return () => `uuid-${String(++n).padStart(4, '0')}`; })(),
    };
    apiMocks.createImageErase.mockResolvedValueOnce({
      job_id: 'e2', status: 'queued',
      canvas_binding: { protocol_version: 1, submission_id: 'uuid-0001', target_node_id: 'n1', binding_revision: 1, job_id: 'e2', is_current: true },
    } as never);
    const def = createImageToolsTask();
    const runtime = createGenerationRuntime(host, deps);
    runtime.register(def);
    const dispatched = runtime.submit(def, {
      payload: { kind: 'imageErase', input: { source_asset_id: '5', target_node_id: 'n1', erase_scene: 'full_screen_text_erase' } as never },
      target: { targetNodeId: 'n1', seedTarget: BINDING.recovery_seed.target, seedSources: [], expectedBindingRevision: 0 },
    });
    expect(dispatched).toBe(true);
    await flushMicrotasks();
    expect(pollCount).toBe(1); // 首轮 processing：受理后卡未建，进度 patch no-op
    // 受理后建卡（handoff 时机）：卡在此补上（jobId 由 handoff 建卡写入），续链照常收敛
    nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { imageErase: { sourceAssetId: '5' }, jobId: 'e2', genStatus: 'generating', progress: 0 } });
    clock.fireNext();
    await flushMicrotasks();
    const data = nodes.get('n1')!.data;
    expect(data.jobId).toBe('e2');
    expect(runtime.bindingRevisionOf('n1')).toBe(1);
    expect(data.generationRecovery).toEqual({ protocolVersion: 1, submissionId: 'uuid-0001', outputKey: 'primary' });
    expect(runtime.statusOf('n1')).toBeNull();
  });
});

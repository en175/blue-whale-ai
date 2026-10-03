/* ============================================
 * 生成任务运行时公开接口测试（IKJJR1，测试接缝 = 五动作 + 保存差分 + 恢复扫描）。
 * 注入可控 API 响应、手动时钟与画布宿主；不断言私有变量/Hook 顺序。
 * ============================================ */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import { createGenerationRuntime, type GenerationRuntimeDeps } from './runtime';
import { normalGenerationTask } from './normalGeneration';
import type { GenerationRuntimeHost, GenerationTaskDefinition, RuntimeNodeView } from './types';
import type { GenerationRecoveryPage, GenerationRecoveryRecord } from '@/api/canvasRecovery';

/** 手动时钟：轮询续链只在 flush 时推进。 */
class ManualClock {
  now = 0;
  private seq = 0;
  private timers = new Map<number, { fn: () => void; at: number }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.set(id, { fn, at: this.now + ms });
    return id;
  };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  /** 推进到最近的定时器并触发（无定时器返回 false）。 */
  fireNext(): boolean {
    let targetId: number | null = null;
    let targetAt = Infinity;
    for (const [id, timer] of this.timers) {
      if (timer.at < targetAt) { targetAt = timer.at; targetId = id; }
    }
    if (targetId == null) return false;
    const timer = this.timers.get(targetId)!;
    this.timers.delete(targetId);
    this.now = timer.at;
    timer.fn();
    return true;
  }
  pendingCount(): number { return this.timers.size; }
}

const flushMicrotasks = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

interface FakeHost {
  host: GenerationRuntimeHost;
  nodes: Map<string, RuntimeNodeView>;
  edges: Array<{ source: string; target: string }>;
  patches: Array<{ nodeId: string; patch: Record<string, unknown> }>;
  inserts: RuntimeNodeView[];
  removes: string[];
  toasts: Array<{ kind: string; message: string }>;
  activeTokens: Map<string, string>;
  locallyRemoved: Set<string>;
  pendingDeletes: Set<string>;
  terminalResults: Array<{ nodeId: string; jobId: string; status: string }>;
  settles: string[];
  switchProject: (project: string | null) => void;
  advanceEpoch: () => void;
  data: (nodeId: string) => Record<string, unknown>;
}

function createFakeHost(): FakeHost {
  const nodes = new Map<string, RuntimeNodeView>();
  const edges: Array<{ source: string; target: string }> = [];
  const patches: FakeHost['patches'] = [];
  const inserts: RuntimeNodeView[] = [];
  const removes: string[] = [];
  const toasts: FakeHost['toasts'] = [];
  const activeTokens = new Map<string, string>();
  const locallyRemoved = new Set<string>();
  const pendingDeletes = new Set<string>();
  const terminalResults: FakeHost['terminalResults'] = [];
  const settles: string[] = [];
  let project: string | null = 'p1';
  let epoch: object = {};
  const host: GenerationRuntimeHost = {
    getProjectId: () => project,
    getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()],
    findNode: (id) => nodes.get(id) ?? null,
    patchNode: (nodeId, patch) => {
      patches.push({ nodeId, patch });
      const node = nodes.get(nodeId);
      if (node) nodes.set(nodeId, { ...node, data: { ...node.data, ...patch } });
    },
    insertMediaNode: (node) => { inserts.push(node); nodes.set(node.id, node); },
    removeMediaNode: (nodeId) => { removes.push(nodeId); nodes.delete(nodeId); },
    getEdges: () => edges,
    addEdge: (source, target) => { edges.push({ source, target }); },
    getActiveJob: (nodeId) => activeTokens.get(nodeId),
    setActiveJob: (nodeId, token) => { activeTokens.set(nodeId, token); },
    clearActiveJob: (nodeId) => { activeTokens.delete(nodeId); },
    isLocallyRemoved: (nodeId) => locallyRemoved.has(nodeId),
    markLocallyRemoved: (nodeId) => { locallyRemoved.add(nodeId); },
    registerPendingDelete: (nodeId) => { pendingDeletes.add(nodeId); },
    isPendingDelete: (nodeId) => pendingDeletes.has(nodeId),
    applyTerminal: (nodeId, jobId, detail) => {
      terminalResults.push({ nodeId, jobId, status: detail.status });
      if (detail.status === 'succeeded') {
        const node = nodes.get(nodeId);
        if (node) nodes.set(nodeId, { ...node, data: { ...node.data, genStatus: undefined, src: detail.asset?.url ?? '', assetId: detail.asset?.id } });
      }
      if (detail.status === 'failed') {
        const node = nodes.get(nodeId);
        if (node) nodes.set(nodeId, { ...node, data: { ...node.data, genStatus: 'failed' } });
      }
      return 'terminal';
    },
    settleCancelled: (nodeId) => { settles.push(nodeId); },
    saveCanvas: async () => true,
    toast: (kind, message) => { toasts.push({ kind, message }); },
    openRechargeForCreditsError: () => false,
    addAuthResume: () => {},
    rememberAsset: () => {},
  };
  return {
    host, nodes, edges, patches, inserts, removes, toasts, activeTokens, locallyRemoved,
    pendingDeletes, terminalResults, settles,
    switchProject: (next) => { project = next; epoch = {}; nodes.clear(); edges.length = 0; },
    advanceEpoch: () => { epoch = {}; },
    data: (nodeId) => nodes.get(nodeId)?.data ?? {},
  };
}

/** 测试用任务定义：记录请求，响应可控。 */
function createFakeDef() {
  const calls = {
    create: [] as Array<{ projectId: string; payload: unknown; binding: unknown; key: string }>,
    retry: [] as Array<{ projectId: string; jobId: string; binding: unknown; key: string }>,
    cancel: [] as Array<{ projectId: string; jobId: string }>,
  };
  let createResponse: () => Promise<unknown> = async () => ({ jobId: '501', canvasBinding: null });
  let retryResponse: () => Promise<unknown> = async () => ({ jobId: '502', canvasBinding: null });
  let cancelResponse: () => Promise<unknown> = async () => ({});
  return {
    calls,
    respond: {
      create: (fn: () => Promise<unknown>) => { createResponse = fn; },
      retry: (fn: () => Promise<unknown>) => { retryResponse = fn; },
      cancel: (fn: () => Promise<unknown>) => { cancelResponse = fn; },
    },
    def: {
      taskTypes: ['image', 'video', 'audio'],
      identify: normalGenerationTask.identify,
      create: async (projectId: string, input: { payload: unknown }, binding: unknown, key: string) => {
        calls.create.push({ projectId, payload: input.payload, binding, key });
        return createResponse();
      },
      retry: async (projectId: string, jobId: string, _data: unknown, binding: unknown, key: string) => {
        calls.retry.push({ projectId, jobId, binding, key });
        return retryResponse();
      },
      cancel: async (projectId: string, jobId: string) => {
        calls.cancel.push({ projectId, jobId });
        return cancelResponse();
      },
      planRecovery: normalGenerationTask.planRecovery,
    } as unknown as GenerationTaskDefinition,
  };
}

/** 可编程任务状态序列（每次 fetchJobStatus 消费一项；耗尽重复最后一项）。 */
function statusScript(script: Array<Record<string, unknown>>) {
  const calls: Array<unknown> = [];
  let index = 0;
  const fn = vi.fn(async (jobId: unknown) => {
    calls.push(jobId);
    const item = script[Math.min(index, script.length - 1)];
    index += 1;
    return JSON.parse(JSON.stringify(item ?? { job_id: jobId, status: 'processing', progress: 0, asset: null }));
  });
  return { fn, calls };
}

function pageScript(pages: GenerationRecoveryPage[]) {
  let index = 0;
  return vi.fn(async () => {
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    return JSON.parse(JSON.stringify(page));
  });
}

const BINDING_VIEW = (submissionId: string, nodeId: string, jobId: string, revision = 1) => ({
  protocol_version: 1,
  submission_id: submissionId,
  target_node_id: nodeId,
  binding_revision: revision,
  job_id: jobId,
  is_current: true,
});

const targetFacts = (nodeId: string, role: 'draft' | 'existing-media' | 'result-placeholder' = 'result-placeholder') => ({
  targetNodeId: nodeId,
  seedTarget: { role, x: 10, y: 20, width: 320, height: 320, name: '卡' },
  seedSources: [],
  expectedBindingRevision: 0,
});

function setup(overrides: { script?: Array<Record<string, unknown>> } = {}) {
  const fake = createFakeHost();
  const clock = new ManualClock();
  const status = statusScript(overrides.script ?? [{ status: 'processing', progress: 10, asset: null }]);
  const page = pageScript([{ protocol_version: 1, canvas_version: 3, records: [], next_cursor: null }]);
  const deps: GenerationRuntimeDeps = {
    fetchJobStatus: status.fn as never,
    fetchRecoveryPage: page as never,
    setTimeout: clock.setTimeout as never,
    clearTimeout: clock.clearTimeout as never,
    newId: (() => { let n = 0; return () => `uuid-${String(++n).padStart(4, '0')}`; })(),
  };
  const runtime = createGenerationRuntime(fake.host, deps);
  const kit = createFakeDef();
  runtime.register(kit.def);
  return { fake, runtime, clock, status, page, kit };
}

describe('生成任务运行时：submit', () => {
  it('创建请求携带 canvas_binding，Idempotency-Key = submission_id；受理后回填 jobId 并开始轮询', async () => {
    const { fake, runtime, kit } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    const dispatched = runtime.submit(kit.def, { payload: { type: 'image' }, target: targetFacts('n1') });
    expect(dispatched).toBe(true);
    await flushMicrotasks();
    expect(kit.calls.create).toHaveLength(1);
    const call = kit.calls.create[0]!;
    expect(call.key).toMatch(/^uuid-/);
    expect(call.binding).toMatchObject({
      protocol_version: 1,
      submission_id: call.key,
      target_node_id: 'n1',
      expected_binding_revision: 0,
      recovery_seed: { target: { role: 'result-placeholder', x: 10, y: 20 } },
    });
    expect(fake.data('n1').jobId).toBe('501');
    expect(runtime.statusOf('n1')).toMatchObject({ phase: 'generating', jobId: '501', submissionId: 'uuid-0001' });
  });

  it('创建窗口内重复提交被拒（重复点击保护）', async () => {
    const { fake, runtime, kit } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} });
    let resolveCreate: (value: unknown) => void = () => {};
    kit.respond.create(() => new Promise((resolve) => { resolveCreate = resolve; }));
    expect(runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') })).toBe(true);
    expect(runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') })).toBe(false);
    resolveCreate({ jobId: '501', canvasBinding: null });
    await flushMicrotasks();
    expect(kit.calls.create).toHaveLength(1);
  });

  it('受理撞归属冲突（409 canvas_binding_conflict）：采纳服务端版本，同意图（同 submission_id）重发一次', async () => {
    const { fake, runtime, kit } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    const conflictError = new ApiError(409, '目标节点承接版本已变化', 409, {
      reason: 'canvas_binding_conflict', currentBindingRevision: 4,
    });
    let first = true;
    kit.respond.create(async () => {
      if (first) { first = false; throw conflictError; }
      return { jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501', 5) };
    });
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks(20);
    expect(kit.calls.create).toHaveLength(2);
    expect(kit.calls.create[1]!.binding).toMatchObject({ expected_binding_revision: 4, submission_id: kit.calls.create[0]!.key });
    expect(kit.calls.create[1]!.key).toBe(kit.calls.create[0]!.key); // 同意图同一把
    expect(fake.data('n1').jobId).toBe('501');
    expect(runtime.bindingRevisionOf('n1')).toBe(5);
  });

  it('创建失败落失败卡，不启动轮询', async () => {
    const { fake, runtime, kit, clock } = setup({ script: [{ status: 'succeeded', asset: null }] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} });
    kit.respond.create(async () => { throw new Error('boom'); });
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    expect(fake.data('n1')).toMatchObject({ genStatus: 'failed', errorText: '创建任务失败' });
    expect(clock.pendingCount()).toBe(0);
  });
});

describe('生成任务运行时：轮询归属与乱序', () => {
  it('同卡新执行接管后，旧执行迟到响应丢弃且不续链', async () => {
    const { fake, runtime, kit, clock, status } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    // 首轮轮询在途（processing）——同卡再提交（新意图接管）
    const callsOf501BeforeTakeover = status.calls.filter((id) => id === '501').length;
    kit.respond.create(async () => ({ jobId: '502', canvasBinding: BINDING_VIEW('uuid-0002', 'n1', '502', 2) }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    clock.fireNext();
    await flushMicrotasks();
    clock.fireNext();
    await flushMicrotasks();
    // 旧 501 的轮询链不续（接管后只有 502 在轮询）
    expect(status.calls.filter((id) => id === '501')).toHaveLength(callsOf501BeforeTakeover);
    expect(status.calls.filter((id) => id === '502').length).toBeGreaterThan(0);
    expect(fake.data('n1').jobId).toBe('502');
  });

  it('A→B→A：加载身份变化后旧执行的受理结果不写入', async () => {
    const { fake, runtime, kit, status } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} });
    let resolveCreate: (value: unknown) => void = () => {};
    kit.respond.create(() => new Promise((resolve) => { resolveCreate = resolve; }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    fake.advanceEpoch(); // 同项目重载
    resolveCreate({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') });
    await flushMicrotasks();
    expect(fake.data('n1').jobId).toBeUndefined();
    expect(status.calls).toHaveLength(0);
  });

  it('终态后停止轮询；成功一对一写 primary marker 并在保存差分出 replaceTarget+apply', async () => {
    const { fake, runtime, kit, clock } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    expect(clock.pendingCount()).toBe(0); // 终态后无续链
    expect(fake.data('n1').generationRecovery).toEqual({ protocolVersion: 1, submissionId: 'uuid-0001', outputKey: 'primary' });
    const fields = runtime.composeSaveFields();
    expect(fields).not.toBeNull();
    const actions = Object.fromEntries(fields!.recoveryChanges.map((change) => [change.action, change]));
    expect(actions.replaceTarget).toMatchObject({ recoveryItemId: 'gcr:uuid-0001:$target', expectedRevision: 1 });
    expect(actions.apply).toMatchObject({ recoveryItemId: 'gcr:uuid-0001:primary', expectedRevision: 0 });
    runtime.onSaveReceipt({ commandId: fields!.commandId, replayed: false, changes: [
      { recoveryItemId: 'gcr:uuid-0001:$target', revision: 2, nodeBindingRevision: 1, state: 'replaced' },
      { recoveryItemId: 'gcr:uuid-0001:primary', revision: 1, nodeBindingRevision: 1, state: 'present' },
    ] });
    expect(runtime.composeSaveFields()).toBeNull(); // 回执确认后无待确认状态
  });

  it('回执重放（replayed）仅确认，不重复确认也不覆盖', async () => {
    const { fake, runtime, kit } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    const receipt = { commandId: 'cmd-1', replayed: true, changes: [
      { recoveryItemId: 'gcr:uuid-0001:$target', revision: 2, nodeBindingRevision: 1, state: 'replaced' },
      { recoveryItemId: 'gcr:uuid-0001:primary', revision: 1, nodeBindingRevision: 1, state: 'present' },
    ] };
    runtime.onSaveReceipt(receipt);
    runtime.onSaveReceipt(receipt);
    expect(runtime.composeSaveFields()).toBeNull();
  });
});

describe('生成任务运行时：retry', () => {
  it('无受理关联的失败卡（历史兼容）重试不带 canvas_binding', async () => {
    const { fake, runtime, kit } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { jobId: '401', genStatus: 'failed' } });
    expect(runtime.claims('n1', fake.data('n1'))).toBe(true);
    kit.respond.retry(async () => ({ jobId: '402', canvasBinding: null }));
    expect(runtime.retry('n1')).toBe(true);
    await flushMicrotasks();
    expect(kit.calls.retry[0]!.binding).toBeNull();
    expect(fake.data('n1').jobId).toBe('402');
  });

  it('有受理关联（marker）的失败卡重试带 canvas_binding，key = submission_id；归属版本取台账', async () => {
    const { fake, kit } = setup();
    fake.nodes.set('n1', {
      id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 },
      data: { jobId: '401', genStatus: 'failed', generationRecovery: { protocolVersion: 1, submissionId: 'sub-old', outputKey: '$target' } },
    });
    // 台账经恢复扫描注入：$target nodeBindingRevision = 3
    const page = pageScript([{ protocol_version: 1, canvas_version: 1, records: [{
      submission_id: 'sub-old', target_node_id: 'n1', job_id: '401', task_type: 'image',
      binding_revision: 3, is_current: true,
      job: { job_id: '401', type: 'image', status: 'failed', progress: 0, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      recovery_seed: null,
      previous_target_snapshot: null,
      items: [{ recovery_item_id: 'gcr:sub-old:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 3, asset_id: null, slot_id: null }],
    }], next_cursor: null }]);
    const rt2 = createGenerationRuntime(fake.host, {
      fetchRecoveryPage: page as never,
      newId: () => 'uuid-7777',
    });
    rt2.register(kit.def);
    await rt2.recover('p1');
    kit.respond.retry(async () => ({ jobId: '402', canvasBinding: BINDING_VIEW('uuid-7777', 'n1', '402', 4) }));
    expect(rt2.retry('n1')).toBe(true);
    await flushMicrotasks();
    expect(kit.calls.retry[0]!.binding).toMatchObject({
      submission_id: 'uuid-7777', target_node_id: 'n1', expected_binding_revision: 3,
    });
    expect(kit.calls.retry[0]!.key).toBe('uuid-7777');
    expect(rt2.bindingRevisionOf('n1')).toBe(4);
  });

  it('生成中卡片重试被防重入拦截', async () => {
    const { fake, runtime, kit } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { jobId: '401', genStatus: 'generating' } });
    expect(runtime.retry('n1')).toBe(true);
    expect(kit.calls.retry).toHaveLength(0);
  });
});

describe('生成任务运行时：cancel 与 remove', () => {
  it('取消按权威终态收敛：cancelled 后保留卡（settleCancelled）并差分 settleTarget（草稿角色）', async () => {
    const { fake, runtime, kit } = setup({ script: [
      { status: 'processing', progress: 10, asset: null },
      { status: 'cancelled', progress: 0, asset: null },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating', draft: true } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1', 'draft') });
    await flushMicrotasks();
    expect(runtime.cancel('n1')).toBe(true);
    await flushMicrotasks();
    expect(fake.settles).toContain('n1');
    const fields = runtime.composeSaveFields();
    expect(fields?.recoveryChanges).toEqual([
      { recoveryItemId: 'gcr:uuid-0001:$target', expectedRevision: 1, action: 'settleTarget' },
    ]);
  });

  it('取消遇到抢先成功：收敛器挂载作品，不回退卡', async () => {
    const { fake, runtime, kit } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    runtime.cancel('n1');
    await flushMicrotasks();
    expect(fake.settles).toHaveLength(0);
    expect(fake.data('n1').assetId).toBe('9');
  });

  it('remove：取消确认 cancelled/failed 后移除卡，并在保存差分出 remove（$target）', async () => {
    const { fake, runtime, kit } = setup({ script: [
      { status: 'processing', progress: 10, asset: null },
      { status: 'cancelled', progress: 0, asset: null },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    expect(runtime.remove('n1')).toBe(true);
    await flushMicrotasks();
    expect(fake.removes).toContain('n1');
    expect(fake.locallyRemoved.has('n1')).toBe(true);
    expect(runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: 'gcr:uuid-0001:$target', expectedRevision: 1, action: 'remove' },
    ]);
  });

  it('remove：任务仍 processing 时登记删除意图（不抢先移除）', async () => {
    const { fake, runtime, kit } = setup({ script: [
      { status: 'processing', progress: 10, asset: null },
      { status: 'processing', progress: 30, asset: null },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    runtime.remove('n1');
    await flushMicrotasks();
    expect(fake.pendingDeletes.has('n1')).toBe(true);
    expect(fake.removes).toHaveLength(0);
  });
});

describe('生成任务运行时：recover', () => {
  const record = (overrides: Partial<Record<string, unknown>> = {}): GenerationRecoveryRecord => ({
    submission_id: 'sub-1', target_node_id: 'n1', job_id: '501', task_type: 'image',
    binding_revision: 1, is_current: true,
    job: { job_id: '501', type: 'image', status: 'processing', progress: 20, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: { target: { role: 'result-placeholder', x: 5, y: 6, width: 320, height: 320, name: '图片生成中' }, sources: [] },
    previous_target_snapshot: null,
    items: [{ recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
    ...overrides,
  } as GenerationRecoveryRecord);

  it('进行中且卡在：续轮询；重复扫描不双链', async () => {
    const { fake, runtime, status, page } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { jobId: '501', genStatus: 'generating' } });
    page.mockImplementation(async () => ({
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [record()],
    }) as never);
    await runtime.recover('p1');
    expect(status.calls).toHaveLength(1);
    await runtime.recover('p1'); // 重复扫描：active 判重
    expect(status.calls).toHaveLength(1);
  });

  it('进行中但卡不在（受理回执丢失）：按恢复种子补卡一次，不重复建卡', async () => {
    const { fake, runtime, page } = setup();
    page.mockImplementation(async () => ({
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [record()],
    }) as never);
    await runtime.recover('p1');
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0]).toMatchObject({ id: 'n1', type: 'mediaNode' });
    expect(fake.inserts[0]!.data).toMatchObject({ genStatus: 'generating', jobId: '501', mediaType: 'image' });
    await runtime.recover('p1');
    expect(fake.inserts).toHaveLength(1);
  });

  it('is_current=false 的历史关联：无画布动作（不猜卡）', async () => {
    const { fake, runtime, page, status } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating', jobId: '501' } });
    page.mockImplementation(async () => ({
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [record({ is_current: false, job: null })],
    }) as never);
    await runtime.recover('p1');
    expect(fake.inserts).toHaveLength(0);
    expect(status.calls).toHaveLength(0); // 不复活轮询
  });

  it('succeeded 且有未应用输出：拉详情取产物，扇出输出槽卡并差分 replaceTarget + apply', async () => {
    const { fake, runtime, status, page } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: null, output_assets: [
        { id: '11', url: 'https://a/11.png', type: 'image' },
        { id: '12', url: 'https://a/12.png', type: 'image' },
      ] },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { jobId: '501', genStatus: 'generating' } });
    page.mockImplementation(async () => ({
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [record({
        job: { job_id: '501', type: 'image', status: 'succeeded', progress: 100, output_asset_ids: ['11', '12'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        items: [
          { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
          { recovery_item_id: 'gcr:sub-1:slot:77', output_key: 'slot:77', node_id: 'generation-output:77', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '11', slot_id: '77' },
          { recovery_item_id: 'gcr:sub-1:slot:78', output_key: 'slot:78', node_id: 'generation-output:78', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '12', slot_id: '78' },
        ],
      })],
    }) as never);
    await runtime.recover('p1');
    await flushMicrotasks(20);
    expect(fake.removes).toContain('n1'); // 占位移除
    expect(fake.nodes.has('generation-output:77')).toBe(true);
    expect(fake.nodes.has('generation-output:78')).toBe(true);
    expect(fake.data('generation-output:77')).toMatchObject({ assetId: '11', generationRecovery: { submissionId: 'sub-1', outputKey: 'slot:77' } });
    const fields = runtime.composeSaveFields();
    const actions = fields!.recoveryChanges.map((change) => change.action).sort();
    expect(actions).toEqual(['apply', 'apply', 'replaceTarget']);
    expect(status.calls).toContain('501');
  });

  it('轮询自行成功且多输出（>1 产物）：占位卡移除并按恢复页投影扇出输出槽卡', async () => {
    const { fake, runtime, kit, page } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '21', url: 'https://a/21.png', type: 'image' }, output_assets: [
        { id: '21', url: 'https://a/21.png', type: 'image' },
        { id: '22', url: 'https://a/22.png', type: 'image' },
      ] },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    page.mockImplementation(async () => ({
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [{
        submission_id: 'uuid-0001', target_node_id: 'n1', job_id: '501', task_type: 'image',
        binding_revision: 1, is_current: true, job: null, recovery_seed: null, previous_target_snapshot: null,
        items: [
          { recovery_item_id: 'gcr:uuid-0001:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
          { recovery_item_id: 'gcr:uuid-0001:slot:91', output_key: 'slot:91', node_id: 'generation-output:91', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '21', slot_id: '91' },
          { recovery_item_id: 'gcr:uuid-0001:slot:92', output_key: 'slot:92', node_id: 'generation-output:92', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '22', slot_id: '92' },
        ],
      }],
    }) as never);
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks(30);
    expect(fake.removes).toContain('n1');
    expect(fake.data('generation-output:91')).toMatchObject({ assetId: '21', generationRecovery: { outputKey: 'slot:91' } });
    expect(fake.data('generation-output:92')).toMatchObject({ assetId: '22' });
    const actions = runtime.composeSaveFields()!.recoveryChanges.map((change) => change.action).sort();
    expect(actions).toEqual(['apply', 'apply', 'replaceTarget']);
    expect(runtime.statusOf('n1')).toBeNull(); // 扇出收尾后清理在途
  });

  it('一对一已保存成品卡（primary present 且卡在）：恢复零动作，不移除不重建不重复确认', async () => {
    const { fake, runtime, status, page } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } },
    ] });
    // 已保存的一对一成品卡（marker 已切 primary，用户已改名）——恢复扫描不得扇出移除重建
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 30, y: 40 }, data: {
      jobId: '501', fileName: '用户改名', assetId: '9',
      generationRecovery: { protocolVersion: 1, submissionId: 'sub-1', outputKey: 'primary' },
    } });
    page.mockImplementation(async () => ({
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [record({
        job: { job_id: '501', type: 'image', status: 'succeeded', progress: 100, output_asset_ids: ['9'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        items: [
          { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
          { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'n1', state: 'present', revision: 1, node_binding_revision: 1, asset_id: '9', slot_id: null },
        ],
      })],
    }) as never);
    await runtime.recover('p1');
    await flushMicrotasks(20);
    expect(fake.removes).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
    expect(fake.data('n1').fileName).toBe('用户改名'); // 用户编辑保留
    expect(runtime.composeSaveFields()).toBeNull(); // 全部确认态：无待确认动作
    expect(status.calls).toHaveLength(0); // 不拉详情不扇出
  });

  it('一对一恢复扇出：primary pending 复用目标 node_id → 不移除卡，差分 replaceTarget+apply', async () => {
    const { fake, runtime, status, page } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } },
    ] });
    // converge 已写 primary marker 但保存差分未确认（刷新窗口）——卡在场、项仍 pending
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 30, y: 40 }, data: {
      jobId: '501', fileName: '用户改名',
      generationRecovery: { protocolVersion: 1, submissionId: 'sub-1', outputKey: 'primary' },
    } });
    page.mockImplementation(async () => ({
      protocol_version: 1, canvas_version: 1, next_cursor: null,
      records: [record({
        job: { job_id: '501', type: 'image', status: 'succeeded', progress: 100, output_asset_ids: ['9'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        items: [
          { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
          { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'n1', state: 'pending', revision: 0, node_binding_revision: 1, asset_id: '9', slot_id: null },
        ],
      })],
    }) as never);
    await runtime.recover('p1');
    await flushMicrotasks(20);
    // 扇出判定 primary node_id = 目标卡：不 removeMediaNode、不 insertMediaNode，编辑保留
    expect(fake.removes).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
    expect(fake.data('n1').fileName).toBe('用户改名');
    expect(fake.data('n1').generationRecovery).toEqual({ protocolVersion: 1, submissionId: 'sub-1', outputKey: 'primary' });
    const fields = runtime.composeSaveFields();
    expect(fields!.recoveryChanges).toEqual([
      { recoveryItemId: 'gcr:sub-1:$target', expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: 'gcr:sub-1:primary', expectedRevision: 0, action: 'apply' },
    ]);
    expect(status.calls).toContain('501'); // 拉详情补产物 URL
  });

  it('A→B→A：扫描期间项目切换即中止分页', async () => {
    const { fake, runtime, page, status } = setup();
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { jobId: '501', genStatus: 'generating' } });
    let releasePage: (value: GenerationRecoveryPage) => void = () => {};
    page.mockImplementation(() => new Promise((resolve) => { releasePage = resolve; }));
    const pending = runtime.recover('p1');
    fake.switchProject('p2');
    releasePage({ protocol_version: 1, canvas_version: 1, records: [record()], next_cursor: null });
    await pending;
    expect(status.calls).toHaveLength(0);
  });
});

describe('生成任务运行时：保存差分与撤销', () => {
  it('已确认 remove 的卡经撤销回画布（marker 回来）→ 差分 restore', async () => {
    const { fake, runtime, kit } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    const applied = runtime.composeSaveFields()!;
    runtime.onSaveReceipt({ commandId: applied.commandId, replayed: false, changes: [
      { recoveryItemId: 'gcr:uuid-0001:$target', revision: 2, nodeBindingRevision: 1, state: 'replaced' },
      { recoveryItemId: 'gcr:uuid-0001:primary', revision: 1, nodeBindingRevision: 1, state: 'present' },
    ] });
    // 用户删除结果卡（确认 removed）：差分出 remove，回执确认 removed
    fake.nodes.delete('n1');
    const removed = runtime.composeSaveFields()!;
    expect(removed.recoveryChanges).toEqual([{ recoveryItemId: 'gcr:uuid-0001:primary', expectedRevision: 1, action: 'remove' }]);
    runtime.onSaveReceipt({ commandId: removed.commandId, replayed: false, changes: [
      { recoveryItemId: 'gcr:uuid-0001:primary', revision: 2, nodeBindingRevision: 1, state: 'removed' },
    ] });
    // 撤销：卡带 marker 回画布
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId: '9', generationRecovery: { protocolVersion: 1, submissionId: 'uuid-0001', outputKey: 'primary' } } });
    expect(runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: 'gcr:uuid-0001:primary', expectedRevision: 2, action: 'restore' },
    ]);
  });

  it('未对账条目不差分（扫描窗口内不误删补卡）', async () => {
    const { fake, runtime, kit } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    runtime.reset(); // 模拟重载：台账清空，扫描未完成
    fake.nodes.delete('n1'); // 卡缺席
    expect(runtime.composeSaveFields()).toBeNull();
  });
});

describe('生成任务运行时：resolve 定向对账', () => {
  it('reconcileConflictItems 按台账项定向 resolve，读回服务端现状（后续差分用新 revision）', async () => {
    const { fake, runtime, kit } = setup({ script: [
      { status: 'succeeded', progress: 100, asset: { id: '9', url: 'https://a/9.png', type: 'image' } },
    ] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { genStatus: 'generating' } });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    // 保存撞 409 后的定向对账：resolve 读回 primary 已 present/revision 5、$target replaced
    const resolveFn = vi.fn(async (_projectId: string, ids: string[]) => {
      expect(ids).toContain('gcr:uuid-0002:$target');
      return {
        protocol_version: 1 as const,
        records: [{
          submission_id: 'uuid-0002', target_node_id: 'n1', job_id: '501', task_type: 'image',
          binding_revision: 1, is_current: true, job: null, recovery_seed: null, previous_target_snapshot: null,
          items: [
            { recovery_item_id: 'gcr:uuid-0002:$target', output_key: '$target', node_id: 'n1', state: 'replaced', revision: 2, node_binding_revision: 1, asset_id: null, slot_id: null },
            { recovery_item_id: 'gcr:uuid-0002:primary', output_key: 'primary', node_id: 'n1', state: 'present', revision: 5, node_binding_revision: 1, asset_id: '9', slot_id: null },
          ],
        }],
      };
    });
    // 主 runtime 的 resolve 依赖经 reconcileConflictItems 走（默认真客户端会失败——用注入法重验）
    const rt2 = createGenerationRuntime(fake.host, {
      resolveItems: resolveFn as never,
      fetchJobStatus: async () => ({ status: 'succeeded', progress: 100, asset: null }) as never,
    });
    const kit2 = createFakeDef();
    rt2.register(kit2.def);
    kit2.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0002', 'n1', '501') }));
    rt2.submit(kit2.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    await rt2.reconcileConflictItems('p1');
    expect(resolveFn).toHaveBeenCalled();
    // 对账后：$target 终置态跳过、primary present 且 marker 在场 → 无待确认动作
    expect(rt2.composeSaveFields()).toBeNull();
  });
});

describe('生成任务运行时：资源清理', () => {
  it('reset 清全部在途与台账；旧执行链的续链定时器被清', async () => {
    const { fake, runtime, kit, clock } = setup({ script: [{ status: 'processing', progress: 5, asset: null }] });
    fake.nodes.set('n1', { id: 'n1', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} });
    kit.respond.create(async () => ({ jobId: '501', canvasBinding: BINDING_VIEW('uuid-0001', 'n1', '501') }));
    runtime.submit(kit.def, { payload: {}, target: targetFacts('n1') });
    await flushMicrotasks();
    expect(clock.pendingCount()).toBe(1);
    runtime.reset();
    expect(clock.pendingCount()).toBe(0);
    expect(runtime.statusOf('n1')).toBeNull();
  });
});

/* ============================================
 * IKJJR7 跨类型组合场景：两个不同家族定义并存于同一运行时，验证共同规则
 * （恢复分派/归属检查/差分确认）跨家族一致——单家族场景由各 describe 与
 * 各家族定义测试覆盖（规格 Testing Decisions 10：先等价覆盖再收敛）。
 * ============================================ */

/** 家族 def 的恢复规划：复用普通生成规划，补卡写家族身份键（videoTools 补卡先例）。 */
function familyPlanRecovery(identityKey: 'kindA' | 'kindB') {
  return (record: GenerationRecoveryRecord, host: GenerationRuntimeHost) => {
    const plan = normalGenerationTask.planRecovery!(record, host);
    if (plan.kind === 'restore-target') plan.node.data = { ...plan.node.data, [identityKey]: {} };
    return plan;
  };
}

/** 家族 A/B def：同 createFakeDef 骨架 + 家族身份识别与恢复规划（复用其 respond/calls）。 */
function createFamilyDef(kit: ReturnType<typeof createFakeDef>, identityKey: 'kindA' | 'kindB', taskTypes: string[]) {
  const def = {
    taskTypes,
    identify: (_nodeId: string, data: Record<string, unknown>) => data[identityKey] != null,
    planRecovery: familyPlanRecovery(identityKey),
    create: kit.def.create,
    retry: kit.def.retry,
    cancel: kit.def.cancel,
  };
  return { ...kit, def: def as unknown as ReturnType<typeof createFakeDef>['def'] };
}

/** 家族 A：普通生成形态（kindA 身份键；task_type=image）。 */
function createFamilyADef() {
  return createFamilyDef(createFakeDef(), 'kindA', ['image']);
}

/** 家族 B：视频处理工具形态（kindB 身份键；task_type=video_enhance，一对一同款）。 */
function createFamilyBDef() {
  return createFamilyDef(createFakeDef(), 'kindB', ['video_enhance']);
}

function setupCrossFamily(overrides: { script?: Array<Record<string, unknown>>; pages?: GenerationRecoveryPage[] } = {}) {
  const fake = createFakeHost();
  const clock = new ManualClock();
  const status = statusScript(overrides.script ?? [{ status: 'processing', progress: 10, asset: null }]);
  const page = pageScript(overrides.pages ?? [{ protocol_version: 1, canvas_version: 3, records: [], next_cursor: null }]);
  const deps: GenerationRuntimeDeps = {
    fetchJobStatus: status.fn as never,
    fetchRecoveryPage: page as never,
    setTimeout: clock.setTimeout as never,
    clearTimeout: clock.clearTimeout as never,
    newId: (() => { let n = 0; return () => `xuuid-${String(++n).padStart(4, '0')}`; })(),
  };
  const runtime = createGenerationRuntime(fake.host, deps);
  const familyA = createFamilyADef();
  const familyB = createFamilyBDef();
  runtime.register(familyA.def);
  runtime.register(familyB.def);
  return { fake, runtime, clock, status, page, familyA, familyB };
}

const jobDetailOf = (status: string, progress = 20): GenerationRecoveryRecord['job'] => ({
  job_id: 'j', type: 'image', status, progress, output_asset_ids: [], stored_error: null,
  created_at: '2026-10-01T00:00:00Z',
} as NonNullable<GenerationRecoveryRecord['job']>);

const recoveryRecord = (taskType: string, submissionId: string, nodeId: string, jobId: string, overrides: Partial<GenerationRecoveryRecord> & { jobStatus?: string } = {}): GenerationRecoveryRecord => ({
  submission_id: submissionId,
  target_node_id: nodeId,
  job_id: jobId,
  task_type: taskType,
  binding_revision: 1,
  is_current: true,
  job: jobDetailOf(overrides.jobStatus ?? 'processing'),
  recovery_seed: { target: { role: 'result-placeholder', x: 5, y: 6, width: 320, height: 320, name: `${taskType} 卡` }, sources: [] },
  previous_target_snapshot: null,
  items: [{ recovery_item_id: `gcr:${submissionId}:$target`, output_key: '$target', node_id: nodeId, state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
  ...overrides,
});

describe('生成任务运行时：IKJJR7 跨类型组合场景', () => {
  it('受理回执丢失 × 双家族同页恢复：按 task_type 各归各家族补卡，重复扫描先补卡后续链', async () => {
    const pages: GenerationRecoveryPage[] = [{
      protocol_version: 1,
      canvas_version: 3,
      records: [
        recoveryRecord('image', 'sub-a', 'node-a', '601'),
        recoveryRecord('video_enhance', 'sub-b', 'node-b', '602'),
      ],
      next_cursor: null,
    }];
    const { fake, runtime, familyA, familyB, clock } = setupCrossFamily({ pages, script: [{ status: 'processing', progress: 20, asset: null }] });
    await runtime.recover('p1');
    await flushMicrotasks();
    // 两个受理回执丢失的目标各按恢复种子补一张卡（卡不在画布），不重复建卡
    expect([...fake.nodes.keys()].sort()).toEqual(['node-a', 'node-b']);
    expect(fake.data('node-a').jobId).toBe('601');
    expect(fake.data('node-b').jobId).toBe('602');
    // 补卡轮不双开轮询（restore-target 只补卡落盘）；两家族创建请求不被触发（恢复不重发）
    expect(runtime.statusOf('node-a')).toBeNull();
    expect(clock.pendingCount()).toBe(0);
    expect(familyA.calls.create).toHaveLength(0);
    expect(familyB.calls.create).toHaveLength(0);
    // 第二轮扫描对账：卡已在（水合同款）→ 按家族身份各续一条轮询链
    await runtime.recover('p1');
    await flushMicrotasks();
    expect(runtime.statusOf('node-a')?.jobId).toBe('601');
    expect(runtime.statusOf('node-b')?.jobId).toBe('602');
    expect(fake.host.getActiveJob('node-a')).toBeTruthy();
    expect(fake.host.getActiveJob('node-b')).toBeTruthy();
    expect(clock.pendingCount()).toBe(2);
    // 第三轮扫描按在途判重：不双链
    await runtime.recover('p1');
    await flushMicrotasks();
    expect(clock.pendingCount()).toBe(2);
  });

  it('完成未落盘 × 多结果与一对一并存：present 已在卡判重不重建，pending 补出并差分 apply', async () => {
    // 家族 A 多结果：slot:11 已扇出且确认 present（卡在，用户已改名）；slot:12 pending（完成未落盘）
    const pages: GenerationRecoveryPage[] = [{
      protocol_version: 1,
      canvas_version: 3,
      records: [
        recoveryRecord('image', 'sub-m', 'node-m', '701', {
          jobStatus: 'succeeded',
          items: [
            { recovery_item_id: 'gcr:sub-m:$target', output_key: '$target', node_id: 'node-m', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
            { recovery_item_id: 'gcr:sub-m:slot:11', output_key: 'slot:11', node_id: 'generation-output:11', state: 'present', revision: 2, node_binding_revision: 1, asset_id: '9001', slot_id: '11' },
            { recovery_item_id: 'gcr:sub-m:slot:12', output_key: 'slot:12', node_id: 'generation-output:12', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '9002', slot_id: '12' },
          ],
        }),
        // 家族 B 一对一：primary pending + 卡不在（完成未落盘的受理回执丢失形态）
        recoveryRecord('video_enhance', 'sub-1', 'node-1', '702', {
          jobStatus: 'succeeded',
          items: [
            { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'node-1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
            { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'node-1', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '9003', slot_id: null },
          ],
        }),
      ],
      next_cursor: null,
    }];
    const script = [
      { status: 'succeeded', progress: 100, asset: { id: '9001', url: 'u1', type: 'image' }, output_assets: [{ id: '9001', url: 'u1', type: 'image' }, { id: '9002', url: 'u2', type: 'image' }, { id: '9003', url: 'u3', type: 'image' }] },
    ];
    const { fake, runtime } = setupCrossFamily({ pages, script });
    // slot:11 卡已在画布（带用户改名）——恢复不得重建
    fake.nodes.set('generation-output:11', { id: 'generation-output:11', type: 'mediaNode', position: { x: 0, y: 0 }, data: { fileName: '用户改名', generationRecovery: { protocolVersion: 1, submissionId: 'sub-m', outputKey: 'slot:11' } } });
    await runtime.recover('p1');
    await flushMicrotasks();
    // pending 的 slot:12 与一对一 primary 各补出；present 的 slot:11 判重不重建、名称保留
    expect(fake.nodes.has('generation-output:12')).toBe(true);
    expect(fake.nodes.has('node-1')).toBe(true);
    expect(fake.data('generation-output:11').fileName).toBe('用户改名');
    const fields = runtime.composeSaveFields();
    const applied = fields?.recoveryChanges.filter((c) => c.action === 'apply') ?? [];
    // 扇出保持台账项的服务端状态：pending 项（slot:12/primary）差分 apply；
    // present 项（slot:11）已确认在场，无重复 apply（B.6）
    expect(applied.map((c) => c.recoveryItemId).sort()).toEqual(['gcr:sub-1:primary', 'gcr:sub-m:slot:12']);
    const replaced = fields?.recoveryChanges.filter((c) => c.action === 'replaceTarget') ?? [];
    expect(replaced.map((c) => c.recoveryItemId).sort()).toEqual(['gcr:sub-1:$target', 'gcr:sub-m:$target']);
  });

  it('双标签页冲突 × 跨家族节点版本：B 家族提交撞 409 后采纳服务端版本同意图重发受理', async () => {
    const { fake, runtime, familyB, clock } = setupCrossFamily({ script: [{ status: 'processing', progress: 1, asset: null }] });
    fake.nodes.set('node-x', { id: 'node-x', type: 'mediaNode', position: { x: 0, y: 0 }, data: { kindB: {} } });
    // 另一标签页（家族 A）已把 node-x 归属推进到 revision 3；本端仍按 0 提交
    let createCalls = 0;
    familyB.respond.create(async () => {
      createCalls += 1;
      if (createCalls === 1) {
        throw new ApiError(409, '目标节点承接版本已变化', 409, { reason: 'canvas_binding_conflict', currentBindingRevision: 3 });
      }
      return { jobId: '801', canvasBinding: BINDING_VIEW('xuuid-0002', 'node-x', '801', 3) };
    });
    const issued = runtime.submit(familyB.def, { payload: { b: 1 }, target: { ...targetFacts('node-x'), expectedBindingRevision: 0 } });
    expect(issued).toBe(true);
    await flushMicrotasks(20);
    // 同意图（同 submission_id）重发一次并受理成功；卡片回填 jobId 并进入轮询
    expect(createCalls).toBe(2);
    expect(familyB.calls.create[1].binding).toMatchObject({ expected_binding_revision: 3, submission_id: familyB.calls.create[0]!.key });
    expect(fake.data('node-x').jobId).toBe('801');
    expect(runtime.statusOf('node-x')?.phase).toBe('generating');
    expect(clock.pendingCount()).toBe(1);
    // 后续该节点的新提交按台账版本（3）携带 expected_binding_revision
    expect(runtime.bindingRevisionOf('node-x')).toBe(3);
  });

  it('同 jobId 专属重试 × 独立提交身份：旧意图被他端替代（is_current=false）不接旧 jobId 新状态', async () => {
    const { fake, runtime, familyA, clock } = setupCrossFamily({ script: [{ status: 'processing', progress: 2, asset: null }] });
    fake.nodes.set('node-r', { id: 'node-r', type: 'mediaNode', position: { x: 0, y: 0 }, data: { kindA: {}, genStatus: 'failed', jobId: '901' } });
    // 专属重试响应：复用同 jobId（901）但 is_current=false——另一标签页同 jobId 的新重试已接管
    familyA.respond.retry(async () => ({ jobId: '901', canvasBinding: { ...BINDING_VIEW('xuuid-0009', 'node-r', '901', 2), is_current: false } }));
    const issued = runtime.retry('node-r');
    expect(issued).toBe(true);
    await flushMicrotasks();
    // 旧意图不开轮询不落台账——卡由新承接收敛，本地不接旧执行状态
    expect(runtime.statusOf('node-r')).toBeNull();
    expect(clock.pendingCount()).toBe(0);
    // 不落新受理的失败覆盖（被替代的意图不写失败卡）
    expect(fake.patches.filter((p) => p.patch.genStatus === 'failed')).toHaveLength(0);
  });

  it('A→B→A / 同项目重载 × 双家族在途：加载身份推进后两条执行链一并消亡且不再写卡', async () => {
    const { fake, runtime, familyA, familyB, clock } = setupCrossFamily({ script: [{ status: 'processing', progress: 10, asset: null }] });
    fake.nodes.set('na', { id: 'na', type: 'mediaNode', position: { x: 0, y: 0 }, data: { kindA: {} } });
    fake.nodes.set('nb', { id: 'nb', type: 'mediaNode', position: { x: 0, y: 0 }, data: { kindB: {} } });
    familyA.respond.create(async () => ({ jobId: '911', canvasBinding: BINDING_VIEW('xuuid-0011', 'na', '911') }));
    familyB.respond.create(async () => ({ jobId: '912', canvasBinding: BINDING_VIEW('xuuid-0012', 'nb', '912') }));
    runtime.submit(familyA.def, { payload: {}, target: targetFacts('na') });
    runtime.submit(familyB.def, { payload: {}, target: targetFacts('nb') });
    await flushMicrotasks();
    expect(clock.pendingCount()).toBe(2); // 两家族各一条轮询链
    const patchesBefore = fake.patches.length;
    // 同项目重载（doc 更替）：loadEpoch 推进，旧链在下次 tick 归属检查时消亡（不续链不写卡）
    fake.advanceEpoch();
    clock.fireNext();
    clock.fireNext();
    await flushMicrotasks();
    expect(clock.pendingCount()).toBe(0);
    expect(fake.patches.length).toBe(patchesBefore); // 两条旧链都不再写卡（进度/终态均不落）
    // 重载后的水合恢复扫描按新身份重新对账（恢复页无记录：不残留旧链）
    await runtime.recover('p1');
    await flushMicrotasks();
    expect(clock.pendingCount()).toBe(0);
  });

  it('逐结果删除/撤销 × 保存回执丢失重放：多结果段卡 remove→差分，回放只确认不重复确认', async () => {
    const pages: GenerationRecoveryPage[] = [{
      protocol_version: 1,
      canvas_version: 3,
      records: [recoveryRecord('image', 'sub-d', 'node-d', '999', {
        jobStatus: 'succeeded',
        items: [
          { recovery_item_id: 'gcr:sub-d:$target', output_key: '$target', node_id: 'node-d', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
          { recovery_item_id: 'gcr:sub-d:slot:21', output_key: 'slot:21', node_id: 'generation-output:21', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '9101', slot_id: '21' },
        ],
      })],
      next_cursor: null,
    }];
    const script = [
      { status: 'succeeded', progress: 100, asset: { id: '9101', url: 'u', type: 'image' }, output_assets: [{ id: '9101', url: 'u', type: 'image' }] },
    ];
    const { fake, runtime } = setupCrossFamily({ pages, script });
    await runtime.recover('p1');
    await flushMicrotasks();
    expect(fake.nodes.has('generation-output:21')).toBe(true);
    // 用户删除其中一张结果卡（未首次保存前删除）：差分出 remove（虚拟输出与 owner 一同建立）
    fake.nodes.delete('generation-output:21');
    const removed = runtime.composeSaveFields()?.recoveryChanges.find((c) => c.action === 'remove');
    expect(removed?.recoveryItemId).toBe('gcr:sub-d:slot:21');
    // 保存成功但回执丢失 → 重放（replayed=true）同命令：只进台账确认，不重复确认不覆盖
    runtime.onSaveReceipt({ commandId: 'cmd-1', replayed: false, changes: [{ recoveryItemId: 'gcr:sub-d:slot:21', revision: 1, nodeBindingRevision: 1, state: 'removed' }] });
    const fields1 = runtime.composeSaveFields();
    expect(fields1?.recoveryChanges.find((c) => c.recoveryItemId === 'gcr:sub-d:slot:21')).toBeUndefined(); // removed 已确认：无重复动作
    runtime.onSaveReceipt({ commandId: 'cmd-1', replayed: true, changes: [{ recoveryItemId: 'gcr:sub-d:slot:21', revision: 1, nodeBindingRevision: 1, state: 'removed' }] });
    // 撤销（卡带回画布 + marker）：差分 restore 恢复同一结果
    fake.nodes.set('generation-output:21', { id: 'generation-output:21', type: 'mediaNode', position: { x: 0, y: 0 }, data: { generationRecovery: { protocolVersion: 1, submissionId: 'sub-d', outputKey: 'slot:21' } } });
    const restored = runtime.composeSaveFields()?.recoveryChanges.find((c) => c.action === 'restore');
    expect(restored?.recoveryItemId).toBe('gcr:sub-d:slot:21');
  });

  it('原位接管 × 跨家族迟到响应：B 家族新提交接管节点后，A 家族旧执行失败响应不覆盖新生成态', async () => {
    const { fake, runtime, familyA, familyB, clock, status } = setupCrossFamily({
      script: [{ status: 'processing', progress: 10, asset: null }],
    });
    fake.nodes.set('node-t', { id: 'node-t', type: 'mediaNode', position: { x: 0, y: 0 }, data: { kindA: {} } });
    familyA.respond.create(async () => ({ jobId: '921', canvasBinding: BINDING_VIEW('xuuid-0021', 'node-t', '921') }));
    // A 家族先提交（在途轮询中）
    runtime.submit(familyA.def, { payload: {}, target: targetFacts('node-t') });
    await flushMicrotasks();
    expect(runtime.statusOf('node-t')?.jobId).toBe('921');
    // 同节点被 B 家族新提交接管（卡片身份切换为 kindB——原位换工具重做）
    fake.nodes.set('node-t', { id: 'node-t', type: 'mediaNode', position: { x: 0, y: 0 }, data: { kindB: {}, genStatus: 'generating' } });
    familyB.respond.create(async () => ({ jobId: '922', canvasBinding: BINDING_VIEW('xuuid-0022', 'node-t', '922', 2) }));
    runtime.submit(familyB.def, { payload: {}, target: { ...targetFacts('node-t'), expectedBindingRevision: 1 } });
    await flushMicrotasks();
    expect(runtime.statusOf('node-t')?.jobId).toBe('922');
    // A 家族旧执行（jobId 921）的轮询响应到达失败：因在途登记已是 B 的执行而丢弃，不清 B 的锁
    status.fn.mockImplementation(async (jobId: unknown) => (
      String(jobId) === '921'
        ? { status: 'failed', error: { code: 1, message: 'A 家族失败' } }
        : { status: 'processing', progress: 30 }
    ));
    const patchesBefore = fake.patches.length;
    const tokenOfB = fake.host.getActiveJob('node-t');
    expect(tokenOfB).toBeTruthy();
    clock.fireNext(); // A 的续链定时器（登记更早、id 更小）先触发：迟到失败响应
    await flushMicrotasks();
    // B 的锁未被 A 清除、轮询链仍在、A 的失败不落卡
    expect(fake.host.getActiveJob('node-t')).toBe(tokenOfB);
    expect(runtime.statusOf('node-t')?.jobId).toBe('922');
    expect(fake.patches.filter((p) => p.patch.genStatus === 'failed')).toHaveLength(0);
    expect(clock.pendingCount()).toBe(1);
    expect(fake.patches.length).toBeGreaterThan(patchesBefore); // B 的 tick 照常写进度（续链健康）
  });
});

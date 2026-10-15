import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { retryAudioMix } from '@/custom/api/jobs';
import { serializeNodes, serializeEdges } from '@/custom/api/canvas';
import { canvasBindingSchema } from '@lib/contracts/canvas-recovery';
import { audioMixTerminalPatch, buildAudioMixPlaceholderNode, AUDIO_MIX_EDGE_ORIGIN } from '../audioMix';
import { setupAudioMixRecovery, bindingView, deferred, flush } from './audioMixRecoveryTestKit';

vi.mock('@/custom/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/custom/api/jobs')>(), retryAudioMix: vi.fn(),
}));

const SUBMISSION = 'a571aabb-7c22-43cf-aac6-b5d237282c9c';
const JOB = '3268';
const NODE = 'audio-mix-1791261088752-1';
const sources = [
  { node_id: 'media-1789965798278-6', x: 4746.826884702837, y: 3994.19370364894, width: 320, height: 320, name: '原源音频.mp3' },
  { node_id: 'audio-mix-1791104343846-1', x: 5366.882368010906, y: 3994.19370364894, width: 320, height: 320, name: '原混合音频.ogg' },
];
const succeeded = {
  job_id: JOB, status: 'succeeded' as const, progress: 100,
  asset: { id: '8130', url: 'https://fixture.invalid/mix.mp3', type: 'audio' as const, duration: 3.552 },
};

function setup(existing: boolean, withSources = true) {
  const kit = setupAudioMixRecovery({
    reuseUnacceptedCard: true, rollbackOnFailure: true,
    edgeOrigin: AUDIO_MIX_EDGE_ORIGIN, terminalPatch: audioMixTerminalPatch,
  });
  kit.nodes.clear();
  for (const [i, source] of sources.entries()) {
    kit.nodes.set(source.node_id, {
      id: source.node_id, type: 'mediaNode', position: { x: source.x, y: source.y },
      data: { mediaType: 'audio', assetId: i === 0 ? '6973' : '8124', src: `https://fixture.invalid/${i}.mp3`, fileName: source.name },
    });
  }
  if (existing) {
    const node = buildAudioMixPlaceholderNode(NODE, 'mp3', { x: 5287, y: 5026 });
    kit.nodes.set(NODE, {
      ...node, data: {
        ...node.data, genStatus: 'failed', jobId: JOB, errorText: '任务入队失败',
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: '$target' },
      },
    });
    for (const source of sources) kit.drawEdge(source.node_id, NODE);
  }
  kit.recoveryRecords.push({
    submission_id: SUBMISSION, target_node_id: NODE, job_id: JOB, task_type: 'audio_mix', binding_revision: 1, is_current: true,
    job: {
      job_id: JOB, type: 'audio_mix', status: 'failed', progress: 0, output_asset_ids: [],
      stored_error: { code: 'enqueue_failed', message: '任务入队失败' }, created_at: '2026-10-06T12:31:30+08:00',
    },
    recovery_seed: {
      target: { role: 'result-placeholder', x: 5287, y: 5026, width: 480, height: 284, name: '混合结果.mp3' },
      sources: withSources ? [...sources] : [],
    },
    previous_target_snapshot: null,
    items: [{
      recovery_item_id: `gcr:${SUBMISSION}:$target`, output_key: '$target', node_id: NODE, state: 'pending',
      revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null,
    }],
  });
  vi.mocked(retryAudioMix).mockImplementation(async (project, job, key, _opts, rawBinding) => {
    const binding = canvasBindingSchema.parse(rawBinding);
    expect({ project, job, key }).toEqual({ project: 'p1', job: JOB, key: binding.submission_id });
    expect(binding.target_node_id).toBe(NODE);
    expect(binding.submission_id).not.toBe(SUBMISSION);
    expect(binding.expected_binding_revision).toBe(1);
    return { job_id: String(job), status: 'queued', replayed: false,
      canvas_binding: bindingView(binding.submission_id, NODE, JOB, 2) };
  });
  kit.fetchJobStatus.mockResolvedValue(succeeded);
  return kit;
}

type Kit = ReturnType<typeof setup>;
const targetEdges = (kit: Kit) => kit.edges().filter((edge) => edge.target === NODE);
const persistedCanvas = (kit: Kit) => ({
  nodes: serializeNodes([...kit.nodes.values()]), edges: serializeEdges(kit.edges() as Edge[]),
});
function reopen(kit: Kit, doc: ReturnType<typeof persistedCanvas>) {
  kit.reload();
  kit.dropFromHydration(NODE);
  kit.nodes.clear();
  for (const node of JSON.parse(doc.nodes) as Node[]) kit.nodes.set(node.id, node);
  for (const edge of JSON.parse(doc.edges) as Edge[]) kit.host.addEdge(edge.source, edge.target, undefined, edge.data);
}

beforeEach(() => { vi.resetAllMocks(); });

describe('实际任务 3268 的缺卡失败恢复与连线最小重放', () => {
  it('两个冻结画布来源仍在，恢复失败卡再同卡重试成功后应有两条来源线', async () => {
    const kit = setup(false);
    await kit.runtime.recover('p1');
    expect(kit.nodes.get(NODE)?.data.genStatus).toBe('failed');
    expect(kit.runtime.retry(NODE)).toBe(true);
    await flush();
    expect(kit.nodes.get(NODE)?.data.assetId).toBe('8130');
    expect(kit.nodes.get(NODE)?.data.genStatus).toBeUndefined();
    expect(JSON.parse(serializeNodes([...kit.nodes.values()])).filter((node: { id: string }) => node.id === NODE)).toHaveLength(1);
    expect(JSON.parse(serializeEdges(kit.edges() as Edge[])).filter((edge: { target: string }) => edge.target === NODE)).toHaveLength(2);
  });

  it('对照：失败卡与两条来源线已保存时，重试保留两条线', async () => {
    const kit = setup(true);
    await kit.runtime.recover('p1');
    expect(kit.runtime.retry(NODE)).toBe(true);
    await flush();
    expect(kit.nodes.get(NODE)?.data.assetId).toBe('8130');
    expect(targetEdges(kit)).toHaveLength(2);
  });

  it('对照：没有可靠画布来源种子时，不猜测或补建连线', async () => {
    const kit = setup(false, false);
    await kit.runtime.recover('p1');
    expect(kit.runtime.retry(NODE)).toBe(true);
    await flush();
    expect(kit.nodes.get(NODE)?.data.assetId).toBe('8130');
    expect(kit.edges()).toHaveLength(0);
  });

  it('补回失败卡即恢复两条带音频混合标记的来源线，重复扫描保留编辑且不重复', async () => {
    const kit = setup(false);
    await kit.runtime.recover('p1');
    expect(targetEdges(kit).map(({ source, target, data }) => ({ source, target, data }))).toEqual([
      { source: sources[0].node_id, target: NODE, data: { origin: AUDIO_MIX_EDGE_ORIGIN } },
      { source: sources[1].node_id, target: NODE, data: { origin: AUDIO_MIX_EDGE_ORIGIN } },
    ]);
    expect(kit.nodes.get(NODE)?.data).toMatchObject({ jobId: JOB, genStatus: 'failed', errorText: '任务入队失败', audioMix: { format: 'mp3' } });
    const card = kit.nodes.get(NODE)!;
    kit.nodes.set(NODE, { ...card, position: { x: 10, y: 20 }, data: { ...card.data, fileName: '我的混音.wav', width: 520, height: 300 } });
    const edited = persistedCanvas(kit);
    await kit.runtime.recover('p1');
    await kit.runtime.recover('p1');
    expect(persistedCanvas(kit)).toEqual(edited);
    expect([...kit.nodes.keys()].filter((id) => id === NODE)).toHaveLength(1);
  });

  it('来源重复及已有入边不重复补建，也不覆盖已有关系属性', async () => {
    const kit = setup(false);
    kit.recoveryRecords[0].recovery_seed!.sources.push(sources[0]);
    kit.host.addEdge(sources[0].node_id, NODE, undefined, { origin: 'manual', refRole: 'reference' });
    await kit.runtime.recover('p1');
    expect(targetEdges(kit)).toHaveLength(2);
    expect(targetEdges(kit)[0].data).toEqual({ origin: 'manual', refRole: 'reference' });
    expect(targetEdges(kit)[1].data).toEqual({ origin: AUDIO_MIX_EDGE_ORIGIN });
  });

  it.each(['missing', 'removed', 'invalid'] as const)('不恢复 %s 来源，仍保留另一条有效来源', async (state) => {
    const kit = setup(false);
    const sourceId = sources[0].node_id;
    if (state === 'missing') kit.nodes.delete(sourceId);
    else if (state === 'removed') kit.host.markLocallyRemoved(sourceId);
    else kit.nodes.set(sourceId, { ...kit.nodes.get(sourceId)!, data: { mediaType: 'audio', src: 'blob:uploading' } });
    await kit.runtime.recover('p1');
    expect(targetEdges(kit).map((edge) => edge.source)).toEqual([sources[1].node_id]);
    expect(kit.nodes.has(sourceId)).toBe(state !== 'missing');
  });

  it('已有失败卡被用户显式删线后，重复恢复及专属重试均不补回旧种子线', async () => {
    const kit = setup(true);
    kit.dropFromHydration(NODE);
    const card = buildAudioMixPlaceholderNode(NODE, 'wav', { x: 30, y: 40 });
    kit.nodes.set(NODE, { ...card, data: { ...card.data, genStatus: 'failed', jobId: JOB, fileName: '保留编辑.wav', width: 600, height: 320 } });
    const edited = persistedCanvas(kit);
    await kit.runtime.recover('p1');
    expect(persistedCanvas(kit)).toEqual(edited);
    expect(kit.runtime.retry(NODE)).toBe(true);
    await flush();
    expect(canvasBindingSchema.parse(vi.mocked(retryAudioMix).mock.calls[0][4]).recovery_seed.sources).toEqual([]);
    expect(kit.edges()).toHaveLength(0);
    expect(kit.nodes.get(NODE)).toMatchObject({ position: { x: 30, y: 40 }, data: { assetId: '8130', fileName: '保留编辑.wav', width: 600, height: 320 } });
  });

  it.each(['removed', 'historical', 'version'] as const)('%s 守卫拒绝恢复目标及来源线', async (guard) => {
    const kit = setup(false);
    if (guard === 'removed') kit.host.markLocallyRemoved(NODE);
    else if (guard === 'historical') kit.recoveryRecords[0].is_current = false;
    else {
      kit.recoveryRecords[0].is_current = false;
      kit.recoveryRecords[0].items[0].node_binding_revision = 2;
      await kit.runtime.recover('p1');
      kit.recoveryRecords[0].is_current = true;
      kit.recoveryRecords[0].items[0].node_binding_revision = 1;
    }
    await kit.runtime.recover('p1');
    expect(kit.nodes.has(NODE)).toBe(false);
    expect(kit.edges()).toEqual([]);
  });

  it.each(['project', 'load'] as const)('%s 变化后的迟到恢复页不补卡或来源线', async (change) => {
    const kit = setup(false);
    const page = deferred<Awaited<ReturnType<typeof kit.host.fetchRecoveryPage>>>();
    kit.host.fetchRecoveryPage = () => page.promise;
    const pending = kit.runtime.recover('p1');
    if (change === 'project') kit.host.getProjectId = () => 'p2';
    else kit.reload();
    page.resolve({ protocol_version: 1, canvas_version: 2, records: kit.recoveryRecords, next_cursor: null });
    await pending;
    expect(kit.nodes.has(NODE)).toBe(false);
    expect(kit.edges()).toEqual([]);
  });

  it('当前执行已移交时，可靠旧记录不夺回缺失目标或补来源线', async () => {
    const kit = setup(true);
    const reply = deferred<Awaited<ReturnType<typeof kit.fetchJobStatus>>>();
    kit.fetchJobStatus.mockImplementation(() => reply.promise);
    kit.runtime.resumeFromHydration(NODE, JOB, kit.nodes.get(NODE)!.data);
    kit.host.setActiveJob(NODE, 'new-owner');
    kit.dropFromHydration(NODE);
    await kit.runtime.recover('p1');
    expect(kit.host.getActiveJob(NODE)).toBe('new-owner');
    expect(kit.nodes.has(NODE)).toBe(false);
    expect(kit.edges()).toEqual([]);
  });

  it('原卡重试处理中与成功后重新打开均保留来源线，成功以同提交原子转换保存', async () => {
    const kit = setup(false);
    await kit.runtime.recover('p1');
    kit.fetchJobStatus.mockResolvedValue({ job_id: JOB, status: 'processing', progress: 40, asset: null });
    expect(kit.runtime.retry(NODE)).toBe(true);
    await flush();
    const binding = canvasBindingSchema.parse(vi.mocked(retryAudioMix).mock.calls[0][4]);
    expect(binding.recovery_seed.sources.map((source) => source.node_id)).toEqual(sources.map((source) => source.node_id));
    const record = kit.recoveryRecords[0];
    record.submission_id = binding.submission_id;
    record.binding_revision = 2;
    record.recovery_seed = binding.recovery_seed;
    record.job = { ...record.job!, status: 'processing', progress: 40, stored_error: null };
    record.items[0] = { ...record.items[0], recovery_item_id: `gcr:${binding.submission_id}:$target`, node_binding_revision: 2 };
    const processingDoc = persistedCanvas(kit);
    reopen(kit, processingDoc);
    await kit.runtime.recover('p1');
    await flush();
    expect(persistedCanvas(kit).edges).toBe(processingDoc.edges);
    expect(kit.runtime.statusOf(NODE)).toMatchObject({ submissionId: binding.submission_id, jobId: JOB });
    kit.fetchJobStatus.mockResolvedValue(succeeded);
    kit.advancePolling();
    await flush();
    expect(kit.nodes.get(NODE)?.data).toMatchObject({ src: succeeded.asset.url, assetId: '8130', generationRecovery: { submissionId: binding.submission_id, outputKey: 'primary' } });
    expect(kit.runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${binding.submission_id}:$target`, expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: `gcr:${binding.submission_id}:primary`, expectedRevision: 0, action: 'apply' },
    ]);
    record.job = { ...record.job!, status: 'succeeded', progress: 100, output_asset_ids: ['8130'] };
    record.items[0] = { ...record.items[0], state: 'replaced', revision: 2 };
    record.items.push({
      recovery_item_id: `gcr:${binding.submission_id}:primary`, output_key: 'primary', node_id: NODE,
      state: 'present', revision: 1, node_binding_revision: 2, asset_id: '8130', slot_id: null,
    });
    const succeededDoc = persistedCanvas(kit);
    reopen(kit, succeededDoc);
    await kit.runtime.recover('p1');
    expect(persistedCanvas(kit)).toEqual(succeededDoc);
    expect(JSON.parse(succeededDoc.nodes).filter((node: Node) => node.id === NODE)).toHaveLength(1);
    expect(targetEdges(kit)).toHaveLength(2);
    expect(kit.runtime.statusOf(NODE)).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { GenerationRecoveryPage, GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import type { JobDetail } from '@/custom/api/jobs';
import { createGenerationRuntime } from './runtime';
import { sceneSplitTask } from './multiOutputTasks';
import { normalGenerationTask } from './normalGeneration';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

const SUBMISSION = '4d5e6f7a-0000-4000-8000-00000000a001';
const TARGET = 'review3-scene-target';
const resultNode = (key: string) => `generation-result:${SUBMISSION}:${key}`;
const itemId = (key: string) => `gcr:${SUBMISSION}:${key}`;

const captured = JSON.parse(readFileSync(new URL('./ikjlxf-deleted-output.fixture.json', import.meta.url), 'utf8')) as {
  page: { records: GenerationRecoveryRecord[] }; detail: JobDetail;
};
const sourceRecord = () => structuredClone(captured.page.records[0]!);
const deletedOutputDetail = () => structuredClone(captured.detail);

function setup(record = sourceRecord(), detail = deletedOutputDetail(), initial: RuntimeNodeView[] = [{
  id: TARGET, type: 'mediaNode', position: { x: 42, y: 24 },
  data: { fileName: '用户改名的任务卡', mediaType: 'video', width: 640, height: 480 },
}]) {
  const nodes = new Map(initial.map(node => [node.id, node]));
  const edges: Array<{ source: string; target: string }> = [];
  const removed = new Set<string>();
  const epoch = {};
  const page: GenerationRecoveryPage = { protocol_version: 1, canvas_version: null, records: [record], next_cursor: null };
  const save = vi.fn(async () => true);
  const toast = vi.fn();
  const host: GenerationRuntimeHost = {
    getProjectId: () => 'p1', getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()], findNode: id => nodes.get(id) ?? null,
    patchNode: (id, patch) => { const node = nodes.get(id); if (node) nodes.set(id, { ...node, data: { ...node.data, ...patch } }); },
    insertMediaNode: node => { nodes.set(node.id, node); },
    removeMediaNode: id => { nodes.delete(id); },
    getEdges: () => edges, addEdge: (source, target) => { if (!edges.some(e => e.source === source && e.target === target)) edges.push({ source, target }); },
    getActiveJob: () => undefined, setActiveJob: () => {}, clearActiveJob: () => {},
    isLocallyRemoved: id => removed.has(id), markLocallyRemoved: id => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: () => 'terminal', settleCancelled: () => {}, saveCanvas: save,
    fetchRecoveryPage: async () => page, toast, openRechargeForCreditsError: () => false,
    addAuthResume: () => {}, rememberAsset: () => {},
  };
  const status = vi.fn(async () => detail);
  const runtime = createGenerationRuntime(host, { fetchJobStatus: status, fetchRecoveryPage: async () => page });
  runtime.register(sceneSplitTask);
  runtime.register(normalGenerationTask);
  const recover = async () => {
    await runtime.recover('p1');
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { runtime, nodes, edges, removed, save, toast, status, recover };
}

function fullDetail(): JobDetail {
  const detail = deletedOutputDetail();
  detail.output_assets = [
    { id: '950171', url: 'https://example.test/one.mp4', type: 'video', width: 1280, height: 720 },
    { id: '950172', url: 'https://example.test/two.mp4', type: 'video', width: 1920, height: 1080 },
  ];
  detail.asset = detail.output_assets[0]!;
  return detail;
}

describe('IKJLXF 可信产物恢复', () => {
  it('公开删除首项后的真实查询组合：保留任务卡，整批停止转换且不自动 remove', async () => {
    const kit = setup();
    await kit.recover();
    expect([...kit.nodes.keys()]).toEqual([TARGET]);
    expect(kit.nodes.get(TARGET)).toMatchObject({ position: { x: 42, y: 24 }, data: {
      fileName: '用户改名的任务卡', width: 640, height: 480,
    } });
    expect(kit.toast).toHaveBeenCalledWith('warn', expect.any(String));
    expect(kit.runtime.composeSaveFields()).toBeNull();
    expect(kit.save).not.toHaveBeenCalled();
    expect(kit.removed.size).toBe(0);
  });

  it('目标未落盘且产物缺失：按恢复种子补可核对占位与在场来源线，不推断删除', async () => {
    const record = sourceRecord();
    record.recovery_seed = {
      target: { role: 'result-placeholder', x: 80, y: 60, width: 400, height: 240, name: '场景任务原名' },
      sources: [{ node_id: 'source', x: 0, y: 0, width: 200, height: 200, name: '来源视频' }],
    };
    const kit = setup(record, deletedOutputDetail(), [{ id: 'source', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} }]);
    await kit.recover();
    expect(kit.nodes.get(TARGET)).toMatchObject({ position: { x: 80, y: 60 }, data: {
      fileName: '场景任务原名', width: 400, height: 240, jobId: '9', mediaType: 'video',
    } });
    expect(kit.edges).toEqual([{ source: 'source', target: TARGET }]);
    expect(kit.runtime.composeSaveFields()).toBeNull();
    expect(kit.nodes.has(resultNode('segment:1'))).toBe(false);
    expect(kit.nodes.has(resultNode('segment:2'))).toBe(false);
  });

  it('缺失非首项仍停止整批，保留当前任务卡', async () => {
    const detail = fullDetail();
    detail.output_assets = [detail.output_assets![0]!];
    const kit = setup(sourceRecord(), detail);
    await kit.recover();
    expect([...kit.nodes.keys()]).toEqual([TARGET]);
    expect(kit.runtime.composeSaveFields()).toBeNull();
    expect(kit.toast).toHaveBeenCalled();
  });

  it('整批缺产物时在场但未确认的结果也不自动 apply', async () => {
    const detail = fullDetail();
    detail.output_assets!.pop();
    const kit = setup(sourceRecord(), detail, [
      { id: TARGET, type: 'mediaNode', position: { x: 0, y: 0 }, data: {} },
      { id: resultNode('segment:1'), type: 'mediaNode', position: { x: 10, y: 20 }, data: {
        src: 'https://example.test/one.mp4', assetId: '950171', fileName: '待确认原结果',
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' },
      } },
    ]);
    await kit.recover();
    expect(kit.runtime.composeSaveFields()).toBeNull();
    expect(kit.nodes.get(resultNode('segment:1'))?.data.fileName).toBe('待确认原结果');
  });

  it.each(['url', 'url-shape', 'type', 'reference'] as const)('指定产物的 %s 无效时不创建空卡或借用其他资产', async invalid => {
    const record = sourceRecord();
    const detail = fullDetail();
    if (invalid === 'url') detail.output_assets![0]!.url = '';
    if (invalid === 'url-shape') Object.assign(detail.output_assets![0]!, { url: 123 });
    if (invalid === 'type') Object.assign(detail.output_assets![0]!, { type: 'video_scene_split' });
    if (invalid === 'reference') record.items[1]!.asset_id = null;
    const kit = setup(record, detail);
    await kit.recover();
    expect([...kit.nodes.keys()]).toEqual([TARGET]);
    expect(kit.runtime.composeSaveFields()).toBeNull();
  });

  it('合法全量但数组乱序：每张卡的 URL、资产和尺寸仍按可信身份对应', async () => {
    const detail = fullDetail();
    detail.output_assets!.reverse();
    const kit = setup(sourceRecord(), detail);
    await kit.recover();
    expect(kit.nodes.get(resultNode('segment:1'))?.data).toMatchObject({
      assetId: '950171', src: 'https://example.test/one.mp4', mediaType: 'video', width: 1280, height: 720,
      fileName: '第 1 段 00:00-00:05',
    });
    expect(kit.nodes.get(resultNode('segment:2'))?.data).toMatchObject({
      assetId: '950172', src: 'https://example.test/two.mp4', width: 1920, height: 1080,
    });
    expect(kit.runtime.composeSaveFields()?.recoveryChanges.map(change => change.action)).toEqual(['replaceTarget', 'apply', 'apply']);
    expect(kit.toast).not.toHaveBeenCalled();
  });

  it('场景切分单段仍使用 segment 身份转换', async () => {
    const record = sourceRecord();
    record.items.pop();
    const detail = fullDetail();
    detail.output_assets!.pop();
    detail.result!.segments.pop();
    const kit = setup(record, detail);
    await kit.recover();
    expect([...kit.nodes.keys()]).toEqual([resultNode('segment:1')]);
    expect(kit.nodes.get(resultNode('segment:1'))?.data.generationRecovery).toEqual({ protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:1' });
  });

  it('结果已显式 removed 不复活；其余合法结果仍转换', async () => {
    const record = sourceRecord();
    record.items[1]!.state = 'removed';
    record.items[1]!.revision = 1;
    const kit = setup(record);
    await kit.recover();
    expect([...kit.nodes.keys()]).toEqual([resultNode('segment:2')]);
    expect(kit.runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: itemId('$target'), expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: itemId('segment:2'), expectedRevision: 0, action: 'apply' },
    ]);
  });

  it('缺产物时已有独立结果仍可显式删除，不自动移除未落卡项', async () => {
    const record = sourceRecord();
    record.items[2]!.state = 'present';
    record.items[2]!.revision = 1;
    const kit = setup(record, deletedOutputDetail(), [
      { id: TARGET, type: 'mediaNode', position: { x: 0, y: 0 }, data: {} },
      { id: resultNode('segment:2'), type: 'mediaNode', position: { x: 42, y: 24 }, data: {
        assetId: '950172', src: 'https://example.test/two.mp4',
        generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'segment:2' },
      } },
    ]);
    await kit.recover();
    expect(kit.removed.size).toBe(0);
    const original = kit.nodes.get(resultNode('segment:2'))!;
    expect(kit.runtime.remove(resultNode('segment:2'))).toBe(true);
    expect(kit.runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: itemId('segment:2'), expectedRevision: 1, action: 'remove' },
    ]);
    kit.runtime.onSaveReceipt({ commandId: 'remove-result', replayed: false, changes: [
      { recoveryItemId: itemId('segment:2'), revision: 2, nodeBindingRevision: 1, state: 'removed' },
    ] });
    kit.nodes.set(original.id, original);
    expect(kit.runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: itemId('segment:2'), expectedRevision: 2, action: 'restore' },
    ]);
  });

  it('保存确认后重复恢复保留已编辑卡与来源线，不重复转换', async () => {
    const record = sourceRecord();
    record.recovery_seed!.sources = [{ node_id: 'source', x: 0, y: 0, width: 200, height: 200, name: '源' }];
    const kit = setup(record, fullDetail(), [
      { id: 'source', type: 'mediaNode', position: { x: 0, y: 0 }, data: { width: 200, height: 200 } },
      { id: TARGET, type: 'mediaNode', position: { x: 500, y: 0 }, data: {} },
    ]);
    kit.edges.push({ source: 'source', target: TARGET });
    await kit.recover();
    for (const item of record.items) {
      item.state = item.output_key === '$target' ? 'replaced' : 'present';
      item.revision++;
    }
    const card = kit.nodes.get(resultNode('segment:1'))!;
    card.position = { x: 99, y: 123 };
    card.data = { ...card.data, fileName: '用户段卡名称', width: 777, height: 333 };
    kit.runtime.reset();
    kit.removed.clear();
    await kit.recover();
    expect(kit.nodes.size).toBe(3);
    expect(kit.nodes.get(card.id)).toMatchObject({ position: { x: 99, y: 123 }, data: { fileName: '用户段卡名称', width: 777, height: 333 } });
    expect(kit.edges.filter(edge => edge.target === resultNode('segment:1'))).toEqual([{ source: 'source', target: resultNode('segment:1') }]);
    expect(kit.runtime.composeSaveFields()).toBeNull();
  });

  it('空引用一对一 primary 仍从单个可信任务结果同步身份并保留普通编辑', async () => {
    const record = sourceRecord();
    record.task_type = 'image';
    record.items = [record.items[0]!, { ...record.items[1]!, recovery_item_id: itemId('primary'), output_key: 'primary', node_id: TARGET, asset_id: null }];
    const detail = fullDetail();
    detail.output_assets = [{ id: '950171', url: 'https://example.test/one.png', type: 'image' }];
    const kit = setup(record, detail);
    await kit.recover();
    expect(kit.nodes.get(TARGET)).toMatchObject({ position: { x: 42, y: 24 }, data: {
      assetId: '950171', src: 'https://example.test/one.png', fileName: '用户改名的任务卡', width: 640, height: 480,
      generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'primary' },
    } });
    expect(kit.runtime.composeSaveFields()?.recoveryChanges.map(change => change.action)).toEqual(['replaceTarget', 'apply']);
  });

  it.each(['missing-reference', 'ambiguous-primary'] as const)('一对一 %s 不得借用其他产物', async mode => {
    const record = sourceRecord();
    record.task_type = 'image';
    record.items = [record.items[0]!, { ...record.items[1]!, recovery_item_id: itemId('primary'),
      output_key: 'primary', node_id: TARGET, asset_id: mode === 'missing-reference' ? '950199' : null }];
    const kit = setup(record, fullDetail());
    await kit.recover();
    expect(kit.nodes.get(TARGET)?.data.src).toBeUndefined();
    expect(kit.nodes.get(TARGET)?.data.generationRecovery).toBeUndefined();
    expect(kit.runtime.composeSaveFields()).toBeNull();
  });

  it('用户再次恢复时全量产物已可用，正常转换不受先前缺产物抑制影响', async () => {
    const detail = deletedOutputDetail();
    const kit = setup(sourceRecord(), detail);
    await kit.recover();
    expect(kit.runtime.composeSaveFields()).toBeNull();
    detail.output_assets = fullDetail().output_assets;
    await kit.recover();
    expect(kit.nodes.has(TARGET)).toBe(false);
    expect(kit.runtime.composeSaveFields()?.recoveryChanges.map(change => change.action)).toEqual(['replaceTarget', 'apply', 'apply']);
  });
});

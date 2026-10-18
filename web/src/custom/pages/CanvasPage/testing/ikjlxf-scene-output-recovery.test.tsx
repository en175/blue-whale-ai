// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import type { JobDetail } from '@/custom/api/jobs';
import { ApiError } from '@/shared/api/http';
import { apiMocks, canvasDocMock, flowProps, mediaNodes, renderPage, unmountPage } from './canvasPageTestHarness';
import { sceneSplitTask } from '../generation/multiOutputTasks';

const captured = JSON.parse(readFileSync(resolve('src/custom/pages/CanvasPage/generation/ikjlxf-deleted-output.fixture.json'), 'utf8')) as {
  page: { records: GenerationRecoveryRecord[] }; detail: JobDetail;
};
interface RecoveryScene {
  page: { records: GenerationRecoveryRecord[] };
  detail: JobDetail;
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
}
const facts = JSON.parse(readFileSync(resolve('src/custom/pages/CanvasPage/generation/iknb9b-recovery-facts.fixture.json'), 'utf8')) as {
  scene3416: RecoveryScene; scene3260: RecoveryScene;
};
const recoveryApi = vi.hoisted(() => ({
  page: { current: { records: [] as GenerationRecoveryRecord[] } },
  put: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('@/custom/api/canvasRecovery', async importOriginal => {
  const actual = await importOriginal<typeof import('@/custom/api/canvasRecovery')>();
  return {
    ...actual, fetchGenerationRecoveryPage: () => recoveryApi.fetch(),
    generationRecoveryPageOptions: (projectId: string, options: { cursor?: string | null } = {}) => ({
      ...actual.generationRecoveryPageOptions(projectId, options), queryFn: () => recoveryApi.fetch(),
    }),
    resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
    putCanvasDocWithRecovery: recoveryApi.put,
  };
});

const target = captured.page.records[0]!.target_node_id;
const targetCard = {
  id: target, type: 'mediaNode', position: { x: 42, y: 24 },
  data: { src: '', jobId: '9', sceneSplit: {}, mediaType: 'video', fileName: '用户任务卡名称', width: 640, height: 480 },
};
function seed(nodes: RecoveryScene['nodes']) {
  seedScene({ nodes, edges: [] });
}
function seedScene(scene: Pick<RecoveryScene, 'nodes' | 'edges'>) {
  canvasDocMock.current = {
    doc: {
      id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 },
      nodes: structuredClone(scene.nodes), edges: structuredClone(scene.edges),
    },
    assets: {}, refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
  };
}

const UNAVAILABLE = '生成结果当前不可用';
const flushRecovery = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};
const settleRecovery = async () => {
  await act(async () => { await vi.waitFor(() => expect(recoveryApi.fetch).toHaveBeenCalled()); });
  await flushRecovery();
};
const edgePairs = () => (flowProps.current.edges as Array<{ source: string; target: string }>)
  .map(edge => ({ source: edge.source, target: edge.target }));
const nodeSnapshots = () => mediaNodes().map(node => ({ id: node.id, position: node.position, data: node.data }));
const putWithRemovedReceipt = () => {
  recoveryApi.put.mockImplementation(async (_project: string, _payload: unknown, _version: number, recovery: {
    commandId: string; recoveryChanges: Array<{ recoveryItemId: string; action: string }>;
  }) => ({
    project_id: 'p1', version: 4, recoveryReceipt: { commandId: recovery.commandId, replayed: false,
      changes: recovery.recoveryChanges.map(change => ({ recoveryItemId: change.recoveryItemId,
        revision: 2, nodeBindingRevision: 1, state: change.action === 'remove' ? 'removed' : 'present' })),
    },
  }));
};
const savedSceneAfterRemove = (record: GenerationRecoveryRecord) => {
  const savedNodes = JSON.parse(JSON.stringify(mediaNodes().map(node => ({
    id: node.id, type: node.type ?? 'mediaNode', position: node.position, data: node.data,
  }))));
  const savedEdges = edgePairs().map((edge, index) => ({ id: `saved-edge-${index}`, ...edge }));
  const savedPage = { records: [{ ...structuredClone(record), items: [
    structuredClone(record.items[0]!),
    { ...structuredClone(record.items[1]!), state: 'removed' as const, revision: 2 },
    structuredClone(record.items[2]!),
  ] }] };
  return { savedNodes, savedEdges, savedPage };
};
const expectSceneCardsIntact = (scene: RecoveryScene) => {
  const actual = nodeSnapshots();
  expect(actual).toHaveLength(scene.nodes.length);
  scene.nodes.forEach((node, index) => {
    expect(actual[index]!.id).toBe(node.id);
    expect(actual[index]!.position).toEqual(node.position);
    expect(actual[index]!.data).toMatchObject(node.data);
  });
  expect(edgePairs()).toEqual(scene.edges.map(edge => ({ source: edge.source, target: edge.target })));
};

beforeEach(() => {
  recoveryApi.page.current = { records: structuredClone(captured.page.records) };
  recoveryApi.fetch.mockReset();
  recoveryApi.fetch.mockImplementation(async () => ({
    protocol_version: 1, canvas_version: 3, next_cursor: null, ...recoveryApi.page.current,
  }));
  apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(captured.detail));
  recoveryApi.put.mockImplementation(async (_project: string, _payload: unknown, _version: number, recovery: {
    commandId: string; recoveryChanges: Array<{ recoveryItemId: string; action: string }>;
  }) => ({
    project_id: 'p1', version: 4, recoveryReceipt: { commandId: recovery.commandId, replayed: false,
      changes: recovery.recoveryChanges.map(change => ({ recoveryItemId: change.recoveryItemId,
        revision: 2, nodeBindingRevision: 1, state: change.action === 'replaceTarget' ? 'replaced' : 'present' })),
    },
  }));
});
afterEach(async () => { await unmountPage(); vi.clearAllMocks(); });

describe('IKJLXF 实际场景恢复与保存接线', () => {
  it('缺首项保留原任务卡、显示提示，普通保存不携错误 remove 或 replaceTarget', async () => {
    const create = vi.spyOn(sceneSplitTask, 'create');
    seed([targetCard]);
    await renderPage();
    await act(async () => { await vi.waitFor(() => expect(document.body.textContent).toContain('生成结果当前不可用')); });
    expect(mediaNodes().map(node => node.id)).toEqual([target]);
    expect(mediaNodes()[0]).toMatchObject({ position: { x: 42, y: 24 }, data: {
      fileName: '用户任务卡名称', width: 640, height: 480,
    } });
    await act(async () => { await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled(), { timeout: 2500 }); });
    expect(recoveryApi.put).not.toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc.mock.calls[0]![1].nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: target }),
    ]));
    expect(create).not.toHaveBeenCalled();
  });

  it('乱序但全量可用时按可信资产落段卡，同笔保存 replaceTarget 与逐项 apply', async () => {
    const detail = structuredClone(captured.detail);
    detail.output_assets!.push({ id: '950171', url: 'https://example.test/one.mp4', type: 'video', width: 1280, height: 720 });
    apiMocks.fetchJobStatus.mockResolvedValue(detail);
    seed([targetCard]);
    await renderPage();
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.put).toHaveBeenCalled()); });
    const outputs = mediaNodes();
    expect(outputs).toHaveLength(2);
    expect(outputs.find(node => node.data.assetId === '950171')?.data.src).toBe('https://example.test/one.mp4');
    expect(outputs.find(node => node.data.assetId === '950172')?.data.src).toBe('https://example.test/two.mp4');
    expect(recoveryApi.put.mock.calls[0]![3].recoveryChanges.map((change: { action: string }) => change.action)).toEqual(['replaceTarget', 'apply', 'apply']);
    expect((flowProps.current.edges as unknown[]).length).toBe(0);
  });
});

describe('IKNB9B 服务端恢复事实驱动的刷新行为', () => {
  it('任务 3416 四段已落地：刷新不重跑投影、不重取任务、不弹警告，位置名称尺寸素材身份与来源连线不变', async () => {
    const scene = facts.scene3416;
    recoveryApi.page.current = structuredClone(scene.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(scene.detail));
    seedScene(scene);
    await renderPage();
    await settleRecovery();
    expect(document.body.textContent).not.toContain(UNAVAILABLE);
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    expect(recoveryApi.put).not.toHaveBeenCalled();
    expectSceneCardsIntact(scene);

    await unmountPage();
    apiMocks.fetchJobStatus.mockClear();
    recoveryApi.fetch.mockClear();
    recoveryApi.put.mockClear();
    await renderPage();
    await settleRecovery();
    expect(document.body.textContent).not.toContain(UNAVAILABLE);
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    expect(recoveryApi.put).not.toHaveBeenCalled();
    expectSceneCardsIntact(scene);
  });

  it('任务 3260 明确软删：零警告、原卡保留、不复活素材、不自动 remove 或 replaceTarget，卸载重挂载后仍成立', async () => {
    const scene = facts.scene3260;
    const expectDeletedFactSettled = () => {
      expect(document.body.textContent).not.toContain(UNAVAILABLE);
      expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
      expect(recoveryApi.put).not.toHaveBeenCalled();
      expect(mediaNodes().map(node => node.id)).toEqual(['review5-scene-target']);
      expect(mediaNodes()[0]).toMatchObject({
        position: { x: 120, y: 80 },
        data: { fileName: '用户改名的场景任务卡', width: 640, height: 480, mediaType: 'video', src: '' },
      });
      expect(mediaNodes()[0]!.data.assetId).toBeUndefined();
      expect(edgePairs()).toEqual([]);
    };
    recoveryApi.page.current = structuredClone(scene.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(scene.detail));
    seedScene(scene);
    await renderPage();
    await settleRecovery();
    expectDeletedFactSettled();

    for (let refresh = 0; refresh < 2; refresh += 1) {
      await unmountPage();
      apiMocks.fetchJobStatus.mockClear();
      recoveryApi.fetch.mockClear();
      recoveryApi.put.mockClear();
      await renderPage();
      await settleRecovery();
      expectDeletedFactSettled();
    }
  });

  it('任务 3416 与 3260 同页：连续三次挂载都不弹不可用警告，四张段卡与原任务卡原样保留', async () => {
    const merged = {
      page: { records: [
        ...structuredClone(facts.scene3416.page.records),
        ...structuredClone(facts.scene3260.page.records),
      ] },
      detail: structuredClone(facts.scene3416.detail),
      nodes: [...structuredClone(facts.scene3416.nodes), ...structuredClone(facts.scene3260.nodes)],
      edges: [...structuredClone(facts.scene3416.edges), ...structuredClone(facts.scene3260.edges)],
    };
    const expectCombinedSettled = () => {
      expect(document.body.textContent).not.toContain(UNAVAILABLE);
      expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
      expect(recoveryApi.put).not.toHaveBeenCalled();
      expectSceneCardsIntact(merged);
      const deletedSubmission = facts.scene3260.page.records[0]!.submission_id;
      expect(mediaNodes().some(node => node.id.includes(deletedSubmission))).toBe(false);
      expect(mediaNodes()[merged.nodes.length - 1]!.id).toBe('review5-scene-target');
      expect(mediaNodes()[merged.nodes.length - 1]!.data.assetId).toBeUndefined();
    };
    recoveryApi.page.current = structuredClone(merged.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(merged.detail));
    seedScene(merged);
    for (let refresh = 0; refresh < 3; refresh += 1) {
      await renderPage();
      await settleRecovery();
      expectCombinedSettled();
      await unmountPage();
      apiMocks.fetchJobStatus.mockClear();
      recoveryApi.fetch.mockClear();
      recoveryApi.put.mockClear();
    }
  });
});

describe('IKNBKS 部分软删的恢复与保存接线', () => {
  const SUB = '7c2d1e4b-0000-4000-8000-00000000420a';
  const SOURCE = 'source-8166';
  const TARGET = 'scene-partial-target';
  const segmentCard = (index: number) => `generation-result:${SUB}:segment:${index}`;
  const partialScene = (): RecoveryScene => ({
    page: { records: [{
      submission_id: SUB, target_node_id: TARGET, job_id: '4200', task_type: 'video_scene_split',
      binding_revision: 1, is_current: true,
      job: { job_id: '4200', type: 'video_scene_split', status: 'succeeded', progress: 100,
        output_asset_ids: ['8716', '8715'], stored_error: null, created_at: '2026-10-18T12:00:00.000Z' },
      recovery_seed: {
        target: { role: 'result-placeholder', x: 400, y: 120, width: 640, height: 480, name: '场景切分 · 标准' },
        sources: [{ node_id: SOURCE, x: 60, y: 120, width: 320, height: 180, name: '源视频' }],
      },
      previous_target_snapshot: null,
      items: [
        { recovery_item_id: `gcr:${SUB}:$target`, output_key: '$target', node_id: TARGET,
          state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, asset_deleted: null, slot_id: null },
        { recovery_item_id: `gcr:${SUB}:segment:1`, output_key: 'segment:1', node_id: segmentCard(1),
          state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '8716', asset_deleted: true, slot_id: null },
        { recovery_item_id: `gcr:${SUB}:segment:2`, output_key: 'segment:2', node_id: segmentCard(2),
          state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '8715', asset_deleted: false, slot_id: null },
      ],
    }] },
    detail: {
      job_id: '4200', status: 'succeeded', progress: 100, asset: null,
      output_assets: [{ id: '8715', url: 'https://example.test/8715.mp4', type: 'video' }],
      result: { duration: 30, segments: [
        { segment_index: 1, start_time: 0, end_time: 15, segment_asset_id: '8716' },
        { segment_index: 2, start_time: 15, end_time: 30, segment_asset_id: '8715' },
      ] },
    },
    nodes: [
      { id: SOURCE, type: 'mediaNode', position: { x: 60, y: 120 }, data: {
        assetId: '8166', src: 'https://example.test/8166.mp4', mediaType: 'video', fileName: '源视频', width: 320, height: 180 } },
      { id: TARGET, type: 'mediaNode', position: { x: 400, y: 120 }, data: {
        src: '', jobId: '4200', mediaType: 'video', fileName: '场景切分 · 标准', width: 640, height: 480,
        sceneSplit: { sourceAssetId: '8166', lastInput: { source_asset_id: '8166', target_node_id: TARGET, granularity: 'standard' } } } },
    ],
    edges: [{ id: 'edge-source-target', source: SOURCE, target: TARGET }],
  });
  const edgeKeys = () => edgePairs().map(edge => `${edge.source}->${edge.target}`).sort();

  it('部分段明确软删：原卡保留、只落存活段、同笔差分不含 replaceTarget，按保存结果重挂载不再产生差分', async () => {
    const scene = partialScene();
    seedScene(scene);
    recoveryApi.page.current = structuredClone(scene.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(scene.detail));

    await renderPage();
    await settleRecovery();
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.put).toHaveBeenCalled()); });

    expect(document.body.textContent).not.toContain(UNAVAILABLE);
    expect(mediaNodes().map(node => node.id).sort()).toEqual([SOURCE, TARGET, segmentCard(2)].sort());
    expect(mediaNodes().find(node => node.id === TARGET)!.data).toMatchObject({
      fileName: '场景切分 · 标准', progress: 100, sceneSplit: { sourceAssetId: '8166' },
    });
    expect(mediaNodes().find(node => node.id === TARGET)!.data.genStatus).toBeUndefined();
    expect(mediaNodes().find(node => node.id === segmentCard(2))!.data).toMatchObject({
      assetId: '8715', src: 'https://example.test/8715.mp4',
    });
    expect(edgeKeys()).toEqual([`${SOURCE}->${TARGET}`, `${SOURCE}->${segmentCard(2)}`].sort());
    expect(recoveryApi.put.mock.calls[0]![3].recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUB}:segment:2`, expectedRevision: 0, action: 'apply' },
    ]);
    for (const call of recoveryApi.put.mock.calls) {
      expect(call[3].recoveryChanges.map((change: { action: string }) => change.action)).not.toContain('replaceTarget');
    }

    const savedNodes = JSON.parse(JSON.stringify(mediaNodes().map(node => ({
      id: node.id, type: node.type ?? 'mediaNode', position: node.position, data: node.data,
    }))));
    const savedEdges = edgePairs().map((edge, index) => ({ id: `saved-edge-${index}`, ...edge }));
    const record = scene.page.records[0]!;
    const savedPage = { records: [{ ...structuredClone(record), items: [
      structuredClone(record.items[0]!),
      { ...structuredClone(record.items[2]!), state: 'present' as const, revision: 1 },
    ] }] };

    for (let refresh = 0; refresh < 2; refresh += 1) {
      await unmountPage();
      apiMocks.fetchJobStatus.mockClear();
      recoveryApi.fetch.mockClear();
      recoveryApi.put.mockClear();
      recoveryApi.page.current = structuredClone(savedPage);
      seedScene({ nodes: savedNodes, edges: savedEdges });
      await renderPage();
      await settleRecovery();
      expect(document.body.textContent).not.toContain(UNAVAILABLE);
      expect(recoveryApi.put).not.toHaveBeenCalled();
      expect(mediaNodes().map(node => node.id).sort()).toEqual([SOURCE, TARGET, segmentCard(2)].sort());
      expect(edgeKeys()).toEqual([`${SOURCE}->${TARGET}`, `${SOURCE}->${segmentCard(2)}`].sort());
    }
  });
});

describe('IKNBU9 已软删结果卡的显式删除与保存', () => {
  const SUB = '7c2d1e4b-0000-4000-8000-000000004419';
  const SOURCE = 'source-9017';
  const segmentCard = (index: number) => `generation-result:${SUB}:segment:${index}`;
  const persistedScene = (): RecoveryScene => ({
    page: { records: [{
      submission_id: SUB, target_node_id: 'scene-deleted-target', job_id: '4400', task_type: 'video_scene_split',
      binding_revision: 1, is_current: true,
      job: { job_id: '4400', type: 'video_scene_split', status: 'succeeded', progress: 100,
        output_asset_ids: ['9018', '9017'], stored_error: null, created_at: '2026-10-18T12:00:00.000Z' },
      recovery_seed: {
        target: { role: 'result-placeholder', x: 400, y: 120, width: 640, height: 480, name: '场景切分 · 标准' },
        sources: [{ node_id: SOURCE, x: 60, y: 120, width: 320, height: 180, name: '源视频' }],
      },
      previous_target_snapshot: null,
      items: [
        { recovery_item_id: `gcr:${SUB}:$target`, output_key: '$target', node_id: 'scene-deleted-target',
          state: 'replaced', revision: 1, node_binding_revision: 1, asset_id: null, asset_deleted: null, slot_id: null },
        { recovery_item_id: `gcr:${SUB}:segment:1`, output_key: 'segment:1', node_id: segmentCard(1),
          state: 'present', revision: 1, node_binding_revision: 1, asset_id: '9018', asset_deleted: true, slot_id: null },
        { recovery_item_id: `gcr:${SUB}:segment:2`, output_key: 'segment:2', node_id: segmentCard(2),
          state: 'present', revision: 1, node_binding_revision: 1, asset_id: '9017', asset_deleted: false, slot_id: null },
      ],
    }] },
    detail: {
      job_id: '4400', status: 'succeeded', progress: 100, asset: null,
      output_assets: [
        { id: '9018', url: 'https://example.test/9018.mp4', type: 'video' },
        { id: '9017', url: 'https://example.test/9017.mp4', type: 'video' },
      ],
      result: { duration: 30, segments: [
        { segment_index: 1, start_time: 0, end_time: 15, segment_asset_id: '9018' },
        { segment_index: 2, start_time: 15, end_time: 30, segment_asset_id: '9017' },
      ] },
    },
    nodes: [
      { id: SOURCE, type: 'mediaNode', position: { x: 60, y: 120 }, data: {
        assetId: '9016', src: 'https://example.test/9016.mp4', mediaType: 'video', fileName: '源视频', width: 320, height: 180 } },
      { id: segmentCard(1), type: 'mediaNode', position: { x: 780, y: 120 }, data: {
        assetId: '9018', src: 'https://example.test/9018.mp4', mediaType: 'video', fileName: '第 1 段 00:00-00:15',
        width: 640, height: 480, generationRecovery: { protocolVersion: 1, submissionId: SUB, outputKey: 'segment:1' } } },
      { id: segmentCard(2), type: 'mediaNode', position: { x: 1460, y: 120 }, data: {
        assetId: '9017', src: 'https://example.test/9017.mp4', mediaType: 'video', fileName: '第 2 段 00:15-00:30',
        width: 640, height: 480, generationRecovery: { protocolVersion: 1, submissionId: SUB, outputKey: 'segment:2' } } },
    ],
    edges: [
      { id: 'edge-source-1', source: SOURCE, target: segmentCard(1) },
      { id: 'edge-source-2', source: SOURCE, target: segmentCard(2) },
    ],
  });
  const edgeKeys = () => edgePairs().map(edge => `${edge.source}->${edge.target}`).sort();
  const persistedNodes = () => [SOURCE, segmentCard(2)].sort();
  const expectSurvivorsIntact = () => {
    const nodes = mediaNodes();
    expect(nodes.map(node => node.id).sort()).toEqual(persistedNodes());
    const byId = new Map(nodes.map(node => [node.id, node]));
    expect(byId.get(SOURCE)).toMatchObject({
      position: { x: 60, y: 120 },
      data: { assetId: '9016', fileName: '源视频', width: 320, height: 180, mediaType: 'video' },
    });
    expect(byId.get(segmentCard(2))).toMatchObject({
      position: { x: 1460, y: 120 },
      data: {
        assetId: '9017', src: 'https://example.test/9017.mp4', fileName: '第 2 段 00:15-00:30',
        width: 640, height: 480, mediaType: 'video',
        generationRecovery: { protocolVersion: 1, submissionId: SUB, outputKey: 'segment:2' },
      },
    });
    expect(edgeKeys()).toEqual([`${SOURCE}->${segmentCard(2)}`]);
  };

  it('页面删除入口删掉软删段卡：同笔保存携带 remove，刷新重开不复活也不动存活结果', async () => {
    putWithRemovedReceipt();
    const scene = persistedScene();
    seedScene(scene);
    recoveryApi.page.current = structuredClone(scene.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(scene.detail));

    await renderPage();
    await settleRecovery();
    expect(document.body.textContent).not.toContain(UNAVAILABLE);
    expect(recoveryApi.put).not.toHaveBeenCalled();
    expect(mediaNodes().map(node => node.id).sort()).toEqual([SOURCE, segmentCard(1), segmentCard(2)].sort());

    await act(async () => { flowProps.current.onDeleteNode([segmentCard(1)]); });
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.put).toHaveBeenCalled(), { timeout: 3000 }); });

    expect(recoveryApi.put.mock.calls[0]![3].recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUB}:segment:1`, expectedRevision: 1, action: 'remove' },
    ]);
    expect(recoveryApi.put.mock.calls[0]![1].nodes.map((node: { id: string }) => node.id).sort()).toEqual(persistedNodes());
    expect(document.body.textContent).not.toContain('recovery_protocol_required');
    expectSurvivorsIntact();

    const { savedNodes, savedEdges, savedPage } = savedSceneAfterRemove(scene.page.records[0]!);

    for (let refresh = 0; refresh < 3; refresh += 1) {
      await unmountPage();
      apiMocks.fetchJobStatus.mockClear();
      recoveryApi.fetch.mockClear();
      recoveryApi.put.mockClear();
      recoveryApi.page.current = structuredClone(savedPage);
      seedScene({ nodes: savedNodes, edges: savedEdges });
      await renderPage();
      await settleRecovery();
      expect(document.body.textContent).not.toContain(UNAVAILABLE);
      expect(recoveryApi.put).not.toHaveBeenCalled();
      expectSurvivorsIntact();
    }
  });

  it('同笔再删一张存活段卡：两项 remove 同时提交，软删段不被自动声明删除', async () => {
    putWithRemovedReceipt();
    const scene = persistedScene();
    seedScene(scene);
    recoveryApi.page.current = structuredClone(scene.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(scene.detail));

    await renderPage();
    await settleRecovery();
    expect(recoveryApi.put).not.toHaveBeenCalled();
    expect(mediaNodes().map(node => node.id).sort()).toEqual([SOURCE, segmentCard(1), segmentCard(2)].sort());

    await act(async () => { flowProps.current.onDeleteNode([segmentCard(1), segmentCard(2)]); });
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.put).toHaveBeenCalled(), { timeout: 3000 }); });

    expect(recoveryApi.put.mock.calls[0]![3].recoveryChanges.map((change: { action: string }) => change.action))
      .toEqual(['remove', 'remove']);
    expect(mediaNodes().map(node => node.id)).toEqual([SOURCE]);
  });

  const delayRecovery = () => {
    let release: (page: unknown) => void = () => {};
    const pending = new Promise((resolve) => { release = resolve; });
    recoveryApi.fetch.mockImplementation(() => pending);
    return (page: unknown) => release(page);
  };
  const releasePage = (scene: RecoveryScene) => ({
    protocol_version: 1, canvas_version: 3, next_cursor: null, ...structuredClone(scene.page),
  });

  it('IKNCKQ 恢复响应未返回时页面删除软删段卡：迟到响应后同笔携带 remove，不回落普通保存', async () => {
    putWithRemovedReceipt();
    const release = delayRecovery();
    const scene = persistedScene();
    seedScene(scene);
    recoveryApi.page.current = structuredClone(scene.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(scene.detail));

    await renderPage();
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.fetch).toHaveBeenCalled()); });
    await act(async () => { flowProps.current.onDeleteNode([segmentCard(1)]); });
    expect(mediaNodes().map(node => node.id).sort()).toEqual([SOURCE, segmentCard(2)].sort());
    expect(recoveryApi.put).not.toHaveBeenCalled();

    await act(async () => { release(releasePage(scene)); });
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.put).toHaveBeenCalled(), { timeout: 3000 }); });

    expect(recoveryApi.put.mock.calls[0]![3].recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUB}:segment:1`, expectedRevision: 1, action: 'remove' },
    ]);
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
    expectSurvivorsIntact();

    const { savedNodes, savedEdges, savedPage } = savedSceneAfterRemove(scene.page.records[0]!);

    for (let refresh = 0; refresh < 3; refresh += 1) {
      await unmountPage();
      apiMocks.fetchJobStatus.mockClear();
      recoveryApi.fetch.mockClear();
      recoveryApi.put.mockClear();
      recoveryApi.page.current = structuredClone(savedPage);
      seedScene({ nodes: savedNodes, edges: savedEdges });
      await renderPage();
      await settleRecovery();
      expect(recoveryApi.put).not.toHaveBeenCalled();
      expectSurvivorsIntact();
    }
  });

  it('IKNCKQ 卡片加载前已缺失且无显式删除：迟到响应不生成 remove，也不删卡或复活', async () => {
    putWithRemovedReceipt();
    const release = delayRecovery();
    const scene = persistedScene();
    seedScene({ nodes: scene.nodes.filter(node => node.id !== segmentCard(1)), edges: [
      { id: 'edge-source-2', source: SOURCE, target: segmentCard(2) },
    ] });
    recoveryApi.page.current = structuredClone(scene.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(scene.detail));

    await renderPage();
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.fetch).toHaveBeenCalled()); });
    await act(async () => { release(releasePage(scene)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });

    expect(recoveryApi.put).not.toHaveBeenCalled();
    expect(mediaNodes().map(node => node.id).sort()).toEqual([SOURCE, segmentCard(2)].sort());
  });

  it('IKNCLD 恢复响应晚于自动保存：普通保存被拒后，迟到响应自动补保存并携带 remove', async () => {
    putWithRemovedReceipt();
    const release = delayRecovery();
    const scene = persistedScene();
    seedScene(scene);
    recoveryApi.page.current = structuredClone(scene.page);
    apiMocks.fetchJobStatus.mockResolvedValue(structuredClone(scene.detail));
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(
      new ApiError(428, 'recovery protocol required', '', { reason: 'recovery_protocol_required' }),
    );

    await renderPage();
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.fetch).toHaveBeenCalled()); });
    await act(async () => { flowProps.current.onDeleteNode([segmentCard(1)]); });

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(recoveryApi.put).not.toHaveBeenCalled();

    await act(async () => { release(releasePage(scene)); });
    await act(async () => { await vi.waitFor(() => expect(recoveryApi.put).toHaveBeenCalled(), { timeout: 3000 }); });

    expect(recoveryApi.put.mock.calls[0]![3].recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUB}:segment:1`, expectedRevision: 1, action: 'remove' },
    ]);
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(mediaNodes().map(node => node.id).sort()).toEqual([SOURCE, segmentCard(2)].sort());
  });
});

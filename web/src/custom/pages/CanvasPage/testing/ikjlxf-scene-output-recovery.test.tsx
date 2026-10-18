// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import type { JobDetail } from '@/custom/api/jobs';
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
});

// @vitest-environment jsdom
// 真实页面恢复/保存接线，API 与画布组件为受控替身，无认证 HTTP 浏览器端到端。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import type { JobDetail } from '@/api/jobs';
import { apiMocks, canvasDocMock, flowProps, mediaNodes, renderPage, unmountPage } from './testing/canvasPageTestHarness';
import { sceneSplitTask } from './generationRuntime/multiOutputTasks';

const captured = JSON.parse(readFileSync(resolve('src/pages/CanvasPage/generationRuntime/ikjlxf-deleted-output.fixture.json'), 'utf8')) as {
  page: { records: GenerationRecoveryRecord[] }; detail: JobDetail;
};
const recoveryApi = vi.hoisted(() => ({ page: { current: { records: [] as GenerationRecoveryRecord[] } }, put: vi.fn() }));
vi.mock('@/api/canvasRecovery', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/canvasRecovery')>();
  const fetchPage = vi.fn(async () => ({ protocol_version: 1, canvas_version: 3, next_cursor: null, ...recoveryApi.page.current }));
  return {
    ...actual, fetchGenerationRecoveryPage: fetchPage,
    generationRecoveryPageOptions: (projectId: string, options: { cursor?: string | null } = {}) => ({
      ...actual.generationRecoveryPageOptions(projectId, options), queryFn: fetchPage,
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
function seed(nodes: Array<Record<string, unknown>>) {
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] },
    assets: {}, refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
  };
}

beforeEach(() => {
  recoveryApi.page.current = { records: structuredClone(captured.page.records) };
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

// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiMocks, canvasDocMock, mediaNodes, renderPage, unmountPage,
} from './testing/canvasPageTestHarness';

const recoveryApi = vi.hoisted(() => ({
  page: { current: null as null | { records: unknown[] } },
  putWithRecovery: vi.fn(),
}));
vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('@/api/canvasRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/canvasRecovery')>();
  const fetchPage = vi.fn(async (_projectId: string, _options?: { limit?: number; cursor?: string | null }) => recoveryApi.page.current ?? {
    protocol_version: 1, canvas_version: null, records: [], next_cursor: null,
  });
  return {
    ...actual,
    fetchGenerationRecoveryPage: fetchPage,
    generationRecoveryPageOptions: (projectId: string, options: { limit?: number; cursor?: string | null } = {}) => ({
      ...actual.generationRecoveryPageOptions(projectId, options),
      queryFn: () => fetchPage(projectId, options),
    }),
    resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
    putCanvasDocWithRecovery: recoveryApi.putWithRecovery,
  };
});

const originalCard = {
  id: 'n1', type: 'mediaNode', position: { x: 42, y: 24 },
  data: {
    src: 'https://old/5.png', assetId: '5', mediaType: 'image',
    fileName: '用户素材改名', width: 640, height: 480,
  },
};

const nullAssetRecord = (targetState: string, targetRevision: number, primaryState: string, primaryRevision: number) => ({
  submission_id: 'sub-1', target_node_id: 'n1', job_id: '501', task_type: 'image',
  binding_revision: 1, is_current: true,
  job: { job_id: '501', type: 'image', status: 'succeeded', progress: 100, output_asset_ids: ['11'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
  recovery_seed: { target: { role: 'existing-media', x: 42, y: 24, width: 320, height: 320, name: '原卡' }, sources: [] },
  previous_target_snapshot: null,
  items: [
    { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'n1', state: targetState, revision: targetRevision, node_binding_revision: 1, asset_id: null, slot_id: null },
    { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'n1', state: primaryState, revision: primaryRevision, node_binding_revision: 1, asset_id: null, slot_id: null },
  ],
});

const succeededDetail = {
  job_id: '501', status: 'succeeded', progress: 100,
  asset: { id: '11', url: 'https://a/11.png', type: 'image' },
  output_assets: [{ id: '11', url: 'https://a/11.png', type: 'image' }],
};

function seed(nodes: Array<Record<string, unknown>>, version = 3) {
  canvasDocMock.current = {
    doc: { id: 11, version, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] },
    assets: {}, refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  recoveryApi.page.current = null;
  recoveryApi.putWithRecovery.mockImplementation(async (
    _projectId: string, _payload: unknown, _version: number | null,
    recovery: { commandId: string; recoveryChanges: Array<{ recoveryItemId: string; action: string }> },
  ) => ({
    project_id: 'p1', version: 4,
    recoveryReceipt: {
      commandId: recovery.commandId, replayed: false,
      changes: recovery.recoveryChanges.map((change) => ({
        recoveryItemId: change.recoveryItemId, revision: 2, nodeBindingRevision: 1,
        state: change.action === 'replaceTarget' ? 'replaced' : 'present',
      })),
    },
  }));
  apiMocks.fetchJobStatus.mockResolvedValue(succeededDetail);
});
afterEach(async () => { await unmountPage(); vi.clearAllMocks(); });

describe('IKJLTQ 一对一恢复同步真实产物身份（实际入口）', () => {
  it('刷新恢复：原素材卡原位取得产物身份（URL/assetId 同源），普通编辑保留，同笔恢复保存确认', async () => {
    seed([originalCard]);
    recoveryApi.page.current = { records: [nullAssetRecord('pending', 1, 'pending', 0)] };
    await renderPage();
    await vi.waitFor(() => {
      const card = mediaNodes().find((node) => node.id === 'n1');
      expect(card?.data).toMatchObject({ src: 'https://a/11.png', assetId: '11' });
    });
    const card = mediaNodes().find((node) => node.id === 'n1')!;
    expect(card.data).toMatchObject({
      jobId: '501',
      fileName: '用户素材改名',
      width: 640, height: 480,
      generationRecovery: { protocolVersion: 1, submissionId: 'sub-1', outputKey: 'primary' },
    });
    expect(card.position).toEqual({ x: 42, y: 24 });
    expect(mediaNodes().filter((node) => node.id === 'n1')).toHaveLength(1);
    await vi.waitFor(() => expect(recoveryApi.putWithRecovery).toHaveBeenCalled());
    const saveCall = recoveryApi.putWithRecovery.mock.calls[0]!;
    expect(saveCall[3].recoveryChanges).toEqual([
      { recoveryItemId: 'gcr:sub-1:$target', expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: 'gcr:sub-1:primary', expectedRevision: 0, action: 'apply' },
    ]);
  });

  it('保存后再次刷新（记录已推进 replaced/present）：产物身份稳定，零恢复写入、不再拉任务详情', async () => {
    seed([{
      ...originalCard,
      data: {
        ...originalCard.data,
        src: 'https://a/11.png', assetId: '11', jobId: '501',
        generationRecovery: { protocolVersion: 1, submissionId: 'sub-1', outputKey: 'primary' },
      },
    }], 4);
    recoveryApi.page.current = { records: [nullAssetRecord('replaced', 2, 'present', 1)] };
    await renderPage();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const card = mediaNodes().find((node) => node.id === 'n1')!;
    expect(card.data).toMatchObject({
      src: 'https://a/11.png', assetId: '11',
      fileName: '用户素材改名', width: 640, height: 480,
      generationRecovery: { protocolVersion: 1, submissionId: 'sub-1', outputKey: 'primary' },
    });
    expect(mediaNodes().filter((node) => node.id === 'n1')).toHaveLength(1);
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    expect(recoveryApi.putWithRecovery).not.toHaveBeenCalled();
  });
});

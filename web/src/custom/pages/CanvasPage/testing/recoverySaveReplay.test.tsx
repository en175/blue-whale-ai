// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { ApiError } from '@/shared/api/http';
import type { GenerationModel } from '@/custom/api/generation';

vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('../components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));
vi.mock('../components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));
vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));
vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

type SaveResult = { id: number; project_id: number; version: number; viewport: string; nodes: string };
type SavePayload = {
  viewport: unknown;
  nodes: Node[];
  edges: Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
};
type RecoverySaveFields = { recoveryProtocolVersion: number; commandId: string; recoveryChanges: Array<{ recoveryItemId: string; expectedRevision: number; action: string }> };

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(
    async (_projectId: string, _payload: SavePayload, _version: number | null): Promise<SaveResult> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1', status: 'processing', progress: 10, asset: null,
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
}));

const recoveryApi = vi.hoisted(() => ({
  fetchGenerationRecoveryPage: vi.fn(async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null })),
  resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
  putCanvasDocWithRecovery: vi.fn(),
}));
vi.mock('@/custom/api/canvasRecovery', () => ({
  RECOVERY_PAGE_LIMIT_MAX: 100,
  fetchGenerationRecoveryPage: recoveryApi.fetchGenerationRecoveryPage,
  resolveGenerationRecovery: recoveryApi.resolveGenerationRecovery,
  putCanvasDocWithRecovery: recoveryApi.putCanvasDocWithRecovery,
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  })),
}));

const runtimeMock = vi.hoisted(() => {
  let seq = 0;
  return {
    runtime: {
      register: vi.fn(),
      claims: vi.fn(() => false),
      submit: vi.fn(() => false),
      retry: vi.fn(() => true),
      cancel: vi.fn(() => true),
      remove: vi.fn(() => true),
      recover: vi.fn(async () => {}),
      resumeFromHydration: vi.fn(),
      statusOf: vi.fn(() => null),
      bindingRevisionOf: vi.fn(() => 0),
      composeSaveFields: vi.fn((): { commandId: string; recoveryChanges: Array<{ recoveryItemId: string; expectedRevision: number; action: string }> } | null => {
        seq += 1;
        return { commandId: `cmd-${seq}`, recoveryChanges: [{ recoveryItemId: `gcr:s${seq}:$target`, expectedRevision: 1, action: 'settleTarget' }] };
      }),
      onSaveReceipt: vi.fn(),
      reconcileConflictItems: vi.fn(async () => {}),
      reset: vi.fn(),
    },
  };
});
vi.mock('../generation/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generation/runtime')>();
  return { ...actual, createGenerationRuntime: () => runtimeMock.runtime };
});

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/custom/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/custom/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({
    queryKey: ['canvas', projectId, 'legacy-history'],
    queryFn: () => Promise.resolve({ items: [] }),
    retry: false,
  }),
  readCanvasConflictVersion: (error: unknown): number | undefined => {
    const version = (error as { data?: { version?: unknown } } | null | undefined)?.data?.version;
    return typeof version === 'number' ? version : undefined;
  },
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
  ),
}));

vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: 'a9', width: 1920, height: 1080 },
        },
      ],
      edges: [],
    },
    assets: {
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage)),
      ),
    );
  });
}

async function renameNode(name: string) {
  await act(async () => {
    const data = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!.data as {
      onTitleChange: (id: string, name: string) => void;
    };
    data.onTitleChange('v1', name);
  });
}

async function waitDebounce() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
}

async function clickRetrySave() {
  await act(async () => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const putCalls = () => recoveryApi.putCanvasDocWithRecovery.mock.calls as unknown as Array<[string, SavePayload, number | null, RecoverySaveFields]>;

const savedReceipt = (commandId: string, version: number) => ({
  project_id: 'p1',
  version,
  recoveryReceipt: {
    commandId,
    replayed: false,
    changes: [{ recoveryItemId: `gcr:${commandId}:$target`, revision: 2, nodeBindingRevision: 1, state: 'present' }],
  },
});

function stageResponseLostReplay() {
  let attempts = 0;
  recoveryApi.putCanvasDocWithRecovery.mockImplementation(async (_p: string, _pl: SavePayload, _v: number | null, recovery: RecoverySaveFields) => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('network down');
    const receipt = savedReceipt(recovery.commandId, 4);
    return { ...receipt, recoveryReceipt: { ...receipt.recoveryReceipt, replayed: true } };
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  recoveryApi.putCanvasDocWithRecovery.mockReset();
  runtimeMock.runtime.composeSaveFields.mockClear();
  runtimeMock.runtime.onSaveReceipt.mockClear();
  runtimeMock.runtime.reconcileConflictItems.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKJKU8 恢复保存回执丢失可安全重放', () => {
  it('自动保存链路：响应丢失后完全相同的重试复用原 commandId/载荷/If-Match，回填 replayed 回执', async () => {
    stageResponseLostReplay();

    await renderPage();
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
    const [first] = putCalls();
    expect(first[2]).toBe(3);
    const composed = runtimeMock.runtime.composeSaveFields.mock.calls.length;

    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, replay] = putCalls();
    expect(replay[3].commandId).toBe(first[3].commandId);
    expect(replay[1]).toEqual(first[1]);
    expect(replay[2]).toBe(3);
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composed);

    expect(runtimeMock.runtime.onSaveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: first[3].commandId, replayed: true }),
    );
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
  }, 20000);

  it('flush 链路（重试保存按钮）：响应丢失后原样重发复用原命令，成功后状态恢复', async () => {
    stageResponseLostReplay();

    await renderPage();
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
    const [first] = putCalls();
    const composed = runtimeMock.runtime.composeSaveFields.mock.calls.length;

    await clickRetrySave();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, replay] = putCalls();
    expect(replay[3].commandId).toBe(first[3].commandId);
    expect(replay[1]).toEqual(first[1]);
    expect(replay[2]).toBe(3);
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composed);
    expect(runtimeMock.runtime.onSaveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: first[3].commandId, replayed: true }),
    );
  }, 20000);

  it('IKJLTY：丢回执后继续改名——原命令先原样重放确认（版本对齐 4），新内容再以版本 4 为基换新命令保存', async () => {
    let attempts = 0;
    recoveryApi.putCanvasDocWithRecovery.mockImplementation(async (_p: string, _pl: SavePayload, _v: number | null, recovery: RecoverySaveFields) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('network down');
      if (attempts === 2) {
        const receipt = savedReceipt(recovery.commandId, 4);
        return { ...receipt, recoveryReceipt: { ...receipt.recoveryReceipt, replayed: true } };
      }
      return savedReceipt(recovery.commandId, 5);
    });

    await renderPage();
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
    const [first] = putCalls();
    expect(first[2]).toBe(3);
    const composedAfterFirst = runtimeMock.runtime.composeSaveFields.mock.calls.length;

    await renameNode('改名B');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, confirmReplay] = putCalls();
    expect(confirmReplay[3].commandId).toBe(first[3].commandId);
    expect(confirmReplay[1]).toEqual(first[1]);
    expect(confirmReplay[2]).toBe(3);
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composedAfterFirst);
    expect(runtimeMock.runtime.onSaveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: first[3].commandId, replayed: true }),
    );
    expect(flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });

    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(3);
    const [, , freshSave] = putCalls();
    expect(freshSave[3].commandId).not.toBe(first[3].commandId);
    expect((freshSave[1].nodes as Node[]).find((n) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });
    expect(freshSave[2]).toBe(4);
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composedAfterFirst + 1);

    await renameNode('改名B');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(3);
  }, 20000);

  it('IKJLTY：未提交丢响应（原命令未落库）继续改名——重放按原 If-Match 首存成功，新内容再以确认版本为基', async () => {
    let attempts = 0;
    recoveryApi.putCanvasDocWithRecovery.mockImplementation(async (_p: string, _pl: SavePayload, _v: number | null, recovery: RecoverySaveFields) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('network down');
      return savedReceipt(recovery.commandId, attempts === 2 ? 4 : 5);
    });

    await renderPage();
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
    const [first] = putCalls();

    await renameNode('改名B');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, confirmReplay] = putCalls();
    expect(confirmReplay[3].commandId).toBe(first[3].commandId);
    expect(confirmReplay[1]).toEqual(first[1]);
    expect(confirmReplay[2]).toBe(3);
    expect(runtimeMock.runtime.onSaveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: first[3].commandId, replayed: false }),
    );

    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(3);
    const [, , freshSave] = putCalls();
    expect(freshSave[3].commandId).not.toBe(first[3].commandId);
    expect((freshSave[1].nodes as Node[]).find((n) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });
    expect(freshSave[2]).toBe(4);
  }, 20000);

  it('IKJLTY：flush 链路（重试保存按钮）——丢回执后继续改名，一次 flush 连续完成确认笔与新内容笔', async () => {
    let attempts = 0;
    recoveryApi.putCanvasDocWithRecovery.mockImplementation(async (_p: string, _pl: SavePayload, _v: number | null, recovery: RecoverySaveFields) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('network down');
      if (attempts === 2) {
        const receipt = savedReceipt(recovery.commandId, 4);
        return { ...receipt, recoveryReceipt: { ...receipt.recoveryReceipt, replayed: true } };
      }
      return savedReceipt(recovery.commandId, 5);
    });

    await renderPage();
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
    const [first] = putCalls();
    const composedAfterFirst = runtimeMock.runtime.composeSaveFields.mock.calls.length;

    await renameNode('改名B');
    await clickRetrySave();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(3);
    const [, confirmReplay, freshSave] = putCalls();
    expect(confirmReplay[3].commandId).toBe(first[3].commandId);
    expect(confirmReplay[1]).toEqual(first[1]);
    expect(confirmReplay[2]).toBe(3);
    expect(freshSave[3].commandId).not.toBe(first[3].commandId);
    expect((freshSave[1].nodes as Node[]).find((n) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });
    expect(freshSave[2]).toBe(4);
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composedAfterFirst + 1);
    expect(runtimeMock.runtime.onSaveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: first[3].commandId, replayed: true }),
    );
  }, 20000);

  it('IKJLTY：确认笔撞其他客户端真实更新的受控 412——保留本地新编辑并登记复核闸门，重试被拦截', async () => {
    let attempts = 0;
    recoveryApi.putCanvasDocWithRecovery.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('network down');
      throw new ApiError(412, 'Canvas 版本冲突', '', { reason: 'canvas_version_conflict', version: 4 });
    });

    await renderPage();
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
    const [first] = putCalls();

    await renameNode('改名B');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, confirmReplay] = putCalls();
    expect(confirmReplay[3].commandId).toBe(first[3].commandId);
    expect(confirmReplay[2]).toBe(3);
    expect(flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });

    await clickRetrySave();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    expect(flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });
  }, 20000);

  it('412 版本冲突路径行为不变：保留命令作废，后续保存按对齐版本走新命令', async () => {
    recoveryApi.putCanvasDocWithRecovery
      .mockRejectedValueOnce(new ApiError(412, 'Canvas 版本冲突', '', { version: 4 }))
      .mockImplementation(async (_p: string, _pl: SavePayload, _v: number | null, recovery: RecoverySaveFields) =>
        savedReceipt(recovery.commandId, 5));

    await renderPage();
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
    const [first] = putCalls();

    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, second] = putCalls();
    expect(second[3].commandId).not.toBe(first[3].commandId);
    expect(second[2]).toBe(4);
  }, 20000);

  it('409 项冲突对账路径行为不变：保留命令作废，resolve 对账后被调用', async () => {
    recoveryApi.putCanvasDocWithRecovery
      .mockRejectedValueOnce(new ApiError(409, '任务状态已被其他操作更新', '', { reason: 'recovery_item_conflict' }))
      .mockImplementation(async (_p: string, _pl: SavePayload, _v: number | null, recovery: RecoverySaveFields) =>
        savedReceipt(recovery.commandId, 4));

    await renderPage();
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
    const [first] = putCalls();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(runtimeMock.runtime.reconcileConflictItems).toHaveBeenCalledWith('p1');

    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    expect(putCalls()[1][3].commandId).not.toBe(first[3].commandId);
  }, 20000);
});

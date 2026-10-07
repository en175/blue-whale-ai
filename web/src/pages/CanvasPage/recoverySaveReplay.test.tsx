// @vitest-environment jsdom
/* IKJKU8（PR981-REVIEW-20261003-F8）：恢复保存回执丢失可安全重放（用户故事 38）。
   修复前 composeSaveFields 每次组合都拿新 commandId，保存成功但响应丢失（断连）后用户
   原样重试 = 新 commandId + 旧 If-Match → 服务端幂等回读永不命中 → 必 412 进冲突复核。
   本文件锁死发送侧：完全相同的重试（画布签名与版本未变）复用保留的命令身份/完整载荷/
   If-Match 重发；新增编辑或版本推进必须换新命令；412 与 409 对账路径行为不变。
   运行时 mock 只为可控 composeSaveFields（命令保留本身在页面保存接缝，见 index.tsx）。

   IKJLTY（PR981-REVIEW2-20261003-R6）：回执丢失后「继续编辑」窗口修复——签名/版本变化
   不再丢弃未决命令；新保存意图到来时先按原 commandId/完整载荷/原 If-Match 重放确认原
   命令结果（服务端幂等先于版本检查：已落库命中回读返回 replayed 回执与确认版本），
   确认后新内容再以确认版本为基换新命令保存。旧回执只确认原保存与合法版本、只进台账，
   不回写旧全文覆盖新编辑；确认笔撞其他客户端真实更新的受控 412 仍走既有冲突闸门。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { ApiError } from '@/api/http';
import type { GenerationModel } from '@/api/generation';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点与触发画布回调 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));
vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));
vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));
vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

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

/** IKJKU8：恢复保存传输层打桩——按调用序编排「首次结果 + 后续行为」，回执身份跟随实际命令 */
const recoveryApi = vi.hoisted(() => ({
  fetchGenerationRecoveryPage: vi.fn(async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null })),
  resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
  putCanvasDocWithRecovery: vi.fn(),
}));
vi.mock('@/api/canvasRecovery', () => ({
  RECOVERY_PAGE_LIMIT_MAX: 100,
  fetchGenerationRecoveryPage: recoveryApi.fetchGenerationRecoveryPage,
  resolveGenerationRecovery: recoveryApi.resolveGenerationRecovery,
  putCanvasDocWithRecovery: recoveryApi.putCanvasDocWithRecovery,
}));

/** IKJKU8：运行时打桩——composeSaveFields 逐次返回递增命令身份（重放路径不得再调它），
 *  onSaveReceipt/reconcileConflictItems 记录回填与对账调用。 */
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
vi.mock('./generationRuntime/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generationRuntime/runtime')>();
  return { ...actual, createGenerationRuntime: () => runtimeMock.runtime };
});

vi.mock('@/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真 */
vi.mock('@/api/canvas', () => ({
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

vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：一个就绪视频节点 v1（assetId a9），无连线 */
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

/** 改卡片标题（真实编辑）：内容变化推进防抖自动保存；同名改写只动引用不动签名 */
async function renameNode(name: string) {
  await act(async () => {
    const data = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!.data as {
      onTitleChange: (id: string, name: string) => void;
    };
    data.onTitleChange('v1', name);
  });
}

/** 等一轮 800ms 防抖自动保存收尾 */
async function waitDebounce() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
}

/** 点左下角「重试保存」（flushCanvasSave 的用户入口） */
async function clickRetrySave() {
  await act(async () => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const putCalls = () => recoveryApi.putCanvasDocWithRecovery.mock.calls as unknown as Array<[string, SavePayload, number | null, RecoverySaveFields]>;

/** 首次保存成功响应（replayed=false；重放场景由编排覆写 replayed） */
const savedReceipt = (commandId: string, version: number) => ({
  project_id: 'p1',
  version,
  recoveryReceipt: {
    commandId,
    replayed: false,
    changes: [{ recoveryItemId: `gcr:${commandId}:$target`, revision: 2, nodeBindingRevision: 1, state: 'present' }],
  },
});

/** 传输层编排：第 1 次 PUT 丢响应（网络层失败，无服务端回执），第 2 次起返回 replayed 回执 */
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
    expect(first[2]).toBe(3); // If-Match = 水合版本
    const composed = runtimeMock.runtime.composeSaveFields.mock.calls.length;

    // 回执丢失（首次 reject）：用户原样重试——同名改写触发防抖，画布签名未变
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, replay] = putCalls();
    expect(replay[3].commandId).toBe(first[3].commandId); // 复用原命令身份
    expect(replay[1]).toEqual(first[1]); // 完整载荷原样重发
    expect(replay[2]).toBe(3); // If-Match 未变
    // 完全相同的重试不重新组命令（无新保存意图）
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composed);

    // 服务端幂等回读命中回放原回执（replayed=true）→ 按既有语义回填台账
    expect(runtimeMock.runtime.onSaveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: first[3].commandId, replayed: true }),
    );
    // 回执落定后命令不再保留：签名未变的再次防抖不再发 PUT
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

    // 防抖保存失败 → 「重试保存」入口走 flushCanvasSave：必须复用保留命令原样重发
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
    // 已提交丢响应：第 1 笔服务端已落库（版本 3→4）但响应丢失；第 2 笔（原命令重放）
    // 命中服务端幂等回读返回 replayed 回执（版本 4）；第 3 笔（新内容新命令）If-Match 4 首存成功
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
    expect(first[2]).toBe(3); // If-Match = 水合版本
    const composedAfterFirst = runtimeMock.runtime.composeSaveFields.mock.calls.length;

    // 回执丢失后继续改名（签名变化）——不得丢弃未决命令：先按原 commandId/完整载荷/原 If-Match 重放确认
    await renameNode('改名B');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, confirmReplay] = putCalls();
    expect(confirmReplay[3].commandId).toBe(first[3].commandId); // 原命令身份保留（重放入口不失）
    expect(confirmReplay[1]).toEqual(first[1]); // 完整原载荷（改名A，不掺入新编辑）
    expect(confirmReplay[2]).toBe(3); // 原 If-Match（命令实际版本，服务端摘要含版本必须原样）
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composedAfterFirst); // 确认笔不组新命令
    // 旧回执只确认原保存与合法版本：replayed 回执按既有语义回填台账，不触碰画布新编辑
    expect(runtimeMock.runtime.onSaveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: first[3].commandId, replayed: true }),
    );
    expect(flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });

    // 原命令确认后：新编辑内容以确认版本 4 为基、换新命令保存
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(3);
    const [, , freshSave] = putCalls();
    expect(freshSave[3].commandId).not.toBe(first[3].commandId);
    expect((freshSave[1].nodes as Node[]).find((n) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });
    expect(freshSave[2]).toBe(4); // 确认版本为基——修复前此笔仍携版本 3 必吃受控 412
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composedAfterFirst + 1);

    // 新内容保存成功后签名对齐：同名改写不再发 PUT
    await renameNode('改名B');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(3);
  }, 20000);

  it('IKJLTY：未提交丢响应（原命令未落库）继续改名——重放按原 If-Match 首存成功，新内容再以确认版本为基', async () => {
    // 第 1 笔响应丢失且服务端未落库；第 2 笔（原命令重放）按原 If-Match 3 首存成功
    // （replayed=false，版本 4）；第 3 笔（新内容新命令）If-Match 4 首存成功（版本 5）
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
    // 未落库的重放 = 按原 If-Match 的正常首存：回执 replayed=false，同样只确认版本与台账
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
    // 已提交丢响应：第 1 笔落库（版本 4）丢响应；flush 第 1 轮重放原命令确认（replayed 回执），
    // 第 2 轮以确认版本 4 为基保存当前内容（版本 5）
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

    // 回执丢失后继续改名（签名变化），再点「重试保存」——flush 不得丢弃未决命令直接组新命令
    await renameNode('改名B');
    await clickRetrySave();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(3);
    const [, confirmReplay, freshSave] = putCalls();
    expect(confirmReplay[3].commandId).toBe(first[3].commandId); // 确认笔：原命令原载荷原 If-Match
    expect(confirmReplay[1]).toEqual(first[1]);
    expect(confirmReplay[2]).toBe(3);
    expect(freshSave[3].commandId).not.toBe(first[3].commandId); // 新内容笔：新命令 + 确认版本为基
    expect((freshSave[1].nodes as Node[]).find((n) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });
    expect(freshSave[2]).toBe(4);
    expect(runtimeMock.runtime.composeSaveFields.mock.calls.length).toBe(composedAfterFirst + 1);
    expect(runtimeMock.runtime.onSaveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: first[3].commandId, replayed: true }),
    );
  }, 20000);

  it('IKJLTY：确认笔撞其他客户端真实更新的受控 412——保留本地新编辑并登记复核闸门，重试被拦截', async () => {
    // 第 1 笔响应丢失且服务端未落库；期间其他客户端把版本推到 4——第 2 笔（原命令重放）
    // 携原 If-Match 3 收到受控 412（canvas_version_conflict）：原命令结果落定（未保存），
    // 本地新编辑保留，登记恢复冲突闸门引导刷新复核（既有口径，不因重放路径旁路）
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
    expect(confirmReplay[3].commandId).toBe(first[3].commandId); // 仍是原命令重放
    expect(confirmReplay[2]).toBe(3);
    // 本地新编辑保留（不被旧回执/旧全文覆盖）
    expect(flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!.data).toMatchObject({ fileName: '改名B' });

    // 复核闸门已登记：「重试保存」入口拦截，不再发请求
    await clickRetrySave();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    // 本地内容仍未被覆盖
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

    // 服务端已明确表态（412）→ 命令已死：重试必须换新命令，且 If-Match 采用服务端对齐版本
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    const [, second] = putCalls();
    expect(second[3].commandId).not.toBe(first[3].commandId);
    expect(second[2]).toBe(4); // adoptCanvasConflictVersion 对齐后重发（既有行为）
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
    // 既有行为：定向对账刷新台账（不自动重发旧全文）
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(runtimeMock.runtime.reconcileConflictItems).toHaveBeenCalledWith('p1');

    // 明确拒绝后命令作废：后续保存走新命令
    await renameNode('改名A');
    await waitDebounce();
    expect(recoveryApi.putCanvasDocWithRecovery).toHaveBeenCalledTimes(2);
    expect(putCalls()[1][3].commandId).not.toBe(first[3].commandId);
  }, 20000);
});

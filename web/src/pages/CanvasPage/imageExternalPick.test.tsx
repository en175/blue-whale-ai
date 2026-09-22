// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { AssetRecord } from '@/api/assets';
import CanvasPage from './index';
import { typePromptRefText } from './testing/promptRefEditor';
import {
  ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
} from './components/AttachmentActionBar';
import dialogStyles from './components/ImageDialog/index.module.css';

/* IKF5KE 自由生图面板参考选取事件的一次消费语义：
   从节点添加素材/从资产中选择注入的参考在删除并关闭（或工具栏直接重建）后不得随旧事件重放；
   本轮主动重选仍可加入；生成请求只携带本轮实际保留的参考。
   FlowCanvas/CanvasToolbar/AssetsPickerModal 打桩透出 props；ImageDialog 用真实实现。 */

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点与触发画布点击 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

/** CanvasToolbar 打桩：透出图片入口（工具栏打开/重建自由生图面板） */
const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

/** AssetsPickerModal 打桩：透出 onSelect 直接回填「从资产中选择」的确认结果 */
const assetsPickerProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/AssetsPickerModal', () => ({
  default: (props: Record<string, any>) => {
    assetsPickerProps.current = props;
    return createElement('div', { 'data-testid': 'assets-picker-stub' });
  },
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j1', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a2', url: 'http://img/out.png', type: 'image' },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => [
    {
      model_id: 'm-test',
      provider_id: 'prov',
      model_label: '测试生图模型',
      icon: null,
      supported_sizes: [{ id: '2k', label: '2K' }],
      supported_aspect_ratios: ['1:1'],
      supported_formats: [],
      supported_durations: null,
      default_size: '2k',
      default_format: null,
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: { reference_image: true, image_reference_max: 9 },
      version: 1,
      digest: '',
    },
  ]),
}));

vi.mock('@/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));

vi.mock('@/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchQuota: apiMocks.fetchQuota,
  toSessionUser: apiMocks.toSessionUser,
}));

vi.mock('@/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(async () => undefined),
}));

vi.mock('@/api/canvas', () => ({
  applyPromptPreview: vi.fn(),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
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

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

/* useCanvasDoc 打桩须保持引用稳定；内容经 current 按用例注入 */
const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));

vi.mock('./hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

/** 最小场景：仅一张就绪图片 m1（assetId a1），无连线 */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
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

/** 面板参考区预览图 alt 列表（自由面板渲染面板本地 files；IKFCKK 起为共享缩略图，挂参考行内） */
function refImages(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>(`.${dialogStyles.previewRow} img`)].map(
    (img) => img.alt,
  );
}

function panelOpen(): boolean {
  return container.querySelector('[contenteditable]') !== null;
}

/** 工具栏打开/重建自由生图面板 */
async function openFreePanel() {
  await act(async () => {
    toolbarProps.current.onToggleImageDialog();
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
}

/** IKGB7U 附件操作条：点「+ 参考」直达旧「从节点添加素材」链路——进入画布选取模式（旧「+」菜单已退役） */
async function enterPickMode() {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** 画布点击图片节点 m1（从节点添加素材命中） */
async function pickNodeM1() {
  const m1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1')!;
  await act(async () => {
    flowProps.current.onNodeClick(m1);
  });
}

/** IKGB7U 附件操作条：点「资产库」直达旧「从资产中选择」链路——打开资产库弹窗后确认回填 */
async function pickFromAssets(assets: AssetRecord[]) {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    assetsPickerProps.current.onSelect(assets);
  });
}

/** 移除参考区第一个附件 */
async function removeFirstRef() {
  const btn = container.querySelector<HTMLButtonElement>('button[title="移除"]')!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** 关闭当前面板 */
async function closePanel() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '关闭',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** IKFR4X 结束持续选取会话：点击提示条「完成选取」按钮（编辑/发送须先结束会话） */
async function finishPick() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === '完成选取',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

async function clickSend() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  // 面板会话/选取事件均以 ts 区分：单测节拍内保证单调递增，避免同毫秒 ts 撞 key
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => ++now);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe('IKF5KE 自由生图面板选取事件一次消费', () => {
  it('删除后关闭重开参考列表为空，连续重复不恢复旧附件', async () => {
    await renderPage();

    for (let round = 0; round < 2; round += 1) {
      await openFreePanel();
      await enterPickMode();
      await pickNodeM1();
      await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));

      await removeFirstRef();
      expect(refImages()).toEqual([]);

      await closePanel();
      expect(panelOpen()).toBe(false);

      await openFreePanel();
      expect(refImages()).toEqual([]);

      await closePanel();
    }
  });

  it('面板未关闭时工具栏直接重建空面板，不带入上一轮选取事件', async () => {
    await renderPage();
    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
    await removeFirstRef();
    expect(refImages()).toEqual([]);

    // 不关闭面板，直接经工具栏重建
    await openFreePanel();
    expect(refImages()).toEqual([]);
  });

  it('未删除附件直接关闭，新建空面板同样不继承旧事件', async () => {
    await renderPage();
    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));

    await closePanel();
    await openFreePanel();
    expect(refImages()).toEqual([]);
  });

  it('同一面板删除后重新选择同一素材可加入一次；重复选择保持去重', async () => {
    await renderPage();
    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));

    await removeFirstRef();
    expect(refImages()).toEqual([]);

    // 删除后主动重选同一节点：正常加入一次
    await enterPickMode();
    await pickNodeM1();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));

    // 未删除重复选择同一节点：既有去重规则不变
    await enterPickMode();
    await pickNodeM1();
    expect(refImages()).toEqual(['素材图一']);
  });

  it('从资产中选择加入草稿参考，删除后重开不重放', async () => {
    await renderPage();
    await openFreePanel();
    // 绑定模式经父级建立参考连线；删除后不能由旧选取事件再次注入。
    await pickFromAssets([
      { id: 7, type: 'image', url: 'http://img/asset7.png', width: 100, height: 100, duration: null, source: null, model: null, created_at: null },
    ]);
    expect(refImages()).toEqual(['asset7.png']);
    await removeFirstRef();
    expect(refImages()).toEqual([]);

    await closePanel();
    await openFreePanel();
    // 已消费的选择事件在新挂载上不重放（IKF5KE）
    expect(refImages()).toEqual([]);
  });

  // 1f2f498d 起面板经工具栏入口进入即绑定草稿卡，本地注入路径（含去重与 9 张上限保护）不再触发；
  // 逻辑仍保留在 ImageDialog 消费路径中，待产品决策绑定模式下的资产注入方案后恢复验证
  it.skip('批量选择保持既有去重与 9 张上限规则', async () => {
    const asset = (id: number): AssetRecord => ({
      id, type: 'image', url: `http://img/asset${id}.png`, width: 100, height: 100, duration: null, source: null, model: null, created_at: null,
    });
    await renderPage();
    await openFreePanel();

    // 批量内同一资产重复：按 id 去重，只入一次
    await pickFromAssets([asset(7), asset(8), asset(7)]);
    await vi.waitFor(() => expect(refImages()).toEqual(['asset7.png', 'asset8.png']));

    // 跨批次重复选择同一资产：仍不重复入列
    await pickFromAssets([asset(7)]);
    expect(refImages()).toEqual(['asset7.png', 'asset8.png']);

    // 一次批量 10 张新图：已有 2 张，补满 9 张后拒绝剩余并提示上限
    await pickFromAssets([10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(asset));
    await vi.waitFor(() => expect(refImages()).toHaveLength(9));
    expect(container.textContent).toContain('图片最多 9 张');
  });

  it('生成请求只包含本轮实际保留的参考：删除后不携带，保留时携带', async () => {
    await renderPage();

    // 选取后删空：发送不携带任何参考（IKFR4X：编辑/发送前先完成持续会话）
    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await finishPick();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
    await removeFirstRef();
    await typePrompt('画一只蓝鲸');
    await clickSend();
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].input_asset_ids).toBeUndefined();

    // 重开新面板主动选择：发送仅携带本轮保留的参考
    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await finishPick();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
    await typePrompt('参考这张图重绘');
    await clickSend();
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(2));
    expect(apiMocks.createGenerationJob.mock.calls[1]![1].input_asset_ids).toBeUndefined();
    expect(apiMocks.createGenerationJob.mock.calls[1]![1].references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
  });
});

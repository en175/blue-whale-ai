// CanvasPage 页面级测试共享夹具（IKGBP1 审查收口）：keyboardClipboardPage /
// clipboardPasteFallback / undoShortcut 三份页面级测试近乎逐行相同的 vi.mock
// 组件与 API 打桩、画布文档接缝、渲染与剪贴板/撤销操作助手收口于此。
// 各文件特有的打桩（系统剪贴板、上传、seed 画布、生成模型等）留在各自文件。
//
// 注意：vi.mock 在本文件顶层执行（非测试文件不提升）；CanvasPage 由 renderPage
// 动态 import 加载，测试文件自身不得再静态 import './index'，否则页面模块图
// 会在打桩注册前解析、mock 失效。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { GenerationModel } from '@/api/generation';
import type { FetchJobsParams, FrameInterpolationCurrentData, JobListData } from '@/api/jobs';

vi.mock('../components/AgentPanel', () => ({
  default: ({ initialCardLabel }: { initialCardLabel?: string }) =>
    createElement('div', { 'data-testid': 'agent-panel-stub' }, initialCardLabel),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点/连线与触发画布回调 */
export const flowProps: { current: Record<string, any> } = { current: {} };
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
vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

/** API 打桩：fetchProjects 默认单项目、fetchGenerationModels 默认空、fetchJobStatus 默认无实现——
 *  需要多项目/生成模型/任务状态的测试在各自 beforeEach 里 mockResolvedValue / mockImplementation 覆盖。
 *  cancelGenerationJob 默认成功返回（取消确认链 .then 需要 promise）；createFrameInterpolation
 *  默认无实现（IKHLKX 插帧发送：需要的测试显式 mockResolvedValue）；fetchFrameInterpolationCurrent
 *  默认 null（IKHSFF 关页恢复：无关联任务时水合恢复查询为 no-op，需要恢复的测试显式覆盖）。 */
export const apiMocks = {
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(async () => null),
  retryGenerationJob: vi.fn(),
  retryAudioMix: vi.fn(),
  newIdempotencyKey: vi.fn(() => 'test-retry-key'),
  createFrameInterpolation: vi.fn(),
  fetchFrameInterpolationCurrent: vi.fn(async (): Promise<FrameInterpolationCurrentData | null> => null),
  fetchJobs: vi.fn(async (_params?: FetchJobsParams): Promise<JobListData> => ({ records: [], total: 0, size: 20, current: 1 })),
  /** 调速创建（IKI4LX 项目隔离回归：默认无实现，需要的测试显式 mockResolvedValue /
   *  挂起手工放行；断言第三参 { silent: true } 同插帧先例） */
  createAudioSpeed: vi.fn(),
};

vi.mock('@/api/projects', () => ({
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
  touchProjectLastOpened: apiMocks.touchProjectLastOpened,
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
  linkAssetToProject: vi.fn(),
}));
vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
  ),
}));
vi.mock('@/api/jobs', () => ({
  createGenerationJob: vi.fn(),
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  retryAudioMix: apiMocks.retryAudioMix,
  newIdempotencyKey: apiMocks.newIdempotencyKey,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: vi.fn(),
  createFrameInterpolation: apiMocks.createFrameInterpolation,
  fetchFrameInterpolationCurrent: apiMocks.fetchFrameInterpolationCurrent,
  fetchJobs: apiMocks.fetchJobs,
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createAudioSpeed: apiMocks.createAudioSpeed,
  createVocalSplit: vi.fn(),
  readJobFailText: vi.fn(() => ''),
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

/** 画布文档接缝（useCanvasDoc 打桩）：各测试文件的 seed 函数改写 current 注入专属画布 */
export const canvasDocMock = {
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
};

vi.mock('../hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

/** React act 环境标记（renderPage 内亦会设置，beforeEach 显式调用以兼容 act 外操作） */
export function enableReactActEnvironment() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** 暴露 navigate 供切项目用例改 URL query（currentId 随 location.search 迁移） */
export let navigateRef: ((to: string) => void) | null = null;
function NavProbe() {
  navigateRef = useNavigate();
  return null;
}

/** 渲染 CanvasPage（jsdom + 打桩组件；页面经动态 import 加载，保证本文件顶层
 *  的 vi.mock 注册先于页面模块图；卸载走 unmountPage） */
export async function renderPage() {
  enableReactActEnvironment();
  const { default: CanvasPage } = await import('../index');
  container = document.createElement('div');
  document.body.appendChild(container);
  const createdRoot = createRoot(container);
  root = createdRoot;
  await act(async () => {
    createdRoot.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }) },
        createElement(MemoryRouter, { initialEntries: ['/canvas?project=p1'] }, createElement(NavProbe), createElement(CanvasPage)),
      ),
    );
  });
}

/** 卸载当前渲染的页面（afterEach 调用） */
export async function unmountPage() {
  const current = root;
  if (current) await act(async () => { current.unmount(); });
  container?.remove();
  root = null;
  container = null;
  navigateRef = null;
}

export function textNodes(): Node[] {
  return flowProps.current.textNodes as Node[];
}

export function mediaNodes(): Node[] {
  return flowProps.current.mediaNodes as Node[];
}

/** 粘贴副本（newNodeId 生成 text- 前缀；seed 节点 t1 无该前缀，天然区分原卡） */
export function textCopies(): Node[] {
  return textNodes().filter((n) => n.id.startsWith('text-'));
}

export function mediaCopies(): Node[] {
  return mediaNodes().filter((n) => n.id.startsWith('media-'));
}

/** C 快照上抛（Canvas 入口已过滤 text/media，页面收到的即最终名单） */
export async function copySelected(ids: string[]) {
  await act(async () => {
    flowProps.current.onCopySelected(ids);
  });
}

/** V 粘贴上抛（内部为空时走系统剪贴板兜底异步链，补一轮微任务冲刷） */
export async function pasteClipboard() {
  await act(async () => {
    flowProps.current.onPasteClipboard();
  });
  await act(async () => {});
}

/** 页面级撤销监听（document 捕获级）收真实 Ctrl/Cmd+Z */
export async function pressUndo(modifier: 'ctrl' | 'meta' = 'ctrl') {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', bubbles: true, cancelable: true,
      ctrlKey: modifier === 'ctrl', metaKey: modifier === 'meta',
    }));
  });
}

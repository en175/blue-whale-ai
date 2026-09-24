// @vitest-environment jsdom
/* IKI8L8 音频混合会话纪元回归（真实 CanvasPage 混合页面，受控 createAudioMix）：
   创建请求在途时按 Esc 退出（发送在途 X 按钮禁用，Esc 公共链是唯一可用的在途退出
   入口；其余公共退出入口——选中规范化退出/互斥退出/源卡删除绑定清理——与 Esc/X 同经
   exitAudioMixEditing 单点退出，纪元推进对该四路一并生效，本文件以 Esc 为代表入口），
   重开会话并改 WAV 等新参数后，旧成功/旧失败响应迟到返回：
   - 旧成功不得关闭新会话、不得清除新参数（修订前 exitAudioMixEditing 被无条件调用）；
   - 旧失败不得向新会话弹旧错误、不得改变其状态参数（修订前页面 catch 无纪元比对）；
   - 已受理的旧任务仍按原任务收尾：结果占位卡、来源边、首保存、轮询照常；
   - 旧请求结束后任务在途锁（ref）必须释放，新会话后续发送可用（不得留永久锁）；
   - 当前有效会话的成功闭环不受会话保护影响。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { AUDIO_MIX_EDGE_ORIGIN } from './audioMix';
import type { GenerationModel } from '@/api/generation';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点与边 */
type FlowProps = { mediaNodes: Node[]; edges: Array<{ source: string; target: string; data?: Record<string, unknown> }> };
const flowProps: { current: FlowProps } = { current: { mediaNodes: [], edges: [] } };
vi.mock('./components/Canvas', () => ({
  default: (props: FlowProps) => {
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

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(
    async (): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createAudioMix: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
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
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({
    queryKey: ['canvas', projectId, 'legacy-history'],
    queryFn: () => Promise.resolve({ items: [] }),
    retry: false,
  }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
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
  createAudioMix: apiMocks.createAudioMix,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));
vi.mock('@/utils/upload', () => ({ uploadAssetFile: apiMocks.uploadAssetFile }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：两张就绪音频卡 a1/a2（混合源 + 第二源候选，同 audioMixEdit 夹具） */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'a1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://aud/a1.mp3',
            mediaType: 'audio',
            fileName: '播客片头.mp3',
            assetId: '8',
            duration: 15,
            mime: 'audio/mpeg',
          },
        },
        {
          id: 'a2',
          type: 'mediaNode',
          position: { x: 1000, y: 0 },
          data: {
            src: 'http://aud/a2.mp3',
            mediaType: 'audio',
            fileName: '背景乐.mp3',
            assetId: '6',
            duration: 30,
            mime: 'audio/mpeg',
          },
        },
      ],
      edges: [],
    },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 },
      6: { asset_id: 6, type: 'audio', access_url: 'http://aud/a2.mp3', duration: 30 },
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
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(MemoryRouter, null, createElement(CanvasPage)),
      ),
    );
  });
}

/** 从音频卡工具栏进入混合编辑态（源卡 a1）。 */
async function enterMix() {
  const audio = flowProps.current.mediaNodes.find((n: Node) => n.id === 'a1')!;
  await act(async () => {
    (audio.data.onMixAudio as (id: string) => void)('a1');
  });
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 配好一次可发送的混合会话：加画布候选 a2 为第二源并改输出格式。 */
async function armSession(format: 'mp3' | 'wav') {
  await click('audio-mix-add');
  await click('audio-mix-candidate-a2');
  await click('audio-mix-format-trigger');
  await click(`audio-mix-format-${format}`);
}

/** 发送并冲刷微任务（挂起场景下创建请求已发出、仍未 settle）。 */
async function sendMix() {
  await click('audio-mix-send');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** 在途可用的 Esc 公共链退出（X 在提交中禁用，不能也不用于伪造本场景）。 */
async function pressEsc() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
});

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="audio-mix-send-bar"]');
}

function nodeById(id: string): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createAudioMix.mockReset();
  apiMocks.saveCanvasDoc.mockReset();
  apiMocks.saveCanvasDoc.mockResolvedValue({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });
  apiMocks.fetchJobStatus.mockReset();
  apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKI8L8 音频混合会话纪元：Esc 在途退出重开后旧响应不打扰新会话', () => {
  it('当前混合任务创建成功但首保存失败：提示用户重试保存，任务仍建卡轮询', async () => {
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await enterMix();
    await armSession('mp3');
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new Error('save failed'));

    await sendMix();
    await flush();

    expect(nodeById('audio-mix-j1')).toBeTruthy();
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    expect(document.body.textContent).toContain('混合任务已创建，但画布保存失败，请重试保存');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
  });

  it('首保存在途时重开混合：旧保存失败不向新会话提示，WAV 参数保留', async () => {
    let rejectSave!: (error: Error) => void;
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await enterMix();
    await armSession('mp3');
    apiMocks.saveCanvasDoc.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));

    await sendMix();
    expect(sendBar()).toBeNull();
    await enterMix();
    await armSession('wav');
    await act(async () => { rejectSave(new Error('旧画布保存失败')); });
    await flush();

    expect(document.body.textContent).not.toContain('混合任务已创建，但画布保存失败，请重试保存');
    expect(sendBar()).not.toBeNull();
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('wav');
    expect(nodeById('audio-mix-j1')).toBeTruthy();
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
  });

  it('旧成功迟到：新会话仍开、WAV 保留；旧任务照常建卡连线首保存轮询；锁释放后可再发送', async () => {
    let resolveOld!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioMix.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    await renderPage();
    await enterMix();
    await armSession('wav');
    await sendMix();
    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(1);
    // 发送在途：X 按钮（提交禁用）不可用，Esc 公共链是真实可用的退出入口
    expect(bodyBtn('audio-mix-close').disabled).toBe(true);
    expect(bodyBtn('audio-mix-send').disabled).toBe(true);
    await pressEsc();
    expect(sendBar()).toBeNull();
    // 重开新会话并改 WAV（新会话参数）
    await enterMix();
    await armSession('wav');
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('wav');
    // 旧成功响应迟到返回
    await act(async () => { resolveOld({ job_id: 'j1', status: 'queued' }); });
    await flush();
    // 新会话仍打开且 WAV 与所选第二源保留（修订前：旧成功无条件 exitAudioMixEditing 关新会话、清参数）
    expect(sendBar()).not.toBeNull();
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('wav');
    // 旧任务已受理：结果占位卡（冻结的 WAV 参数）照常建立
    const placeholder = nodeById('audio-mix-j1')!;
    expect(placeholder).toBeTruthy();
    expect(placeholder.data).toMatchObject({ fileName: '混合结果.wav', genStatus: 'generating' });
    // 来源边照常（a1/a2 → 占位卡，带 origin 标记）
    const lines = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .filter((edge) => edge.target === 'audio-mix-j1');
    expect(lines.map((edge) => [edge.source, edge.data?.origin]))
      .toEqual([['a1', AUDIO_MIX_EDGE_ORIGIN], ['a2', AUDIO_MIX_EDGE_ORIGIN]]);
    // 首保存与轮询照常启动（会话失效不跳过任务收尾）
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    // 旧请求结束只释放自己持有的任务在途锁：新会话可继续发送并正常闭环
    expect(bodyBtn('audio-mix-send').disabled).toBe(false);
    await sendMix();
    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(2);
    expect(apiMocks.createAudioMix).toHaveBeenLastCalledWith('p1', expect.objectContaining({ output_format: 'wav' }), { silent: true });
    // 新会话自己的成功闭环不受会话保护影响（发送条正常退出、j2 建卡）
    expect(sendBar()).toBeNull();
    expect(nodeById('audio-mix-j2')).toBeTruthy();
  });

  it('旧失败迟到：新会话状态参数不变、无旧错误提示、无占位卡；锁释放后可再发送', async () => {
    let rejectOld!: (error: unknown) => void;
    apiMocks.createAudioMix.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    await renderPage();
    await enterMix();
    await armSession('wav');
    await sendMix();
    expect(bodyBtn('audio-mix-close').disabled).toBe(true);
    await pressEsc();
    await enterMix();
    await armSession('wav');
    // 旧失败响应迟到返回（业务/网络失败同向：错误对象由页面 catch 收敛）
    await act(async () => { rejectOld(new Error('旧会话时代的创建失败')); });
    await flush();
    // 新会话仍开、WAV 与第二源保留，状态参数不变
    expect(sendBar()).not.toBeNull();
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('wav');
    expect(bodyBtn('audio-mix-send').disabled).toBe(false);
    // 无旧错误提示（修订前：页面 catch 无纪元比对，旧错误弹给新会话）
    expect(document.body.textContent).not.toContain('旧会话时代的创建失败');
    expect(document.body.textContent).not.toContain('音频混合任务创建失败');
    // 任务未创建：无占位卡、无来源边、无首保存
    expect((flowProps.current.mediaNodes as Node[]).filter((node) => node.id.startsWith('audio-mix-'))).toEqual([]);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
    // 旧请求结束后锁释放：新会话发送可用且正常成功
    await sendMix();
    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(2);
    expect(nodeById('audio-mix-j2')).toBeTruthy();
    expect(sendBar()).toBeNull();
  });
});

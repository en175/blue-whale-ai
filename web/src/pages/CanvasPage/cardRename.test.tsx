// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { typePromptRefText } from './testing/promptRefEditor';

/* IKFA8X 卡片名称：四类卡片改名接线（名称 + 显式 customName 标记）/ 新建文本立即可改 /
   复制继承与独立 / 生成生命周期（首次生成、重新生成、失败重试、取消回退）保留自定义名、
   未自定义卡片沿用自动命名。FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；
   ImageDialog 用真实实现（沿用 imageDraft/failureRetry 组织方式）。 */

vi.mock('./components/AgentPanel', () => ({
  default: ({ initialCardLabel }: { initialCardLabel?: string }) =>
    createElement('div', { 'data-testid': 'agent-panel-stub' }, initialCardLabel),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点/连线与触发画布回调 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

/** CanvasToolbar 打桩：透出文本/图片入口 */
const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

const headerProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasHeader', () => ({
  default: (props: Record<string, any>) => {
    headerProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-header' });
  },
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
  saveCanvasDoc: vi.fn(async (
    _projectId: string,
    _payload: { viewport: unknown; nodes: Node[]; edges: Array<{ id: string; source: string; target: string }> },
    _version: number | null,
  ) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j-new', cursor: 1 })),
  /** 任务状态覆盖表：用例可钉住 processing/cancelled 观察中间态，默认 succeeded */
  statusOverrides: { current: {} as Record<string, string> },
  /** 按 jobId 分发终态：覆盖表优先；j-cancel 默认取消，其余默认成功 */
  fetchJobStatus: vi.fn(async (jobId: number | string) => {
    const id = String(jobId);
    const status = apiMocks.statusOverrides.current[id] ?? (id === 'j-cancel' ? 'cancelled' : 'succeeded');
    if (status === 'processing') return { job_id: id, status, progress: 10 };
    if (status === 'cancelled') return { job_id: id, status, progress: 0 };
    return {
      job_id: id,
      status: 'succeeded',
      progress: 100,
      asset: { id: 'a-out', url: 'http://img/out.png', type: 'image', width: 1024, height: 1024 },
    };
  }),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(async (_projectId: string, _jobId: number | string) => ({ generation_job_id: 'j-retry-new', cursor: 2 })),
  createMediaExtraction: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  /** 按能力返回模型目录：图片面板取 image，视频面板取 video（IKFA8Y 视频参考用例需要视频模型） */
  fetchGenerationModels: vi.fn(async (capability: string) => capability === 'video'
    ? [{
        model_id: 'seedance-2',
        provider_id: 'prov',
        model_label: '测试视频模型',
        icon: null,
        supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
        supported_aspect_ratios: ['16:9'],
        supported_formats: [],
        supported_durations: { min: 4, max: 12, step: 1 },
        default_size: '720p',
        default_format: null,
        default_aspect_ratio: '16:9',
        default_duration: 5,
        features: {
          reference_image: true,
          max_reference_images: 10,
          watermark: false,
          quantity_max: 1,
          sequential_image_generation: false,
          stream: false,
          tools: false,
          first_frame: true,
          last_frame: true,
          first_last_frame: true,
          audio: false,
        },
        version: 1,
        digest: '',
      }]
    : [
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
          features: { reference_image: true, max_reference_images: 9 },
          version: 1,
          digest: '',
        },
      ]),
}));

vi.mock('@/api/projects', () => ({
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
  createMediaExtraction: apiMocks.createMediaExtraction,
  readJobFailText: apiMocks.readJobFailText,
}));

vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

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

/**
 * 验收画布文档：
 * - img-a / img-b：同一素材 a1 的两张图片卡（独立性用例）
 * - vid / aud：视频卡、音频卡
 * - t1：文本卡（无 title，沿用默认显示）
 * - d1：待生成图片草稿卡
 * - gen-custom：已自定义名称的生成中卡（customName 显式标记）
 * - gen-auto：未自定义的生成中卡（自动命名回归基线）
 * - fail-custom：已自定义名称的首生成失败卡（重试用例）
 * - cancel-custom：已自定义名称的生成中草稿卡（取消回退用例）
 * - vd1：待生成视频草稿卡（IKFA8Y 视频参考显示同步用例）
 */
function seedRenameDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { html: '<p>正文</p>' } },
        {
          id: 'img-a', type: 'mediaNode', position: { x: 200, y: 0 },
          data: { src: 'http://img/shared.png', mediaType: 'image', fileName: '上传图.png', assetId: 'a1', mime: 'image/png' },
        },
        {
          id: 'img-b', type: 'mediaNode', position: { x: 560, y: 0 },
          data: { src: 'http://img/shared.png', mediaType: 'image', fileName: '上传图.png', assetId: 'a1', mime: 'image/png' },
        },
        {
          id: 'vid', type: 'mediaNode', position: { x: 920, y: 0 },
          data: { src: 'http://img/clip.mp4', mediaType: 'video', fileName: '素材视频.mp4', assetId: 'a2', mime: 'video/mp4' },
        },
        {
          id: 'aud', type: 'mediaNode', position: { x: 1280, y: 0 },
          data: { src: 'http://img/bgm.mp3', mediaType: 'audio', fileName: '配乐.mp3', assetId: 'a3', mime: 'audio/mpeg' },
        },
        {
          id: 'd1', type: 'mediaNode', position: { x: 420, y: 400 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
        {
          id: 'vd1', type: 'mediaNode', position: { x: 700, y: 600 },
          data: { src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '', draftMode: 'reference' },
        },
        {
          id: 'gen-custom', type: 'mediaNode', position: { x: 780, y: 400 },
          data: { src: '', mediaType: 'image', fileName: '我的封面', genStatus: 'generating', customName: true, jobId: 'j-custom', progress: 40, prompt: '封面提示词', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1' },
        },
        {
          id: 'gen-auto', type: 'mediaNode', position: { x: 1140, y: 400 },
          data: { src: '', mediaType: 'image', fileName: '图片生成中', genStatus: 'generating', jobId: 'j-auto', progress: 40, prompt: '自动命名提示词', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1' },
        },
        {
          id: 'fail-custom', type: 'mediaNode', position: { x: 1500, y: 400 },
          data: { src: '', mediaType: 'image', fileName: '我的草稿', genStatus: 'failed', customName: true, draft: true, jobId: 'j-fail', errorText: '上游生成失败', prompt: '草稿提示词', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1' },
        },
        {
          id: 'cancel-custom', type: 'mediaNode', position: { x: 1860, y: 400 },
          data: { src: '', mediaType: 'image', fileName: '等待中的草稿', genStatus: 'generating', customName: true, draft: true, jobId: 'j-cancel', progress: 10, prompt: '取消提示词', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1' },
        },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/shared.png', width: 100, height: 100 },
      a2: { asset_id: 2, type: 'video', access_url: 'http://img/clip.mp4', width: 100, height: 100 },
      a3: { asset_id: 3, type: 'audio', access_url: 'http://img/bgm.mp3' },
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

function mediaNode(id: string): Node {
  return flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
}

function textNode(id: string): Node {
  return flowProps.current.textNodes.find((n: Node) => n.id === id)!;
}

/** 节点标题编辑保存路径的真实回调（MediaNode/TextNode 提交时调用） */
async function renameVia(id: string, kind: 'media' | 'text', name: string) {
  const node = kind === 'media' ? mediaNode(id) : textNode(id);
  const onTitleChange = (node.data as Record<string, unknown>).onTitleChange as ((id: string, name: string) => void) | undefined;
  expect(typeof onTitleChange, `${id} 应已接入名称编辑回调`).toBe('function');
  await act(async () => {
    onTitleChange!(id, name);
  });
}

function sendButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

/** 下载捕获：拦下 <a download> 的点击，读回浏览器将要保存的文件名（同组下载既有做法） */
let downloadedName = '';
function stubDownloadCapture() {
  downloadedName = '';
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const el = realCreate(tag, options);
    if (tag === 'a') {
      (el as HTMLAnchorElement).click = () => {
        downloadedName = (el as HTMLAnchorElement).download;
      };
    }
    return el;
  }) as typeof document.createElement);
}

/** 媒体节点下载回调（节点工具条/右键菜单的下载入口），返回下载后的文件名 */
async function downloadVia(id: string, type: string): Promise<string> {
  const onDownload = mediaNode(id).data.onDownload as ((id: string) => Promise<void>) | undefined;
  expect(typeof onDownload, `${id} 应已接入下载回调`).toBe('function');
  const blob = new Blob(['x'], { type });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })));
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} });
  await act(async () => {
    await onDownload!(id);
  });
  return downloadedName;
}

/** 图片草稿面板参考缩略项图片 alt（ImageDialog 按来源节点身份渲染，alt = 参考名称） */
function dockRefNames(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>('[data-testid="dock-media-ref"] img')].map(
    (img) => img.alt,
  );
}

/** 图片自由面板参考项名称（无 dock 测试标识，取面板内预览项 img 的 alt） */
function freePanelRefNames(): string[] {
  const dialog = container.querySelector('[class*="dialog"]');
  return [...(dialog?.querySelectorAll<HTMLImageElement>('img[alt]') ?? [])].map((img) => img.alt);
}

/** 视频面板参考缩略项标题（BottomDialog 按来源节点身份渲染，title = 参考名称） */
function dockVideoRefNames(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="dock-video-ref"]')].map(
    (el) => el.getAttribute('title') ?? '',
  );
}

/** 打开图片草稿卡 d1 的绑定生成面板 */
async function openImageDraftPanel(): Promise<string> {
  await act(async () => {
    flowProps.current.onNodeClick(mediaNode('d1'));
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
  return 'd1';
}

/** 打开视频草稿卡 vd1 的绑定生成面板 */
async function openVideoDraftPanel(): Promise<string> {
  await act(async () => {
    flowProps.current.onNodeClick(mediaNode('vd1'));
  });
  return 'vd1';
}

/** 视频草稿面板内「到节点选择」：进入选取模式后点画布节点作为普通参考（同画布连线语义） */
async function pickNodeIntoVideoPanel(nodeId: string, role: '图片' | '视频' = '图片') {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    (b.getAttribute('title') ?? '').startsWith(`添加${role}参考`),
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const item = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === '到节点选择',
  )!;
  await act(async () => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    flowProps.current.onNodeClick(mediaNode(nodeId));
  });
}



async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  apiMocks.statusOverrides.current = {};
  seedRenameDoc();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKFA8X 改名接线与独立性', () => {
  it('图片/视频/音频/文本四类卡片改名：写入名称并显式标记 customName', async () => {
    await renderPage();

    await renameVia('img-a', 'media', '海边日落');
    await renameVia('vid', 'media', '片头素材');
    await renameVia('aud', 'media', '旁白配音');
    await renameVia('t1', 'text', '分镜大纲');

    expect(mediaNode('img-a').data.fileName).toBe('海边日落');
    expect(mediaNode('img-a').data.customName).toBe(true);
    expect(mediaNode('vid').data.fileName).toBe('片头素材');
    expect(mediaNode('vid').data.customName).toBe(true);
    expect(mediaNode('aud').data.fileName).toBe('旁白配音');
    expect(mediaNode('aud').data.customName).toBe(true);
    expect(textNode('t1').data.title).toBe('分镜大纲');
    expect(textNode('t1').data.customName).toBe(true);
  });

  it('名称与自定义状态随自动保存落盘（真实序列化负载）', async () => {
    await renderPage();
    await renameVia('img-a', 'media', '海边日落');

    await vi.waitFor(
      () => {
        const last = apiMocks.saveCanvasDoc.mock.calls.at(-1);
        expect(last).toBeTruthy();
        const saved = last![1].nodes.find((n) => n.id === 'img-a')!;
        expect(saved.data.fileName).toBe('海边日落');
        expect(saved.data.customName).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it('同一素材的两张卡只改一张：另一张名称与自定义状态保持', async () => {
    await renderPage();
    await renameVia('img-b', 'media', '副本专用名');

    expect(mediaNode('img-b').data.fileName).toBe('副本专用名');
    expect(mediaNode('img-a').data.fileName).toBe('上传图.png');
    expect(mediaNode('img-a').data.customName).toBeUndefined();
  });

  it('新建普通文本无需刷新即可改名', async () => {
    await renderPage();
    const before = flowProps.current.textNodes.length;

    await act(async () => {
      toolbarProps.current.onAddTextNode();
    });
    expect(flowProps.current.textNodes).toHaveLength(before + 1);
    const created = flowProps.current.textNodes.at(-1)!;

    await renameVia(created.id, 'text', '新建即改');
    expect(textNode(created.id).data.title).toBe('新建即改');
    expect(textNode(created.id).data.customName).toBe(true);
  });

  it('空文本卡改名后添加到对话使用当前名称，未命名时保持默认标签', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onAddTextNode(); });
    const id = flowProps.current.textNodes.at(-1)!.id;
    const addToChat = async () => act(async () => {
      (textNode(id).data.onAddToChat as (id: string) => void)(id);
    });

    await addToChat();
    expect(container.querySelector('[data-testid="agent-panel-stub"]')?.textContent).toBe('文本节点');
    await renameVia(id, 'text', '自定义空白文本');
    await addToChat();
    expect(container.querySelector('[data-testid="agent-panel-stub"]')?.textContent).toBe('自定义空白文本');
  });

  it('复制继承名称与自定义状态，此后分别改名互不影响', async () => {
    await renderPage();
    await renameVia('img-a', 'media', '母版名');

    await act(async () => {
      (mediaNode('img-a').data.onDuplicate as (id: string) => void)('img-a');
    });
    const copy = flowProps.current.mediaNodes.at(-1)!;
    expect(copy.id).not.toBe('img-a');
    expect(copy.data.fileName).toBe('母版名');
    expect(copy.data.customName).toBe(true);

    await renameVia('img-a', 'media', '母版改名');
    await renameVia(copy.id, 'media', '副本改名');
    expect(mediaNode('img-a').data.fileName).toBe('母版改名');
    expect(mediaNode(copy.id).data.fileName).toBe('副本改名');
  });

  it('文本卡复制同样继承名称与自定义状态', async () => {
    await renderPage();
    await renameVia('t1', 'text', '大纲母版');

    await act(async () => {
      (textNode('t1').data.onDuplicate as (id: string) => void)('t1');
    });
    const copy = flowProps.current.textNodes.at(-1)!;
    expect(copy.data.title).toBe('大纲母版');
    expect(copy.data.customName).toBe(true);
  });
});

describe('IKFA8X 生成生命周期保留自定义名', () => {
  it('待生成草稿先改名，原位转生成中保留自定义名；成功回填不覆盖（同卡身份）', async () => {
    // 钉住新任务为 processing：稳定观察生成中状态（imageDraft 先例：succeeded 替身瞬时推进，中间态须钉住）
    apiMocks.statusOverrides.current['j-new'] = 'processing';
    await renderPage();
    await renameVia('d1', 'media', '我的封面图');

    // 点击草稿卡打开绑定面板并发送
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('d1'));
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('画一只蓝鲸');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].target_node_id).toBe('d1');

    // 原位转生成中：名称不被「图片生成中」覆盖，节点身份不变
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBe('generating'));
    expect(mediaNode('d1').data.fileName).toBe('我的封面图');
    expect(mediaNode('d1').data.customName).toBe(true);

    // 放行成功：回填保留自定义名与自定义状态（成功回填守卫另由 gen-custom 水合用例覆盖）
    apiMocks.statusOverrides.current['j-new'] = 'succeeded';
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBeUndefined(), { timeout: 8000 });
    expect(mediaNode('d1').data.fileName).toBe('我的封面图');
    expect(mediaNode('d1').data.customName).toBe(true);
    expect(mediaNode('d1').data.src).toBe('http://img/out.png');
    expect(mediaNode('d1').data.draft).toBeUndefined();
  });

  it('水合恢复的生成中自定义卡：成功回填保留名称与自定义状态', async () => {
    await renderPage();
    // gen-custom 水合即恢复轮询，j-custom 成功
    await vi.waitFor(() => expect(mediaNode('gen-custom').data.genStatus).toBeUndefined(), { timeout: 5000 });
    expect(mediaNode('gen-custom').data.fileName).toBe('我的封面');
    expect(mediaNode('gen-custom').data.customName).toBe(true);
    expect(mediaNode('gen-custom').data.src).toBe('http://img/out.png');
  });

  it('未自定义的生成卡成功回填沿用自动命名（回归基线）', async () => {
    await renderPage();
    await vi.waitFor(() => expect(mediaNode('gen-auto').data.genStatus).toBeUndefined(), { timeout: 5000 });
    expect(mediaNode('gen-auto').data.fileName).toBe('生成-j-auto');
    expect(mediaNode('gen-auto').data.customName).toBeUndefined();
  });

  it('失败重试保留自定义名：重试转生成中与成功回填均不覆盖', async () => {
    // 钉住重试任务为 processing：稳定观察重试后的生成中状态
    apiMocks.statusOverrides.current['j-retry-new'] = 'processing';
    await renderPage();
    await act(async () => {
      (mediaNode('fail-custom').data.onRetryJob as (id: string) => void)('fail-custom');
    });
    // 重试沿用失败任务快照发起：旧 jobId 作为重试入参
    await vi.waitFor(() => expect(apiMocks.retryGenerationJob).toHaveBeenCalledWith('p1', 'j-fail'));
    // 重试进入生成中：名称保持
    await vi.waitFor(() => expect(mediaNode('fail-custom').data.genStatus).toBe('generating'));
    expect(mediaNode('fail-custom').data.fileName).toBe('我的草稿');

    // 重试任务成功回填：名称与自定义状态保持，草稿身份结束
    apiMocks.statusOverrides.current['j-retry-new'] = 'succeeded';
    await vi.waitFor(() => expect(mediaNode('fail-custom').data.genStatus).toBeUndefined(), { timeout: 8000 });
    expect(mediaNode('fail-custom').data.fileName).toBe('我的草稿');
    expect(mediaNode('fail-custom').data.customName).toBe(true);
    expect(mediaNode('fail-custom').data.draft).toBeUndefined();
  });

  it('取消生成回退待生成：自定义名保留，不被「图片草稿」覆盖', async () => {
    await renderPage();
    // cancel-custom 水合即恢复轮询，j-cancel 返回 cancelled → 回退待生成
    await vi.waitFor(() => expect(mediaNode('cancel-custom').data.genStatus).toBe('draft'), { timeout: 5000 });
    expect(mediaNode('cancel-custom').data.fileName).toBe('等待中的草稿');
    expect(mediaNode('cancel-custom').data.customName).toBe(true);
  });
});

describe('IKFA8Y 改名同步当前参考显示', () => {
  it.each(['列表选择', '画布点击'])('音频参考经%s选入后随源卡改名更新', async (entry) => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleAudioDialog(); });
    const pick = container.querySelector('button[title="添加参考音频（最多 3 段）"]')!;
    await act(async () => { pick.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const fromCanvas = [...container.querySelectorAll('button')].find((b) => b.textContent === '从画布选择')!;
    await act(async () => { fromCanvas.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {
      if (entry === '画布点击') flowProps.current.onNodeClick(mediaNode('aud'));
      else {
        const source = [...container.querySelectorAll('button')].find((b) => b.textContent === '配乐.mp3')!;
        source.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    expect(container.querySelector('button[title="播放：配乐.mp3"]')).not.toBeNull();

    const assetId = mediaNode('aud').data.assetId;
    const src = mediaNode('aud').data.src;
    await renameVia('aud', 'media', '新配乐');
    expect(container.querySelector('button[title="播放：新配乐"]')).not.toBeNull();
    expect(container.querySelectorAll('button[title^="播放："]')).toHaveLength(1);
    expect(mediaNode('aud').data.assetId).toBe(assetId);
    expect(mediaNode('aud').data.src).toBe(src);
  });

  it('图片自由面板的文本附件随源卡改名更新，连线和正文保持不变', async () => {
    // 已完成的生成卡保留其原始文本输入连线。
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [{ id: 'text-ref', source: 't1', target: 'img-a' }];
    await renderPage();
    await renameVia('t1', 'text', '原附件标题');
    await act(async () => {
      (mediaNode('img-a').data.onGenImage as (id: string) => void)('img-a');
    });
    await vi.waitFor(() => expect(container.textContent).toContain('原附件标题'));
    const edges = flowProps.current.edges;

    await renameVia('t1', 'text', '新附件标题');
    expect(container.textContent).toContain('新附件标题');
    expect(container.textContent).not.toContain('原附件标题');
    expect(container.textContent).toContain('正文');
    expect(flowProps.current.edges).toEqual(edges);
  });

  it('改名已被生成面板引用的卡片：参考显示同步新名称，连线与引用身份不变', async () => {
    await renderPage();
    const draftId = await openImageDraftPanel();

    // 画布连线建立图片参考：img-a（a1）→ 草稿
    await act(async () => {
      flowProps.current.onConnect({ source: 'img-a', target: draftId, sourceHandle: null, targetHandle: null });
    });
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['上传图.png']));

    // 改名来源卡片：参考显示同步新名称
    await renameVia('img-a', 'media', '海边日落');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['海边日落']));

    // 引用对象与连线不变：仍是同一节点、同一素材
    expect(flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
      .toEqual([`img-a->${draftId}`]);
    expect(mediaNode('img-a').data.assetId).toBe('a1');
    expect(mediaNode('img-a').data.src).toBe('http://img/shared.png');
  });

  it('同素材多张卡只更新改名节点的参考显示', async () => {
    await renderPage();
    const draftId = await openImageDraftPanel();
    // img-a 与 img-b 同素材 a1：仅改名 img-a
    await act(async () => {
      flowProps.current.onConnect({ source: 'img-a', target: draftId, sourceHandle: null, targetHandle: null });
    });
    await renameVia('img-a', 'media', '只改这张');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['只改这张']));
    expect(mediaNode('img-b').data.fileName).toBe('上传图.png');
  });

  it('视频面板参考同样随改名同步（连线推导 + 选取当刻缓存两条路径）', async () => {
    await renderPage();
    const draftId = await openVideoDraftPanel();

    // 连线来源：改名后按来源节点身份取当前名称（连线用视频素材，暂存选取用图片素材，避免同素材去重）
    await act(async () => {
      flowProps.current.onConnect({ source: 'vid', target: draftId, sourceHandle: null, targetHandle: null });
    });
    await vi.waitFor(() => expect(dockVideoRefNames()).toEqual(['素材视频.mp4']));
    await renameVia('vid', 'media', '连线改名');
    await vi.waitFor(() => expect(dockVideoRefNames()).toEqual(['连线改名']));

    // 选取当刻缓存路径：先选取并入暂存参考，再改名
    await pickNodeIntoVideoPanel('img-a');
    await vi.waitFor(() => expect(dockVideoRefNames()).toEqual(['连线改名', '上传图.png']));
    await renameVia('img-a', 'media', '暂存改名');
    await vi.waitFor(() => expect(dockVideoRefNames()).toEqual(['连线改名', '暂存改名']));
  });

  it('改名后新选参考使用当前名称；已提交的生成记录保持当次输入', async () => {
    await renderPage();
    const draftId = await openImageDraftPanel();
    // 连线建立参考后改名：参考显示用当前名称，提交输入仍是同一素材身份
    await act(async () => {
      flowProps.current.onConnect({ source: 'img-a', target: draftId, sourceHandle: null, targetHandle: null });
    });
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['上传图.png']));
    await renameVia('img-a', 'media', '改名后引用');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['改名后引用']));

    await typePrompt('把这张图重新画一遍');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    // 历史生成请求冻结当次输入：素材身份不随后续改名变化，也不会重复提交
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.input_asset_ids).toEqual(['a1']);
    await renameVia('img-a', 'media', '发送后再改');
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].input_asset_ids).toEqual(['a1']);
    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
  });

  it('图片自由面板（画布节点带入的参考）同步改名后的名称', async () => {
    await renderPage();
    await act(async () => {
      (mediaNode('img-a').data.onGenImage as (id: string) => void)('img-a');
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(freePanelRefNames()).toEqual(['上传图.png']);

    await renameVia('img-a', 'media', '自由面板改名');
    await vi.waitFor(() => expect(freePanelRefNames()).toEqual(['自由面板改名']));
  });
});

describe('IKFA8Y 下载以当前卡片名称命名', () => {
  beforeEach(() => {
    stubDownloadCapture();
  });

  it('改名后下载：用当前卡片名称 + 真实类型扩展名', async () => {
    await renderPage();
    await renameVia('img-a', 'media', '海边日落');
    expect(await downloadVia('img-a', 'image/png')).toBe('海边日落.png');
  });

  it('卡片名称自带扩展名时不重复追加，扩展名与真实类型不一致时按真实类型纠正', async () => {
    await renderPage();
    // 未改名的上传卡本身带 .png：不重复追加
    expect(await downloadVia('img-a', 'image/png')).toBe('上传图.png');
    // 用户改名保留了旧扩展名：按真实类型替换，不产生「视频名.mp4.png」这类名实不符的文件
    await renameVia('img-a', 'media', '海边日落.mp4');
    expect(await downloadVia('img-a', 'image/png')).toBe('海边日落.png');
  });

  it('视频与音频按各自真实类型命名', async () => {
    await renderPage();
    await renameVia('vid', 'media', '片头');
    expect(await downloadVia('vid', 'video/mp4')).toBe('片头.mp4');
    await renameVia('aud', 'media', '旁白');
    expect(await downloadVia('aud', 'audio/mpeg')).toBe('旁白.mp3');
  });

  it('同素材另一张卡的下载名称不被联动，素材库命名不受影响', async () => {
    await renderPage();
    await renameVia('img-a', 'media', '只改这张');
    expect(await downloadVia('img-a', 'image/png')).toBe('只改这张.png');
    expect(await downloadVia('img-b', 'image/png')).toBe('上传图.png');
    expect(mediaNode('img-b').data.customName).toBeUndefined();
  });

  it('保存成功并刷新恢复后，下载仍使用持久恢复的新名称', async () => {
    await renderPage();
    await renameVia('img-a', 'media', '持久名');
    await vi.waitFor(
      () => {
        const last = apiMocks.saveCanvasDoc.mock.calls.at(-1);
        expect(last![1].nodes.find((n: Node) => n.id === 'img-a')!.data.fileName).toBe('持久名');
      },
      { timeout: 3000 },
    );
    expect(await downloadVia('img-a', 'image/png')).toBe('持久名.png');
  });
});

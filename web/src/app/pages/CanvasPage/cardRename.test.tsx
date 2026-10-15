// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { typePromptRefText } from './testing/promptRefEditor';


vi.mock('@/app/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/app/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ records: [], next_cursor: null, protocol_version: 1, canvas_version: null }),
  })),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
}));
vi.mock('./components/AgentPanel', () => ({
  default: ({ initialCardLabel }: { initialCardLabel?: string }) =>
    createElement('div', { 'data-testid': 'agent-panel-stub' }, initialCardLabel),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

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

vi.mock('@/app/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/app/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(async (
    _projectId: string,
    _payload: { viewport: unknown; nodes: Node[]; edges: Array<{ id: string; source: string; target: string }> },
    _version: number | null,
  ) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j-new', cursor: 1 })),
  statusOverrides: { current: {} as Record<string, string> },
  fetchJobStatus: vi.fn(async (jobId: number | string) => {
    const id = String(jobId);
    const status = apiMocks.statusOverrides.current[id] ?? (id === 'j-cancel' ? 'cancelled' : 'succeeded');
    if (status === 'processing') return { job_id: id, status, progress: 10 };
    if (status === 'cancelled') return { job_id: id, status, progress: 0 };
    if (status === 'failed') return { job_id: id, status, progress: 0, asset: null, error: { code: 1000, msg: '上游生成失败' } };
    return {
      job_id: id,
      status: 'succeeded',
      progress: 100,
      asset: { id: 'a-out', url: 'http://img/out.png', type: 'image', width: 1024, height: 1024 },
    };
  }),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(async (_projectId: string, _jobId: number | string) => ({ generation_job_id: 'j-retry-new', cursor: 2 })),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (capability: string) => capability === 'video'
    ? [{
        model_id: 'seedance-2',
        provider_id: 'prov',
        model_label: '测试视频模型',
        icon: null,
        supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
        supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
        supported_formats: [],
        supported_durations: { min: 4, max: 12, step: 1 },
        default_size: '720p',
        default_format: null,
        default_aspect_ratio: '16:9',
        default_duration: 5,
        features: {
          reference_image: true,
          image_reference_max: 10,
          watermark: false,
          quantity_max: 1,
          sequential_image_generation: false,
          stream: false,
          tools: false,
          first_frame: true,
          last_frame: true,
          first_last_frame: true,
          task_types: {
            text2video: {},
            omni: {},
            image_reference: {},
            first_frame: {},
            first_last_frame: {},
          },
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
          supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
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

vi.mock('@/app/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));

vi.mock('@/app/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));

vi.mock('@/app/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/app/api/canvas', () => ({
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

vi.mock('@/app/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
  readJobFailText: apiMocks.readJobFailText,
}));

vi.mock('@/app/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

vi.mock('@/app/api/generation', () => ({
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

async function downloadVia(id: string, type: string): Promise<string> {
  const onDownload = mediaNode(id).data.onDownload as ((id: string) => Promise<void>) | undefined;
  expect(typeof onDownload, `${id} 应已接入下载回调`).toBe('function');
  const blob = new Blob(['x'], { type });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })));
  const StubURL = class extends URL {};
  (StubURL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:stub';
  (StubURL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.stubGlobal('URL', StubURL);
  await act(async () => {
    await onDownload!(id);
  });
  return downloadedName;
}

function dockRefNames(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>('[data-testid="dock-media-ref"] img')].map(
    (img) => img.alt,
  );
}

function dockVideoRefNames(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="dock-video-ref"]')].map(
    (el) => el.getAttribute('title') ?? '',
  );
}

async function openImageDraftPanel(): Promise<string> {
  await act(async () => {
    flowProps.current.onNodeClick(mediaNode('d1'));
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
  return 'd1';
}

async function openVideoDraftPanel(): Promise<string> {
  await act(async () => {
    flowProps.current.onNodeClick(mediaNode('vd1'));
  });
  return 'vd1';
}

async function sendImageDraftUntilGenerating(prompt: string) {
  await openImageDraftPanel();
  await typePrompt(prompt);
  await act(async () => {
    sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBe('generating'));
}

async function pickNodeIntoVideoPanel(nodeId: string, _role: '图片' | '视频' = '图片') {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === '参考',
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
  Reflect.deleteProperty(document, 'elementsFromPoint');
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
    apiMocks.statusOverrides.current['j-new'] = 'processing';
    await renderPage();
    await renameVia('d1', 'media', '我的封面图');

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

    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBe('generating'));
    expect(mediaNode('d1').data.fileName).toBe('我的封面图');
    expect(mediaNode('d1').data.customName).toBe(true);

    apiMocks.statusOverrides.current['j-new'] = 'succeeded';
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBeUndefined(), { timeout: 8000 });
    expect(mediaNode('d1').data.fileName).toBe('我的封面图');
    expect(mediaNode('d1').data.customName).toBe(true);
    expect(mediaNode('d1').data.src).toBe('http://img/out.png');
    expect(mediaNode('d1').data.draft).toBeUndefined();
  });

  it('水合恢复的生成中自定义卡：成功回填保留名称与自定义状态', async () => {
    await renderPage();
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
    apiMocks.statusOverrides.current['j-retry-new'] = 'processing';
    await renderPage();
    await act(async () => {
      (mediaNode('fail-custom').data.onRetryJob as (id: string) => void)('fail-custom');
    });
    await vi.waitFor(() => expect(apiMocks.retryGenerationJob).toHaveBeenCalledWith('p1', 'j-fail', expect.any(String)));
    await vi.waitFor(() => expect(mediaNode('fail-custom').data.genStatus).toBe('generating'));
    expect(mediaNode('fail-custom').data.fileName).toBe('我的草稿');

    apiMocks.statusOverrides.current['j-retry-new'] = 'succeeded';
    await vi.waitFor(() => expect(mediaNode('fail-custom').data.genStatus).toBeUndefined(), { timeout: 8000 });
    expect(mediaNode('fail-custom').data.fileName).toBe('我的草稿');
    expect(mediaNode('fail-custom').data.customName).toBe(true);
    expect(mediaNode('fail-custom').data.draft).toBeUndefined();
  });

  it('取消生成回退待生成：自定义名保留，不被「图片草稿」覆盖', async () => {
    await renderPage();
    await vi.waitFor(() => expect(mediaNode('cancel-custom').data.genStatus).toBe('draft'), { timeout: 5000 });
    expect(mediaNode('cancel-custom').data.fileName).toBe('等待中的草稿');
    expect(mediaNode('cancel-custom').data.customName).toBe(true);
  });

  it('生成进行中双击改名：入口可用并保存成功，成功回填保留该名称', async () => {
    apiMocks.statusOverrides.current['j-new'] = 'processing';
    await renderPage();
    await sendImageDraftUntilGenerating('画一只蓝鲸');
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    expect(mediaNode('d1').data.fileName).toBe('图片生成中');

    await renameVia('d1', 'media', '生成中起的名');
    expect(mediaNode('d1').data.fileName).toBe('生成中起的名');
    expect(mediaNode('d1').data.customName).toBe(true);

    apiMocks.statusOverrides.current['j-new'] = 'succeeded';
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBeUndefined(), { timeout: 8000 });
    expect(mediaNode('d1').data.fileName).toBe('生成中起的名');
    expect(mediaNode('d1').data.customName).toBe(true);
    expect(mediaNode('d1').data.src).toBe('http://img/out.png');
  });

  it('生成中改名后失败：名称保留，再次生成开始不被自动名覆盖', async () => {
    apiMocks.statusOverrides.current['j-new'] = 'processing';
    await renderPage();
    await sendImageDraftUntilGenerating('画一只蓝鲸');
    await renameVia('d1', 'media', '生成中起的名');

    apiMocks.statusOverrides.current['j-new'] = 'failed';
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBe('failed'), { timeout: 8000 });
    expect(mediaNode('d1').data.fileName).toBe('生成中起的名');
    expect(mediaNode('d1').data.customName).toBe(true);

    apiMocks.statusOverrides.current['j-new'] = 'processing';
    await sendImageDraftUntilGenerating('再画一只蓝鲸');
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(2));
    expect(mediaNode('d1').data.fileName).toBe('生成中起的名');
    expect(mediaNode('d1').data.customName).toBe(true);

    apiMocks.statusOverrides.current['j-new'] = 'succeeded';
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBeUndefined(), { timeout: 8000 });
    expect(mediaNode('d1').data.fileName).toBe('生成中起的名');
    expect(mediaNode('d1').data.customName).toBe(true);
  }, 20000);

  it('生成中改名后失败：重试转生成中与成功回填都保留该名称', async () => {
    apiMocks.statusOverrides.current['j-new'] = 'processing';
    await renderPage();
    await sendImageDraftUntilGenerating('画一只蓝鲸');
    await renameVia('d1', 'media', '生成中起的名');

    apiMocks.statusOverrides.current['j-new'] = 'failed';
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBe('failed'), { timeout: 8000 });
    expect(mediaNode('d1').data.fileName).toBe('生成中起的名');

    apiMocks.statusOverrides.current['j-retry-new'] = 'processing';
    await act(async () => {
      (mediaNode('d1').data.onRetryJob as (id: string) => void)('d1');
    });
    await vi.waitFor(() => expect(apiMocks.retryGenerationJob).toHaveBeenCalledWith('p1', 'j-new', expect.any(String)));
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBe('generating'));
    expect(mediaNode('d1').data.fileName).toBe('生成中起的名');

    apiMocks.statusOverrides.current['j-retry-new'] = 'succeeded';
    await vi.waitFor(() => expect(mediaNode('d1').data.genStatus).toBeUndefined(), { timeout: 8000 });
    expect(mediaNode('d1').data.fileName).toBe('生成中起的名');
    expect(mediaNode('d1').data.customName).toBe(true);
  }, 20000);
});

describe('IKFA8Y 改名同步当前参考显示', () => {
  it.each(['列表选择', '画布点击'])('音频参考经%s选入后随源卡改名更新', async (entry) => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleAudioDialog(); });
    const fromCanvas = container.querySelector<HTMLButtonElement>('button[title="从节点添加素材"]')!;
    await act(async () => { fromCanvas.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {
      if (entry === '画布点击') flowProps.current.onNodeClick(mediaNode('aud'));
      else {
        const source = [...container.querySelectorAll('button')].find((b) => b.textContent === '配乐.mp3')!;
        source.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    const audioThumb = () => container.querySelector('[data-testid="audio-ref-thumb"]') as HTMLElement | null;
    expect(audioThumb()?.getAttribute('title')).toBe('配乐.mp3');

    const assetId = mediaNode('aud').data.assetId;
    const src = mediaNode('aud').data.src;
    await renameVia('aud', 'media', '新配乐');
    await vi.waitFor(() => expect(audioThumb()?.getAttribute('title')).toBe('新配乐'));
    expect(container.querySelectorAll('[data-testid="audio-ref-thumb"]')).toHaveLength(1);
    expect(mediaNode('aud').data.assetId).toBe(assetId);
    expect(mediaNode('aud').data.src).toBe(src);
  });

  it('图片自由面板的文本附件随源卡改名更新，连线和正文保持不变', async () => {
    const doc = canvasDocMock.current.doc as { edges: unknown[]; nodes: Array<{ id: string; data: Record<string, unknown> }> };
    doc.edges = [{ id: 'text-ref', source: 't1', target: 'img-a' }];
    doc.nodes.find((n) => n.id === 'img-a')!.data.draft = true;
    await renderPage();
    await renameVia('t1', 'text', '原附件标题');
    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'img-a'));
    });
    const textThumb = () => container.querySelector('[data-testid="dock-text-ref"]') as HTMLElement | null;
    await vi.waitFor(() => expect(textThumb()?.getAttribute('title')).toBe('原附件标题'));
    const edges = flowProps.current.edges;

    await renameVia('t1', 'text', '新附件标题');
    await vi.waitFor(() => expect(textThumb()?.getAttribute('title')).toBe('新附件标题'));
    await act(async () => {
      textThumb()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 250); });
    });
    expect(document.querySelector('[data-testid="ref-thumb-preview"]')?.textContent).toContain('正文');
    expect(flowProps.current.edges).toEqual(edges);
  });

  it('改名已被生成面板引用的卡片：参考显示同步新名称，连线与引用身份不变', async () => {
    await renderPage();
    const draftId = await openImageDraftPanel();

    await act(async () => {
      flowProps.current.onConnect({ source: 'img-a', target: draftId, sourceHandle: null, targetHandle: null });
    });
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['上传图.png']));

    await renameVia('img-a', 'media', '海边日落');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['海边日落']));

    expect(flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
      .toEqual([`img-a->${draftId}`]);
    expect(mediaNode('img-a').data.assetId).toBe('a1');
    expect(mediaNode('img-a').data.src).toBe('http://img/shared.png');
  });

  it('同素材多张卡只更新改名节点的参考显示', async () => {
    await renderPage();
    const draftId = await openImageDraftPanel();
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

    await act(async () => {
      flowProps.current.onConnect({ source: 'vid', target: draftId, sourceHandle: null, targetHandle: null });
    });
    await vi.waitFor(() => expect(dockVideoRefNames()).toEqual(['素材视频.mp4']));
    await renameVia('vid', 'media', '连线改名');
    await vi.waitFor(() => expect(dockVideoRefNames()).toEqual(['连线改名']));

    await pickNodeIntoVideoPanel('img-a');
    await vi.waitFor(() => expect(dockVideoRefNames()).toEqual(['连线改名', '上传图.png']));
    await renameVia('img-a', 'media', '暂存改名');
    await vi.waitFor(() => expect(dockVideoRefNames()).toEqual(['连线改名', '暂存改名']));
  });

  it('改名后新选参考使用当前名称；已提交的生成记录保持当次输入', async () => {
    await renderPage();
    const draftId = await openImageDraftPanel();
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

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
    await renameVia('img-a', 'media', '发送后再改');
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].input_asset_ids).toBeUndefined();
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
  });

  it('拖线落空白经类型菜单建图片草稿：面板参考同步改名后的名称', async () => {
    await renderPage();
    document.elementsFromPoint = () => [];
    await act(async () => {
      flowProps.current.onConnectEnd(
        new MouseEvent('mouseup', { clientX: 400, clientY: 300 }),
        { fromNode: mediaNode('img-a') },
      );
    });
    const menuItem = () => [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '图片生成')!;
    await vi.waitFor(() => expect(menuItem()).toBeTruthy());
    await act(async () => {
      menuItem().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(dockRefNames()).toEqual(['上传图.png']);

    await renameVia('img-a', 'media', '自由面板改名');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['自由面板改名']));
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
    expect(await downloadVia('img-a', 'image/png')).toBe('上传图.png');
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

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
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
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
      features: {},
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
          data: { src: 'http://img/shared.png', mediaType: 'image', fileName: '上传图.png', assetId: 'a1' },
        },
        {
          id: 'img-b', type: 'mediaNode', position: { x: 560, y: 0 },
          data: { src: 'http://img/shared.png', mediaType: 'image', fileName: '上传图.png', assetId: 'a1' },
        },
        {
          id: 'vid', type: 'mediaNode', position: { x: 920, y: 0 },
          data: { src: 'http://img/clip.mp4', mediaType: 'video', fileName: '素材视频.mp4', assetId: 'a2' },
        },
        {
          id: 'aud', type: 'mediaNode', position: { x: 1280, y: 0 },
          data: { src: 'http://img/bgm.mp3', mediaType: 'audio', fileName: '配乐.mp3', assetId: 'a3' },
        },
        {
          id: 'd1', type: 'mediaNode', position: { x: 420, y: 400 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
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

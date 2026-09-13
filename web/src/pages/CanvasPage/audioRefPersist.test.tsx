// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { typePromptRefText } from './testing/promptRefEditor';

/* IKFDFZ 音频节点参考隔离、持久化与生成传递：画布选取/@ 即时建线并随自动保存落盘；
   关闭重开、A→B→A 按连线恢复且互不串入；存量 audioRefs 迁移为连线；移除断线重开不复活；
   重复/超限明确拒绝；失效来源提示原因并阻止发送；发送按顺序组装 references。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；AudioDialog 用真实实现。 */

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
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
  saveCanvasDoc: vi.fn(async (
    _projectId: string,
    _payload: { viewport: unknown; nodes: Node[]; edges: Array<{ id: string; source: string; target: string; data?: unknown }> },
    _version: number | null,
  ) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]', edges: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j1', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a9', url: 'http://audio/out.mp3', type: 'audio', duration: 30 },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => [
    {
      model_id: 'a-test',
      provider_id: 'prov',
      model_label: '测试音频模型',
      icon: null,
      supported_sizes: null,
      supported_aspect_ratios: null,
      supported_formats: [],
      supported_durations: null,
      default_size: null,
      default_format: null,
      default_aspect_ratio: null,
      default_duration: null,
      features: {},
      version: 1,
      digest: '',
      is_default: true,
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

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真 */
vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn(
    (edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
      JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
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

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

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

/** 默认画布：文本 t1 + 成品音频 u1/u2/u3/u4 + 成品图片 m1 + 音频草稿 d1（可选注入 d2/预置边/audioRefs） */
function seedDoc(extra?: {
  secondDraft?: boolean;
  edges?: Array<{ id: string; source: string; target: string }>;
  legacyAudioRefs?: unknown[];
  brokenSource?: boolean;
}) {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        { id: 'm1', type: 'mediaNode', position: { x: 0, y: 120 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '成品图', assetId: 'a-img' } },
        { id: 'u1', type: 'mediaNode', position: { x: 300, y: 0 }, data: { src: 'http://aud/u1.mp3', mediaType: 'audio', fileName: '海浪声', assetId: 'a1' } },
        { id: 'u2', type: 'mediaNode', position: { x: 600, y: 0 }, data: { src: 'http://aud/u2.mp3', mediaType: 'audio', fileName: '风声', assetId: 'a2' } },
        { id: 'u3', type: 'mediaNode', position: { x: 900, y: 0 }, data: { src: 'http://aud/u3.mp3', mediaType: 'audio', fileName: '雨声', assetId: 'a3' } },
        {
          id: 'u0',
          type: 'mediaNode',
          position: { x: 1200, y: 0 },
          data: extra?.brokenSource
            ? { src: 'http://aud/u0.mp3', mediaType: 'audio', fileName: '坏来源', assetId: 'a0', genStatus: 'generating' }
            : { src: 'http://aud/u0.mp3', mediaType: 'audio', fileName: '备用', assetId: 'a8' },
        },
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 420, y: 300 },
          data: {
            src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '',
            ...(extra?.legacyAudioRefs ? { audioRefs: extra.legacyAudioRefs } : {}),
          },
        },
        ...(extra?.secondDraft
          ? [{
              id: 'd2', type: 'mediaNode', position: { x: 640, y: 300 },
              data: { src: '', mediaType: 'audio', fileName: '音频草稿二', genStatus: 'draft', draft: true, prompt: '' },
            }]
          : []),
      ],
      edges: extra?.edges ?? [],
    },
    assets: {
      'a-img': { asset_id: 101, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a1: { asset_id: 1, type: 'audio', access_url: 'http://aud/u1.mp3', duration: 12 },
      a2: { asset_id: 2, type: 'audio', access_url: 'http://aud/u2.mp3', duration: 8 },
      a3: { asset_id: 3, type: 'audio', access_url: 'http://aud/u3.mp3', duration: 15 },
      a8: { asset_id: 8, type: 'audio', access_url: 'http://aud/u0.mp3', duration: 20 },
      a0: { asset_id: 10, type: 'audio', access_url: 'http://aud/u0.mp3', duration: 20 },
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

function sendButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('[data-testid="audio-send"]')!;
}

async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

async function clickNode(id: string) {
  const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id);
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}

const edgePairs = () =>
  flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`);

/** 面板参考缩略图名称列表（RefThumbnail 根元素 title=素材名） */
function refNames(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="audio-ref-thumb"]')].map((el) => el.title);
}

/** 经「添加参考音频」→「从节点添加素材」进入画布选取模式（面板列表与 pick 模式同时激活） */
async function startCanvasPick() {
  await vi.waitFor(() => {
    const btn = [...container.querySelectorAll('button')].find((b) => b.title === '从资产中选择 / 从节点添加素材');
    expect(btn).toBeTruthy();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.title === '从资产中选择 / 从节点添加素材')!.click();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === '从节点添加素材')!.click();
  });
}

/** 选取是一次性模式：每选一个节点前重新进入画布选取，再点击来源节点（真实路径） */
async function pickCanvasNode(nodeId: string) {
  await startCanvasPick();
  await clickNode(nodeId);
}

async function waitModelReady() {
  await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'), { timeout: 3000 });
}

/** 关闭当前绑定面板（右上角 ×） */
async function closePanel() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '关闭',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** 最近一次自动保存载荷 */
const lastSavedPayload = () => apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKFDFZ 音频参考即时建线与持久化', () => {
  it('画布连续选取多项参考：校验通过立即逐条建线，身份、数量、顺序随自动保存完整上送（不等待发送）', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickCanvasNode('u1');
    expect(edgePairs()).toEqual(['u1->d1']);
    await pickCanvasNode('u2');
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    // 自动保存载荷：两条连线按边序完整上送；未发送不创建任务
    await vi.waitFor(() => {
      expect(lastSavedPayload().edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual(['u1->d1', 'u2->d1']);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('关闭重开：参考按连线完整恢复（提示词与配置同路径），不因未发送丢失', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('环境音');

    await pickCanvasNode('u1');
    await pickCanvasNode('u2');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    await closePanel();
    expect(refNames()).toEqual([]);

    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).toContain('环境音');
  });

  it('空白隐藏重开：点击画布空白隐藏面板，参考与提示词保留，重开原目标恢复', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('空白隐藏描述');

    await pickCanvasNode('u1');
    await pickCanvasNode('u2');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    // 画布空白点击隐藏面板（Q9：隐藏不丢弃，绑定保留供重开原目标）
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(refNames()).toEqual([]);

    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).toContain('空白隐藏描述');
  });

  it('A→B→A 目标隔离：A 的参考与提示词保留，B 不串入 A；B 独立积累自己的参考', async () => {
    seedDoc({ secondDraft: true });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('A 目标描述');

    await pickCanvasNode('u1');
    await pickCanvasNode('u2');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    // 切换到 B：面板干净，不带入 A 的参考与提示词
    await clickNode('d2');
    await waitModelReady();
    expect(refNames()).toEqual([]);
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).not.toContain('A 目标描述');

    await pickCanvasNode('u3');
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1', 'u3->d2']);

    // 切回 A：A 的两项参考完整恢复，B 的参考不串入
    await clickNode('d1');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).toContain('A 目标描述');
  });

  it('存量 data.audioRefs 画布项首次打开迁移为连线，旧字段清空随保存落盘', async () => {
    seedDoc({
      legacyAudioRefs: [
        { id: 'u1', kind: 'audio', name: '海浪声', src: 'http://aud/u1.mp3', source: 'canvas', assetId: 'a1' },
        { id: 'u2', kind: 'audio', name: '风声', src: 'http://aud/u2.mp3', source: 'canvas', assetId: 'a2' },
        { id: 'gone', kind: 'audio', name: '已不在画布', src: 'http://aud/gone.mp3', source: 'canvas', assetId: 'a7' },
      ],
    });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    // 画布上仍存在的两项迁移为连线；已消失的项无法表达，不迁移
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    await vi.waitFor(() => {
      const d1 = lastSavedPayload().nodes.find((n: Node) => n.id === 'd1')!;
      expect((d1.data as Record<string, unknown>).audioRefs).toEqual([]);
    }, { timeout: 3000 });
  });

  it('重复素材与超上限明确拒绝：重复提示「重复的素材已跳过」不建第二条线；满 3 段后入口显示已达上限', async () => {
    seedDoc({
      edges: [
        { id: 'e-u1-d1', source: 'u1', target: 'd1' },
        { id: 'e-u2-d1', source: 'u2', target: 'd1' },
      ],
    });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    // 重复素材（同 assetId）拒绝：明确提示且不建第二条线
    await pickCanvasNode('u1');
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1']);
    await vi.waitFor(() => expect(container.textContent).toContain('重复的素材已跳过'));

    // 补满第 3 段后：入口收起并显示已达上限（不静默截断，无添加入口）
    await act(async () => {
      flowProps.current.onConnect({ source: 'u3', target: 'd1' });
    });
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声', '雨声']), { timeout: 3000 });
    await vi.waitFor(() => expect(container.textContent).toContain('已达上限'));
    expect([...container.querySelectorAll('button')].some((b) => b.title === '从资产中选择 / 从节点添加素材')).toBe(false);
  });

  it('失效来源（生成中）保留连线并提示原因阻止发送；移除后恢复发送', async () => {
    seedDoc({
      brokenSource: true,
      edges: [{ id: 'e-u0-d1', source: 'u0', target: 'd1' }],
    });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('描述');

    // 失效来源不进参考列表，但连线保留并给出原因
    await vi.waitFor(() => expect(refNames()).toEqual([]), { timeout: 3000 });
    await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-ref-invalid"]')?.textContent).toContain('生成中的卡片不能作为参考'));
    expect(sendButton().disabled).toBe(true);

    // 断开失效连线后恢复发送
    await act(async () => {
      flowProps.current.onEdgesChange([{ id: 'e-u0-d1', type: 'remove' }]);
    });
    await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-ref-invalid"]')).toBeNull());
    expect(sendButton().disabled).toBe(false);
  });

  it('面板移除参考：断开对应连线并随保存落盘，来源素材与其他目标引用保持完整，重开不复活', async () => {
    seedDoc({ secondDraft: true });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickCanvasNode('u1');
    await pickCanvasNode('u2');
    // 其他目标也引用 u1：移除 A 的引用不影响 B 的连线
    await act(async () => {
      flowProps.current.onConnect({ source: 'u1', target: 'd2' });
    });
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    const removeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="audio-ref-thumb"] button[title="移除"]')];
    await act(async () => { removeButtons().at(-1)!.click(); });
    expect(edgePairs()).toEqual(['u1->d1', 'u1->d2']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']));
    await vi.waitFor(() => {
      expect(lastSavedPayload().edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual(['u1->d1', 'u1->d2']);
    }, { timeout: 3000 });

    await closePanel();
    await clickNode('d1');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
  });

  it('画布拖线：音频→音频草稿建线持久化；图片→音频草稿不建线（音频面板不提供图片入口）', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await act(async () => {
      flowProps.current.onConnect({ source: 'u1', target: 'd1' });
    });
    expect(edgePairs()).toEqual(['u1->d1']);

    await act(async () => {
      flowProps.current.onConnect({ source: 'm1', target: 'd1' });
    });
    expect(edgePairs()).toEqual(['u1->d1']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
  });

  it('发送：画布参考按连线顺序进入创建任务 references（role/type/asset_id），携带 target_node_id', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('生成一段海边的环境音');

    await pickCanvasNode('u1');
    await pickCanvasNode('u2');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.type).toBe('audio');
    expect(payload.target_node_id).toBe('d1');
    expect(payload.references).toEqual([
      { role: 'reference', type: 'audio', asset_id: 'a1' },
      { role: 'reference', type: 'audio', asset_id: 'a2' },
    ]);
    // 不携带旧参考字段
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.reference_asset_ids).toBeUndefined();
  });
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { ATTACHMENT_ACTION_PICK_ASSETS_TITLE } from './components/AttachmentActionBar';
import type { GenerationModel, ModelFeatures } from '@/api/generation';
import type { AssetRecord } from '@/api/assets';

/* IKFDG2 画布外参考建来源卡片并持久关联：
   资产库选择的持久素材——画布已有同身份节点时复用来源卡片不重复建卡，无明确来源时建卡并连线，
   连线随既有自动保存落盘（无需发送）；同名不同身份不误用。
   IKFE8V：音频改为从资产选择，取消不建卡建线；保存失败仍保留未保存提示并阻止发送。
   FlowCanvas/CanvasToolbar/CanvasHeader/AssetsPickerModal 打桩透出 props；三类面板用真实实现。 */

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

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

const pickerProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/AssetsPickerModal', () => ({
  default: (props: Record<string, any>) => {
    pickerProps.current = props;
    return createElement('div', { 'data-testid': 'assets-picker-stub' });
  },
}));

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
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
  saveCanvasDoc: vi.fn(async (
    _projectId: string,
    _payload: { viewport: unknown; nodes: Node[]; edges: Array<{ id: string; source: string; target: string; data?: unknown }> },
    _version: number | null,
  ) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j1', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a9', url: 'http://audio/out.mp3', type: 'audio', duration: 30 },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
}));

/** 画布外素材持久接纳的上传封装（本地上传换取 assetId）——按用例注入成功/失败/md5 命中 */
const uploadMocks = vi.hoisted(() => ({
  uploadAssetFile: vi.fn(),
}));

vi.mock('@/utils/upload', () => ({ uploadAssetFile: uploadMocks.uploadAssetFile }));

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
  dedupUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(async () => undefined),
}));

vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  // !779 起保存 catch 会调这个函数对齐 412 version；缺省则 throw，失败提示出不来
  readCanvasConflictVersion: () => undefined,
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

const apiGenerationMocks = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
}));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiGenerationMocks.fetchGenerationModels,
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

function imageModel(modelId: string, label: string, features: Partial<ModelFeatures> = {}): GenerationModel {
  return {
    model_id: modelId,
    provider_id: 'prov',
    model_label: label,
    icon: null,
    supported_sizes: [{ id: '2k', label: '2K' }],
    supported_aspect_ratios: ['1:1'],
    supported_formats: [],
    supported_durations: null,
    default_size: '2k',
    default_format: null,
    default_aspect_ratio: '1:1',
    default_duration: null,
    features: {
      reference_image: true, image_reference_max: 9, watermark: false, quantity_max: 1,
      sequential_image_generation: false, stream: false, tools: false,
      first_frame: false, last_frame: false, first_last_frame: false, audio: false,
      ...features,
    },
    is_default: true,
    version: 1,
    digest: '',
  };
}

function videoModel(modelId: string, label: string, features: Partial<ModelFeatures> = {}): GenerationModel {
  return {
    model_id: modelId,
    provider_id: 'prov',
    model_label: label,
    icon: null,
    supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }, { id: '1080p', label: '1080p', api_value: '1080p' }],
    supported_aspect_ratios: ['16:9'],
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
      audio: false,
      ...features,
    },
    is_default: modelId === 'seedance-2',
    version: 1,
    digest: '',
  };
}

function audioModel(): GenerationModel {
  return {
    model_id: 'a-test',
    provider_id: 'prov',
    model_label: '测试音频模型',
    icon: null,
    supported_sizes: [],
    supported_aspect_ratios: [],
    supported_formats: [],
    supported_durations: null,
    default_size: null,
    default_format: null,
    default_aspect_ratio: null,
    default_duration: null,
    features: {
      reference_image: false, image_reference_max: 0, watermark: false, quantity_max: 1,
      sequential_image_generation: false, stream: false, tools: false,
      first_frame: false, last_frame: false, first_last_frame: false, audio: false,
    },
    is_default: true,
    version: 1,
    digest: '',
  };
}

/** 默认画布：图片成品 m1(a1) + 音频成品 au1(aud1) + 图片草稿 d1 + 视频草稿 dv1 + 音频草稿 da1 */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
        { id: 'au1', type: 'mediaNode', position: { x: 600, y: 0 }, data: { src: 'http://audio/au1.mp3', mediaType: 'audio', fileName: '参考音频一', assetId: 'aud1', duration: 30 } },
        { id: 'd1', type: 'mediaNode', position: { x: 420, y: 160 }, data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' } },
        {
          id: 'dv1', type: 'mediaNode', position: { x: 460, y: 320 },
          data: {
            src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '',
            draftModelId: 'seedance-2', draftSize: '720p', draftRatio: '16:9', draftDuration: 5,
          },
        },
        { id: 'da1', type: 'mediaNode', position: { x: 500, y: 480 }, data: { src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '' } },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      aud1: { asset_id: 'aud1', type: 'audio', access_url: 'http://audio/au1.mp3', duration: 30 },
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

/** 点击画布媒体节点（打开绑定面板） */
async function clickNode(id: string) {
  const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}

const edgePairs = () =>
  flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`);

const mediaNodeCount = () => flowProps.current.mediaNodes.length;

/** 最近一次自动保存载荷 */
const lastSaved = () => apiMocks.saveCanvasDoc.mock.calls.at(-1)![1] as {
  nodes: Node[];
  edges: Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
};

/** 关闭当前绑定面板（右上角 ×） */
async function closePanel() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '关闭',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** 构造资产库素材记录（placeAssetsOnCanvas 输入形态） */
function assetOf(id: number | string, type: 'image' | 'video' | 'audio', url: string): AssetRecord {
  return {
    id,
    type,
    url,
    width: type === 'audio' ? null : 100,
    height: type === 'audio' ? null : 100,
    duration: type === 'audio' ? 30 : null,
    size: 1024,
    source: 'uploaded',
    model: null,
    created_at: null,
  } as AssetRecord;
}

/** 图片面板「资产库」（IKGB7U 附件操作条直达，旧「+」菜单已退役）：点 pill → 桩 onSelect 回调 */
async function pickImagePanelAssets(assets: AssetRecord[]) {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    pickerProps.current.onSelect(assets);
  });
}

/** 音频面板「资产库」（IKGB82 附件操作条直达，旧「+」菜单已退役）：点 pill → 桩 onSelect 回调 */
async function pickAudioPanelAssets(assets: AssetRecord[]) {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    pickerProps.current.onSelect(assets);
  });
}

/** 视频面板「资产库」（IKGB7W 附件操作条直达，栏尾旧「+」菜单退役）：点 pill → 桩 onSelect 回调 */
async function pickVideoPanelAssets(assets: AssetRecord[]) {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    pickerProps.current.onSelect(assets);
  });
}

/** 音频统一入口：从资产选择已有持久身份，接纳与画布保存沿用原链路。 */
async function pickAudioAsset() {
  await pickAudioPanelAssets([{ id: 'au9', type: 'audio', url: 'http://audio/au9.mp3', width: null, height: null, duration: 25, source: 'uploaded', model: null, created_at: null } as AssetRecord]);
}

/** 面板参考缩略图名称列表（audio-ref-thumb / dock-media-ref） */
function refNames(testid: string): string[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)].map((el) => el.textContent ?? '');
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiGenerationMocks.fetchGenerationModels.mockImplementation(async (kind?: string) => {
    if (kind === 'video') return [videoModel('seedance-2', '测试视频模型')];
    if (kind === 'audio') return [audioModel()];
    return [imageModel('m-test', '测试生图模型')];
  });
  uploadMocks.uploadAssetFile.mockImplementation(async () => ({
    asset_id: 'au9', url: 'http://audio/au9.mp3', mime: 'audio/mpeg', size: 2048,
  }));
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKFDG2 画布外参考建来源卡片并持久关联', () => {
  it('图片面板资产库选择画布已有素材：复用来源卡片不重复建卡，连线到当前目标并随自动保存落盘', async () => {
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    const before = mediaNodeCount();
    await pickImagePanelAssets([assetOf('a1', 'image', 'http://img/m1.png')]);

    // 复用已有 m1：不新建节点，直接建 m1->d1 连线
    expect(mediaNodeCount()).toBe(before);
    expect(edgePairs()).toEqual(['m1->d1']);
    await vi.waitFor(() => {
      expect(lastSaved().edges.map((e) => `${e.source}->${e.target}`)).toEqual(['m1->d1']);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('图片面板资产库选择画布外新素材：建立来源卡片并连线，节点与边随自动保存完整上送', async () => {
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    const before = mediaNodeCount();
    await pickImagePanelAssets([assetOf(5, 'image', 'http://img/m5.png')]);

    expect(mediaNodeCount()).toBe(before + 1);
    const newNode = flowProps.current.mediaNodes.find(
      (n: Node) => n.id !== 'm1' && n.id !== 'au1' && (n.data as Record<string, unknown>)?.assetId === '5',
    );
    expect(newNode).toBeTruthy();
    expect(edgePairs()).toEqual([`${newNode.id}->d1`]);
    await vi.waitFor(() => {
      const saved = lastSaved();
      expect(saved.edges.map((e) => `${e.source}->${e.target}`)).toEqual([`${newNode.id}->d1`]);
      expect(saved.nodes.some((n) => n.id === newNode.id)).toBe(true);
    }, { timeout: 3000 });
  });

  it('同名但不同身份的素材不误用：资产库选择同显示名不同 id 的素材建独立来源卡，不复用既有节点', async () => {
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    const before = mediaNodeCount();
    // URL 与 m1 同路径（展示名相同）但 id 不同：身份不同，不复用 m1
    await pickImagePanelAssets([assetOf('a99', 'image', 'http://img/m1.png')]);

    expect(mediaNodeCount()).toBe(before + 1);
    expect(edgePairs()).not.toContain('m1->d1');
    const newNode = flowProps.current.mediaNodes.find(
      (n: Node) => n.id !== 'm1' && n.id !== 'au1' && (n.data as Record<string, unknown>)?.assetId === 'a99',
    );
    expect(newNode).toBeTruthy();
    expect(edgePairs()).toEqual([`${newNode.id}->d1`]);
  });

  it('图片面板资产库接纳后 A→B→A 切换：A 的参考完整恢复，B 不串入', async () => {
    // 补第二个图片草稿 d2 作为切换目标 B
    (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
      id: 'd2', type: 'mediaNode', position: { x: 560, y: 160 },
      data: { src: '', mediaType: 'image', fileName: '图片草稿二', genStatus: 'draft', draft: true, prompt: '' },
    });
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await pickImagePanelAssets([assetOf('a1', 'image', 'http://img/m1.png')]);
    await pickImagePanelAssets([assetOf('a5', 'image', 'http://img/m5.png')]);
    await vi.waitFor(() => expect(refNames('dock-media-ref').length).toBe(2), { timeout: 3000 });

    // 切到 B：B 面板打开但无 A 的参考（连线只属于 A）
    await closePanel();
    await clickNode('d2');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(refNames('dock-media-ref')).toEqual([]);

    // 返回 A：两项参考（复用节点 + 新建来源卡）完整恢复
    await closePanel();
    await clickNode('d1');
    await vi.waitFor(() => expect(refNames('dock-media-ref').length).toBe(2));
    expect(edgePairs().every((pair: string) => pair.endsWith('->d1'))).toBe(true);
  });

  it('视频面板普通参考资产库选择：已有同身份图片节点复用建线，画布外新素材建来源卡建线', async () => {
    await renderPage();
    await clickNode('dv1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'));

    const before = mediaNodeCount();
    // IKGB7W：入口形态平移到操作条「资产库」pill，落地行为不变——复用：a1 已有画布节点 m1
    await pickVideoPanelAssets([assetOf('a1', 'image', 'http://img/m1.png')]);
    expect(mediaNodeCount()).toBe(before);
    expect(edgePairs()).toEqual(['m1->dv1']);

    // 新素材：建来源卡并连线
    await pickVideoPanelAssets([assetOf('a6', 'image', 'http://img/m6.png')]);
    expect(mediaNodeCount()).toBe(before + 1);
    const newNode = flowProps.current.mediaNodes.find(
      (n: Node) => (n.data as Record<string, unknown>)?.assetId === 'a6',
    );
    expect(edgePairs()).toEqual(['m1->dv1', `${newNode.id}->dv1`]);
    await vi.waitFor(() => {
      expect(lastSaved().edges.map((e) => `${e.source}->${e.target}`)).toEqual(['m1->dv1', `${newNode.id}->dv1`]);
    }, { timeout: 3000 });
  });

  /* 边界说明（非用例）：视频面板首帧槽从零添加受 IKFC1T 模式门控不可达（keyframe 模式需
     imageCount≥2 启用，而首帧入口又要求首帧槽空闲——互锁），IKFE6E 已立 P1 跟踪，本票不新增
     入口。首帧角色的连线持久化与发送路由由 videoRefPersist「首尾帧草稿保存恢复」「首帧生成请求
     角色校验」既有用例覆盖，本票改动对 refRole 仅透传不改变语义。 */

  it('音频草稿资产选择成功：复用持久身份，建来源卡片并连线，节点与边随自动保存落盘且面板显示', async () => {
    await renderPage();
    await clickNode('da1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'));

    await pickAudioAsset();
    await vi.waitFor(() => expect(edgePairs().length).toBe(1), { timeout: 3000 });
    const newNode = flowProps.current.mediaNodes.find(
      (n: Node) => (n.data as Record<string, unknown>)?.assetId === 'au9',
    );
    expect(newNode).toBeTruthy();
    expect((newNode.data as Record<string, unknown>).mediaType).toBe('audio');
    expect(edgePairs()).toEqual([`${newNode.id}->da1`]);
    // 面板参考经连线推导显示（不进入面板本地上传暂存）
    await vi.waitFor(() => expect(refNames('audio-ref-thumb').length).toBe(1));
    await vi.waitFor(() => {
      const saved = lastSaved();
      expect(saved.edges.map((e) => `${e.source}->${e.target}`)).toEqual([`${newNode.id}->da1`]);
      expect(saved.nodes.some((n) => n.id === newNode.id)).toBe(true);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('音频统一入口取消资产选择：不建卡、不建线、不发起上传', async () => {
    await renderPage(); await clickNode('da1');
    const before = mediaNodeCount();
    await pickAudioPanelAssets([]);
    expect(mediaNodeCount()).toBe(before);
    expect(edgePairs()).toEqual([]);
    expect(uploadMocks.uploadAssetFile).not.toHaveBeenCalled();
  });

  it('IKGB82：音频面板点「资产库」直接打开同一资产库弹窗，按面板过滤图片和音频', async () => {
    await renderPage();
    await clickNode('da1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'));

    const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
    )!;
    await act(async () => {
      entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(pickerProps.current.mediaTypes).toEqual(['image', 'audio']);
  });

  it('音频资产选择成功后关闭重开原目标：参考经连线完整恢复，不恢复选取模式', async () => {
    await renderPage();
    await clickNode('da1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'));

    await pickAudioAsset();
    await vi.waitFor(() => expect(refNames('audio-ref-thumb').length).toBe(1), { timeout: 3000 });

    await closePanel();
    expect(refNames('audio-ref-thumb')).toEqual([]);
    expect(edgePairs().length).toBe(1);

    await clickNode('da1');
    await vi.waitFor(() => expect(refNames('audio-ref-thumb').length).toBe(1));
  });

  it('音频重复内容（同 assetId 已连线）：查重提示且不建第二条线，不重复创建来源卡', async () => {
    await renderPage();
    await clickNode('da1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'));

    await pickAudioAsset();
    await vi.waitFor(() => expect(edgePairs().length).toBe(1), { timeout: 3000 });
    const firstNode = flowProps.current.mediaNodes.find(
      (n: Node) => (n.data as Record<string, unknown>)?.assetId === 'au9',
    );

    // 第二次选择同一持久资产：不重复建卡，查重提示不建线
    await pickAudioAsset();
    await vi.waitFor(() => expect(container.textContent).toContain('重复的素材已跳过'), { timeout: 3000 });
    expect(edgePairs().length).toBe(1);
    const sameAssetNodes = flowProps.current.mediaNodes.filter(
      (n: Node) => (n.data as Record<string, unknown>)?.assetId === 'au9',
    );
    expect(sameAssetNodes.length).toBe(1);
    expect(sameAssetNodes[0].id).toBe(firstNode.id);
  });

  it('音频参考已满 3 段：添加入口常显置灰并悬停说明已达上限，点击无接纳发起（IKGB82 替代旧「入口消失」）', async () => {
    // 画布补齐 3 个音频成品并全部连到 da1
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
    for (const id of ['au2', 'au3']) {
      doc.nodes.push({
        id, type: 'mediaNode', position: { x: 700, y: 100 },
        data: { src: `http://audio/${id}.mp3`, mediaType: 'audio', fileName: `参考${id}`, assetId: `aud-${id}`, duration: 20 },
      });
      (canvasDocMock.current.assets as Record<string, unknown>)[`aud-${id}`] = {
        asset_id: `aud-${id}`, type: 'audio', access_url: `http://audio/${id}.mp3`, duration: 20,
      };
    }
    doc.edges.push(
      { id: 'e-au1-da1', source: 'au1', target: 'da1' },
      { id: 'e-au2-da1', source: 'au2', target: 'da1' },
      { id: 'e-au3-da1', source: 'au3', target: 'da1' },
    );

    await renderPage();
    await clickNode('da1');
    await vi.waitFor(() => expect(refNames('audio-ref-thumb').length).toBe(3));

    // 满 3 段：「已达上限」文案保留在附件栏原位；操作条两按钮常显但 aria-disabled 置灰，
    // 悬停说明已达上限，点击不发起资产/节点选择（无上传无新线）
    await vi.waitFor(() => expect(container.textContent).toContain('已达上限'));
    const fullPills = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent === '参考' || b.textContent === '资产库',
    );
    expect(fullPills).toHaveLength(2);
    for (const btn of fullPills) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('参考音频最多 3 段，已达上限');
    }
    await act(async () => {
      fullPills[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(edgePairs().length).toBe(3);
    expect(uploadMocks.uploadAssetFile).not.toHaveBeenCalled();
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('接纳复用已有来源后画布保存失败：连线保留并显示未保存，阻止发送；重试成功后落盘且不重复创建来源', async () => {
    // 画布预置与上传产物同身份（au9）的音频成品：资产选择后复用该节点建线
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> };
    doc.nodes.push({
      id: 'au9', type: 'mediaNode', position: { x: 650, y: 100 },
      data: { src: 'http://audio/au9.mp3', mediaType: 'audio', fileName: '既有音频', assetId: 'au9', duration: 25 },
    });
    (canvasDocMock.current.assets as Record<string, unknown>).au9 = {
      asset_id: 'au9', type: 'audio', access_url: 'http://audio/au9.mp3', duration: 25,
    };
    // 仅对「含接纳连线」的保存失败一次（模型默认值写回等早于接纳的保存不受影响；重试成功），用例内恢复实现
    let failAdoptSave = true;
    apiMocks.saveCanvasDoc.mockImplementation(async (
      _projectId: string,
      payload: { edges: Array<{ source: string; target: string }> },
    ) => {
      if (failAdoptSave && payload.edges.some((e) => e.source === 'au9' && e.target === 'da1')) {
        failAdoptSave = false;
        throw new Error('保存失败');
      }
      return { id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' };
    });
    try {
      await renderPage();
      await clickNode('da1');
      await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'));

      const before = mediaNodeCount();
      await pickAudioAsset();
      await vi.waitFor(() => expect(edgePairs()).toEqual(['au9->da1']), { timeout: 3000 });
      expect(mediaNodeCount()).toBe(before);

      // 保存失败：未保存提示出现，复用建线的连线保留（无新增节点，不触发回滚）
      await vi.waitFor(() => expect(container.textContent).toContain('保存失败'), { timeout: 3000 });
      expect(edgePairs()).toEqual(['au9->da1']);

      // 重试保存成功：连线落盘，来源不重复创建
      await act(async () => {
        const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent === '重试保存',
        )!;
        retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await vi.waitFor(() => {
        expect(lastSaved().edges.map((e) => `${e.source}->${e.target}`)).toEqual(['au9->da1']);
      }, { timeout: 3000 });
      expect(mediaNodeCount()).toBe(before);
    } finally {
      apiMocks.saveCanvasDoc.mockImplementation(async () => (
        { id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }
      ));
    }
  });
});

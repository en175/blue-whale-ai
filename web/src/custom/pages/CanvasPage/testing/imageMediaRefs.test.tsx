// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { ATTACHMENT_ACTION_PICK_CANVAS_TITLE } from '../components/AttachmentActionBar';
import { readPromptRefText, typePromptRefRaw, typePromptRefText } from './promptRefEditor';
import { Toaster, toast } from 'sonner';


vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/canvasRecovery')>()),
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

const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

vi.mock('../components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

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
      supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
      supported_formats: [],
      supported_durations: null,
      default_size: '2k',
      default_format: null,
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: { reference_image: true, image_reference_max: 10 },
      version: 1,
      digest: '',
    },
  ]),
}));

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
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
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
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

vi.mock('@/custom/api/generation', () => ({
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

vi.mock('../hooks/document/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
        { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: 'a9' } },
        { id: 'd1', type: 'mediaNode', position: { x: 420, y: 160 }, data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' } },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 100, height: 100 },
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
  toast.dismiss();

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage), createElement(Toaster, { duration: Infinity })),
      ),
    );
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

async function createDraft(): Promise<string> {
  const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
  await act(async () => {
    flowProps.current.onNodeClick(draft);
  });
  return 'd1';
}

function connect(source: string, target: string) {
  return act(async () => {
    flowProps.current.onConnect({ source, target, sourceHandle: null, targetHandle: null });
  });
}

const enterPickMode = async () => {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const edgePairs = () =>
  flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`);

async function finishPick() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === '完成选取',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function dockRefImages(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>('[data-testid="dock-media-ref"] img')].map(
    (img) => img.alt,
  );
}

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

describe('IKDMQR 连线 → Dock 同步与提交消费', () => {
  it('画布连入有效图片后 Dock 立即显示同一输入；提交携带连线推导的 references', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    expect(dockRefImages()).toEqual([]);

    await connect('m1', draftId);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);

    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled(), { timeout: 3000 });
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual([`m1->${draftId}`]);

    await typePrompt('参考这张图重新绘制');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.type).toBe('image');
    expect(payload.target_node_id).toBe(draftId);
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );
  });

  it('文本附件与图片参考并存：文本连线继续作为附件展示与消费', async () => {
    await renderPage();
    const draftId = await createDraft();

    await connect('t1', draftId);
    await connect('m1', draftId);

    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(sendButton().disabled).toBe(false);
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.target_node_id).toBe(draftId);
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
  });

  it('点击文本缩略图 ×：仅断开当前连线（画布原文本卡保留），正文提及随之失效（IKFCKN）', async () => {
    await renderPage();
    const draftId = await createDraft();

    await connect('t1', draftId);
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));

    await typePrompt('按');
    await typePromptRefRaw(container, '@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-ref-item"]')).toBeTruthy());
    await act(async () => {
      (container.querySelector('[data-testid="mention-ref-item"]') as HTMLButtonElement).click();
    });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('按文本1'));

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="dock-text-ref"] button[title="移除"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(edgePairs()).not.toContain(`t1->${draftId}`));
    expect(flowProps.current.textNodes.some((n: Node) => n.id === 't1')).toBe(true);
    await vi.waitFor(() => expect(container.querySelector('[data-testid="dock-text-ref"]')).toBeNull());
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('按已失效：原文本1'));
    expect(sendButton().disabled).toBe(true);
  });
});

describe('IKDMQR Dock 选择 → 连线', () => {
  it('Dock 选取立即建立连线并随自动保存上送，发送消费同一资产（IKFDFT）', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await vi.waitFor(() => expect(container.textContent).toContain('点击画布中的图片节点'), { timeout: 3000 });

    const m1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1')!;
    await act(async () => {
      flowProps.current.onNodeClick(m1);
    });
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled(), { timeout: 3000 });
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual([`m1->${draftId}`]);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(container.textContent).toContain('完成选取'), { timeout: 3000 });
    await finishPick();
    expect(container.textContent).not.toContain('点击画布中的图片节点');

    await typePrompt('采用所选参考');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].input_asset_ids).toBeUndefined();
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
  });

  it('Dock 选取非法来源（待生成草稿/视频）明确提示且不建立连线', async () => {
    ((canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes).push({
      id: 'd2',
      type: 'mediaNode',
      position: { x: 440, y: 160 },
      data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
    });
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    const otherDraft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd2')!;

    await enterPickMode();

    await act(async () => {
      flowProps.current.onNodeClick(otherDraft);
    });
    expect(edgePairs()).toEqual([]);
    await vi.waitFor(() => expect(container.textContent).toContain('待生成的草稿不能作为参考'), { timeout: 3000 });

    await enterPickMode();
    const v1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      flowProps.current.onNodeClick(v1);
    });
    expect(edgePairs()).toEqual([]);
    await vi.waitFor(() => expect(container.textContent).toContain('图片参考仅支持图片素材'), { timeout: 3000 });
  });
});

describe('IKDMQR 移除双向同步', () => {
  it('Dock 移除引用断开对应连线；画布断线同步移除 Dock 引用；来源与其他目标引用保留', async () => {
    ((canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes).push({
      id: 'd2',
      type: 'mediaNode',
      position: { x: 440, y: 200 },
      data: { src: '', mediaType: 'image', fileName: '图片草稿二', genStatus: 'draft', draft: true, prompt: '' },
    });
    await renderPage();
    const draftId = await createDraft();

    await act(async () => {
      flowProps.current.onConnect({ source: 'm1', target: draftId, sourceHandle: null, targetHandle: null });
      flowProps.current.onConnect({ source: 'm1', target: 'd2', sourceHandle: null, targetHandle: null });
    });
    expect(edgePairs()).toEqual([`m1->${draftId}`, 'm1->d2']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(edgePairs()).toEqual(['m1->d2']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'm1')).toBe(true);

    await connect('m1', draftId);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    const edgeId = flowProps.current.edges.find(
      (e: { source: string; target: string }) => e.source === 'm1' && e.target === draftId,
    )!.id;
    await act(async () => {
      flowProps.current.onEdgesChange([{ type: 'remove', id: edgeId }]);
    });
    expect(edgePairs()).toEqual(['m1->d2']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
  });
});

describe('IKDMQR Dock 素材入口', () => {
  it('图片 Dock 不提供本地上传入口：无文件选择器与上传按钮（草稿绑定与资产卡入口一致）', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    const visibleFileInputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]:not([hidden])');
    expect(visibleFileInputs).toHaveLength(0);
    expect(container.textContent).not.toContain('图片上传');
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].some((b) => b.title.startsWith('上传图片'))).toBe(false);
  });
});

describe('IKDMQR 画布连线来源校验', () => {
  it('视频来源连线被拒绝（ABILITY 层静默拦截）；文本节点连线不受影响', async () => {
    await renderPage();
    const draftId = await createDraft();

    await connect('v1', draftId);
    expect(edgePairs()).toEqual([]);

    await connect('t1', draftId);
    expect(edgePairs()).toEqual([`t1->${draftId}`]);
  });

  it('同一素材（相同 assetId）重复连入被拒绝；参考图超过上限被拒绝（缺省能力行 10）', async () => {
    canvasDocMock.current = {
      doc: {
        id: 11,
        version: 3,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
          { id: 'm1-copy', type: 'mediaNode', position: { x: 220, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一 副本', assetId: 'a1' } },
          { id: 'd1', type: 'mediaNode', position: { x: 420, y: 160 }, data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' } },
          ...Array.from({ length: 10 }, (_, i) => ({
            id: `mx${i}`, type: 'mediaNode', position: { x: 300 + i * 10, y: 0 },
            data: { src: `http://img/mx${i}.png`, mediaType: 'image', fileName: `素材${i}`, assetId: `ax${i}` },
          })),
        ],
        edges: [],
      },
      assets: Object.fromEntries([
        ['a1', { asset_id: 1, type: 'image', access_url: 'http://img/m1.png' }],
        ...Array.from({ length: 10 }, (_, i) => [`ax${i}`, { asset_id: 100 + i, type: 'image', access_url: `http://img/mx${i}.png` }]),
      ]),
      refetch: () => Promise.resolve([]),
      acceptDoc: vi.fn(),
    };
    await renderPage();
    const draftId = await createDraft();

    await connect('m1', draftId);
    await connect('m1-copy', draftId);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    await vi.waitFor(() => expect(container.textContent).toContain('该素材已连入当前草稿'), { timeout: 3000 });

    for (let i = 0; i < 9; i += 1) {
      await connect(`mx${i}`, draftId);
    }
    expect(edgePairs()).toHaveLength(10);
    await connect('mx9', draftId);
    expect(edgePairs()).toHaveLength(10);
    await vi.waitFor(() => expect(container.textContent).toContain('图片最多 10 张'), { timeout: 3000 });
  });

  it('重复校验兼容 assetId/asset_id/assetID 三形态（asset_id 形态来源去重不误判）', async () => {
    canvasDocMock.current = {
      doc: {
        id: 11,
        version: 3,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: 'm-u', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/u.png', mediaType: 'image', fileName: '下划线形态', asset_id: 'a7' } },
          { id: 'm-c', type: 'mediaNode', position: { x: 220, y: 0 }, data: { src: 'http://img/u.png', mediaType: 'image', fileName: '驼峰形态', assetId: 'a7' } },
          { id: 'm-x', type: 'mediaNode', position: { x: 240, y: 0 }, data: { src: 'http://img/x.png', mediaType: 'image', fileName: '其他素材', assetID: 'a8' } },
          { id: 'd1', type: 'mediaNode', position: { x: 420, y: 160 }, data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' } },
        ],
        edges: [],
      },
      assets: {
        a7: { asset_id: 7, type: 'image', access_url: 'http://img/u.png' },
        a8: { asset_id: 8, type: 'image', access_url: 'http://img/x.png' },
      },
      refetch: () => Promise.resolve([]),
      acceptDoc: vi.fn(),
    };
    await renderPage();
    const draftId = await createDraft();

    await connect('m-u', draftId);
    expect(edgePairs()).toEqual([`m-u->${draftId}`]);
    await connect('m-c', draftId);
    expect(edgePairs()).toEqual([`m-u->${draftId}`]);
    await vi.waitFor(() => expect(container.textContent).toContain('该素材已连入当前草稿'), { timeout: 3000 });
    await connect('m-x', draftId);
    expect(edgePairs()).toEqual([`m-u->${draftId}`, `m-x->${draftId}`]);
  });
});

describe('IKDMQR 生成中输入只读', () => {
  it('生成中 Dock 参考可见但移除入口隐藏；连线建立与断开被拦截', async () => {
    apiMocks.fetchJobStatus.mockImplementation(async (): Promise<any> => ({
      job_id: 'j1',
      status: 'processing',
      progress: 10,
      asset: null,
    }));
    await renderPage();
    const draftId = await createDraft();
    await connect('m1', draftId);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('画一只蓝鲸');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBe('generating');
    });

    expect(dockRefImages()).toEqual([]);

    await createDraft();
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(container.querySelector('[data-testid="dock-media-ref"] button[title="移除"]')).toBeNull();
    await vi.waitFor(() => expect(container.textContent).toContain('生成中，参数与连线只读'), { timeout: 3000 });

    const edgeId = flowProps.current.edges.find(
      (e: { source: string; target: string }) => e.source === 'm1' && e.target === draftId,
    )!.id;
    await act(async () => {
      flowProps.current.onEdgesChange([{ type: 'remove', id: edgeId }]);
    });
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    await connect('v1', draftId);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
  });
});

describe('IKDMQR 参考关系持久化恢复', () => {
  it('参考连线随草稿保存；刷新恢复后 Dock 显示一致，提交输入与显示一致', async () => {
    canvasDocMock.current = {
      doc: {
        id: 11,
        version: 3,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
          { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
          {
            id: 'd1',
            type: 'mediaNode',
            position: { x: 420, y: 160 },
            data: {
              src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true,
              prompt: '恢复的提示词', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1', targetRatio: '1:1',
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'm1', target: 'd1' },
          { id: 'e2', source: 't1', target: 'd1' },
        ],
      },
      assets: {
        a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      },
      refetch: () => Promise.resolve([]),
      acceptDoc: vi.fn(),
    };
    await renderPage();

    const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
    await act(async () => {
      flowProps.current.onNodeClick(draft);
    });
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1);

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.target_node_id).toBe('d1');
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
  });
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { ATTACHMENT_ACTION_PICK_CANVAS_TITLE } from './components/AttachmentActionBar';
import { readPromptRefText, typePromptRefRaw, typePromptRefText } from './testing/promptRefEditor';

/* IKDMQR 图片参考连线与 Dock 双向同步：
   连线 → Dock 显示同一输入并随提交消费；Dock 选择/移除 ↔ 画布连线双向同步；
   非法来源拒绝；文本附件回归；生成中输入只读；Dock 无本地上传入口。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；ImageDialog 用真实实现。 */

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

/** CanvasToolbar 打桩：透出侧栏图片入口 */
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
      // max_reference_images 是参考图上限的唯一口径（ADR-0086）：9 会让下方「连满 10 张」用例
      // 变成连满 9 张，与用例名/断言的缺省能力行 10 自相矛盾
      features: { reference_image: true, max_reference_images: 10 },
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
  linkAssetToProject: vi.fn(),
}));

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真 */
vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  // IKDLQK 起 CanvasPage 还引入这两个调用：mock 补齐，否则组件挂载即抛错（IKDLQK 合入时的既有欠账）
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

/** 默认画布：文本节点 t1 + 就绪图片 m1（assetId a1）+ 视频节点 v1 + 图片草稿 d1 */
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
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

/** PromptRefEditor（IKFA1M）整体替换文本 */
async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

/** 点击画布草稿卡 d1 打开绑定面板（草稿绑定路径），返回草稿节点 id */
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

/** IKGB7U 附件操作条：点「+ 参考」直达旧「从节点添加素材」链路——进入画布选取模式（旧「+」菜单已退役） */
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

/** IKFR4X 结束持续选取会话：点击提示条「完成选取」按钮（编辑/发送须先结束会话） */
async function finishPick() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === '完成选取',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Dock 参考图预览项的图片 alt 列表（草稿绑定面板按连线推导渲染） */
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

    // 连线前 Dock 无参考图
    expect(dockRefImages()).toEqual([]);

    // 画布建立图片参考连线：m1 → 草稿
    await connect('m1', draftId);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);

    // Dock 立即显示同一输入
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    // 连线随自动保存上送
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled(), { timeout: 3000 });
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual([`m1->${draftId}`]);

    // 提交：先落盘再建任务，references 与 Dock 显示一致
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

    // 参考栏文本缩略图照常展示（IKFCKN 进栏，旧「文本附件（N）」区块下线）；图片参考区显示连线素材
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    // 空提示词 + 非空附件正文即可发送；提交同时携带文本目标与图片参考
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

    // 正文经 @ 菜单插入文本标签（建立对 t1 的提及）
    await typePrompt('按');
    await typePromptRefRaw(container, '@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-ref-item"]')).toBeTruthy());
    await act(async () => {
      (container.querySelector('[data-testid="mention-ref-item"]') as HTMLButtonElement).click();
    });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('按文本1'));

    // 点击 ×：仅断开当前连线，不删画布文本卡
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="dock-text-ref"] button[title="移除"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(edgePairs()).not.toContain(`t1->${draftId}`));
    expect(flowProps.current.textNodes.some((n: Node) => n.id === 't1')).toBe(true);
    // 面板实时跟随：缩略图消失；正文提及沿用既有失效生命周期（灰显原编号、阻止发送）
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

    // Dock 进入选取模式
    await enterPickMode();
    expect(container.textContent).toContain('点击画布中的图片节点');

    // 点击后立即建立来源→目标连线，不再等待发送
    const m1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1')!;
    await act(async () => {
      flowProps.current.onNodeClick(m1);
    });
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    // 连线随自动保存上送（未发送生成）
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled(), { timeout: 3000 });
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual([`m1->${draftId}`]);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();

    // IKFR4X：持续会话仍进行（完成入口可见），发送前先完成选取
    expect(container.textContent).toContain('完成选取');
    await finishPick();
    // 选取模式已退出（提示条文案消失）
    expect(container.textContent).not.toContain('点击画布中的图片节点');

    // 发送仍消费同一资产（先落盘后建任务）
    await typePrompt('采用所选参考');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].input_asset_ids).toBeUndefined();
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
  });

  it('Dock 选取非法来源（待生成草稿/视频）明确提示且不建立连线', async () => {
    // 追加第二张待生成草稿 d2 作为非法来源（draft 状态不可作参考）
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

    // 待生成草稿作为来源：拒绝
    await act(async () => {
      flowProps.current.onNodeClick(otherDraft);
    });
    expect(edgePairs()).toEqual([]);
    expect(container.textContent).toContain('待生成的草稿不能作为参考');

    // 视频节点作为来源：拒绝
    await enterPickMode();
    const v1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      flowProps.current.onNodeClick(v1);
    });
    expect(edgePairs()).toEqual([]);
    expect(container.textContent).toContain('图片参考仅支持图片素材');
  });
});

describe('IKDMQR 移除双向同步', () => {
  it('Dock 移除引用断开对应连线；画布断线同步移除 Dock 引用；来源与其他目标引用保留', async () => {
    // 追加第二张图片草稿 d2 作为"其他目标"（connectPair 要求目标为草稿/生成中节点，
    // v1 为成品视频卡不再接受新连线；改用 d2 保持测试意图：同一来源连入多目标时移除仅影响当前草稿）
    ((canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes).push({
      id: 'd2',
      type: 'mediaNode',
      position: { x: 440, y: 200 },
      data: { src: '', mediaType: 'image', fileName: '图片草稿二', genStatus: 'draft', draft: true, prompt: '' },
    });
    await renderPage();
    const draftId = await createDraft();

    // 同一来源 m1 同时连入草稿 d1 与 d2
    await act(async () => {
      flowProps.current.onConnect({ source: 'm1', target: draftId, sourceHandle: null, targetHandle: null });
      flowProps.current.onConnect({ source: 'm1', target: 'd2', sourceHandle: null, targetHandle: null });
    });
    expect(edgePairs()).toEqual([`m1->${draftId}`, 'm1->d2']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    // Dock 移除引用 → 仅断开草稿的连线；来源卡与 m1->d2 保留
    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(edgePairs()).toEqual(['m1->d2']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'm1')).toBe(true);

    // 重新连入后从画布断线 → Dock 同步移除
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

    // 画布级隐藏上传 input（paneUploadRef）始终存在但不属于 Dock；
    // Dock 区域不提供可见的文件选择器与上传按钮。
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

    // 视频来源：connectPair 在 ABILITY 层拦截（video 能力集不含 image），不进入图片校验，无 toast
    await connect('v1', draftId);
    expect(edgePairs()).toEqual([]);

    // 能力不匹配在拖线阶段静默拒绝；Dock 选择的非法来源提示由上方用例覆盖。
    // 文本节点来源（文本附件语义）不受媒体校验影响
    await connect('t1', draftId);
    expect(edgePairs()).toEqual([`t1->${draftId}`]);
  });

  it('同一素材（相同 assetId）重复连入被拒绝；参考图超过上限被拒绝（缺省能力行 10）', async () => {
    // 画布上另一张同 assetId 的复制卡 + 10 张独立素材（缺省上限 DEFAULT_MAX_REFERENCE_IMAGES=10，ADR-0086）
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

    // 同一 assetId 的两张卡：第二张拒绝
    await connect('m1', draftId);
    await connect('m1-copy', draftId);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    expect(container.textContent).toContain('该素材已连入当前草稿');

    // 连满 10 张后第 11 张（新素材）按上限拒绝
    for (let i = 0; i < 9; i += 1) {
      await connect(`mx${i}`, draftId);
    }
    expect(edgePairs()).toHaveLength(10);
    await connect('mx9', draftId);
    expect(edgePairs()).toHaveLength(10);
    expect(container.textContent).toContain('图片最多 10 张');
  });

  it('重复校验兼容 assetId/asset_id/assetID 三形态（asset_id 形态来源去重不误判）', async () => {
    canvasDocMock.current = {
      doc: {
        id: 11,
        version: 3,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          // 下划线/大写历史形态与 camelCase 各一张，同一素材 a7
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

    // asset_id 形态可正常连入（校验通过）
    await connect('m-u', draftId);
    expect(edgePairs()).toEqual([`m-u->${draftId}`]);
    // 同素材 camelCase 形态的复制卡：跨形态识别为重复，拒绝
    await connect('m-c', draftId);
    expect(edgePairs()).toEqual([`m-u->${draftId}`]);
    expect(container.textContent).toContain('该素材已连入当前草稿');
    // 其他素材不受影响
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

    // IKFXZD：发送成功即隐藏面板
    expect(dockRefImages()).toEqual([]);

    // 生成中点卡片重开只读面板（IKFXZD 口径：自动关闭不动只读入口）：Dock 参考仍可见，移除入口隐藏
    await createDraft();
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(container.querySelector('[data-testid="dock-media-ref"] button[title="移除"]')).toBeNull();
    expect(container.textContent).toContain('生成中，参数与连线只读');

    // 画布断线被拦截
    const edgeId = flowProps.current.edges.find(
      (e: { source: string; target: string }) => e.source === 'm1' && e.target === draftId,
    )!.id;
    await act(async () => {
      flowProps.current.onEdgesChange([{ type: 'remove', id: edgeId }]);
    });
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    // 新连线被拦截
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

    // 点击草稿卡重开面板：图片参考与文本附件随连线恢复
    const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
    await act(async () => {
      flowProps.current.onNodeClick(draft);
    });
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1);

    // 提交输入与 Dock 显示一致（先落盘后建任务）
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

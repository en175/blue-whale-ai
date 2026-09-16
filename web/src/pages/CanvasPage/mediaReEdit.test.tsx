// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { promptRefReadOnly, readPromptRefText, typePromptRefText } from './testing/promptRefEditor';
import { setGenHandoff, type GenHandoff } from '@/utils/gen-handoff';

/* IKDMQU 成功卡原卡编辑与重新生成：P1 单选成品卡自动开面板 / Q4 上传素材不自动开 /
   P2 编辑实时写回原卡 / Q1+Q6 发送后原卡重新生成不新建卡（旧素材保留）/
   Q5 成功替换与取消恢复 / Q9 空白与多选隐藏面板 / Q8 Enter 仅换行 /
   音频成品卡绑定音频面板（原落入图片分支的缺陷修复）。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；ImageDialog/AudioDialog 用真实实现。 */

// IKFJJT 合并 0915 适配：视频提交前会对参考图做合规入库（ensureVideoImageRefsCompliance →
// depositCanvasAssetToCharacterLibrary）。测试环境固定返回 materialId，避免真实调素材入库 API。
vi.mock('./characterLibraryDeposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./characterLibraryDeposit')>()),
  depositCanvasAssetToCharacterLibrary: vi.fn(async () => ({ materialId: 'asset-compliance-test' })),
  // IKFVMQ 合规改轮询 GetAsset：恢复后的节点带 materialId 会走真实 waitAssetReady
  // （getAsset 未 mock 致视频重编辑发送中止），测试环境跳过轮询等待
  waitComplianceAssetReady: vi.fn(async () => ({})),
}));

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
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async () => ({ generation_job_id: 'j2', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j2',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a9', url: 'http://img/out.png', type: 'image' },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
  linkAssetToProject: vi.fn(async () => {}),
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
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
  fetchUploadPresign: apiMocks.fetchUploadPresign,
  putToPresignedUrl: apiMocks.putToPresignedUrl,
  completeUpload: apiMocks.completeUpload,
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: apiMocks.linkAssetToProject,
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

/** 默认画布：文本 t1 → 成品图片卡 g1（有生成记录）+ 上传素材卡 u1（无生成记录） */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        {
          id: 'g1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: {
            src: 'http://img/g1.png',
            mediaType: 'image',
            fileName: '生成-j1',
            assetId: 'a1',
            jobId: 'j1',
            prompt: '原提示词',
            draftModelId: 'm-test',
            draftSize: '2k',
            draftRatio: '1:1',
          },
        },
        {
          id: 'u1',
          type: 'mediaNode',
          position: { x: 500, y: 0 },
          data: { src: 'http://img/u1.png', mediaType: 'image', fileName: '上传图.png', assetId: 'a2' },
        },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'g1' }],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/g1.png', width: 100, height: 100 },
      a2: { asset_id: 2, type: 'image', access_url: 'http://img/u1.png', width: 100, height: 100 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

/** 含成品音频卡 au1 的画布 */
function seedAudioDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'au1',
          type: 'mediaNode',
          position: { x: 0, y: 0 },
          data: {
            src: 'http://img/au1.mp3',
            mediaType: 'audio',
            fileName: '生成-j1',
            assetId: 'a1',
            jobId: 'j1',
            prompt: '原音频描述',
            draftModelId: 'm-test',
          },
        },
      ],
      edges: [],
    },
    assets: { a1: { asset_id: 1, type: 'audio', access_url: 'http://img/au1.mp3' } },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

const defaultJobStatus = apiMocks.fetchJobStatus.getMockImplementation()!;
const defaultSaveDoc = apiMocks.saveCanvasDoc.getMockImplementation()!;

let root: Root;
let container: HTMLDivElement;

async function renderPage(handoff?: GenHandoff) {
  if (handoff) setGenHandoff(handoff);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, { initialEntries: [{ pathname: '/canvas', state: handoff ? { genKind: handoff.kind } : null }] }, createElement(CanvasPage)),
      ),
    );
  });
}

function sendButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

function promptTextarea(): HTMLElement | null {
  return container.querySelector('[contenteditable]');
}

/** PromptRefEditor（IKFA1M）整体替换文本 */
async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

function nodeOf(id: string): Node {
  return flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
}

async function clickNode(id: string) {
  await act(async () => {
    flowProps.current.onNodeClick(nodeOf(id));
  });
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
  apiMocks.fetchJobStatus.mockReset().mockImplementation(defaultJobStatus);
  // clearAllMocks 不清除实现：持续失败的保存替身会污染后续用例，统一恢复默认
  apiMocks.saveCanvasDoc.mockReset().mockImplementation(defaultSaveDoc);
});

/** 一份带真 PNG 文件头的最小文件：上传前会读开头认容器（IKE53Z），'png' 这三个字母过不去。 */
const pngFile = (name: string) => {
  const head = new Uint8Array(32);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([head.slice().buffer as ArrayBuffer], name, { type: 'image/png' });
};

describe('IKDMQU P1/P2/Q4：成品卡面板绑定与编辑', () => {
  it('单选有生成记录的成品卡自动打开图片面板并恢复参数与文本附件', async () => {
    await renderPage();
    await clickNode('g1');

    // 面板打开且绑定原卡：恢复原提示词
    expect(promptTextarea()).toBeTruthy();
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('原提示词'));
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    // 连线文本附件实时展示（IKFCKN：FileText 缩略图进参考栏）
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));
  });

  it('上传素材卡（无生成记录）点击不自动打开面板（Q4）', async () => {
    await renderPage();
    await clickNode('u1');
    expect(container.querySelector('[contenteditable]')).toBeNull();
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('面板编辑实时写回原卡节点（P2）：不新增卡片、不改素材', async () => {
    await renderPage();
    await clickNode('g1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await typePrompt('改成 B 版本');

    const node = nodeOf('g1');
    await vi.waitFor(() => expect(nodeOf('g1').data.prompt).toBe('改成 B 版本'));
    expect(node.data.src).toBe('http://img/g1.png');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('选中集合变化隐藏面板：空白与多选关闭、内容已写回不丢（Q9/P1）', async () => {
    await renderPage();
    await clickNode('g1');
    await vi.waitFor(() => expect(promptTextarea()).toBeTruthy());
    await typePrompt('编辑中内容');

    // 点空白（IKDMQV：空白点击收敛为 PaneClick，空选中是过渡态不再关面板）
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(container.querySelector('[contenteditable]')).toBeNull();
    // 编辑已实时写回节点，隐藏不丢弃
    expect(nodeOf('g1').data.prompt).toBe('编辑中内容');

    // 重新选中恢复编辑
    await clickNode('g1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('编辑中内容'));

    // 多选隐藏
    await act(async () => {
      flowProps.current.onSelectionChange({
        nodes: [nodeOf('g1'), nodeOf('u1')],
        edges: [],
      });
    });
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('空选中过渡事件不隐藏面板（IKDMQV：取消旧选中→选中新卡的过渡不再误关）', async () => {
    await renderPage();
    await clickNode('g1');
    await vi.waitFor(() => expect(promptTextarea()).toBeTruthy());

    // 模拟 React Flow 的过渡空选中事件：面板保持可见
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [], edges: [] });
    });
    expect(promptTextarea()).toBeTruthy();

    // 空白明确隐藏后，迟到选中事件不得重开；用户重新点击才恢复。
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(container.querySelector('[contenteditable]')).toBeNull();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [nodeOf('g1')], edges: [] });
    });
    expect(promptTextarea()).toBeNull();
    await clickNode('g1');
    await vi.waitFor(() => expect(promptTextarea()).toBeTruthy());
  });

  it('音频成品卡点击打开音频面板（修复此前落入图片分支的缺陷）', async () => {
    seedAudioDoc();
    await renderPage();
    await clickNode('au1');

    const audioInput = container.querySelector<HTMLElement>('[data-testid="audio-input"]');
    expect(audioInput).toBeTruthy();
    expect(container.querySelector('[data-testid="audio-send"]')).toBeTruthy();
    // 唯一正文编辑器位于音频面板，不能再用 contenteditable 判断是图片面板。
    const audioEditor = audioInput!.querySelector('[contenteditable="true"]');
    expect(audioEditor).toBeTruthy();
    expect([...container.querySelectorAll('[contenteditable="true"]')]).toEqual([audioEditor]);
    await vi.waitFor(() => expect(readPromptRefText(audioInput!)).toBe('原音频描述'));
  });
});

describe('IKDMQU Q1/Q5/Q6/Q8：原卡重新生成', () => {
  it('图片发送等待保存期间隐藏重开仍只读，并阻止切目标与重复发送（IKDXHS）', async () => {
    await renderPage();
    await clickNode('g1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('本次提交 A');

    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    apiMocks.saveCanvasDoc.mockImplementationOnce(async () => {
      await barrier;
      return { id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' };
    });
    try {
      await act(async () => sendButton().click());
      await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled());
      await act(async () => flowProps.current.onPaneClick());
      await clickNode('g1');
      await vi.waitFor(() => expect(promptTextarea()).toBeTruthy());
      expect(promptRefReadOnly(container)).toBe(true);
      expect(sendButton().disabled).toBe(true);
      await act(async () => toolbarProps.current.onToggleImageDialog());
      expect(flowProps.current.mediaNodes).toHaveLength(2);
      await act(async () => {
        flowProps.current.onConnect({ source: 'u1', target: 'g1' });
        sendButton().click();
      });
      expect(flowProps.current.edges).toHaveLength(1);
      expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    } finally {
      await act(async () => release());
    }
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].parameters.prompt).toBe('一只蓝鲸在海里\n\n本次提交 A');
    expect(nodeOf('g1').data.prompt).toBe('本次提交 A');
  });

  it('发送后原卡原地转生成中：不新建卡片、保留旧素材、任务带目标节点', async () => {
    // 任务停留在执行中，捕获「生成中保留旧素材」的中间态
    apiMocks.fetchJobStatus.mockImplementationOnce(
      async () => ({ job_id: 'j2', status: 'running', progress: 30 }),
    );
    await renderPage();
    await clickNode('g1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('重画一版');

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.target_node_id).toBe('g1');
    expect(payload.parameters.prompt).toBe('一只蓝鲸在海里\n\n重画一版');

    // 原卡承接：卡片数不变（g1/u1，t1 为文本节点）、生成中、旧素材保留
    expect(flowProps.current.mediaNodes).toHaveLength(2);
    const node = nodeOf('g1');
    expect(node.data.genStatus).toBe('generating');
    expect(node.data.src).toBe('http://img/g1.png');
    expect(node.data.fileName).toBe('生成-j1');
  });

  it('生成成功替换原卡素材：同一张卡、身份与连线保持（Q5/Q7）', async () => {
    await renderPage();
    await clickNode('g1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      expect(nodeOf('g1').data.src).toBe('http://img/out.png');
    });
    const node = nodeOf('g1');
    expect(node.data.genStatus).toBeUndefined();
    expect(node.data.assetId).toBe('a9');
    expect(node.data.jobId).toBe('j2');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
    expect(flowProps.current.edges.some((e: { source: string; target: string }) => e.source === 't1' && e.target === 'g1')).toBe(true);
  });

  it('取消恢复成品态：保留旧素材与最新编辑、不删卡（Q5）', async () => {
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'j2', status: 'cancelled', progress: 30 });
    await renderPage();
    await clickNode('g1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('取消前的编辑');

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    // 取消链路一次性收敛：生成中中间态转瞬即逝，直接断言终态
    await vi.waitFor(() => {
      expect(nodeOf('g1').data.genStatus).toBeUndefined();
    });
    const node = nodeOf('g1');
    expect(node.data.src).toBe('http://img/g1.png');
    expect(node.data.prompt).toBe('取消前的编辑');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });

  it('面板 Enter 仅换行不触发生成（Q8）', async () => {
    await renderPage();
    await clickNode('g1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('一段描述');

    const textarea = promptTextarea();
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });

    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
});

describe('IKDMQU Q10：保存失败暂停切换编辑目标', () => {
  it('保存失败后点击成品卡不自动开面板并提示重试', async () => {
    // 追加第二张成品卡 g2 作为切换目标（有生成记录才会触发切换拦截）
    ((canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes).push({
      id: 'g2',
      type: 'mediaNode',
      position: { x: 800, y: 0 },
      data: { src: 'http://img/g2.png', mediaType: 'image', fileName: '生成-j2', assetId: 'a3', jobId: 'j2', prompt: '原提示词二', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1' },
    });
    (canvasDocMock.current.assets as Record<string, unknown>).a3 = { asset_id: 3, type: 'image', access_url: 'http://img/g2.png', width: 100, height: 100 };
    // 保存持续失败：面板打开时的参数写回与输入都会触发保存，避免一次性失败被提前消费
    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('save failed')));
    await renderPage();

    // 绑定成品卡 g1 编辑：输入触发自动保存 → 保存失败
    await clickNode('g1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('触发保存失败的编辑');
    // 面板输入触发 800ms 防抖自动保存，先等保存调用确实发起
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled(), { timeout: 3000 });
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败'), { timeout: 3000 });

    // 隐藏面板后点击其它成品卡：暂停切换编辑目标（不开新面板）
    // （IKDMQV：空白点击收敛为 PaneClick 关面板；空选中是过渡态不再关）
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    await clickNode('g2');
    expect(container.querySelector('[contenteditable]')).toBeNull();

    // 重开当前绑定目标（g1）不算切换：面板恢复，未保存内容保留、可继续触发保存重试
    await clickNode('g1');
    expect(promptTextarea()).toBeTruthy();
  });
});


describe('IKDXHS：首页生成节点保留可编辑配置', () => {
  it.each(['image', 'video'] as const)('%s 保存实际参数，成功后重开并刷新仍恢复', async kind => {
    const models = await apiMocks.fetchGenerationModels();
    const capable = models.map(model => ({ ...model,
      supported_durations: { min: 4, max: 12, step: 1 }, default_duration: 8,
      features: { reference_image: true, first_frame: true, last_frame: true, first_last_frame: true },
    }));
    apiMocks.fetchGenerationModels.mockResolvedValueOnce(capable).mockResolvedValueOnce(capable).mockResolvedValueOnce(capable);
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'succeeded', progress: 100,
      asset: { id: 'a9', url: kind === 'image' ? 'http://img/out.png' : 'http://img/out.mp4', type: kind } });
    const handoff: GenHandoff = kind === 'image'
      ? { kind, text: '首页输入', modelId: 'm-test', size: '2k', ratio: '1:1',
          files: [{ id: 'ref-a2', name: '参考图', type: 'image', assetId: 'a2', url: 'http://img/u1.png' }] }
      : { kind, text: '首页输入', modelId: 'm-test', resolution: '2k', aspectRatio: '1:1', duration: 8,
          mode: 'keyframe', refs: [
            { type: 'image', assetId: 'a1', preview: 'http://img/g1.png' },
            { type: 'image', assetId: 'a2', preview: 'http://img/u1.png' },
          ] };
    await renderPage(handoff);
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const generated = () => flowProps.current.mediaNodes.find((n: Node) => n.id.startsWith('media-gen')) as Node;
    await vi.waitFor(() => expect(generated()?.data.jobId).toBe('j2'));
    expect(generated().data).toMatchObject({ prompt: '首页输入', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1',
      ...(kind === 'video' ? { draftDuration: 8, draftMode: 'keyframe' } : {}) });
    const refs = flowProps.current.edges.filter((e: { target: string }) => e.target === generated().id);
    expect(refs).toHaveLength(kind === 'image' ? 1 : 2);
    expect(refs.map((e: { source: string }) => nodeOf(e.source).data.assetId)).toEqual(kind === 'image' ? ['a2'] : ['a1', 'a2']);
    if (kind === 'video') expect(refs.map((e: { data: { refRole: string } }) => e.data.refRole)).toEqual(['first', 'last']);
    const generatedId = generated().id;
    await clickNode(generatedId);
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(container.textContent).not.toContain('原生成模型已不可用');
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc.mock.calls.at(-1)?.[1].nodes.some((n: Node) => n.id === generatedId)).toBe(true), { timeout: 3000 });
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    await act(async () => root.unmount());
    container.remove();
    canvasDocMock.current.doc = { id: 11, version: 4, ...JSON.parse(JSON.stringify(saved)) };
    await renderPage();
    await clickNode(generatedId);
    expect(nodeOf(generatedId).data.draftModelId).toBe('m-test');
    expect(flowProps.current.edges.filter((e: { target: string }) => e.target === generatedId)).toHaveLength(refs.length);
    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(sendButton()?.disabled).toBe(false));
    await act(async () => sendButton().click());
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(2));
    const repeated = apiMocks.createGenerationJob.mock.calls[1]![1];
    expect(repeated.target_node_id).toBe(generatedId);
    expect(repeated.parameters.model_id).toBe('m-test');
    if (kind === 'image') expect(repeated.input_asset_ids).toEqual(['a2']);
    // IKEXX8 视频参考改为 structured references 数组（首帧/尾帧角色随连线持久化）
    else expect(repeated.references).toEqual([
      { material_id: 'asset-compliance-test', role: 'first_frame', type: 'image' },
      { material_id: 'asset-compliance-test', role: 'last_frame', type: 'image' },
    ]);
  });
});


it('首页上传参考保留永久素材地址与连线，不保存已释放的 blob 地址（IKDXHS）', async () => {
  apiMocks.fetchUploadPresign.mockResolvedValueOnce({ storage_key: 'ref.png' });
  apiMocks.completeUpload.mockResolvedValueOnce({ asset_id: 'new-ref', type: 'image', status: 'ready',
    url: 'https://assets/ref.png', width: 100, height: 100, duration: null, mime: 'image/png', size: 3 });
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = revoke; });
  try {
    await renderPage({ kind: 'image', text: '上传参考生成', modelId: 'm-test', size: '2k', ratio: '1:1',
      files: [{ id: 'upload', name: 'ref.png', type: 'image', file: pngFile('ref.png'), url: 'blob:home-reference' }] });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const source = flowProps.current.mediaNodes.find((n: Node) => n.data.assetId === 'new-ref') as Node;
    expect(source.data.src).toBe('https://assets/ref.png');
    expect(flowProps.current.edges.some((e: { source: string }) => e.source === source.id)).toBe(true);
    expect(revoke).toHaveBeenCalledWith('blob:home-reference');
  } finally { vi.unstubAllGlobals(); }
});


it('首页引用先关联当前项目，关联失败不丢参考后继续生成（IKDXHS）', async () => {
  apiMocks.linkAssetToProject.mockRejectedValueOnce(new Error('关联失败'));
  await renderPage({ kind: 'image', text: '跨项目参考', modelId: 'm-test', size: '2k', ratio: '1:1',
    files: [{ id: 'cross', name: '跨项目素材', type: 'image', assetId: 'outside', url: 'https://assets/outside.png' }] });
  await vi.waitFor(() => expect(apiMocks.linkAssetToProject).toHaveBeenCalledWith('p1', 'outside'));
  expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  expect(flowProps.current.mediaNodes.some((n: Node) => n.id.startsWith('media-gen'))).toBe(false);
});

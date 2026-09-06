// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';

/* IKDMQU 成功卡原卡编辑与重新生成：P1 单选成品卡自动开面板 / Q4 上传素材不自动开 /
   P2 编辑实时写回原卡 / Q1+Q6 发送后原卡重新生成不新建卡（旧素材保留）/
   Q5 成功替换与取消恢复 / Q9 空白与多选隐藏面板 / Q8 Enter 仅换行 /
   音频成品卡绑定音频面板（原落入图片分支的缺陷修复）。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；ImageDialog/AudioDialog 用真实实现。 */

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

function promptTextarea(): HTMLTextAreaElement {
  return container.querySelector('textarea')!;
}

async function typePrompt(text: string) {
  const textarea = promptTextarea();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
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
});

describe('IKDMQU P1/P2/Q4：成品卡面板绑定与编辑', () => {
  it('单选有生成记录的成品卡自动打开图片面板并恢复参数与文本附件', async () => {
    await renderPage();
    await clickNode('g1');

    // 面板打开且绑定原卡：恢复原提示词
    expect(promptTextarea()).toBeTruthy();
    await vi.waitFor(() => expect(promptTextarea().value).toBe('原提示词'));
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    // 连线文本附件实时展示
    await vi.waitFor(() => expect(container.textContent).toContain('文本附件（1）'));
  });

  it('上传素材卡（无生成记录）点击不自动打开面板（Q4）', async () => {
    await renderPage();
    await clickNode('u1');
    expect(container.querySelector('textarea')).toBeNull();
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
    expect(container.querySelector('textarea')).toBeNull();
    // 编辑已实时写回节点，隐藏不丢弃
    expect(nodeOf('g1').data.prompt).toBe('编辑中内容');

    // 重新选中恢复编辑
    await clickNode('g1');
    await vi.waitFor(() => expect(promptTextarea().value).toBe('编辑中内容'));

    // 多选隐藏
    await act(async () => {
      flowProps.current.onSelectionChange({
        nodes: [nodeOf('g1'), nodeOf('u1')],
        edges: [],
      });
    });
    expect(container.querySelector('textarea')).toBeNull();
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

    // 单选命中绑定目标（面板曾因过渡事件被关的场景）：恢复可见
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(container.querySelector('textarea')).toBeNull();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [nodeOf('g1')], edges: [] });
    });
    await vi.waitFor(() => expect(promptTextarea()).toBeTruthy());
  });

  it('音频成品卡点击打开音频面板（修复此前落入图片分支的缺陷）', async () => {
    seedAudioDoc();
    await renderPage();
    await clickNode('au1');

    const audioInput = container.querySelector<HTMLTextAreaElement>('[data-testid="audio-input"]');
    expect(audioInput).toBeTruthy();
    expect(container.querySelector('[data-testid="audio-send"]')).toBeTruthy();
    // 图片面板不打开
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    await vi.waitFor(() => expect(audioInput!.value).toBe('原音频描述'));
  });
});

describe('IKDMQU Q1/Q5/Q6/Q8：原卡重新生成', () => {
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
    expect(payload.parameters.prompt).toBe('重画一版');

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
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new Error('save failed'));
    await renderPage();

    // 触发一次保存失败：侧栏建草稿（草稿入保存）→ 保存失败
    await act(async () => {
      toolbarProps.current.onToggleImageDialog();
    });
    const draftId = flowProps.current.mediaNodes.find((n: Node) => n.data?.draft === true)!.id;
    await vi.waitFor(
      () => {
        const last = apiMocks.saveCanvasDoc.mock.calls.at(-1);
        expect(last).toBeTruthy();
      },
      { timeout: 3000 },
    );

    // 等待保存失败状态落定（toast 提示）
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败'), { timeout: 3000 });

    // 隐藏面板后点击其它成品卡：暂停切换编辑目标（不开新面板）
    // （IKDMQV：空白点击收敛为 PaneClick 关面板；空选中是过渡态不再关）
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    await clickNode('g1');
    expect(container.querySelector('textarea')).toBeNull();

    // 重开当前绑定目标（草稿）不算切换：面板恢复，未保存内容保留、可继续触发保存重试
    await clickNode(draftId);
    expect(promptTextarea()).toBeTruthy();
  });
});

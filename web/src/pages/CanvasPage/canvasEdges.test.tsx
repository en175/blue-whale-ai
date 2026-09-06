// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';

/* IKDLQF 接线测试：连线受控化（水合恢复/自动保存签名）、图片面板附件展示、
   目标节点提交的保存串行化与 target_node_id 携带。
   FlowCanvas/CanvasToolbar 打桩透出 props；ImageDialog 用真实实现验证附件区。 */

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试直接读取 edges 与触发节点回调 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

/** CanvasToolbar 打桩：透出 onToggleImageDialog 模拟底部固定入口 */
const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
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
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j1', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a2', url: 'http://img/out.png', type: 'image' },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
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

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真 */
vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
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
  readJobFailText: vi.fn(() => ''),
}));

vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

/* useCanvasDoc 打桩须保持引用稳定（见 index.test.tsx 注释）；内容经 current 按用例注入 */
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

/** 画布文档：文本节点 t1/t2 + 图片媒体节点 m1，连线 e1: t1 → m1 */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        { id: 't2', type: 'textNode', position: { x: 40, y: 40 }, data: { title: '配色参考', text: '深蓝与银白' } },
        {
          id: 'm1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '目标图', assetId: 'a1' },
        },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'm1' }],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
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

/** React 受控 textarea 赋值 */
async function typePrompt(text: string) {
  const textarea = container.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('IKDLQF 连线受控化与目标生图接线', () => {
  it('水合恢复连线且连线默认可见（showEdges 初始 true）', async () => {
    await renderPage();

    expect(flowProps.current.showEdges).toBe(true);
    expect(flowProps.current.edges).toEqual([
      { id: 'e1', source: 't1', target: 'm1', type: 'custom', style: { stroke: '#444' } },
    ]);
  });

  it('无变更不保存；连线变更进入自动保存签名并随下次保存上送', async () => {
    await renderPage();

    // 水合基线与当前内容一致：超过防抖窗口也不应发起保存
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();

    await act(async () => {
      flowProps.current.onConnect({ source: 't2', target: 'm1', sourceHandle: null, targetHandle: null });
    });

    await vi.waitFor(
      () => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1),
      { timeout: 3000 },
    );
    const payload = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(payload.edges).toHaveLength(2);
    expect(payload.edges.map((e) => ({ source: e.source, target: e.target }))).toEqual([
      { source: 't1', target: 'm1' },
      { source: 't2', target: 'm1' },
    ]);
  });

  it('拒绝自环与重复 (source,target) 连线，不进入保存签名', async () => {
    await renderPage();
    expect(flowProps.current.edges).toHaveLength(1);

    await act(async () => {
      flowProps.current.onConnect({ source: 't1', target: 'm1', sourceHandle: null, targetHandle: null });
      flowProps.current.onConnect({ source: 't1', target: 't1', sourceHandle: null, targetHandle: null });
    });

    expect(flowProps.current.edges).toHaveLength(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });

  it('删除文本节点后连线级联移除，并随自动保存上送空连线', async () => {    await renderPage();
    expect(flowProps.current.edges).toHaveLength(1);

    await act(async () => {
      flowProps.current.onDeleteNode('t1');
    });

    expect(flowProps.current.edges).toEqual([]);
    await vi.waitFor(
      () => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1),
      { timeout: 3000 },
    );
    const payload = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(payload.edges).toEqual([]);
    expect(payload.nodes.find((n) => n.id === 't1')).toBeUndefined();
  });

  it('从图片节点打开面板展示文本附件；提交先落盘当前编辑再携带 target_node_id', async () => {
    await renderPage();

    const media = flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1');
    await act(async () => {
      media.data.onGenImage('m1');
    });

    // 面板打开即展示当前附件（来源标题 + 正文预览）
    await vi.waitFor(() => expect(container.textContent).toContain('故事文案'));
    expect(container.textContent).toContain('一只蓝鲸在海里');

    // 模型能力就位后，空提示词 + 非空附件正文即可发送（契约：附件可单独驱动生成）
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(sendButton().disabled).toBe(false);

    // 制造一笔未防抖落盘的正文编辑
    const text = flowProps.current.textNodes.find((n: Node) => n.id === 't1');
    await act(async () => {
      text.data.onTextChange('t1', '一只蓝鲸在海里游');
    });

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.type).toBe('image');
    expect(payload.target_node_id).toBe('m1');
    expect(payload.input_asset_ids).toEqual(['a1']);
    expect(payload.parameters.prompt).toBe('');

    // 保存串行化：先落盘（含未防抖编辑与连线）再创建任务
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder[0]!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );
    const saved = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(saved.nodes.find((n) => n.id === 't1')!.data.text).toBe('一只蓝鲸在海里游');
    expect(saved.edges).toHaveLength(1);
  });

  it('资产卡「生成图片」打开空白面板：提交不携带 target_node_id，也不做提交前落盘', async () => {
    // IKDMQQ 起侧栏图片入口改为先建草稿卡（必带 target_node_id）；
    // 不带目标节点的旧链路改由资产卡「生成图片」入口承载（空白面板）。
    canvasDocMock.current = {
      doc: {
        id: 11,
        version: 3,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
          { id: 'c1', type: 'assetNode', position: { x: 300, y: 0 }, data: { kind: 'custom' } },
        ],
        edges: [],
      },
      assets: {},
      refetch: () => Promise.resolve([]),
      acceptDoc: vi.fn(),
    };
    await renderPage();

    const card = flowProps.current.assetNodes.find((n: Node) => n.id === 'c1');
    await act(async () => {
      card.data.onGenerateImage();
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    // 无目标节点：不展示附件区
    expect(container.textContent).not.toContain('故事文案');

    // 未落盘编辑 + 输入提示词后发送
    const text = flowProps.current.textNodes.find((n: Node) => n.id === 't1');
    await act(async () => {
      text.data.onTextChange('t1', '未落盘的编辑');
    });
    await typePrompt('画一只猫');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const payload = apiMocks.createGenerationJob.mock.calls[0]![1];
    expect('target_node_id' in payload).toBe(false);
    expect(payload.parameters.prompt).toBe('画一只猫');
    // 旧链路行为不变：提交前不主动落盘（800ms 防抖尚未到点）
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });
});

/* IKDLQG 视频目标接线：视频节点面板附件展示、提交前保存串行化与 target_node_id 携带。
   BottomDialog 用真实实现验证附件区；视频节点 v1 由 seedVideoDoc 注入。 */
function seedVideoDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '目标视频', assetId: 'a9' },
        },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'v1' }],
    },
    assets: {
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 100, height: 100 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

describe('IKDLQG 视频目标接线', () => {
  it('从视频节点打开面板展示文本附件；提交先落盘当前编辑再携带 target_node_id', async () => {
    seedVideoDoc();
    await renderPage();

    const media = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1');
    await act(async () => {
      media.data.onGenVideo('v1');
    });

    // 面板打开即展示当前附件（来源标题 + 正文预览）
    await vi.waitFor(() => expect(container.textContent).toContain('文本附件（1）'));
    expect(container.textContent).toContain('故事文案');
    expect(container.textContent).toContain('一只蓝鲸在海里');

    // 模型能力就位后，空提示词 + 非空附件正文即可发送（契约：附件可单独驱动生成）
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(sendButton().disabled).toBe(false);

    // 制造一笔未防抖落盘的正文编辑
    const text = flowProps.current.textNodes.find((n: Node) => n.id === 't1');
    await act(async () => {
      text.data.onTextChange('t1', '一只蓝鲸在海里游');
    });

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.type).toBe('video');
    expect(payload.target_node_id).toBe('v1');
    // 视频节点自身作为参考素材（旧语义保留），与目标语义并存
    expect(payload.reference_asset_ids).toEqual(['a9']);
    expect(payload.parameters.prompt).toBe('');

    // 保存串行化：先落盘（含未防抖编辑与连线）再创建任务
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder[0]!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );
    const saved = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(saved.nodes.find((n) => n.id === 't1')!.data.text).toBe('一只蓝鲸在海里游');
    expect(saved.edges).toHaveLength(1);
  });

  it('重新编辑入口同样携带目标节点与附件快照', async () => {
    seedVideoDoc();
    await renderPage();

    const media = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1');
    await act(async () => {
      media.data.onReEdit('v1');
    });

    await vi.waitFor(() => expect(container.textContent).toContain('文本附件（1）'));
    expect(container.textContent).toContain('故事文案');

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const payload = apiMocks.createGenerationJob.mock.calls[0]![1];
    expect(payload.type).toBe('video');
    expect(payload.target_node_id).toBe('v1');
  });

  it('底部固定入口打开视频对话框：无附件区、空提示词禁用发送', async () => {
    seedVideoDoc();
    await renderPage();

    await act(async () => {
      toolbarProps.current.onToggleVideoDialog();
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    // 无目标节点：不展示附件区，空提示词保持发送禁用（无附件语义）
    expect(container.textContent).not.toContain('文本附件');
    expect(sendButton().disabled).toBe(true);
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { typePromptRefText } from './testing/promptRefEditor';
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
vi.mock('./characterLibraryDeposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./characterLibraryDeposit')>()),
  depositCanvasAssetToCharacterLibrary: vi.fn(async () => ({ materialId: 'asset-compliance-test' })),


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

vi.mock('./components/ProjectSelector', () => ({
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
  createConversationQuote: vi.fn(),
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
      features: { task_types: { text2video: {}, omni: {}, image_reference: {}, first_frame: {}, first_last_frame: {} } },
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
  createConversationQuote: apiMocks.createConversationQuote,
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  applyPromptPreview: apiMocks.applyPromptPreview,
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
  ),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
}));

vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
  readJobFailText: vi.fn(() => ''),
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

vi.mock('./hooks/useCanvasDoc', () => ({
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
        { id: 't2', type: 'textNode', position: { x: 40, y: 40 }, data: { title: '配色参考', text: '深蓝与银白' } },
        {
          id: 'm1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '目标图', assetId: 'a1' },
        },
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 420, y: 160 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
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

    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();


    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();


    await act(async () => {
      flowProps.current.onConnect({ source: 't2', target: 'd1', sourceHandle: null, targetHandle: null });
    });

    await vi.waitFor(
      () => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1),
      { timeout: 3000 },
    );
    const payload = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(payload.edges).toHaveLength(2);
    expect(payload.edges.map((e) => ({ source: e.source, target: e.target }))).toEqual([
      { source: 't1', target: 'm1' },
      { source: 't2', target: 'd1' },
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
      flowProps.current.onDeleteNode(['t1']);
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


    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();

    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1'));
    });


    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));


    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(sendButton().disabled).toBe(false);


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


    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.parameters.prompt).toBe('一只蓝鲸在海里游');


    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder[0]!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );
    const saved = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(saved.nodes.find((n) => n.id === 't1')!.data.text).toBe('一只蓝鲸在海里游');
    expect(saved.edges).toHaveLength(1);
  });

  it('资产卡「生成图片」打开空白面板：提交不携带 target_node_id，也不做提交前落盘', async () => {


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

    expect(container.textContent).not.toContain('故事文案');


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

    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });
});



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
          data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '目标视频', assetId: 'a9', jobId: 'j1', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1' },
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
      flowProps.current.onNodeClick(media);
    });


    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));
    expect(container.querySelector('[data-testid="dock-text-ref"]')!.getAttribute('title')).toBe('故事文案');


    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(sendButton().disabled).toBe(false);


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

    expect(payload.reference_asset_ids).toBeUndefined();

    expect(payload.parameters.prompt).toBe('一只蓝鲸在海里游');


    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder[0]!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );
    const saved = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(saved.nodes.find((n) => n.id === 't1')!.data.text).toBe('一只蓝鲸在海里游');
    expect(saved.edges).toHaveLength(1);
  });

  it('底部固定入口打开视频对话框：无附件区、空提示词禁用发送', async () => {
    seedVideoDoc();
    await renderPage();

    await act(async () => {
      toolbarProps.current.onToggleVideoDialog();
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));


    expect(container.querySelector('[data-testid="dock-text-ref"]')).toBeNull();
    expect(sendButton().disabled).toBe(true);
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
});










describe('IKDL9U review text input consistency', () => {
  it('shows a legacy HTML text attachment', async () => {
    const doc = canvasDocMock.current.doc as any;
    doc.nodes[0].data = { title: '旧文本', html: '<div>蓝鲸 &amp; 海</div><div>夜景</div>' };

    doc.nodes.find((n: Node) => n.id === 'm1')!.data.draft = true;
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1'));
    });

    const thumb = container.querySelector('[data-testid="dock-text-ref"]')!;
    await act(async () => {
      thumb.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 250); });
    });
    const previewText = document.querySelector('[data-testid="ref-thumb-preview"]')?.textContent ?? '';
    expect(previewText).toContain('蓝鲸 & 海');
    expect(previewText).toContain('夜景');
  });
  it('pauses autosave for invalid drafts and resumes after correction', async () => {

    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();
    await act(async () => {
      flowProps.current.textNodes[0].data.onDraftError('t1', '正文超限');

      flowProps.current.onConnect({ source: 't2', target: 'd1', sourceHandle: null, targetHandle: null });
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
    await act(async () => flowProps.current.textNodes[0].data.onDraftError('t1', ''));
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
  it('blocks quoting an invalid draft instead of quoting the previous saved text', async () => {
    await renderPage();
    await act(async () => {
      flowProps.current.textNodes[0].data.onDraftError('t1', '正文超限');
      flowProps.current.textNodes[0].data.onAddToChat('t1');
    });
    expect(apiMocks.createConversationQuote).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(container.textContent).toContain('正文超限'), { timeout: 3000 });
  });
  it('blocks generation while a connected text has an invalid draft', async () => {

    (canvasDocMock.current.doc as { nodes: Node[] }).nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1'));
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await act(async () => flowProps.current.textNodes[0].data.onDraftError?.('t1', '正文超限'));
    await act(async () => sendButton().click());
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();


    expect(sendButton().disabled).toBe(true);
  });
});

describe('IKFCKT 参考栏拖拽换位', () => {

  function dragEvent(type: 'dragstart' | 'dragover' | 'drop', clientX: number) {
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
      dataTransfer: { setData: () => void; effectAllowed: string; dropEffect: string };
      clientX: number;
    };
    event.dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
    event.clientX = clientX;
    return event;
  }

  it('混排保存至目标草稿并在关闭重开及画布重新挂载后恢复', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: Array<{ id: string; source: string; target: string }> };
    doc.edges.push({ id: 'media-edge', source: 'm1', target: 'd1' }, { id: 'text-edge', source: 't1', target: 'd1' }, { id: 'text-edge2', source: 't2', target: 'd1' });
    await renderPage();
    const open = async () => {
      await act(async () => flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')));
      await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-media-ref"]')).toHaveLength(1));
    };
    await open();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const text = container.querySelector('[data-testid="dock-text-ref"]')!;
    const media = container.querySelector('[data-testid="dock-media-ref"]')!;
    await act(async () => text.dispatchEvent(dragEvent('dragstart', 0)));
    await act(async () => media.dispatchEvent(dragEvent('drop', 10)));
    const order = () => [...container.querySelectorAll('[data-testid="dock-media-ref"], [data-testid="dock-text-ref"]')].map(el => el.getAttribute('title'));
    expect(order()).toEqual(['故事文案', '目标图', '配色参考']);
    const text2 = container.querySelectorAll('[data-testid="dock-text-ref"]')[1]!;
    await act(async () => text2.dispatchEvent(dragEvent('dragstart', 0)));
    await act(async () => text.dispatchEvent(dragEvent('drop', 10)));
    expect(order()).toEqual(['配色参考', '故事文案', '目标图']);
    expect([...container.querySelectorAll('[data-testid="dock-text-ref"] [data-testid="ref-thumb-badge"]')].map(el => el.textContent)).toEqual(['1', '2']);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });
    const payload = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(payload.nodes.find(n => n.id === 'd1')!.data.referenceStripOrder).toEqual(['text:t2', 'text:t1', 'media:node:m1']);
    expect(payload.edges.filter(e => e.target === 'd1').map(e => e.source)).toEqual(['t2', 't1', 'm1']);
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="关闭"]')!.click());
    await open();
    expect(order()).toEqual(['配色参考', '故事文案', '目标图']);
    await act(async () => root.unmount());
    container.remove();
    canvasDocMock.current.doc = { ...doc, ...payload, id: 11, version: 4 };
    await renderPage();
    await open();
    expect(order()).toEqual(['配色参考', '故事文案', '目标图']);
  });

  it('图片面板拖拽文本附件换位：边序重排随自动保存上送（拼接顺序随之），角标与新序联动', async () => {

    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: Array<{ id: string; source: string; target: string }> };
    doc.edges.push({ id: 'e2', source: 't2', target: 'm1' });

    doc.nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();

    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1'));
    });

    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(2));
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    const titles = () =>
      [...container.querySelectorAll('[data-testid="dock-text-ref"]')].map((el) => el.getAttribute('title'));
    expect(titles()).toEqual(['故事文案', '配色参考']);


    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const thumbs = [...container.querySelectorAll('[data-testid="dock-text-ref"]')];
    await act(async () => { thumbs[1]!.dispatchEvent(dragEvent('dragstart', 0)); });
    await act(async () => { thumbs[0]!.dispatchEvent(dragEvent('dragover', 10)); });
    await act(async () => { thumbs[0]!.dispatchEvent(dragEvent('drop', 10)); });


    await vi.waitFor(() => expect(titles()).toEqual(['配色参考', '故事文案']));


    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    const payload = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    const sources = (payload.edges as Array<{ source: string; target: string }>)
      .filter((e) => e.target === 'm1')
      .map((e) => e.source);
    expect(sources).toEqual(['t2', 't1']);
  });
});

describe('IKFCJG 跨来源视频参考提交顺序', () => {
  it('material 拖到画布图片前后，编号与请求 references 使用相同顺序', async () => {
    seedVideoDoc();
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: Array<Record<string, string>> };
    Object.assign(doc.nodes.find(n => n.id === 'v1')!.data, {
      src: '', draft: true, genStatus: 'draft', draftMode: 'omni', prompt: '组合图片1和图片2',
      draftMaterialRefs: [{ materialId: 'asset-lib1', url: 'http://img/lib.png', name: '角色立绘', mediaType: 'image', role: 'reference' }],
      promptDoc: { version: 1, flat: '组合图片1和图片2', segments: [
        { kind: 'text', text: '组合' }, { kind: 'asset_ref', asset_id: '101', label: '图片1' },
        { kind: 'text', text: '和' }, { kind: 'asset_ref', asset_id: 'asset-lib1', label: '图片2' },
      ] },
    });
    doc.nodes.push({ id: 'source-image', type: 'mediaNode', position: { x: 0, y: 200 }, data: { src: 'http://img/101.png', mediaType: 'image', assetId: '101', fileName: '画布图片' } });
    doc.edges.push({ id: 'image-video', source: 'source-image', target: 'v1', role: 'reference' });
    canvasDocMock.current.assets['101'] = { asset_id: 101, type: 'image', access_url: 'http://img/101.png', width: 100, height: 100 };
    const models = await apiMocks.fetchGenerationModels();


    apiMocks.fetchGenerationModels.mockResolvedValue(models.map(model => ({ ...model, features: { reference_image: true, image_reference_max: 9, ...{ task_types: { text2video: {}, omni: {}, image_reference: {}, first_frame: {}, first_last_frame: {} } } } })));
    await renderPage();
    await act(async () => flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')));
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-video-ref"]')).toHaveLength(2));
    await vi.waitFor(() => expect(sendButton()?.disabled).toBe(false));
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const drag = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: { setData: () => {}, effectAllowed: '', dropEffect: '' }, clientX: 10 });
      return event;
    };
    try {
      const thumbs = [...container.querySelectorAll('[data-testid="dock-video-ref"]')];
      await act(async () => thumbs[1]!.dispatchEvent(drag('dragstart')));
      await act(async () => thumbs[0]!.dispatchEvent(drag('drop')));
      expect([...container.querySelectorAll('[data-testid="dock-video-ref"]')].map(el => el.getAttribute('title'))).toEqual(['角色立绘', '画布图片']);
      expect([...container.querySelectorAll('[data-testid="dock-video-ref"] [data-testid="ref-thumb-badge"]')].map(el => el.textContent)).toEqual(['1', '2']);
      await act(async () => sendButton().click());
      await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
      const payload = apiMocks.createGenerationJob.mock.calls[0]![1];

      expect(payload.references).toEqual([{ material_id: 'asset-lib1', type: 'image', role: 'reference' }, { asset_id: '101', type: 'image', role: 'reference' }]);

      expect(payload.parameters.prompt).toBe('一只蓝鲸在海里组合&101&和&asset-lib1&');
    } finally {
      rect.mockRestore();
    }
  });
});

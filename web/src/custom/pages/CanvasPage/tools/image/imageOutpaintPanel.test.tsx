// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { IMAGE_OUTPAINT_EDGE_ORIGIN } from './imageOutpaint';
import { imageOutpaintInputSchema } from '@lib/contracts/image-outpaint';
import { imageMediaRefsOf } from '../../media/mediaRefs';
import type { GenerationModel } from '@/custom/api/generation';

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
vi.mock('../../components/AgentPanel/index', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../../components/Canvas/index', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../../components/CanvasToolbar/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('../../components/CanvasHeader/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('../../components/ProjectSelector/index', () => ({
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
  saveCanvasDoc: vi.fn(
    async (): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createImageEnhancement: vi.fn(),
  createImageOutpaint: vi.fn(async (_projectId: string, _payload: Record<string, unknown>) => ({
    job_id: '88',
    status: 'queued' as const,
  })),
  fetchJobStatus: vi.fn(async (): Promise<any> => ({
    job_id: '88',
    status: 'processing',
    progress: 0,
    asset: null,
  })),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
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
  createConversationQuote: vi.fn(),
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
  createImageEnhancement: apiMocks.createImageEnhancement,
  createImageOutpaint: apiMocks.createImageOutpaint,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('../../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

const LAST_PARAMS = {
  source_asset_id: '5',
  target_node_id: 'o1',
  expand_top: 0.1,
  expand_bottom: 0,
  expand_left: 0,
  expand_right: 0.2,
};

function seedDoc(withFailedOutpaint = false) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'i1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: { src: 'http://img/i1.png', mediaType: 'image', fileName: '素材图', assetId: '5', width: 1600, height: 900 },
    },
  ];
  if (withFailedOutpaint) {
    nodes.push({
      id: 'o1',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: '',
        mediaType: 'image',
        fileName: '生成-88',
        jobId: '88',
        genStatus: 'failed',
        errorText: '扩图失败，请重试',
        imageOutpaint: { sourceAssetId: '5', lastParams: { ...LAST_PARAMS } },
      },
    });
  }
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      edges: withFailedOutpaint
        ? [{ id: 'e1', source: 'i1', target: 'o1', data: { origin: IMAGE_OUTPAINT_EDGE_ORIGIN } }]
        : [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;

const defaultJobStatus = apiMocks.fetchJobStatus.getMockImplementation()!;

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

async function enterOutpaint(nodeId = 'i1') {
  const image = flowProps.current.mediaNodes.find((n: Node) => n.id === nodeId)!;
  await act(async () => {
    image.data.onOutpaintImage(nodeId);
  });
}

const mediaNode = (id: string) => (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id)!;
const nodeData = (id: string) => mediaNode(id).data as Record<string, unknown>;
const sendBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-send-btn"]');
const frameProps = () => flowProps.current.outpaintFrame as
  | { rect: { width: number; height: number }; expands: Record<string, number>; onExpandChange: (e: never) => void }
  | null;

async function dragAndSend(top = 28, right = 56) {
  await act(async () => {
    frameProps()!.onExpandChange({ top, right, bottom: 0, left: 0 } as never);
  });
  await act(async () => {
    sendBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const outpaintResultId = () =>
  (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1' && n.id !== 'o1')!.id;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  apiMocks.fetchJobStatus.mockReset().mockImplementation(defaultJobStatus);
});

describe('IKGOR6 发送创建任务闭环', () => {
  it('零扩展（默认进入态）发送钮置灰：不建卡不连线不产生任务', async () => {
    seedDoc();
    await renderPage();
    await enterOutpaint();
    expect(sendBtn()!.disabled).toBe(true);
    await act(async () => {
      sendBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createImageOutpaint).not.toHaveBeenCalled();
  });

  it('发送：六键冻结 payload（四比例换算自扩展框，相对短边）且过契约 zod 校验', async () => {
    seedDoc();
    await renderPage();
    await enterOutpaint();
    await dragAndSend();

    expect(apiMocks.createImageOutpaint).toHaveBeenCalledTimes(1);
    const [projectId, payload] = apiMocks.createImageOutpaint.mock.calls[0];
    expect(projectId).toBe('p1');
    const draftId = outpaintResultId();
    expect(payload).toEqual({
      source_asset_id: '5',
      target_node_id: draftId,
      expand_top: 0.1,
      expand_right: 0.2,
      expand_bottom: 0,
      expand_left: 0,
    });
    expect(imageOutpaintInputSchema.parse(payload)).toEqual(payload);
  });

  it('发送后建结果草稿卡转生成中 + 纯视觉来源线（不占参考位）并退出扩图模式', async () => {
    seedDoc();
    await renderPage();
    await enterOutpaint();
    const payload = () => apiMocks.createImageOutpaint.mock.calls[0]?.[1] as Record<string, unknown>;
    await dragAndSend();

    const draftId = outpaintResultId();
    expect(nodeData(draftId).imageOutpaint).toEqual({ sourceAssetId: '5', lastParams: payload() });
    expect(nodeData(draftId).genStatus).toBe('generating');
    expect(nodeData(draftId).progress).toBe(0);
    expect(nodeData(draftId).fileName).toBe('扩图生成中');
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>;
    const edge = edges.find((e) => e.target === draftId)!;
    expect(edge.source).toBe('i1');
    expect(edge.data).toEqual({ origin: IMAGE_OUTPAINT_EDGE_ORIGIN });
    expect(imageMediaRefsOf(draftId, edges as never[], flowProps.current.mediaNodes)).toEqual([]);
    expect(frameProps()).toBeNull();
    expect(document.body.querySelector('[data-testid="outpaint-dialog"]')).toBeNull();
    expect(flowProps.current.refPickActive).toBe(false);
    expect(nodeData('i1').src).toBe('http://img/i1.png');
    expect(nodeData('i1').fileName).toBe('素材图');
  });

  it('创建成功后 jobId 回填并启动轮询', async () => {
    seedDoc();
    await renderPage();
    await enterOutpaint();
    await dragAndSend();
    const draftId = outpaintResultId();

    await act(async () => {
      await Promise.resolve();
    });
    expect(nodeData(draftId).jobId).toBe('88');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('88');
  });
});

describe('IKGOR6 轮询三态回填', () => {
  it('生成中：进度回填、保持生成中', async () => {
    seedDoc();
    await renderPage();
    await enterOutpaint();
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '88', status: 'processing', progress: 40, asset: null });
    await dragAndSend();
    const draftId = outpaintResultId();

    await vi.waitFor(() => expect(nodeData(draftId).progress).toBe(40));
    expect(nodeData(draftId).genStatus).toBe('generating');
  });

  it('成品：结果图与新分辨率回填，脱离生成态', async () => {
    seedDoc();
    await renderPage();
    await enterOutpaint();
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '88',
      status: 'succeeded',
      progress: 100,
      asset: { id: '9', url: 'http://img/out.png', type: 'image', width: 2240, height: 1400 },
    });
    await dragAndSend();
    const draftId = outpaintResultId();

    await vi.waitFor(() => expect(nodeData(draftId).src).toBe('http://img/out.png'));
    expect(nodeData(draftId).width).toBe(2240);
    expect(nodeData(draftId).height).toBe(1400);
    expect(nodeData(draftId).genStatus).toBeUndefined();
    expect(nodeData(draftId).assetId).toBe('9');
    expect(nodeData('i1').src).toBe('http://img/i1.png');
    expect(nodeData('i1').width).toBe(1600);
  });

  it('失败：结果卡置失败态并展示可读原因', async () => {
    seedDoc();
    await renderPage();
    await enterOutpaint();
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '88',
      status: 'failed',
      progress: 0,
      asset: null,
      error: { code: 1041, msg: '扩图失败：上游处理超时' },
    });
    await dragAndSend();
    const draftId = outpaintResultId();

    await vi.waitFor(() => expect(nodeData(draftId).genStatus).toBe('failed'));
    expect(nodeData(draftId).errorText).toBe('扩图失败：上游处理超时');
  });
});

describe('IKGOR6 失败重试沿用上次参数', () => {
  it('失败扩图卡重试：lastParams 原样重发创建接口，不经通用 retry 接口', async () => {
    seedDoc(true);
    await renderPage();

    const retryCb = nodeData('o1').onRetryJob as (id: string) => void;
    await act(async () => {
      retryCb('o1');
    });
    expect(apiMocks.createImageOutpaint).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.createImageOutpaint.mock.calls[0][1]).toEqual(LAST_PARAMS);
    expect(nodeData('o1').genStatus).toBe('generating');
  });
});

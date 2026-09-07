// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { ApiError } from '@/api/http';
import CanvasPage from './index';

/* IKDMQW 取消、删除与任务完成竞态：
   普通取消经接口确认后按任务权威状态收敛（cancelled → 草稿回待生成保留参数与连线；
   processing（软取消已登记）→ 同样回待生成；succeeded 竞态 → 挂载作品不回待生成；
   成品卡重新生成取消 → 恢复成品态）。删除生成中卡片先请求取消：确认成功且非 succeeded
   才移除；取消失败保留卡片并提示原因；删除过程中任务抢先成功保留作品提示「任务已完成」。
   迟到轮询/取消响应不得复活已删除节点。FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props。 */

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

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _body: Record<string, unknown>) => ({ generation_job_id: 'j8', cursor: 1 })),
  fetchJobStatus: vi.fn(),
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
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
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
  applyPromptPreview: vi.fn(),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
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

type JobDetail = {
  job_id: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  asset: { id: string; url: string; type: string } | null;
};

const PROCESSING: JobDetail = { job_id: 'j1', status: 'processing', progress: 10, asset: null };
const CANCELLED: JobDetail = { job_id: 'j1', status: 'cancelled', progress: 0, asset: null };
const SUCCEEDED: JobDetail = {
  job_id: 'j1', status: 'succeeded', progress: 100,
  asset: { id: 'a9', url: 'http://img/out.png', type: 'image' },
};
const FAILED: JobDetail = { job_id: 'j1', status: 'failed', progress: 0, asset: null };

/** 默认画布：生成中草稿卡 d1（jobId j1）+ 文本节点 t1 与连线 t1→d1（断言取消后连线保留）。 */
function seedGeneratingDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 0, y: 0 },
          data: {
            src: '',
            mediaType: 'image',
            fileName: '图片生成中',
            genStatus: 'generating',
            progress: 0,
            draft: true,
            jobId: 'j1',
            prompt: '原提示词',
            draftModelId: 'm-test',
            draftSize: '2k',
            draftRatio: '1:1',
          },
        },
        { id: 't1', type: 'textNode', position: { x: 300, y: 0 }, data: { title: '雨夜', text: '霓虹' } },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'd1' }],
    },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

/** 追加一张重新生成中的成品卡 g1（旧素材保留，取消应恢复成品态）。 */
function seedRegenCard() {
  const doc = canvasDocMock.current.doc as { nodes: unknown[]; assets?: unknown };
  doc.nodes.push({
    id: 'g1',
    type: 'mediaNode',
    position: { x: 600, y: 0 },
    data: {
      src: 'http://img/g1.png',
      mediaType: 'image',
      fileName: '生成-j2',
      assetId: 'a1',
      jobId: 'j2',
      genStatus: 'generating',
      progress: 0,
    },
  });
  canvasDocMock.current.assets = {
    a1: { asset_id: 1, type: 'image', access_url: 'http://img/g1.png', width: 100, height: 100 },
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

function nodeOf(id: string): Node {
  return flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
}

function dataOf(id: string): Record<string, unknown> {
  return nodeOf(id).data as Record<string, unknown>;
}

async function clickCancel(id: string) {
  await act(async () => {
    const onCancelJob = dataOf(id).onCancelJob as (id: string) => void;
    onCancelJob(id);
  });
}

async function clickDelete(id: string) {
  await act(async () => {
    const onDelete = dataOf(id).onDelete as (id: string) => void;
    onDelete(id);
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedGeneratingDoc();
  // 默认：水合轮询首 tick 与取消/删除的权威核对都拿到 processing（测试按需覆盖）
  apiMocks.fetchJobStatus.mockImplementation(async () => ({ ...PROCESSING }));
  apiMocks.cancelGenerationJob.mockImplementation(async () => null);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKDMQW 普通取消：接口确认后按任务权威状态收敛', () => {
  it('草稿卡取消：cancel 确认 + 权威 cancelled → 回待生成，参数与连线保留', async () => {
    await renderPage();
    // 水合轮询首 tick（processing）之后，取消核对拿到 cancelled
    apiMocks.fetchJobStatus.mockImplementation(async () => {
      const calls = apiMocks.fetchJobStatus.mock.calls.length;
      return calls <= 1 ? { ...PROCESSING } : { ...CANCELLED };
    });

    await clickCancel('d1');

    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledTimes(1);
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j1');
    await vi.waitFor(() => expect(dataOf('d1').genStatus).toBe('draft'));
    expect(dataOf('d1').fileName).toBe('图片草稿');
    expect(dataOf('d1').draft).toBe(true);
    expect(dataOf('d1').prompt).toBe('原提示词');
    expect(dataOf('d1').draftModelId).toBe('m-test');
    expect(dataOf('d1').progress).toBeUndefined();
    expect(dataOf('d1').errorText).toBeUndefined();
    // 连线保留：取消不清输入关系
    expect(flowProps.current.edges.some((e: { source: string; target: string }) => e.source === 't1' && e.target === 'd1')).toBe(true);
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
  });

  it('取消确认但权威状态仍 processing（软取消已登记）：同样回待生成', async () => {
    await renderPage();

    await clickCancel('d1');

    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(dataOf('d1').genStatus).toBe('draft'));
    expect(dataOf('d1').prompt).toBe('原提示词');
  });

  it('取消请求失败：卡片保持生成中并提示原因，任务可继续查看', async () => {
    await renderPage();
    apiMocks.cancelGenerationJob.mockRejectedValueOnce(new ApiError(400, '任务已结束'));

    await clickCancel('d1');

    await vi.waitFor(() => expect(container.textContent).toContain('取消失败'));
    expect(dataOf('d1').genStatus).toBe('generating');
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
  });

  it('取消确认但任务抢先成功：挂载作品，不回待生成', async () => {
    await renderPage();
    apiMocks.fetchJobStatus.mockImplementation(async () => {
      const calls = apiMocks.fetchJobStatus.mock.calls.length;
      return calls <= 1 ? { ...PROCESSING } : { ...SUCCEEDED };
    });

    await clickCancel('d1');

    await vi.waitFor(() => expect(dataOf('d1').src).toBe('http://img/out.png'));
    expect(dataOf('d1').genStatus).toBeUndefined();
    expect(dataOf('d1').draft).toBeUndefined();
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
  });

  it('成品卡重新生成中取消：恢复成品态，旧素材保留（IKDMQU Q5 回归）', async () => {
    seedRegenCard();
    await renderPage();
    apiMocks.fetchJobStatus.mockImplementation(async (jobId: string | number) => ({
      ...CANCELLED,
      job_id: String(jobId),
    }));

    await clickCancel('g1');

    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j2');
    await vi.waitFor(() => expect(dataOf('g1').genStatus).toBeUndefined());
    expect(dataOf('g1').src).toBe('http://img/g1.png');
  });

  it('轮询自行收敛到 cancelled：草稿卡同样回待生成（不删除节点）', async () => {
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ ...CANCELLED }));
    await renderPage();

    await vi.waitFor(() => expect(dataOf('d1').genStatus).toBe('draft'));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
    expect(dataOf('d1').prompt).toBe('原提示词');
  });
});

describe('IKDMQW 删除生成中卡片：先取消，确认后移除；竞态保留作品', () => {
  it('删除生成中草稿卡：先请求取消，权威 cancelled 确认后移除节点', async () => {
    await renderPage();
    apiMocks.fetchJobStatus.mockImplementation(async () => {
      const calls = apiMocks.fetchJobStatus.mock.calls.length;
      return calls <= 1 ? { ...PROCESSING } : { ...CANCELLED };
    });

    await clickDelete('d1');

    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(false));
  });

  it('删除非生成中卡片：直接移除，不请求取消', async () => {
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ ...CANCELLED }));
    await renderPage();
    await vi.waitFor(() => expect(dataOf('d1').genStatus).toBe('draft'));

    await clickDelete('d1');

    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(false);
  });

  it('删除时取消失败且任务已失败：保留卡片并提示原因，不自动删除', async () => {
    await renderPage();
    apiMocks.cancelGenerationJob.mockRejectedValueOnce(new ApiError(400, '资源不存在'));
    apiMocks.fetchJobStatus.mockImplementation(async () => {
      const calls = apiMocks.fetchJobStatus.mock.calls.length;
      return calls <= 1 ? { ...PROCESSING } : { ...FAILED };
    });

    await clickDelete('d1');

    await vi.waitFor(() => expect(container.textContent).toContain('取消失败'));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
  });

  it('删除过程中任务抢先成功：停止自动删除，保留作品并提示任务已完成', async () => {
    await renderPage();
    // 取消失败（任务已终态不可取消）+ 权威状态 succeeded
    apiMocks.cancelGenerationJob.mockRejectedValueOnce(new ApiError(400, '资源不存在'));
    apiMocks.fetchJobStatus.mockImplementation(async () => {
      const calls = apiMocks.fetchJobStatus.mock.calls.length;
      return calls <= 1 ? { ...PROCESSING } : { ...SUCCEEDED };
    });

    await clickDelete('d1');

    await vi.waitFor(() => expect(container.textContent).toContain('任务已完成'));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
    await vi.waitFor(() => expect(dataOf('d1').src).toBe('http://img/out.png'));
    // 用户仍可再次删除：此时卡片非生成中，再操作一次直接移除
    await clickDelete('d1');
    await vi.waitFor(() => expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(false));
  });

  it('取消登记成功但权威状态 succeeded：同样停止删除保留作品', async () => {
    await renderPage();
    apiMocks.fetchJobStatus.mockImplementation(async () => {
      const calls = apiMocks.fetchJobStatus.mock.calls.length;
      return calls <= 1 ? { ...PROCESSING } : { ...SUCCEEDED };
    });

    await clickDelete('d1');

    await vi.waitFor(() => expect(container.textContent).toContain('任务已完成'));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
  });

  it('删除时任务仍未终态（软取消已登记）：不抢先移除，轮询 cancelled 后才移除', async () => {
    await renderPage();
    // 全程 processing：删除核对与轮询都拿 processing，卡片保留（等待 worker 停止）
    await clickDelete('d1');
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
    expect(dataOf('d1').genStatus).toBe('generating');

    // worker 停止（轮询拿到 cancelled）：删除意图接管，节点移除
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ ...CANCELLED }));
    await vi.waitFor(() =>
      expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(false),
      { timeout: 8_000 },
    );
  });

  it('删除等待终态期间任务抢先成功：轮询挂载作品并提示，节点保留', async () => {
    await renderPage();
    await clickDelete('d1');
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);

    // worker 竞态完成（轮询拿到 succeeded）：挂载作品，不因删除意图丢结果
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ ...SUCCEEDED }));
    await vi.waitFor(() => expect(dataOf('d1').src).toBe('http://img/out.png'), { timeout: 8_000 });
    await vi.waitFor(() => expect(container.textContent).toContain('任务已完成'), { timeout: 3_000 });
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(true);
  });

  it('删除确认移除后，迟到的轮询成功响应不得复活已删除节点', async () => {
    const resolvers: Array<(v: JobDetail) => void> = [];
    apiMocks.fetchJobStatus.mockImplementation(
      () => new Promise<JobDetail>((resolve) => { resolvers.push(resolve); }),
    );
    await renderPage();
    // resolvers[0] = 水合轮询首 tick（保持 pending 构造迟到）

    await clickDelete('d1');
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledTimes(1);
    // resolvers[1] = 删除流程的权威核对
    await vi.waitFor(() => expect(resolvers.length).toBeGreaterThanOrEqual(2));
    await act(async () => { resolvers[1]({ ...CANCELLED }); });
    await vi.waitFor(() => expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(false));

    // 迟到的轮询响应（任务实际已成功）：不得重建节点
    await act(async () => { resolvers[0]({ ...SUCCEEDED }); });
    await new Promise((r) => setTimeout(r, 30));
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(false);
  });

  it('删除请求在途时重复删除：只发一次取消请求', async () => {
    let resolveCancel: () => void = () => {};
    apiMocks.cancelGenerationJob.mockImplementationOnce(
      () => new Promise<null>((resolve) => { resolveCancel = () => resolve(null); }),
    );
    await renderPage();

    await clickDelete('d1');
    await clickDelete('d1');

    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledTimes(1);
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ ...CANCELLED }));
    await act(async () => { resolveCancel(); });
    await vi.waitFor(() => expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(false));
  });

  it('键盘删除入口（onDeleteNode）对生成中卡片同样先取消后移除', async () => {
    await renderPage();
    apiMocks.fetchJobStatus.mockImplementation(async () => {
      const calls = apiMocks.fetchJobStatus.mock.calls.length;
      return calls <= 1 ? { ...PROCESSING } : { ...CANCELLED };
    });

    await act(async () => { flowProps.current.onDeleteNode('d1'); });

    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'd1')).toBe(false));
  });
});

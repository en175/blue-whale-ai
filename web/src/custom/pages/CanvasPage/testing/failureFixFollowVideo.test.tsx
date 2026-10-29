// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { clickSelectOption } from './radixSelect';
import type { QuoteJobPayload } from '@/custom/api/generationQuote';
import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import type { JobDetail } from '@/custom/api/jobs';
import { ApiError } from '@/shared/api/http';


vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn((_projectId: string, payload: QuoteJobPayload) => ({
    queryKey: ['generation-quote', payload],
    staleTime: Infinity,
    queryFn: async () => ({ credits: payload.parameters.mode === 'edit' ? 320 : 160, quote_revision: 'current-quote' }),
  })),
}));

const recoveryMock = vi.hoisted(() => ({ records: [] as GenerationRecoveryRecord[] }));

vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ records: recoveryMock.records, next_cursor: null, protocol_version: 1, canvas_version: null }),
  })),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: recoveryMock.records,
    next_cursor: null,
  })),
}));
vi.mock('../components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, unknown> } = { current: {} };
vi.mock('../components/Canvas', () => ({
  default: (props: Record<string, unknown>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
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
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  saveCanvasDoc: vi.fn(async (_projectId: string, _payload: { nodes: Node[]; edges: unknown[] }) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _body: Record<string, unknown>, _key: string) => ({ generation_job_id: 'j8', cursor: 1 })),
  fetchJobStatus: vi.fn(async (): Promise<JobDetail> => ({
    job_id: 'j9',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a9', url: 'http://img/out.mp4', type: 'video', width: 720, height: 1280 },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => [
    {
      model_id: 'm-video',
      provider_id: 'prov',
      model_label: '测试生视频模型',
      icon: null,
      supported_sizes: [{ id: '1080p', label: '1080p' }],
      supported_aspect_ratios: [{ id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }, { id: 'adaptive', label: 'adaptive' }],
      supported_formats: [],
      supported_durations: { min: 4, max: 30, step: 1 },
      default_size: '1080p',
      default_format: null,
      default_aspect_ratio: 'adaptive',
      default_duration: 5,
      features: {
        video_reference: true, video_reference_max: 3,
        reference_image: true, image_reference_max: 10,
        first_frame: true, last_frame: true, first_last_frame: true,
        task_types: {
          text2video: {}, omni: {}, image_reference: {}, first_frame: {}, first_last_frame: {},
          edit: { allowed_ratios: ['adaptive'], allowed_durations: [-1] },
          extend: { allowed_ratios: ['adaptive'], allow_auto_duration: true },
        },
      },
      version: 1,
      digest: '',
    },
  ]),
}));

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  fetchProjectSnapshot: vi.fn(async () => {
    const doc = canvasDocMock.current.doc as { version: number; viewport: unknown; nodes: Node[]; edges: unknown[] };
    return {
      canvas: { version: doc.version, viewport: JSON.stringify(doc.viewport), nodes: JSON.stringify(doc.nodes), edges: JSON.stringify(doc.edges) },
      assets: canvasDocMock.current.assets,
      generation_jobs: [{ job_id: 'j1', status: 'failed', error: { code: 1011, reason: 'provider_failed', message: '生成服务响应异常' } }],
    };
  }),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
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
  applyPromptPreview: vi.fn(),
  createConversationQuote: vi.fn(),
  readCanvasConflictVersion: () => undefined,
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
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
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


function seedFixDoc(errorCode: number | string) {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 0, y: 0 },
          data: {
            src: '',
            mediaType: 'video',
            fileName: '视频生成中',
            genStatus: 'failed',
            draft: true,
            jobId: 'j1',
            errorText: '视频模式、比例或时长不符合要求，请重新编辑并确认视频模式、比例和时长后再提交',
            errorCode,
            prompt: '把背景替换成海边沙滩',
            draftModelId: 'm-video',
            draftSize: '1080p',
            draftRatio: '9:16',
            draftDuration: 5,
            draftGenerateAudio: false,
            draftMode: 'omni',
          },
        },
        {
          id: 'ref1',
          type: 'mediaNode',
          position: { x: -360, y: 0 },
          data: {
            src: 'http://img/ref1.mp4',
            mediaType: 'video',
            fileName: '竖屏参考视频.mp4',
            assetId: '8046',
            duration: 11,
          },
        },
        {
          id: 'ref3', type: 'mediaNode', position: { x: -360, y: 640 },
          data: { src: 'http://img/ref3.png', mediaType: 'image', fileName: '人物图.png', assetId: '8044' },
        },
        {
          id: 'ref2',
          type: 'mediaNode',
          position: { x: -360, y: 320 },
          data: {
            src: 'http://img/ref2.png',
            mediaType: 'image',
            fileName: '商品图.png',
            assetId: '8045',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'ref1', target: 'v1', data: { refRole: 'reference' } },
        { id: 'e2', source: 'ref2', target: 'v1', data: { refRole: 'reference' } },
        { id: 'e3', source: 'ref3', target: 'v1', data: { refRole: 'reference' } },
      ],
    },
    assets: {
      8046: { asset_id: 8046, type: 'video', access_url: 'http://img/ref1.mp4', width: 720, height: 1280 },
      8044: { asset_id: 8044, type: 'image', access_url: 'http://img/ref3.png', width: 800, height: 800 },
      8045: { asset_id: 8045, type: 'image', access_url: 'http://img/ref2.png', width: 800, height: 800 },
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

function nodeOf(id: string): Node {
  return (flowProps.current.mediaNodes as Node[]).find((n: Node) => n.id === id)!;
}

async function clickFixFollow(id: string) {
  await act(async () => {
    const onFixFollowVideo = (nodeOf(id).data as Record<string, unknown>).onFixFollowVideo as (id: string) => void;
    onFixFollowVideo(id);
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedFixDoc(1060);
  recoveryMock.records = [];
  apiMocks.fetchJobStatus.mockReset().mockResolvedValue({
    job_id: 'j9', status: 'succeeded', progress: 100,
    asset: { id: 'a9', url: 'http://img/out.mp4', type: 'video', width: 720, height: 1280 },
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKNB99 参数错误重新编辑与主动提交', () => {
  it('IKNB99 参数错误打开原卡编辑面板，不改比例或自动创建任务', async () => {
    await renderPage();
    const original = JSON.parse(JSON.stringify(nodeOf('v1')));
    const originalEdges = JSON.parse(JSON.stringify(flowProps.current.edges));

    await clickFixFollow('v1');

    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(container.textContent).toContain('全能参考'));
    expect(nodeOf('v1').position).toEqual(original.position);
    expect(nodeOf('v1').data).toMatchObject({
      genStatus: 'failed', jobId: 'j1', prompt: '把背景替换成海边沙滩',
      draftRatio: '9:16', draftDuration: 5, draftMode: 'omni',
    });
    expect(flowProps.current.edges).toEqual(originalEdges);
    expect(flowProps.current.mediaNodes).toHaveLength(4);
  });

  it('worker 字符串参数错误码同样打开编辑面板', async () => {
    seedFixDoc('task_type_param_constraint');
    await renderPage();

    await clickFixFollow('v1');

    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(container.textContent).toContain('全能参考'));
    expect(nodeOf('v1').data.draftRatio).toBe('9:16');
  });

  it('其他错误码（如 quota_exhausted=1001）→ 不识别不重交', async () => {
    seedFixDoc(1001);
    await renderPage();

    await clickFixFollow('v1');

    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
  });

  it.each<[string, number | string, string, string?, boolean?]>([
    ['provider_failed', 1060, '请重新编辑视频模式、比例和时长'],
    ['task_type_param_constraint', 1060, '请重新编辑视频模式、比例和时长'],
    ['content_rejected', 'content_rejected', '新的服务端错误'],
    ['permission_denied', 'permission_denied', '新的服务端错误'],
    ['model_unavailable', 'model_unavailable', '新的服务端错误'],
    ['provider_failed', 'provider_failed', '新的服务端错误', 'new-job'],
    ['provider_failed', 1060, '请重新编辑视频模式、比例和时长', 'j1', false],
  ])('旧任务重试被拒后保存重载，服务端 %s 按错误含义恢复', async (serverCode, expectedCode, expectedText, serverJobId = 'j1', withBindingMarker = true) => {
    seedFixDoc('provider_failed');
    const node = (canvasDocMock.current.doc as { nodes: Node[] }).nodes[0];
    node.data.draftRatio = 'adaptive';
    if (withBindingMarker) {
      node.data.generationRecovery = { protocolVersion: 1, submissionId: 'old-submission', outputKey: '$target' };
    }
    apiMocks.retryGenerationJob.mockRejectedValueOnce(new ApiError(400, '请重新编辑视频模式、比例和时长', 1060, null));
    await renderPage();
    await act(async () => {
      (nodeOf('v1').data.onRetryJob as (id: string) => void)('v1');
    });
    await vi.waitFor(() => expect(nodeOf('v1').data.errorCode).toBe(1060));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled(), { timeout: 3000 });
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    const savedNodes = JSON.parse(JSON.stringify(saved.nodes)) as Node[];
    expect(savedNodes.find((item) => item.id === 'v1')!.data.errorCode).toBe(1060);
    await act(async () => root.unmount());
    container.remove();
    canvasDocMock.current.doc = { ...(canvasDocMock.current.doc as object), nodes: savedNodes, edges: saved.edges, version: 4 };
    recoveryMock.records = [{
      submission_id: 'old-submission', target_node_id: 'v1', job_id: serverJobId, task_type: 'video',
      binding_revision: 1, is_current: true,
      job: { job_id: serverJobId, type: 'video', status: 'failed', progress: 0, output_asset_ids: [],
        stored_error: { code: serverCode, message: '新的服务端错误' }, created_at: '2026-09-29T00:00:00Z' },
      recovery_seed: null, previous_target_snapshot: null,
      items: [{ recovery_item_id: 'old-item', output_key: '$target', node_id: 'v1', state: 'present',
        revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
    }];
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: serverJobId, status: 'failed', progress: 0, asset: null,
      error: { code: serverCode, msg: '新的服务端错误' },
    });
    await renderPage();
    await vi.waitFor(() => expect(nodeOf('v1').data.errorCode).toBe(expectedCode));
    await clickFixFollow('v1');
    if (expectedCode === 1060) {
      await vi.waitFor(() => expect(container.textContent).toContain('全能参考'));
    } else {
      expect(container.querySelector('[data-testid="video-send"]')).toBeNull();
    }
    expect(nodeOf('v1').data.errorText).toBe(expectedText);
    expect(nodeOf('v1').data.jobId).toBe(serverJobId);
    expect(flowProps.current.edges).toEqual(saved.edges);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('用户确认视频编辑和跟随原视频时长，看到新报价后主动发送', async () => {
    await renderPage();
    await clickFixFollow('v1');
    await vi.waitFor(() => expect(container.textContent).toContain('本次预计消耗 160 积分'));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    await act(async () => {
      [...container.querySelectorAll('button')].find((button) => button.textContent === '全能参考')!.click();
    });
    await clickSelectOption('视频编辑');
    await vi.waitFor(() => expect(container.textContent).toContain('跟随原视频时长'));
    await vi.waitFor(() => expect(container.textContent).toContain('本次预计消耗 320 积分'));
    expect(nodeOf('v1').data).toMatchObject({ draftMode: 'edit', draftDuration: -1, draftRatio: 'adaptive' });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="video-send"]')!.click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const payload = apiMocks.createGenerationJob.mock.calls[0][1];
    expect(payload).toMatchObject({
      type: 'video', target_node_id: 'v1',
      parameters: { mode: 'edit', duration: -1, aspect_ratio: 'adaptive', prompt: '把背景替换成海边沙滩' },
      references: [
        { type: 'video', asset_id: '8046', duration: 11, role: 'reference' },
        { type: 'image', asset_id: '8045', role: 'reference' },
        { type: 'image', asset_id: '8044', role: 'reference' },
      ],
    });
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
  });
});

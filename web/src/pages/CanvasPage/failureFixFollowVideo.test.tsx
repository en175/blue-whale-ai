// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';

/* IKJ79D 失败卡片「改为跟随视频并重试」一键修复（父单 IKJ6DK）：
   画布视频失败卡按 task_type_param_constraint 错误码（数值 1060 / 字符串信封同码）识别，
   点击后仅把比例改为 adaptive（Auto）重交——提示词/素材/时长原样，走 create 新任务
   （retry 沿用冻结快照改不了比例，不可用）；原卡原位承接。
   前端零关键词判定副本（识别只认码，不认文案）。FlowCanvas 等打桩透出 props；
   视频模型 mock 带全比例 + 视频参考能力位。 */

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, unknown> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, unknown>) => {
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
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _body: Record<string, unknown>, _key: string) => ({ generation_job_id: 'j8', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
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
      supported_aspect_ratios: ['16:9', '9:16', 'adaptive'],
      supported_formats: [],
      supported_durations: { min: 4, max: 30, step: 1 },
      default_size: '1080p',
      default_format: null,
      default_aspect_ratio: 'adaptive',
      default_duration: 5,
      features: { video_reference: true },
      version: 1,
      digest: '',
    },
  ]),
}));

vi.mock('@/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('@/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
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
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
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

/** 默认画布：失败视频草稿卡 v1（编辑意图 + 手选 9:16 被比例约束码拒单，参数与参考保留）
 *  + 9:16 参考视频卡 ref1（经 reference 边连入）+ 普通素材卡 ref2（图片参考）。
 *  errorCode 走数值信封 1060（rebase 前为 1056，撞 IKIZQ5/IKJ8J8 已落号改取）；字符串信封形态由用例覆盖。 */
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
            errorText: '提示词包含修改、替换或延长原视频的意图，输出比例将自动跟随参考视频，请将比例切换为「自动」后重试',
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
            assetId: 'a77',
            duration: 9,
          },
        },
        {
          id: 'ref2',
          type: 'mediaNode',
          position: { x: -360, y: 320 },
          data: {
            src: 'http://img/ref2.png',
            mediaType: 'image',
            fileName: '商品图.png',
            assetId: 'a78',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'ref1', target: 'v1', data: { refRole: 'reference' } },
        { id: 'e2', source: 'ref2', target: 'v1', data: { refRole: 'reference' } },
      ],
    },
    assets: {
      a77: { asset_id: 77, type: 'video', access_url: 'http://img/ref1.mp4', width: 720, height: 1280 },
      a78: { asset_id: 78, type: 'image', access_url: 'http://img/ref2.png', width: 800, height: 800 },
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

/** 触发失败卡「改为跟随视频并重试」（MediaNode 失败角标按钮的真实回调，经 attachCallbacks 注入） */
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
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKJ79D 一键修复：按码识别 + 仅改比例重交', () => {
  it('数值码 1060 → 点按钮走 create 新任务：比例=adaptive，提示词/分辨率/时长/带音频/参考原样', async () => {
    await renderPage();

    await clickFixFollow('v1');

    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    const payload = apiMocks.createGenerationJob.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.type).toBe('video');
    expect(payload.target_node_id).toBe('v1');
    // 唯一被改的参数：比例 → adaptive（Auto）
    expect(payload.parameters).toMatchObject({
      prompt: '把背景替换成海边沙滩',
      model_id: 'm-video',
      aspect_ratio: 'adaptive',
      resolution: '1080p',
      duration: 5,
      generate_audio: false,
    });
    // 素材不动：两路参考原样（视频参考带时长）
    expect(payload.references).toEqual([
      { role: 'reference', type: 'video', asset_id: 'a77', duration: 9 },
      { role: 'reference', type: 'image', asset_id: 'a78' },
    ]);
    // 原卡原位承接成功，节点数不变
    await vi.waitFor(() => expect(nodeOf('v1').data.src).toBe('http://img/out.mp4'));
    expect(flowProps.current.mediaNodes).toHaveLength(3);
  });

  it('worker 归类信封（字符串 task_type_param_constraint）同码同动作', async () => {
    seedFixDoc('task_type_param_constraint');
    await renderPage();

    await clickFixFollow('v1');

    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
    const payload = apiMocks.createGenerationJob.mock.calls[0][1] as Record<string, unknown>;
    expect((payload.parameters as Record<string, unknown>).aspect_ratio).toBe('adaptive');
  });

  it('其他错误码（如 quota_exhausted=1001）→ 不识别不重交', async () => {
    seedFixDoc(1001);
    await renderPage();

    await clickFixFollow('v1');

    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
  });

  it('修复后卡上比例同步改 Auto：draftRatio 落 adaptive，重开面板即显示修复后比例', async () => {
    await renderPage();

    await clickFixFollow('v1');

    await vi.waitFor(() => expect(nodeOf('v1').data.draftRatio).toBe('adaptive'));
    await vi.waitFor(() => expect(nodeOf('v1').data.src).toBe('http://img/out.mp4'));
  });
});

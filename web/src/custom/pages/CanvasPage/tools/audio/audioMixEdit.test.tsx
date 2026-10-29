// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { AUDIO_MIX_EDGE_ORIGIN } from './audioMix';
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

type FlowProps = { mediaNodes: Node[]; edges: Array<{ source: string; target: string; data?: Record<string, unknown> }>; onDeleteNode?: (ids: string[]) => void; onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void; onNodeDragStop?: (node: Node, nodes: Node[]) => void };
const flowProps: { current: FlowProps } = { current: { mediaNodes: [], edges: [] } };
vi.mock('../../components/Canvas/index', () => ({
  default: (props: FlowProps) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../../components/CanvasToolbar/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('../../components/CanvasHeader/index', () => ({
  default: ({ currentProjectId, onSelectProject }: { currentProjectId: string; onSelectProject: (id: string) => void }) =>
    createElement('button', { 'data-testid': 'switch-p2', onClick: () => onSelectProject('p2') }, currentProjectId),
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
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createAudioMix: vi.fn(),
  newIdempotencyKey: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
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
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
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
  createAudioMix: apiMocks.createAudioMix,
  newIdempotencyKey: apiMocks.newIdempotencyKey,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));
vi.mock('@/custom/utils/upload', () => ({ uploadAssetFile: apiMocks.uploadAssetFile }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('../../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'a1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://aud/a1.mp3',
            mediaType: 'audio',
            fileName: '播客片头.mp3',
            assetId: '8',
            duration: 15,
            mime: 'audio/mpeg',
          },
        },
        {
          id: 'a2',
          type: 'mediaNode',
          position: { x: 1000, y: 0 },
          data: {
            src: 'http://aud/a2.mp3',
            mediaType: 'audio',
            fileName: '背景乐.mp3',
            assetId: '6',
            duration: 30,
            mime: 'audio/mpeg',
          },
        },
      ],
      edges: [],
    },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 },
      6: { asset_id: 6, type: 'audio', access_url: 'http://aud/a2.mp3', duration: 30 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;
let navigateTo: ReturnType<typeof useNavigate>;

function NavigationProbe() {
  navigateTo = useNavigate();
  return null;
}

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(MemoryRouter, null, createElement(NavigationProbe), createElement(CanvasPage)),
      ),
    );
  });
}

async function enterMix() {
  const audio = flowProps.current.mediaNodes.find((n: Node) => n.id === 'a1')!;
  await act(async () => {
    (audio.data.onMixAudio as (id: string) => void)('a1');
  });
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="audio-mix-send-bar"]');
}

async function sendMix() {
  await click('audio-mix-send');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function nodeById(id: string): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id);
}

function mixCardByJobId(jobId: string): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find(
    (n) => n.id.startsWith('audio-mix-') && String(n.data?.jobId) === jobId,
  );
}

function mixCreatePayload(overrides: Record<string, unknown> = {}) {
  return {
    canvas_binding: expect.objectContaining({
      protocol_version: 1,
      submission_id: expect.any(String),
      target_node_id: expect.stringMatching(/^audio-mix-/),
      expected_binding_revision: 0,
      recovery_seed: expect.anything(),
    }),
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createAudioMix.mockReset();
  let keySequence = 0;
  apiMocks.newIdempotencyKey.mockImplementation(() => `mix-key-${++keySequence}`);
  apiMocks.saveCanvasDoc.mockReset();
  apiMocks.saveCanvasDoc.mockResolvedValue({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });
  apiMocks.fetchProjects.mockResolvedValue([{ id: 'p1', name: '项目一' }, { id: 'p2', name: '项目二' }]);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKI68W 画布双音频混合', () => {
  it('关闭与 Esc 丢弃未发送选择，重进恢复默认 MP3', async () => {
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    await click('audio-mix-format-trigger');
    await click('audio-mix-format-wav');
    await click('audio-mix-close');
    expect(sendBar()).toBeNull();
    await enterMix();
    expect(bodyBtn('audio-mix-send').disabled).toBe(true);
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('mp3');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(sendBar()).toBeNull();
    expect(apiMocks.createAudioMix).not.toHaveBeenCalled();
    expect(flowProps.current.edges).toEqual([]);
  });

  it('单源禁发送；选择第二张不同资产后，POST 被接受才创建占位卡与两条持久来源边', async () => {
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterMix();
    expect(bodyBtn('audio-mix-send').disabled).toBe(true);
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    expect(bodyBtn('audio-mix-send').disabled).toBe(false);
    await sendMix();
    expect(apiMocks.createAudioMix).toHaveBeenCalledWith('p1', mixCreatePayload({
      source_node_id: 'a1',
      inputs: [{ asset_id: '8', node_id: 'a1' }, { asset_id: '6', node_id: 'a2' }],
      output_format: 'mp3',
    }), { silent: true, idempotencyKey: expect.any(String) });
    const placeholder = mixCardByJobId('j1')!;
    expect(placeholder.data).toMatchObject({ fileName: '混合结果.mp3', genStatus: 'generating', src: '' });
    expect(placeholder.position.y).toBeGreaterThan(0);
    const lines = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>).filter(e => e.target === placeholder.id);
    expect(lines.map(e => [e.source, e.data?.origin])).toEqual([['a1', AUDIO_MIX_EDGE_ORIGIN], ['a2', AUDIO_MIX_EDGE_ORIGIN]]);
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.id.startsWith('audio-mix-'))).toHaveLength(1);
  });

  it('创建拒绝保持编辑和选择，不留下卡与来源线', async () => {
    apiMocks.createAudioMix.mockRejectedValue(new Error('create rejected'));
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    await sendMix();
    expect(sendBar()).not.toBeNull();
    expect(bodyBtn('audio-mix-send').disabled).toBe(false);
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.id.startsWith('audio-mix-'))).toEqual([]);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('创建请求超时后重发复用幂等键，修改格式后换键', async () => {
    apiMocks.createAudioMix.mockRejectedValue(new Error('请求超时'));
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    await sendMix();
    await sendMix();
    await click('audio-mix-format-trigger');
    await click('audio-mix-format-wav');
    await sendMix();

    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(3);
    const attempts = apiMocks.createAudioMix.mock.calls as Array<[string, unknown, { idempotencyKey: string }]>;
    expect(attempts[0]?.[2].idempotencyKey).toMatch(/^[!-~]{1,128}$/);
    expect(attempts[1]?.[2].idempotencyKey).toBe(attempts[0]?.[2].idempotencyKey);
    expect(attempts[2]?.[2].idempotencyKey).not.toBe(attempts[0]?.[2].idempotencyKey);
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.id.startsWith('audio-mix-'))).toEqual([]);
  });

  it('上一次创建已受理后，相同选择可发起新的混合任务', async () => {
    apiMocks.createAudioMix
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockImplementation(async (jobId: string) => ({
      job_id: jobId, status: 'processing', progress: 1, asset: null,
    }));
    await renderPage();
    for (const _ of [1, 2]) {
      await enterMix();
      await click('audio-mix-add');
      await click('audio-mix-candidate-a2');
      await sendMix();
    }
    const attempts = apiMocks.createAudioMix.mock.calls as Array<[string, unknown, { idempotencyKey: string }]>;
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.[2].idempotencyKey).not.toBe(attempts[0]?.[2].idempotencyKey);
    expect(mixCardByJobId('j1')).toBeDefined();
    expect(mixCardByJobId('j2')).toBeDefined();
  });

  it('创建请求及结果卡落盘期间禁止切换项目', async () => {
    let resolveCreate!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioMix.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    await click('audio-mix-send');
    await click('switch-p2');
    expect(bodyBtn('switch-p2').textContent).toBe('p1');
    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(1);
    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    expect(mixCardByJobId('j1')).toBeDefined();
    expect(bodyBtn('switch-p2').textContent).toBe('p1');
  });

  it('服务端已受理但结果卡尚未保存时仍禁止切换项目', async () => {
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    let resolveSave!: (value: { id: number; project_id: number; version: number; viewport: string; nodes: string }) => void;
    apiMocks.saveCanvasDoc.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    await click('audio-mix-send');
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled());
    expect(mixCardByJobId('j1')).toBeDefined();
    await click('switch-p2');
    expect(bodyBtn('switch-p2').textContent).toBe('p1');
    await act(async () => { resolveSave({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }); });
  });

  it('切换保存先开始、混合发送后开始时仍保留原项目并落盘结果卡', async () => {
    let resolveSwitchSave!: (value: { id: number; project_id: number; version: number; viewport: string; nodes: string }) => void;
    let resolveCreate!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioMix.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    const movedA1 = { ...flowProps.current.mediaNodes.find((n) => n.id === 'a1')!, position: { x: 460, y: 0 } };
    await act(async () => { flowProps.current.onNodeDragStop?.(movedA1, [movedA1]); });
    apiMocks.saveCanvasDoc.mockClear();
    apiMocks.saveCanvasDoc.mockImplementationOnce(() => new Promise((resolve) => { resolveSwitchSave = resolve; }));
    await click('switch-p2');
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1));
    await click('audio-mix-send');
    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(1);
    await act(async () => { resolveSwitchSave({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }); });
    expect(bodyBtn('switch-p2').textContent).toBe('p1');
    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    expect(mixCardByJobId('j1')).toBeDefined();
    expect(bodyBtn('switch-p2').textContent).toBe('p1');
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc).toHaveBeenNthCalledWith(1, 'p1', expect.anything(), expect.anything());
  });

  it('请求期间地址栏跳到另一项目也不把结果卡写进另一画布', async () => {
    let resolveCreate!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioMix.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    await click('audio-mix-send');
    await act(async () => { navigateTo('/canvas?project=p2'); });
    expect(bodyBtn('switch-p2').textContent).toBe('p1');
    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    expect(mixCardByJobId('j1')).toBeDefined();
    expect(bodyBtn('switch-p2').textContent).toBe('p1');
  });

  it('请求期间删除来源节点后只给仍存活的节点建边，提交快照保持原样', async () => {
    let resolveCreate!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioMix.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    await click('audio-mix-send');
    await act(async () => { flowProps.current.onDeleteNode?.(['a2']); });
    expect(nodeById('a2')).toBeUndefined();
    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    expect(apiMocks.createAudioMix).toHaveBeenCalledWith('p1', expect.objectContaining({
      inputs: [{ asset_id: '8', node_id: 'a1' }, { asset_id: '6', node_id: 'a2' }],
    }), { silent: true, idempotencyKey: expect.any(String) });
    expect(mixCardByJobId('j1')).toBeDefined();
    expect(flowProps.current.edges.filter((edge) => edge.target === mixCardByJobId('j1')!.id).map((edge) => edge.source)).toEqual(['a1']);
  });

  it('成功沿用同卡并回填服务端权威时长', async () => {
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/mixed.mp3', type: 'audio', duration: 42.75 },
    });
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    await sendMix();
    expect(mixCardByJobId('j1')?.data).toMatchObject({
      fileName: '混合结果.mp3', src: 'http://tos/mixed.mp3', assetId: 'a88', duration: 42.75,
    });
    expect(nodeById('a1')?.data.assetId).toBe('8');
    expect(nodeById('a2')?.data.assetId).toBe('6');
  });
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaNode from './components/MediaNode';
import { AUDIO_VIDEO_MUX_EDGE_ORIGIN, AUDIO_VIDEO_MUX_TITLE } from './audioVideoMux';
import {
  apiMocks, canvasDocMock, flowProps, mediaNodes, renderPage, unmountPage,
} from './testing/canvasPageTestHarness';

const recoveryPageMock = vi.hoisted(() => ({ current: null as null | { records: unknown[] } }));
vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('@/api/canvasRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/canvasRecovery')>();
  const fetchPage = vi.fn(async (_projectId: string, _options?: { limit?: number; cursor?: string | null }) => recoveryPageMock.current ?? {
    protocol_version: 1, canvas_version: null, records: [], next_cursor: null,
  });
  return {
    ...actual,
    fetchGenerationRecoveryPage: fetchPage,
    generationRecoveryPageOptions: (projectId: string, options: { limit?: number; cursor?: string | null } = {}) => ({
      ...actual.generationRecoveryPageOptions(projectId, options),
      queryFn: () => fetchPage(projectId, options),
    }),
    resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
  };
});

const identity = {
  sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: false, sync: 'video',
  video: { assetId: '5', nodeId: 'v1', name: '城市夜景.mp4', duration: 12, width: 1280, height: 720 },
};

function seedDoc(m1?: { genStatus?: string; jobId?: string; keepIdentity?: boolean }) {
  const nodes: Array<Record<string, unknown>> = [
    { id: 'a1', type: 'mediaNode', position: { x: 0, y: 0 },
      data: { src: 'http://aud/a1.mp3', mediaType: 'audio', fileName: '海浪环境音.mp3', duration: 227, assetId: '8' } },
    { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 },
      data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '城市夜景.mp4', assetId: '5', width: 1280, height: 720, duration: 12 } },
  ];
  const edges: Array<Record<string, unknown>> = [];
  if (m1) {
    nodes.push({
      id: 'm1', type: 'mediaNode', position: { x: 1040, y: 0 },
      data: {
        src: '', mediaType: 'video', fileName: AUDIO_VIDEO_MUX_TITLE, draft: true,
        ...(m1.genStatus != null ? { genStatus: m1.genStatus } : {}),
        ...(m1.jobId != null ? { jobId: m1.jobId } : {}),
        ...(m1.keepIdentity === false ? {} : { audioVideoMux: identity }),
      },
    });
    edges.push({ id: 'e-mux-audio', source: 'a1', target: 'm1', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } });
    edges.push({ id: 'e-mux-bind', source: 'v1', target: 'm1', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } });
  }
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 227 },
      5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
    },
    refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
  };
}

const dataOf = (id: string) => (mediaNodes().find((n) => n.id === id)?.data ?? {}) as Record<string, unknown>;
const flush = (ms = 50) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const click = (testId: string) => act(async () => {
  document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  recoveryPageMock.current = null;
  apiMocks.fetchJobs.mockResolvedValue({ records: [], total: 0, size: 20, current: 1 });
});
afterEach(async () => { await unmountPage(); vi.clearAllMocks(); });

describe('IKJJR4 合成任务：刷新恢复', () => {
  it('历史在卡任务经水合即时续轮询，成功在原卡回填（命名回落冻结视频身份、清合成身份）', async () => {
    seedDoc({ genStatus: 'generating', jobId: '79' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '79', status: 'succeeded', progress: 100,
      asset: { id: '88', url: 'http://vid/out.mp4', type: 'video' },
    });
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('79'));
    await flush(30);
    expect(dataOf('m1')).toMatchObject({
      genStatus: undefined, src: 'http://vid/out.mp4', assetId: '88',
      fileName: '城市夜景(音视频合成).mp4', width: 1280, height: 720, duration: 12,
    });
    expect(dataOf('m1').audioVideoMux).toBeUndefined();
  });

  it('受理回执丢失的新协议任务经恢复扫描补卡：合成身份随原目标快照恢复（视频型、生成中、jobId 续上）', async () => {
    seedDoc();
    recoveryPageMock.current = {
      records: [{
        submission_id: '11111111-1111-4111-8111-111111111111',
        target_node_id: 'm1',
        job_id: '79', task_type: 'audio_video_mux', binding_revision: 1, is_current: true,
        job: { job_id: '79', type: 'audio_video_mux', status: 'processing', progress: 30, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        recovery_seed: { target: { role: 'draft', x: 1040, y: 0, width: 320, height: 320, name: AUDIO_VIDEO_MUX_TITLE }, sources: [] },
        previous_target_snapshot: {
          id: 'm1', type: 'mediaNode', position: { x: 1040, y: 0 }, width: 320, height: 180,
          data: { audioVideoMux: identity },
        },
        items: [],
      }],
    };
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '79', status: 'processing', progress: 30, asset: null });
    await renderPage();
    await vi.waitFor(() => expect(mediaNodes().some((node) => node.id === 'm1')).toBe(true));
    expect(dataOf('m1')).toMatchObject({
      mediaType: 'video', genStatus: 'generating', jobId: '79', fileName: AUDIO_VIDEO_MUX_TITLE,
    });
    expect(dataOf('m1').audioVideoMux).toEqual(identity);
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled());
  });

  it('已产出成品卡（身份已清、无 genStatus）不进恢复轮询、不被覆盖', async () => {
    seedDoc({ jobId: '79', keepIdentity: false });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '79', status: 'succeeded', progress: 100, asset: null });
    await renderPage();
    await flush(80);
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('79');
    expect(mediaNodes().some((node) => node.id === 'm1')).toBe(true);
  });
});

describe('IKJJR4 合成任务：取消回退与再次生成（settleTarget 链路）', () => {
  it('取消确认后原草稿回待生成，同一草稿可再次生成（携承接绑定）', async () => {
    seedDoc({ genStatus: 'generating', jobId: '79' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: '79', status: 'processing', progress: 30, asset: null });
    apiMocks.cancelGenerationJob.mockResolvedValue(null);
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('79'));

    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '79', status: 'cancelled', progress: 30, asset: null });
    await act(async () => { (dataOf('m1').onCancelJob as (id: string) => void)('m1'); });
    await vi.waitFor(() => expect(dataOf('m1').genStatus).toBe('draft'));
    expect(dataOf('m1').audioVideoMux).toEqual(identity);
    expect(mediaNodes().some((node) => node.id === 'm1')).toBe(true);
    expect((flowProps.current.edges as Array<{ target: string }>).filter((edge) => edge.target === 'm1')).toHaveLength(2);

    apiMocks.createAudioVideoMux.mockResolvedValue({ job_id: '80', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '80', status: 'queued', progress: 0, asset: null });
    await act(async () => { flowProps.current.onNodeClick(mediaNodes().find((n) => n.id === 'm1')!); });
    await click('audio-video-mux-send');
    await flush();
    expect(apiMocks.createAudioVideoMux).toHaveBeenCalledTimes(1);
    expect(apiMocks.createAudioVideoMux.mock.calls[0]?.[1]).toMatchObject({
      is_audio_reserve: false, sync: 'video',
      canvas_binding: expect.objectContaining({
        protocol_version: 1,
        target_node_id: 'm1',
        recovery_seed: expect.objectContaining({ target: expect.objectContaining({ role: 'draft' }) }),
      }),
    });
    await vi.waitFor(() => expect(dataOf('m1')).toMatchObject({ genStatus: 'generating', jobId: '80' }));
  }, 8000);

  it('取消等待期间任务抢先成功：保留作品回填原卡（不回草稿）', async () => {
    seedDoc({ genStatus: 'generating', jobId: '79' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: '79', status: 'processing', progress: 30, asset: null });
    apiMocks.cancelGenerationJob.mockResolvedValue(null);
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('79'));
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: '79', status: 'succeeded', progress: 100,
      asset: { id: '88', url: 'http://vid/out.mp4', type: 'video', width: 1920, height: 1080, duration: 33 },
    });
    await act(async () => { (dataOf('m1').onCancelJob as (id: string) => void)('m1'); });
    await vi.waitFor(() => expect(dataOf('m1')).toMatchObject({ genStatus: undefined, src: 'http://vid/out.mp4', assetId: '88' }));
    expect(dataOf('m1').audioVideoMux).toBeUndefined();
  });

  it('重试进行中刷新：原卡原地按 jobId 续轮询（不复制卡、不改用虚拟卡 id）', async () => {
    seedDoc({ genStatus: 'generating', jobId: '79' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '79', status: 'processing', progress: 30, asset: null });
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('79'));
    await flush(30);
    expect(mediaNodes().filter((node) => node.id === 'm1')).toHaveLength(1);
    expect(mediaNodes().some((node) => node.id.startsWith('audio-video-mux-'))).toBe(false);
    const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(MediaNode, {
      ...mediaNodes().find((node) => node.id === 'm1')!, selected: false, dragging: false, zIndex: 1,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    } as never)));
    expect(html).not.toContain('mediaVideoPoster');
  });
});

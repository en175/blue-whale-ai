// @vitest-environment jsdom
/* IKIHP M 音视频合成刷新/重开恢复页面级链路测试（照 audioMixRecovery 先例）：
   任务列表驱动恢复——进行中而卡不在画布上的任务补视频型占位卡与冻结来源线（固定音频线 +
   视频绑定边，均为 origin=audio-video-mux 语义边）、卡在画布上的任务按任务态续轮询、
   终态任务补轮询由轮询回填成品；输入卡已删不复活不建悬空线；已产出成品卡不受影响。
   渲染沿用 testing/canvasPageTestHarness（页面级共享夹具）。 */
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRecord } from '@/api/jobs';
import MediaNode from './components/MediaNode';
import { AUDIO_VIDEO_MUX_EDGE_ORIGIN } from './audioVideoMux';
import {
  apiMocks, canvasDocMock, enableReactActEnvironment, flowProps, mediaNodes, navigateRef, renderPage, unmountPage,
} from './testing/canvasPageTestHarness';

const frozenInput = {
  audio: { assetId: '8', nodeId: 'a1', url: 'https://tos.example/a1.mp3' },
  video: { assetId: '5', nodeId: 'v1', url: 'https://tos.example/v1.mp4' },
  is_audio_reserve: true,
  sync: 'none',
};

function jobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    job_id: '73', type: 'audio_video_mux', status: 'queued', progress: 0,
    input: frozenInput, created_at: '2026-09-24T00:00:00Z', output_assets: [], error: null,
    ...overrides,
  };
}

const audioCard = {
  id: 'a1', type: 'mediaNode', position: { x: 0, y: 0 },
  data: { src: 'http://aud/a1.mp3', mediaType: 'audio', fileName: '海浪.mp3', assetId: '8' },
};
const videoCard = {
  id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 },
  data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '城市夜景.mp4', assetId: '5', width: 1280, height: 720 },
};

function seed(nodes: Array<Record<string, unknown>> = [audioCard, videoCard], edges: Array<Record<string, unknown>> = []) {
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges },
    assets: {}, refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
  };
}

const edges = () =>
  flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
const cardIds = () => mediaNodes().map((node) => node.id);
const muxCard = () => mediaNodes().find((node) => node.id === 'audio-video-mux-73');

function cardHtml(id: string): string {
  const card = mediaNodes().find((node) => node.id === id)!;
  return renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(MediaNode, {
    ...card, selected: false, dragging: false, zIndex: 1, selectable: true, deletable: true,
    draggable: true, isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
  } as never)));
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  apiMocks.fetchJobs.mockResolvedValue({ records: [], total: 0, size: 20, current: 1 });
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
});

describe('IKIHPM 刷新恢复：进行中任务补占位卡与冻结来源线', () => {
  it('受理后卡尚未落盘：补视频型占位卡 + 固定音频线与视频绑定边（origin=audio-video-mux）+ 续轮询 + 落盘', async () => {
    seed();
    apiMocks.fetchJobs.mockResolvedValue({ records: [jobRecord()], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    await vi.waitFor(() => expect(cardIds()).toContain('audio-video-mux-73'));

    const card = muxCard()!;
    const data = card.data as Record<string, unknown>;
    // 视频型占位卡、不可播放、记住合成身份（固定源 + 冻结参数 + 绑定视频）
    expect(data.mediaType).toBe('video');
    expect(data.genStatus).toBe('generating');
    expect(data.src).toBe('');
    expect(data.jobId).toBe('73');
    expect(data.audioVideoMux).toMatchObject({
      sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: true, sync: 'none',
      video: { assetId: '5', nodeId: 'v1', name: '城市夜景.mp4', width: 1280, height: 720 },
    });
    const html = cardHtml('audio-video-mux-73');
    expect(html).not.toContain('mediaVideoPoster');
    expect(html).not.toContain('取消生成');
    // 来源线按冻结输入补画：固定音频线 + 视频绑定边，均带专属 origin（参考推导/@ 编号按此跳过）
    expect(edges().map((edge) => [edge.source, edge.target, edge.data?.origin])).toEqual([
      ['a1', 'audio-video-mux-73', AUDIO_VIDEO_MUX_EDGE_ORIGIN],
      ['v1', 'audio-video-mux-73', AUDIO_VIDEO_MUX_EDGE_ORIGIN],
    ]);
    // 补的卡与来源线同一笔快照落盘（刷新不再补）
    await vi.waitFor(() => {
      const saves = apiMocks.saveCanvasDoc.mock.calls as unknown as Array<[string, { nodes: Array<{ id: string }> }]>;
      expect(saves.some(([, body]) => body.nodes.some((node) => node.id === 'audio-video-mux-73'))).toBe(true);
    });
    // 续轮询接管任务（恢复后仍能看到任务状态）
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('73'));
  });

  it('输入视频卡已删：只补固定音频线，不建悬空线、不复活已删输入卡', async () => {
    seed([audioCard]);
    apiMocks.fetchJobs.mockResolvedValue({ records: [jobRecord()], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    await vi.waitFor(() => expect(cardIds()).toContain('audio-video-mux-73'));

    expect(cardIds()).not.toContain('v1');
    expect(edges().map((edge) => edge.source)).toEqual(['a1']);
  });

  it('任务已终态而卡仍是生成中：恢复补轮询由轮询回填成品卡（命名与供应商尺寸）', async () => {
    seed([
      audioCard,
      videoCard,
      {
        id: 'audio-video-mux-73', type: 'mediaNode', position: { x: 1040, y: 0 },
        data: {
          src: '', mediaType: 'video', fileName: '音视频合成', genStatus: 'generating', jobId: '73',
          audioVideoMux: {
            sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: true, sync: 'none',
            video: { assetId: '5', nodeId: 'v1', name: '城市夜景.mp4', width: 1280, height: 720, duration: 12 },
          },
        },
      },
    ], [{ id: 'e1', source: 'a1', target: 'audio-video-mux-73', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } }]);
    apiMocks.fetchJobs.mockResolvedValue({ records: [jobRecord({ status: 'succeeded' })], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '73', status: 'succeeded', progress: 100,
      asset: { id: '88', url: 'http://vid/out.mp4', type: 'video' },
    });
    await renderPage();

    await vi.waitFor(() => {
      expect((muxCard()!.data as Record<string, unknown>).genStatus).toBeUndefined();
    });
    const data = muxCard()!.data as Record<string, unknown>;
    expect(data.src).toBe('http://vid/out.mp4');
    expect(data.fileName).toBe('城市夜景(音视频合成).mp4');
    expect(data.width).toBe(1280);
    expect(data.duration).toBe(12);
    expect(data.audioVideoMux).toBeUndefined();
    // 不复制卡、不新建来源线
    expect(cardIds()).toEqual(['a1', 'v1', 'audio-video-mux-73']);
    expect(edges().filter((edge) => edge.target === 'audio-video-mux-73')).toHaveLength(1);
  });

  it('已产出成品卡（身份已清）不参与恢复：不重建占位卡、不覆盖成品、不复制来源线', async () => {
    seed([
      audioCard,
      videoCard,
      {
        id: 'mux-card', type: 'mediaNode', position: { x: 1040, y: 0 },
        data: { src: 'http://vid/out.mp4', mediaType: 'video', fileName: '城市夜景(音视频合成).mp4', assetId: '88', jobId: '73' },
      },
    ], [
      { id: 'e1', source: 'a1', target: 'mux-card', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } },
      { id: 'e2', source: 'v1', target: 'mux-card', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } },
    ]);
    apiMocks.fetchJobs.mockResolvedValue({ records: [jobRecord({ status: 'succeeded' })], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '73', status: 'succeeded', progress: 100,
      asset: { id: '88', url: 'http://vid/out.mp4', type: 'video' },
    });
    await renderPage();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

    expect(cardIds()).toEqual(['a1', 'v1', 'mux-card']);
    expect((mediaNodes().find((node) => node.id === 'mux-card')!.data as Record<string, unknown>).src)
      .toBe('http://vid/out.mp4');
    expect(edges()).toHaveLength(2);
  });

  it('任务终态为失败且卡已被用户移除：不凭任务补卡（卡删除即取消任务）', async () => {
    seed([audioCard, videoCard]);
    apiMocks.fetchJobs.mockResolvedValue({ records: [jobRecord({ status: 'failed' })], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'failed', progress: 0, asset: null });
    await renderPage();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

    expect(cardIds()).toEqual(['a1', 'v1']);
    expect(edges()).toEqual([]);
  });
});

/* IKILVG 失败重试后原草稿卡刷新恢复：正常发送是草稿卡原地转生成中、卡 id 与任务号无关，
   已持久化的失败草稿卡（data.jobId 命中同一重试任务）刷新后必须按原卡 ID 轮询并在原卡
   显示生成中 / 成品 / 最新失败——不改用 audio-video-mux-${jobId} 虚拟卡 ID，也不补占位卡、
   不复制卡与来源线（卡 id/位置/冻结输入/语义边全部保留）。progress 取值区分来源：规划只写
   任务列表的 40，55 只能来自轮询响应——按原卡 ID 轮询的直接可见证据。 */
describe('IKILVG 失败重试后原草稿卡刷新恢复', () => {
  const failedDraftCard = {
    id: 'mux-draft-1', type: 'mediaNode', position: { x: 800, y: 0 },
    data: {
      src: '', mediaType: 'video', fileName: '音视频合成', genStatus: 'failed',
      jobId: '73', errorText: '上次失败：供应商超时',
      audioVideoMux: {
        sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: true, sync: 'none',
        video: { assetId: '5', nodeId: 'v1', name: '城市夜景.mp4', width: 1280, height: 720, duration: 12 },
      },
    },
  };
  const draftEdges = () => [
    { id: 'e1', source: 'a1', target: 'mux-draft-1', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } },
    { id: 'e2', source: 'v1', target: 'mux-draft-1', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } },
  ];
  const draftData = () => mediaNodes().find((node) => node.id === 'mux-draft-1')!.data as Record<string, unknown>;

  /** 项目二画布：一张就绪音频卡 b1——旧项目的迟到轮询响应不得往这里写任何东西 */
  function seedProjectB() {
    canvasDocMock.current = {
      doc: {
        id: 22, version: 7, viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{
          id: 'b1', type: 'mediaNode', position: { x: 100, y: 100 },
          data: { src: 'http://aud/b1.mp3', mediaType: 'audio', fileName: '项目二音频.mp3', assetId: '9', duration: 20 },
        }],
        edges: [],
      },
      assets: {}, refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
    };
  }

  it('重试进行中刷新：原卡原地转生成中并按原卡 ID 轮询，不补虚拟占位卡、不复制卡与来源线', async () => {
    seed([audioCard, videoCard, failedDraftCard], draftEdges());
    apiMocks.fetchJobs.mockResolvedValue({ records: [jobRecord({ status: 'processing', progress: 40 })], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'processing', progress: 55, asset: null });
    await renderPage();

    await vi.waitFor(() => expect(draftData().progress).toBe(55));
    expect(draftData().genStatus).toBe('generating');
    expect(draftData().errorText).toBeUndefined();
    // 卡名单不变：不补 audio-video-mux-73 占位卡、不复制草稿卡
    expect(cardIds()).toEqual(['a1', 'v1', 'mux-draft-1']);
    // 来源线保持原样（原卡 ID/位置/冻结输入/语义边不动，不复制不重建）
    expect(edges().map((edge) => `${edge.source}->${edge.target}`).sort())
      .toEqual(['a1->mux-draft-1', 'v1->mux-draft-1']);
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('73');
  });

  it('重试在刷新前已成功：原卡回填为可播放的视频成品，命名与尺寸回落冻结视频身份', async () => {
    seed([audioCard, videoCard, failedDraftCard], draftEdges());
    apiMocks.fetchJobs.mockResolvedValue({ records: [jobRecord({ status: 'succeeded', progress: 100 })], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '73', status: 'succeeded', progress: 100,
      asset: { id: '88', url: 'http://vid/out.mp4', type: 'video' },
    });
    await renderPage();

    await vi.waitFor(() => expect(draftData().genStatus).toBeUndefined());
    expect(draftData().src).toBe('http://vid/out.mp4');
    expect(draftData().fileName).toBe('城市夜景(音视频合成).mp4');
    expect(draftData().width).toBe(1280);
    expect(draftData().duration).toBe(12);
    expect(draftData().audioVideoMux).toBeUndefined();
    // 原卡原地回填：不新建卡、不复制来源线
    expect(cardIds()).toEqual(['a1', 'v1', 'mux-draft-1']);
    expect(edges().filter((edge) => edge.target === 'mux-draft-1')).toHaveLength(2);
  });

  it('重试进行中刷新后任务再次失败：原卡显示最新错误', async () => {
    seed([audioCard, videoCard, failedDraftCard], draftEdges());
    apiMocks.fetchJobs.mockResolvedValue({ records: [jobRecord({ status: 'processing', progress: 40 })], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '73', status: 'failed', progress: 0, asset: null, error: { msg: '重试后最新失败原因' },
    });
    await renderPage();

    await vi.waitFor(() => expect(draftData().errorText).toBe('重试后最新失败原因'));
    expect(draftData().genStatus).toBe('failed');
    expect(cardIds()).toEqual(['a1', 'v1', 'mux-draft-1']);
  });

  it('重试在刷新前已再次失败：原卡同步服务端最新失败文案，不重启轮询', async () => {
    seed([audioCard, videoCard, failedDraftCard], draftEdges());
    apiMocks.fetchJobs.mockResolvedValue({
      records: [jobRecord({ status: 'failed', error: { msg: '刷新前已失败的新原因' } })],
      total: 1, size: 100, current: 1,
    });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'failed', progress: 0, asset: null });
    await renderPage();

    await vi.waitFor(() => expect(draftData().errorText).toBe('刷新前已失败的新原因'));
    expect(draftData().genStatus).toBe('failed');
    expect(cardIds()).toEqual(['a1', 'v1', 'mux-draft-1']);
    // 终态已按任务列表同步，无需再拉任务详情
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
  });

  /* IKILVG 跨项目隔离（activeProjectRef / 画布节点双检口径）：恢复轮询已发出、响应在途时
     切项目，旧项目的迟到轮询响应只能丢弃——当前画布（项目二）没有原卡，回填 / 续链 /
     补卡任何一路都会把旧项目任务写进新画布。 */
  it('恢复轮询在途时切项目：旧项目迟到轮询响应不更新当前画布、不续链', async () => {
    // 任务列表按项目分流：p1 有进行中的重试任务 73，p2 无音视频合成任务
    apiMocks.fetchJobs.mockImplementation(async (params?: { projectId?: string }) =>
      params?.projectId === 'p1'
        ? { records: [jobRecord({ status: 'processing', progress: 40 })], total: 1, size: 100, current: 1 }
        : { records: [], total: 0, size: 100, current: 1 });
    // 首次轮询挂起：恢复 effect 已按原卡 ID 发出 fetchJobStatus('73')、响应尚未返回
    let resolveLate!: (value: { job_id: string; status: string; progress: number; asset: null }) => void;
    apiMocks.fetchJobStatus.mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve; }));
    seed([audioCard, videoCard, failedDraftCard], draftEdges());
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('73'));

    // 轮询在途时切到项目二（先进入加载态再交付新项目快照，同 audioSpeedRetryRecovery 手法）
    await act(async () => { canvasDocMock.current = { ...canvasDocMock.current, doc: null }; navigateRef!('/canvas?project=p2'); });
    await act(async () => { seedProjectB(); navigateRef!('/canvas?project=p2'); });

    // 旧项目的迟到轮询响应（processing 55）返回
    await act(async () => { resolveLate({ job_id: '73', status: 'processing', progress: 55, asset: null }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

    // 当前画布不被写入：不回填原卡、不补占位卡、不建来源线
    expect(cardIds()).toEqual(['b1']);
    expect(edges()).toEqual([]);
    // 迟到响应被丢弃后不续链：超过轮询周期（2500ms）后旧任务不再被轮询
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2700)); });
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledTimes(1);
  });
});

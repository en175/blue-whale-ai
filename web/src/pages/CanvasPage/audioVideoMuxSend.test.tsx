// @vitest-environment jsdom
/* IKIHP M 音视频合成提交、占位与终态回填页面级链路测试：草稿卡绑好视频后点发送——
   载荷与冻结快照契约恒等（audio/video/is_audio_reserve/sync）、受理即原地转生成中视频占位
   （不新建卡/线、面板关闭、工具条恢复、连点只发一次）；终态走通用回填分支（按产物资产
   类型翻 mediaType、命名「视频名(音视频合成).mp4」、时长分辨率取供应商值缺失回落源资产、
   清合成身份）；失败卡展示原因并接重试入口（原卡重新进入生成中，同键复用、双击一次）。
   创建未被接受（409/网络）留在面板、展示可读错误、不留假卡/假线。
   渲染沿用 testing/canvasPageTestHarness（页面级共享夹具）。 */
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import MediaNode from './components/MediaNode';

import { AUDIO_VIDEO_MUX_EDGE_ORIGIN, AUDIO_VIDEO_MUX_TITLE } from './audioVideoMux';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  mediaNodes,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';

vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ records: [], next_cursor: null, protocol_version: 1, canvas_version: null }),
  })),
}));

type WireState = {
  fromNode?: Node | null;
  toNode?: Node | null;
  isValid?: boolean | null;
  toHandle?: { nodeId?: string | null } | null;
};

/** 画布：音频成品卡 a1（固定源）+ 视频成品卡 v1（候选）；可选既绑好的合成草稿卡 m1 */
function seedDoc(opts?: { withDraft?: boolean; withBound?: boolean; videoDims?: boolean }) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'a1',
      type: 'mediaNode',
      position: { x: 0, y: 0 },
      data: {
        src: 'http://aud/a1.mp3',
        mediaType: 'audio',
        fileName: '海浪环境音.mp3',
        duration: 227,
        assetId: '8',
      },
    },
    {
      id: 'v1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: {
        src: 'http://vid/v1.mp4',
        mediaType: 'video',
        fileName: '城市夜景.mp4',
        assetId: '5',
        ...(opts?.videoDims === false ? {} : { width: 1280, height: 720, duration: 12 }),
      },
    },
  ];
  const edges: Array<Record<string, unknown>> = [];
  if (opts?.withDraft) {
    nodes.push({
      id: 'm1',
      type: 'mediaNode',
      position: { x: 1040, y: 0 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: AUDIO_VIDEO_MUX_TITLE,
        genStatus: 'draft',
        draft: true,
        audioVideoMux: {
          sourceNodeId: 'a1',
          sourceAssetId: '8',
          reserveAudio: false,
          sync: 'video',
          ...(opts?.withBound
            ? { video: { assetId: '5', nodeId: 'v1', name: '城市夜景.mp4', duration: 12, width: 1280, height: 720 } }
            : {}),
        },
      },
    });
    edges.push({ id: 'e-mux-audio', source: 'a1', target: 'm1', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } });
    if (opts?.withBound) {
      edges.push({ id: 'e-mux-bind', source: 'v1', target: 'm1', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } });
    }
  }
  canvasDocMock.current = {
    doc: {
      id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges,
    },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 227 },
      5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const muxCard = () => mediaNodes().find((n) => n.id.startsWith('media-draft') || n.id.startsWith('audio-video-mux'))!;
const dataOf = (id: string) => (mediaNode(id).data ?? {}) as Record<string, unknown>;
const edges = () =>
  flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
const panel = () => document.body.querySelector<HTMLElement>('[data-testid="audio-video-mux-panel"]');
const sendBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="audio-video-mux-send"]');

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 走音频卡工具条「音视频合成」（回调挂在节点 data 上，同 IKIHPK 口径） */
async function compose(id = 'a1') {
  await act(async () => {
    (dataOf(id).onComposeAudioVideo as (nodeId: string) => void)(id);
  });
}

/** 拖线绑定：从视频卡右侧加号拖出、松手落到草稿卡 */
async function dropWire(sourceId: string, targetId: string) {
  document.elementsFromPoint = () => [];
  await act(async () => {
    flowProps.current.onConnectStart(sourceId);
  });
  await act(async () => {
    flowProps.current.onConnectEnd(
      new MouseEvent('mouseup', { clientX: 0, clientY: 0 }),
      { fromNode: mediaNode(sourceId), toNode: mediaNode(targetId) } as WireState,
    );
  });
}

/** 会话期工具条整条不渲染的观测标记（soloToolbarHidden 注入 = 会话模态生效；
 *  发送退出会话后消失 = 工具条恢复，IKIHPK 同口径） */
function toolbarHiddenIds(): string[] {
  return mediaNodes()
    .filter((n) => (n.data as Record<string, unknown>).soloToolbarHidden === true)
    .map((n) => n.id);
}

/** 卡面静态渲染（可播放性/取消钮断言，同 audioMixRecovery 先例） */
function cardHtml(id: string): string {
  const card = mediaNode(id);
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

describe('IKIHPM 提交：载荷契约、占位卡与面板关闭', () => {
  it('发送调真实创建 API：载荷与冻结快照契约恒等，受理后原地转生成中占位卡、面板关闭、工具条恢复', async () => {
    seedDoc();
    apiMocks.createAudioVideoMux.mockResolvedValue({ job_id: '73', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    await compose();
    const draftId = muxCard().id;
    await dropWire('v1', draftId);
    // 会话期媒体卡工具条整条不渲染（IKIHPK 同口径的观测标记）
    expect(toolbarHiddenIds()).toEqual(mediaNodes().map((n) => n.id));

    await click(sendBtn());
    await flush();

    expect(apiMocks.createAudioVideoMux).toHaveBeenCalledTimes(1);
    expect(apiMocks.createAudioVideoMux.mock.calls[0]?.[0]).toBe('p1');
    // IKJJR4：载荷业务字段原样冻结，另携 canvas_binding（submission_id = 幂等键、
    // 目标 = 原草稿卡、角色 draft、来源线快照为固定音频 + 绑定视频）
    expect(apiMocks.createAudioVideoMux.mock.calls[0]?.[1]).toEqual({
      audio: { assetId: '8', nodeId: 'a1' },
      video: { assetId: '5', nodeId: 'v1' },
      is_audio_reserve: true,
      sync: 'none',
      canvas_binding: {
        protocol_version: 1,
        submission_id: expect.any(String),
        target_node_id: draftId,
        expected_binding_revision: 0,
        recovery_seed: {
          target: { role: 'draft', x: expect.any(Number), y: expect.any(Number), width: 320, height: 320, name: AUDIO_VIDEO_MUX_TITLE },
          sources: [
            { node_id: 'a1', x: 0, y: 0, width: 320, height: 320, name: '海浪环境音.mp3' },
            { node_id: 'v1', x: 400, y: 0, width: 1280, height: 720, name: '城市夜景.mp4' },
          ],
        },
      },
    });
    expect(apiMocks.createAudioVideoMux.mock.calls[0]?.[2]).toMatchObject({ silent: true });

    // 草稿卡原地转生成中占位：同一张卡、视频型、不可播放、记住合成身份
    const card = muxCard();
    expect(card.id).toBe(draftId);
    const data = card.data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.jobId).toBe('73');
    expect(data.src).toBe('');
    expect(data.mediaType).toBe('video');
    expect(data.audioVideoMux).toMatchObject({ sourceNodeId: 'a1', reserveAudio: true, sync: 'none' });
    const html = cardHtml(draftId);
    // 不可播放（无素材层）；画布工具卡不开放取消（族内口径）
    expect(html).not.toContain('mediaVideoPoster');
    expect(html).not.toContain('取消生成');
    // 不新建卡、不新建来源线（固定音频线 + 绑定线原样两条）
    expect(mediaNodes()).toHaveLength(3);
    expect(edges()).toHaveLength(2);
    // 面板关闭、工具条恢复
    expect(panel()).toBeNull();
    expect(toolbarHiddenIds()).toEqual([]);
    // IKIHMX 审查修复 1：源音频卡工具条「音视频合成」保留高亮（在途注入标记）
    expect(dataOf('a1').audioVideoMuxInFlight).toBe(true);
  });

  it('参数两档三档全组合随载荷冻结（替换原声 + 裁到音频长）', async () => {
    seedDoc({ withDraft: true, withBound: true });
    apiMocks.createAudioVideoMux.mockResolvedValue({ job_id: '74', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '74', status: 'queued', progress: 0, asset: null });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await click(document.body.querySelector('[data-testid="audio-video-mux-reserve-false"]'));
    expect(sendBtn()!.disabled).toBe(false);
    await click(sendBtn());
    await flush();

    expect(apiMocks.createAudioVideoMux.mock.calls[0]?.[1]).toMatchObject({
      audio: { assetId: '8', nodeId: 'a1' },
      video: { assetId: '5', nodeId: 'v1' },
      is_audio_reserve: false,
      sync: 'video',
      canvas_binding: expect.objectContaining({ target_node_id: 'm1' }),
    });
  });

  it('连点发送只发一次创建请求', async () => {
    seedDoc({ withDraft: true, withBound: true });
    let release!: (value: { job_id: string; status: 'queued'; enqueue_required: boolean }) => void;
    apiMocks.createAudioVideoMux.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '75', status: 'queued', progress: 0, asset: null });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await act(async () => {
      sendBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      sendBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(apiMocks.createAudioVideoMux).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ job_id: '75', status: 'queued', enqueue_required: true });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mediaNodes().filter((n) => n.id === 'm1')).toHaveLength(1);
    expect(edges()).toHaveLength(2);
  });

  it('创建请求未被接受（409）留在面板：展示可读错误、不建假卡不建假线、卡保持草稿可重发', async () => {
    seedDoc({ withDraft: true, withBound: true });
    apiMocks.createAudioVideoMux.mockRejectedValueOnce(new Error('音频资产不可用'));
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await click(sendBtn());
    await flush();

    expect(panel()).toBeTruthy();
    expect(dataOf('m1').genStatus).toBe('draft');
    expect(dataOf('m1').jobId).toBeUndefined();
    expect(mediaNodes()).toHaveLength(3);
    expect(edges()).toHaveLength(2);
    // 面板留在原会话，可改正后重发（同载荷沿用同幂等键）
    apiMocks.createAudioVideoMux.mockResolvedValueOnce({ job_id: '76', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '76', status: 'queued', progress: 0, asset: null });
    await click(sendBtn());
    await flush();
    expect(apiMocks.createAudioVideoMux).toHaveBeenCalledTimes(2);
    const keys = apiMocks.createAudioVideoMux.mock.calls.map((call) => call[2]?.idempotencyKey);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
    expect(dataOf('m1').genStatus).toBe('generating');
  });
});

describe('IKIHPM 终态回填：原地变视频成品卡', () => {
  it('成功原地转可播放视频成品卡：命名「视频名(音视频合成).mp4」、时长分辨率取供应商值、清合成身份', async () => {
    seedDoc({ withDraft: true, withBound: true });
    apiMocks.createAudioVideoMux.mockResolvedValue({ job_id: '77', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '77', status: 'succeeded', progress: 100,
      asset: { id: '88', url: 'http://vid/out.mp4', type: 'video', width: 1920, height: 1080, duration: 33 },
    });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await click(sendBtn());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });

    const data = dataOf('m1');
    expect(data.genStatus).toBeUndefined();
    expect(data.mediaType).toBe('video');
    expect(data.src).toBe('http://vid/out.mp4');
    expect(data.assetId).toBe('88');
    expect(data.fileName).toBe('城市夜景(音视频合成).mp4');
    expect(data.width).toBe(1920);
    expect(data.height).toBe(1080);
    expect(data.duration).toBe(33);
    expect(data.audioVideoMux).toBeUndefined();
    expect(data.jobId).toBe('77');
    const html = cardHtml('m1');
    // 素材层出现 = 成品卡可播放（非生成中占位）
    expect(html).toContain('mediaVideoPoster');
    // 来源线保留（成品卡不重画、不新增）
    expect(edges().filter((e) => e.target === 'm1')).toHaveLength(2);
    // IKIHMX 审查修复 1：终态回填清身份后，源卡「音视频合成」高亮随之消失
    expect(dataOf('a1').audioVideoMuxInFlight).toBeUndefined();
  });

  it('供应商时长/分辨率缺失时回落源视频资产（产物类型仍翻 mediaType）', async () => {
    seedDoc({ withDraft: true, withBound: true });
    apiMocks.createAudioVideoMux.mockResolvedValue({ job_id: '78', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '78', status: 'succeeded', progress: 100,
      asset: { id: '89', url: 'http://vid/out2.mp4', type: 'video' },
    });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await click(sendBtn());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });

    const data = dataOf('m1');
    expect(data.width).toBe(1280);
    expect(data.height).toBe(720);
    expect(data.duration).toBe(12);
    expect(data.fileName).toBe('城市夜景(音视频合成).mp4');
    expect(data.audioVideoMux).toBeUndefined();
  });

  it('输入卡删除不影响已产出成品：成品卡与产物保留，来源线随输入卡清理不留悬空线', async () => {
    seedDoc({ withDraft: true, withBound: true });
    apiMocks.createAudioVideoMux.mockResolvedValue({ job_id: '81', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '81', status: 'succeeded', progress: 100,
      asset: { id: '88', url: 'http://vid/out.mp4', type: 'video', width: 1920, height: 1080, duration: 33 },
    });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await click(sendBtn());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });

    // 删除两张输入卡（固定音频源 + 绑定视频）
    await act(async () => {
      flowProps.current.onDeleteNode(['a1', 'v1']);
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(mediaNodes().map((node) => node.id)).toContain('m1');
    expect(dataOf('m1').src).toBe('http://vid/out.mp4');
    expect(dataOf('m1').assetId).toBe('88');
    // 不留悬空线：来源线随输入卡一并清理
    expect(edges().some((edge) => edge.source === 'a1' || edge.source === 'v1')).toBe(false);
  });

  it('失败卡展示原因并接重试入口：原卡回生成中、不复制卡与来源线、双击同键一次', async () => {
    seedDoc({ withDraft: true, withBound: true });
    apiMocks.createAudioVideoMux.mockResolvedValue({ job_id: '79', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: '79', status: 'failed', progress: 0, asset: null,
      error: { code: 1053, msg: '音视频合成失败，请重试' },
    });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await click(sendBtn());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

    expect(dataOf('m1').genStatus).toBe('failed');
    expect(dataOf('m1').errorText).toBe('音视频合成失败，请重试');
    // 合成身份保留（重试按冻结快照重放）；失败卡渲染重试钮
    expect(dataOf('m1').audioVideoMux).toBeTruthy();
    expect(cardHtml('m1')).toContain('重试');

    // 重试：走 :jobId/retry + Idempotency-Key，同卡回生成中，卡与来源线都不复制
    apiMocks.retryAudioVideoMux.mockResolvedValue({ job_id: '79', status: 'queued', replayed: false });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '79', status: 'queued', progress: 0, asset: null });
    const retry = dataOf('m1').onRetryJob as (id: string) => void;
    await act(async () => { retry('m1'); retry('m1'); await new Promise((resolve) => setTimeout(resolve, 40)); });

    expect(apiMocks.retryAudioVideoMux).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryAudioVideoMux.mock.calls[0]?.slice(0, 2)).toEqual(['p1', '79']);
    expect(apiMocks.retryAudioVideoMux.mock.calls[0]?.[2]).toBeTruthy();
    expect(dataOf('m1').genStatus).toBe('generating');
    expect(mediaNodes()).toHaveLength(3);
    expect(edges()).toHaveLength(2);
  });

  it('重试请求状态未知时再点沿用原幂等键与 jobId', async () => {
    seedDoc({ withDraft: true, withBound: true });
    apiMocks.createAudioVideoMux.mockResolvedValue({ job_id: '80', status: 'queued', enqueue_required: true });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: '80', status: 'failed', progress: 0, asset: null, error: { code: 1053, msg: '音视频合成失败，请重试' },
    });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await click(sendBtn());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

    apiMocks.retryAudioVideoMux.mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ job_id: '80', status: 'queued', replayed: true });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '80', status: 'queued', progress: 0, asset: null });
    const retry = dataOf('m1').onRetryJob as (id: string) => void;
    await act(async () => { retry('m1'); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(dataOf('m1').genStatus).toBe('failed');
    // IKJJR4：重试失败文案归运行时统一口径（非 ApiError 兜底「重试失败」）
    expect(dataOf('m1').errorText).toBe('重试失败');
    await act(async () => { retry('m1'); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(apiMocks.retryAudioVideoMux.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['p1', '80', expect.stringMatching(/^test-retry-key-\d+$/)], ['p1', '80', expect.stringMatching(/^test-retry-key-\d+$/)],
    ]);
  });
});

describe('IKJIQ6 合成在途关闭与同卡重开', () => {
  it.each(['success', 'failure'] as const)('旧请求 %s 保留新面板与参数，在途重复发送仍受任务锁保护', async (outcome) => {
    seedDoc({ withDraft: true, withBound: true });
    let accept!: (value: { job_id: string; status: 'queued'; enqueue_required: boolean }) => void;
    let reject!: (error: Error) => void;
    apiMocks.createAudioVideoMux.mockImplementationOnce(() => new Promise((resolve, fail) => { accept = resolve; reject = fail; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '91', status: 'queued', progress: 0, asset: null });
    await renderPage();
    await act(async () => { flowProps.current.onNodeClick(mediaNode('m1')); });
    await click(sendBtn());
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(panel()).toBeNull();
    await act(async () => { flowProps.current.onNodeClick(mediaNode('m1')); });
    await click(document.body.querySelector('[data-testid="audio-video-mux-reserve-true"]'));
    await click(sendBtn());
    expect(apiMocks.createAudioVideoMux).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === 'success') accept({ job_id: '91', status: 'queued', enqueue_required: true });
      else reject(new Error('旧合成请求失败'));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(panel()).toBeTruthy();
    expect(dataOf('m1').audioVideoMux).toMatchObject({ reserveAudio: true, sync: 'video' });
    expect(mediaNodes()).toHaveLength(3);
    expect(edges()).toHaveLength(2);
    expect(apiMocks.createAudioVideoMux.mock.calls[0]?.[1]).toMatchObject({ is_audio_reserve: false, sync: 'video' });
    if (outcome === 'success') {
      expect(dataOf('m1')).toMatchObject({ genStatus: 'generating', jobId: '91' });
      expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('91');
    } else {
      expect(dataOf('m1').genStatus).toBe('draft');
      apiMocks.createAudioVideoMux.mockResolvedValueOnce({ job_id: '92', status: 'queued', enqueue_required: true });
      await click(sendBtn()); await flush();
      expect(apiMocks.createAudioVideoMux).toHaveBeenCalledTimes(2);
      expect(apiMocks.createAudioVideoMux.mock.calls[1]?.[1]).toMatchObject({ is_audio_reserve: true });
    }
  });
});

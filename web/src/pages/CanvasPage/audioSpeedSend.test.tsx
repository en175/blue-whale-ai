// @vitest-environment jsdom
/* IKI4LX 调速提交项目隔离与请求治理回归（PR !831 审查整改）：
   慢响应期间 A→B 切换——迟到成功响应不在 B 建卡/连线/启动轮询/误关 B 新进的调速会话、
   迟到失败响应不向 B 弹原项目错误提示（activeProjectRef settle 双检，先例
   startFrameInterpolationJob IKHSFF）；首次提交与失败重试统一走 createAudioSpeedMutation
   （silent 传输，http 层不 toast，页面 catch 统一提示一次，第三参 { silent: true } 同
   插帧先例）；正常留在原项目的建卡/来源边/退会话/终态补丁不回归；重试原样重发冻结的
   lastInput（源资产+倍速）。渲染沿用 testing/canvasPageTestHarness。 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  mediaNodes,
  navigateRef,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';
import { AUDIO_SPEED_EDGE_ORIGIN } from './audioSpeed';

/** 项目一画布：一个就绪音频卡 a1（assetId '8'，15 秒 mp3） */
function seedProjectA() {
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
      ],
      edges: [],
    },
    assets: { 8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 } },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

/** 项目二画布：一个就绪音频卡 b1（assetId '9'）——迟到响应不得往这里写任何东西 */
function seedProjectB() {
  canvasDocMock.current = {
    doc: {
      id: 22,
      version: 7,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'b1',
          type: 'mediaNode',
          position: { x: 100, y: 100 },
          data: {
            src: 'http://aud/b1.mp3',
            mediaType: 'audio',
            fileName: '项目二音频.mp3',
            assetId: '9',
            duration: 20,
            mime: 'audio/mpeg',
          },
        },
      ],
      edges: [],
    },
    assets: { 9: { asset_id: 9, type: 'audio', access_url: 'http://aud/b1.mp3', duration: 20 } },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const dataOf = (id: string) => (mediaNode(id).data ?? {}) as Record<string, unknown>;
const edges = () =>
  flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
const sendBar = () => document.body.querySelector('[data-testid="audio-speed-send-bar"]');
const sendBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="audio-speed-send-btn"]');

/** 进入调速编辑态（音频卡工具条「调速」按钮派发的回调，IKHW5C 挂点） */
async function enterSpeed(id: string) {
  await act(async () => {
    (dataOf(id).onAudioSpeed as (nodeId: string) => void)(id);
  });
}

/** 滑杆拖到指定位置（0~1000 整数；native setter + input 事件，同 AudioSpeedBar 单测）。
 *  契约映射：1.0 → 500（原速中点），1.35 → 558 */
async function dragSliderTo(pos: number) {
  const slider = document.body.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(slider, String(pos));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 点发送钮（不等待创建往返——挂起场景下只完成发送动作本身） */
async function clickSend() {
  await act(async () => {
    sendBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

/** 切到项目二：先换 doc 引用（水合 effect 按 doc 变化重载节点）再迁移 URL query */
async function switchToProjectB() {
  await act(async () => {
    seedProjectB();
    navigateRef!('/canvas?project=p2');
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  seedProjectA();
  apiMocks.createAudioSpeed.mockReset();
  apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKI4LX 慢响应期间 A→B 切换：迟到响应不污染新项目', () => {
  it('成功响应迟到：B 无占位卡/无来源边/不启动轮询，B 新进的调速会话与提交中状态不受影响', async () => {
    // A 的创建请求挂起：构造「往返在途」窗口
    let resolveA!: (value: { job_id: string; status: 'queued' }) => void;
    apiMocks.createAudioSpeed.mockImplementationOnce(
      () => new Promise((resolve) => { resolveA = resolve; }),
    );
    // B 自己的提交也挂起（验证 A 的迟到 finally 不得复位 B 会话的 submitting）
    let resolveB!: (value: { job_id: string; status: 'queued' }) => void;
    apiMocks.createAudioSpeed.mockImplementationOnce(
      () => new Promise((resolve) => { resolveB = resolve; }),
    );
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558); // 1.35x
    await clickSend();
    // 请求已发出：项目一、冻结 payload、silent 传输（http 层不 toast，页面统一提示一次）
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledTimes(1);
    expect(apiMocks.createAudioSpeed).toHaveBeenNthCalledWith(
      1, 'p1', { source_asset_id: '8', speed: 1.35 }, { silent: true },
    );

    // 等待期间切到项目二（水合重载为 B 的节点），并进入 B 自己的调速会话、提交挂起
    await switchToProjectB();
    expect(mediaNodes().map((n) => n.id)).toEqual(['b1']);
    await enterSpeed('b1');
    await dragSliderTo(558);
    await clickSend();
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledTimes(2);
    expect(apiMocks.createAudioSpeed).toHaveBeenNthCalledWith(
      2, 'p2', { source_asset_id: '9', speed: 1.35 }, { silent: true },
    );
    expect(sendBtn()!.disabled).toBe(true); // B 提交在途

    // A 的迟到成功响应到达：本地写入全部丢弃
    await act(async () => {
      resolveA({ job_id: 'j1', status: 'queued' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // 不建卡、不连线、不启动轮询（任务在服务端归属 A，无需补偿）
    expect(mediaNodes().some((n) => n.id === 'audio-speed-j1')).toBe(false);
    expect(edges().some((e) => e.target === 'audio-speed-j1')).toBe(false);
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    // B 的会话不被误关、B 的提交中不被 A 的 finally 复位
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(true);

    // B 自己的响应正常到达：正常建卡（对照——守卫只拦跨项目迟到，不拦正常路径）
    await act(async () => {
      resolveB({ job_id: 'j2', status: 'queued' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mediaNodes().some((n) => n.id === 'audio-speed-j2')).toBe(true);
    expect(sendBar()).toBeNull();
  });

  it('失败响应迟到：不向 B 弹原项目的错误提示，B 画布与编辑会话无痕迹', async () => {
    let rejectA!: (reason: unknown) => void;
    apiMocks.createAudioSpeed.mockImplementationOnce(
      () => new Promise((_, reject) => { rejectA = reject; }),
    );
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledTimes(1);

    // 切到项目二并进入 B 的调速会话（不提交）
    await switchToProjectB();
    await enterSpeed('b1');
    expect(sendBar()).not.toBeNull();

    // A 的迟到失败响应到达：错误提示属于 A，不得弹给 B
    await act(async () => {
      rejectA(new Error('network down'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.body.textContent).not.toContain('音频调速任务创建失败');
    expect(document.body.textContent).not.toContain('network down');
    expect(mediaNodes().map((n) => n.id)).toEqual(['b1']);
    expect(edges()).toEqual([]);
    // B 的会话仍在、未进入提交中（未被 A 的回调触碰）
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(false);
  });
});

describe('IKI4LX 正常路径不回归（留在原项目）', () => {
  it('发送成功：退编辑态建占位卡、来源边 origin=audio-speed、身份冻结 lastInput、启动轮询并落盘', async () => {
    apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558); // 1.35x
    await clickSend();
    await flush();
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledWith(
      'p1', { source_asset_id: '8', speed: 1.35 }, { silent: true },
    );
    // 先退编辑态再建卡：发送条卸载、占位卡上画布（源卡右侧 +60px）、身份冻结
    expect(sendBar()).toBeNull();
    const placeholder = mediaNode('audio-speed-j1');
    expect(placeholder.data.genStatus).toBe('generating');
    expect(placeholder.data.fileName).toBe('播客片头(调速1.35x).m4a');
    expect(placeholder.position.x).toBe(400 + 480 + 60);
    expect(placeholder.data.audioSpeed).toEqual({
      sourceAssetId: '8',
      lastInput: { source_asset_id: '8', speed: 1.35 },
    });
    const edge = edges().find((e) => e.target === 'audio-speed-j1')!;
    expect(edge.source).toBe('a1');
    expect(edge.data).toEqual({ origin: AUDIO_SPEED_EDGE_ORIGIN });
    // 启动轮询 + 立刻落盘
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
  });

  it('创建失败（网络）：不建卡不退编辑态，只提示一次（silent 传输 + 页面统一提示），可调后重发', async () => {
    apiMocks.createAudioSpeed.mockRejectedValueOnce(new Error('network down'));
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    await flush();
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledTimes(1);
    expect(mediaNodes().map((n) => n.id)).toEqual(['a1']);
    expect(edges()).toEqual([]);
    // 编辑态保留、submitting 复位可重发；页面统一提示一次（http 层 silent 不再 toast）
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(false);
    expect(document.body.textContent).toContain('音频调速任务创建失败');
  });

  it('失败重试：冻结的源资产与倍速原样重发（Mutation + silent），新任务收敛成品', async () => {
    apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'failed', progress: 1,
      error: { code: 'audio_speed_failed', msg: '' },
    });
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558); // 冻结 1.35x
    await clickSend();
    await flush();
    const failed = mediaNode('audio-speed-j1');
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('音频调速失败，请重试');

    // 重试：lastInput（源素材 8 + 倍速 1.35）原样重发创建接口（新 job），silent 同口径
    apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j2', status: 'succeeded', progress: 100,
      asset: { id: 'a89', url: 'http://tos/y.m4a', type: 'audio', duration: 11.1 },
    });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)('audio-speed-j1');
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledTimes(2);
    expect(apiMocks.createAudioSpeed).toHaveBeenNthCalledWith(
      2, 'p1', { source_asset_id: '8', speed: 1.35 }, { silent: true },
    );
    const retried = mediaNode('audio-speed-j1') as Node;
    expect(retried.data.jobId).toBe('j2');
    expect(retried.data.genStatus).toBeUndefined();
    expect(retried.data.src).toBe('http://tos/y.m4a');
    expect(retried.data.duration).toBe(11.1);
  });

  it('重试失败：卡上失败态可读 + 页面统一提示一次（替代原 http 层默认 toast）', async () => {
    apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'failed', progress: 1,
      error: { code: 'audio_speed_failed', msg: '' },
    });
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    await flush();
    expect(mediaNode('audio-speed-j1').data.genStatus).toBe('failed');

    apiMocks.createAudioSpeed.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      (mediaNode('audio-speed-j1').data.onRetryJob as (id: string) => void)('audio-speed-j1');
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mediaNode('audio-speed-j1').data.genStatus).toBe('failed');
    expect(mediaNode('audio-speed-j1').data.errorText).toBe('音频调速失败');
    expect(document.body.textContent).toContain('音频调速任务创建失败');
  });
});

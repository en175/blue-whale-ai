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


/** IKJJR3：占位卡 id 预分配（audio-speed-{uuid}），不再按受理 jobId 命名——按家族卡查找 */
function speedCard(): Node {
  return mediaNodes().find((n) => n.id.startsWith('audio-speed-'))!;
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




beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  seedProjectA();
  apiMocks.createAudioSpeed.mockReset();
  apiMocks.saveCanvasDoc.mockReset().mockResolvedValue({
    id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
  });
  apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/* IKJJR3：原「IKI4LX 慢响应期间 A→B 切换」10 用例（迟到受理暂存 + 回 A 当场建卡/补卡保存）
 * 已随调速迁入生成任务运行时删除——语义等价覆盖于：
 *  - audioSpeedRetryRecovery.test.tsx：A→B→A 统一恢复接续（受理丢弃 + 恢复页回放 + 不轮询旧任务）；
 *  - audioSpeedSessionIsolation.test.tsx：迟到响应不污染新项目/新会话、失败收敛到卡。
 * 新协议下「迟到受理归发起项目」由 canvas_binding 服务端关联与统一恢复负责（工单验收 4）。 */

describe('IKI4LX 正常路径不回归（留在原项目）', () => {
  it('发送成功：退编辑态建占位卡、来源边 origin=audio-speed、身份冻结 lastInput、启动轮询并落盘', async () => {
    apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558); // 1.35x
    await clickSend();
    await flush();
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledWith(
      'p1', { source_asset_id: '8', speed: 1.35 }, expect.objectContaining({ silent: true }),
    );
    // 先退编辑态再建卡：发送条卸载、占位卡上画布（源卡右侧 +60px）、身份冻结
    expect(sendBar()).toBeNull();
    const placeholder = speedCard();
    expect(placeholder.data.genStatus).toBe('generating');
    expect(placeholder.data.fileName).toBe('播客片头(调速1.35x).m4a');
    expect(placeholder.position.x).toBe(400 + 480 + 60);
    expect(placeholder.data.audioSpeed).toEqual({
      sourceAssetId: '8',
      lastInput: { source_asset_id: '8', speed: 1.35 },
    });
    const edge = edges().find((e) => e.target === placeholder.id)!;
    expect(edge.source).toBe('a1');
    expect(edge.data).toEqual({ origin: AUDIO_SPEED_EDGE_ORIGIN });
    // 启动轮询；落盘经 800ms 防抖（IKJJR3：原受理后立即 flush 已由运行时统一）
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
  });

  it('创建失败（网络）：失败卡可重试（IKJJR3 提交点即交接，会话已退）', async () => {
    apiMocks.createAudioSpeed.mockRejectedValueOnce(new Error('network down'));
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    await flush();
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledTimes(1);
    // IKJJR3：提交点建卡 + 退会话；受理失败落失败卡（冻结输入可重试）+ 来源边
    expect(sendBar()).toBeNull();
    const failed = speedCard();
    expect(failed.data.genStatus).toBe('failed');
    expect((edges() as unknown[]).length).toBe(1);
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
    const failed = speedCard();
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('音频调速失败，请重试');

    // 重试：lastInput（源素材 8 + 倍速 1.35）原样重发创建接口（新 job），silent 同口径
    apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j2', status: 'succeeded', progress: 100,
      asset: { id: 'a89', url: 'http://tos/y.m4a', type: 'audio', duration: 11.1 },
    });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)(failed.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledTimes(2);
    expect(apiMocks.createAudioSpeed).toHaveBeenNthCalledWith(
      2, 'p1', { source_asset_id: '8', speed: 1.35 }, expect.objectContaining({ silent: true }),
    );
    const retried = speedCard();
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
    expect(speedCard().data.genStatus).toBe('failed');
    const failedNode = speedCard();

    apiMocks.createAudioSpeed.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      (failedNode.data.onRetryJob as (id: string) => void)(failedNode.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(speedCard().data.genStatus).toBe('failed');
    expect(speedCard().data.errorText).toBe('重试失败'); // IKJJR3：非 ApiError 走运行时通用文案
  });
});

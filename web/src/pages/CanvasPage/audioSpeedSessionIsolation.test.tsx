// @vitest-environment jsdom
// IKI6EB：真实页面中的编辑会话与在途任务归属分别隔离。
import { act } from 'react';
import type { Node as FlowNode } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** 项目一画布：一个就绪音频卡 a1（assetId '8'，15 秒 mp3） */
function seedProjectA() {
  return canvasDocMock.current = {
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

/** 切到项目二：先进入加载态，再交付新项目快照。 */
async function switchToProjectB() {
  await act(async () => {
    canvasDocMock.current = { ...canvasDocMock.current, doc: null };
    navigateRef!('/canvas?project=p2');
  });
  await act(async () => {
    seedProjectB();
    navigateRef!('/canvas?project=p2');
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

/** IKJJR3：占位卡 id 预分配（audio-speed-{uuid}）——按冻结源资产找家族卡 */
function speedCardBySource(assetId: string): FlowNode {
  return mediaNodes().find((n) =>
    n.id.startsWith('audio-speed-') &&
    (n.data.audioSpeed as { sourceAssetId?: string } | undefined)?.sourceAssetId === assetId)!;
}

describe('IKI6EB 调速会话响应归属', () => {
  it.each([['success', true], ['failure', true], ['success', false], ['failure', false]] as const)(
    'a 迟到 %s、b 提交=%s：会话和倍速独立，任务正常收敛', async (outcome, bSubmitting) => {
      const doc = seedProjectA().doc;
      const a = doc.nodes[0];
      doc.nodes.push({ ...a, id: 'b1', data: { ...a.data, assetId: '9' } });
      let resolveA!: (value: { job_id: string; status: string }) => void;
      let rejectA!: (error: Error) => void;
      let resolveB!: (value: { job_id: string; status: string }) => void;
      apiMocks.fetchJobStatus.mockImplementation(async (jobId: string) => ({
        job_id: jobId, status: 'succeeded', progress: 100,
        asset: { id: `result-${jobId}`, url: `http://aud/${jobId}.m4a`, type: 'audio', duration: 11.1 },
      }));
      apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; }));
      apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
      await renderPage();
      await enterSpeed('a1');
      await dragSliderTo(558);
      await clickSend();
      // IKJJR3：提交点即交接（a 会话已退）；开 b 会话（倍速独立编辑）
      await enterSpeed('b1');
      await dragSliderTo(600);
      if (bSubmitting) {
        await clickSend();
        // IKJJR3：b 提交点即交接（b 会话退、b 占位卡上画布）；a 的迟到响应不动 b 会话
        expect(sendBar()).toBeNull();
      }
      const sliderBefore = document.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')?.value;
      await act(async () => {
        if (outcome === 'success') resolveA({ job_id: 'old-a', status: 'queued' });
        else rejectA(new Error('old request failed'));
      });
      await flush();
      if (!bSubmitting) {
        // b 未提交：会话保留、滑杆值不被 a 的迟到响应复位、无旧错误弹窗
        expect(sendBar()).not.toBeNull();
        expect(sendBtn()!.disabled).toBe(false);
        expect(document.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!.value).toBe(sliderBefore);
      }
      expect(document.body.textContent).not.toContain('音频调速任务创建失败');
      if (outcome === 'success') {
        const cardA = speedCardBySource('8');
        expect(cardA).toBeTruthy();
        expect(cardA.data.jobId).toBe('old-a');
        expect(cardA.data.src).toBe('http://aud/old-a.m4a');
        expect(cardA.data.genStatus).toBeUndefined();
        expect(edges().some((edge) => edge.source === 'a1' && edge.target === cardA.id)).toBe(true);
      }
      if (!bSubmitting) await clickSend();
      await act(async () => { resolveB({ job_id: 'new-b', status: 'queued' }); });
      await flush();
      expect(sendBar()).toBeNull();
      const cardB = speedCardBySource('9');
      expect(cardB).toBeTruthy();
      expect(cardB.data.jobId).toBe('new-b');
      expect(cardB.data.src).toBe('http://aud/new-b.m4a');
      expect(cardB.data.genStatus).toBeUndefined();
    },
  );

  it('A → B → A 不复用旧编辑会话身份，但保留原任务卡', async () => {
    let resolveOld!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    await switchToProjectB();
    await act(async () => {
      canvasDocMock.current = { ...canvasDocMock.current, doc: null };
      navigateRef!('/canvas?project=p1');
    });
    await act(async () => { seedProjectA(); navigateRef!('/canvas?project=p1'); });
    await flush();
    await enterSpeed('a1');
    await dragSliderTo(600);
    await act(async () => { resolveOld({ job_id: 'old-a', status: 'queued' }); });
    await flush();
    // IKJJR3：重新水合后旧执行链按加载身份消亡——迟到受理不写入新画布（无卡）；
    // 新会话照常可用（服务端关联的找回归统一恢复，见 audioSpeedRetryRecovery）
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(false);
    expect(mediaNodes().some((n) => n.id.startsWith('audio-speed-'))).toBe(false);
  });

  // IKI61O：工单背景的字面场景——同项目同卡「发送在途 → X 关旧会话 → 同卡重开新会话」
  it('同卡重开：迟到成功不关新会话、不改新倍速，旧任务照常建卡收尾', async () => {
    let resolveOld!: (value: { job_id: string; status: string }) => void;
    let resolveNew!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    // IKJJR3：提交点即交接（旧会话已退）；同一张卡重开新会话并调到另一倍速
    await enterSpeed('a1');
    await dragSliderTo(600);
    await act(async () => { resolveOld({ job_id: 'old-a', status: 'queued' }); });
    await flush();
    // 新会话不被旧响应关闭、新倍速不被复位；旧任务卡与来源边照常收尾
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!.value).toBe('600');
    const oldCard = mediaNodes().find((n) => n.id.startsWith('audio-speed-') && n.data.jobId === 'old-a')!;
    expect(oldCard).toBeTruthy();
    expect(edges().some((edge) => edge.source === 'a1' && edge.target === oldCard.id)).toBe(true);
    // 新会话自身发送闭环不受影响（新占位卡承接新任务）
    await clickSend();
    await act(async () => { resolveNew({ job_id: 'new-a', status: 'queued' }); });
    await flush();
    expect(sendBar()).toBeNull();
    const newCard = mediaNodes().find((n) => n.id.startsWith('audio-speed-') && n.data.jobId === 'new-a')!;
    expect(newCard).toBeTruthy();
  });

  it('同卡重开：迟到失败不向新会话弹旧错误、不动新会话提交锁', async () => {
    let rejectOld!: (error: Error) => void;
    apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    // IKJJR3：提交点即交接（旧会话已退）；同卡重开新会话
    await enterSpeed('a1');
    await dragSliderTo(600);
    await act(async () => { rejectOld(new Error('old request failed')); });
    await flush();
    // 旧受理失败收敛到旧占位卡（不弹会话错误、不动新会话提交锁）
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(false);
    expect(mediaNodes().find((n) => n.id.startsWith('audio-speed-'))!.data.genStatus).toBe('failed');
  });
});

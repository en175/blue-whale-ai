// @vitest-environment jsdom
/* IKI61O 会话纪元页面竞态回归（非调速家族代表：音频截取）——同项目「发送在途 →
   X 关旧会话 → 开新会话」场景：迟到响应只做任务收尾（建占位卡/来源边/轮询），
   不关闭用户新开的会话、不复位其提交锁、不向它弹旧失败提示；新会话自身的
   发送成功/失败仍按既有规则处理。渲染接缝沿用 audioSpeedSessionIsolation.test.tsx
   （canvasPageTestHarness 共享夹具），调速同场景回归由该文件继续守护。 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  mediaNodes,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';
import { AUDIO_TRIM_EDGE_ORIGIN } from './audioTrim';

/** 项目一画布：两张就绪音频卡 a1（assetId '8'，15 秒 mp3）与 b1（assetId '9'，20 秒） */
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
        {
          id: 'b1',
          type: 'mediaNode',
          position: { x: 400, y: 300 },
          data: {
            src: 'http://aud/b1.mp3',
            mediaType: 'audio',
            fileName: '插曲素材.mp3',
            assetId: '9',
            duration: 20,
            mime: 'audio/mpeg',
          },
        },
      ],
      edges: [],
    },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 },
      9: { asset_id: 9, type: 'audio', access_url: 'http://aud/b1.mp3', duration: 20 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const dataOf = (id: string) => (mediaNode(id).data ?? {}) as Record<string, unknown>;
const edges = () =>
  flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
const sendBar = () => document.body.querySelector('[data-testid="audio-trim-send-bar"]');
const sendBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="audio-trim-send-btn"]');
const rangeText = () => document.body.querySelector('[data-testid="audio-trim-range"]')!.textContent;

/** 进入截取编辑态（音频卡工具条「截取」按钮派发的回调，IKHB6Y 挂点） */
async function enterTrim(id: string) {
  await act(async () => {
    (dataOf(id).onTrimAudio as (nodeId: string) => void)(id);
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
  apiMocks.createAudioTrim.mockReset();
  apiMocks.fetchJobStatus.mockReset();
  apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKI61O 截取会话纪元（迟到响应不误关同项目新会话）', () => {
  it.each([['success', true], ['failure', true], ['success', false], ['failure', false]] as const)(
    '在途 %s、新会话提交=%s：新会话与提交锁不动，旧任务照常收尾',
    async (outcome, bSubmitting) => {
      let resolveA!: (value: { job_id: string; status: string }) => void;
      let rejectA!: (error: Error) => void;
      let resolveB!: (value: { job_id: string; status: string }) => void;
      apiMocks.createAudioTrim.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; }));
      apiMocks.createAudioTrim.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
      await renderPage();
      await enterTrim('a1');
      await clickSend();
      // IKJJR3：提交点即交接（旧会话已退）→ 同项目另一张卡开新会话
      await enterTrim('b1');
      if (bSubmitting) {
        await clickSend();
        // b 提交点即交接（b 会话退、占位卡上画布）；a 的迟到响应不动 b
        expect(sendBar()).toBeNull();
      }
      const rangeBefore = bSubmitting ? undefined : rangeText();
      await act(async () => {
        if (outcome === 'success') resolveA({ job_id: 'old-a', status: 'queued' });
        else rejectA(new Error('old request failed'));
      });
      await flush();
      // 新会话不被旧响应关闭、参数不被复位、提交锁不被释放
      if (!bSubmitting) {
        expect(sendBar()).not.toBeNull();
        expect(sendBtn()!.disabled).toBe(false);
        expect(rangeText()).toBe(rangeBefore);
      }
      expect(document.body.textContent).not.toContain('音频截取任务创建失败');
      if (outcome === 'success') {
        // 旧任务照常收尾：占位卡（预分配 id）+ 来源边 + 轮询
        const oldCard = mediaNodes().find((n) => n.id.startsWith('audio-trim-') && n.data.jobId === 'old-a')!;
        expect(oldCard).toBeTruthy();
        expect(edges().some((edge) => edge.source === 'a1' && edge.target === oldCard.id
          && edge.data?.origin === AUDIO_TRIM_EDGE_ORIGIN)).toBe(true);
      }
      // 新会话自身的发送闭环不受旧响应影响
      if (!bSubmitting) await clickSend();
      await act(async () => { resolveB({ job_id: 'new-b', status: 'queued' }); });
      await flush();
      expect(sendBar()).toBeNull();
      expect(mediaNodes().find((n) => n.id.startsWith('audio-trim-') && n.data.jobId === 'new-b')).toBeTruthy();
    },
  );

  it('未动会话场景：发送成功照常退会话建卡（与现状一致）', async () => {
    apiMocks.createAudioTrim.mockImplementationOnce(async () => ({ job_id: 'j-ok', status: 'queued' }));
    await renderPage();
    await enterTrim('a1');
    await clickSend();
    await flush();
    expect(sendBar()).toBeNull();
    const card = mediaNodes().find((n) => n.id.startsWith('audio-trim-'))!;
    expect(card.data.jobId).toBe('j-ok');
    expect(edges().some((edge) => edge.source === 'a1' && edge.target === card.id)).toBe(true);
  });

  it('未动会话场景：发送失败落失败卡可重试（IKJJR3 提交点即交接）', async () => {
    apiMocks.createAudioTrim.mockImplementationOnce(async () => { throw new Error('boom'); });
    await renderPage();
    await enterTrim('a1');
    await clickSend();
    await flush();
    expect(sendBar()).toBeNull();
    const card = mediaNodes().find((n) => n.id.startsWith('audio-trim-'))!;
    expect(card.data.genStatus).toBe('failed');
  });
});

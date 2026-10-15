// @vitest-environment jsdom
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

vi.mock('@/app/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/app/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/canvasRecovery')>()),
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

async function enterTrim(id: string) {
  await act(async () => {
    (dataOf(id).onTrimAudio as (nodeId: string) => void)(id);
  });
}

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
      await enterTrim('b1');
      if (bSubmitting) {
        await clickSend();
        expect(sendBar()).toBeNull();
      }
      const rangeBefore = bSubmitting ? undefined : rangeText();
      await act(async () => {
        if (outcome === 'success') resolveA({ job_id: 'old-a', status: 'queued' });
        else rejectA(new Error('old request failed'));
      });
      await flush();
      if (!bSubmitting) {
        expect(sendBar()).not.toBeNull();
        expect(sendBtn()!.disabled).toBe(false);
        expect(rangeText()).toBe(rangeBefore);
      }
      expect(document.body.textContent).not.toContain('音频截取任务创建失败');
      if (outcome === 'success') {
        const oldCard = mediaNodes().find((n) => n.id.startsWith('audio-trim-') && n.data.jobId === 'old-a')!;
        expect(oldCard).toBeTruthy();
        expect(edges().some((edge) => edge.source === 'a1' && edge.target === oldCard.id
          && edge.data?.origin === AUDIO_TRIM_EDGE_ORIGIN)).toBe(true);
      }
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

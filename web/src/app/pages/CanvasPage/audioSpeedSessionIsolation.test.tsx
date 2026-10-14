// @vitest-environment jsdom
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
      ],
      edges: [],
    },
    assets: { 8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 } },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

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

async function enterSpeed(id: string) {
  await act(async () => {
    (dataOf(id).onAudioSpeed as (nodeId: string) => void)(id);
  });
}

async function dragSliderTo(pos: number) {
  const slider = document.body.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(slider, String(pos));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickSend() {
  await act(async () => {
    sendBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

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
      await enterSpeed('b1');
      await dragSliderTo(600);
      if (bSubmitting) {
        await clickSend();
        expect(sendBar()).toBeNull();
      }
      const sliderBefore = document.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')?.value;
      await act(async () => {
        if (outcome === 'success') resolveA({ job_id: 'old-a', status: 'queued' });
        else rejectA(new Error('old request failed'));
      });
      await flush();
      if (!bSubmitting) {
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
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(false);
    expect(mediaNodes().some((n) => n.id.startsWith('audio-speed-'))).toBe(false);
  });

  it('同卡重开：迟到成功不关新会话、不改新倍速，旧任务照常建卡收尾', async () => {
    let resolveOld!: (value: { job_id: string; status: string }) => void;
    let resolveNew!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    await enterSpeed('a1');
    await dragSliderTo(600);
    await act(async () => { resolveOld({ job_id: 'old-a', status: 'queued' }); });
    await flush();
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!.value).toBe('600');
    const oldCard = mediaNodes().find((n) => n.id.startsWith('audio-speed-') && n.data.jobId === 'old-a')!;
    expect(oldCard).toBeTruthy();
    expect(edges().some((edge) => edge.source === 'a1' && edge.target === oldCard.id)).toBe(true);
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
    await enterSpeed('a1');
    await dragSliderTo(600);
    await act(async () => { rejectOld(new Error('old request failed')); });
    await flush();
    expect(sendBar()).not.toBeNull();
    expect(sendBtn()!.disabled).toBe(false);
    expect(mediaNodes().find((n) => n.id.startsWith('audio-speed-'))!.data.genStatus).toBe('failed');
  });
});

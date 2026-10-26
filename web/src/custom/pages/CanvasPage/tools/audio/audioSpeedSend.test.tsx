// @vitest-environment jsdom
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
} from '../../testing/canvasPageTestHarness';
import { AUDIO_SPEED_EDGE_ORIGIN } from './audioSpeed';

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


function speedCard(): Node {
  return mediaNodes().find((n) => n.id.startsWith('audio-speed-'))!;
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


describe('IKI4LX 正常路径不回归（留在原项目）', () => {
  it('发送成功：退编辑态建占位卡、来源边 origin=audio-speed、身份冻结 lastInput、启动轮询并落盘', async () => {
    apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await enterSpeed('a1');
    await dragSliderTo(558);
    await clickSend();
    await flush();
    expect(apiMocks.createAudioSpeed).toHaveBeenCalledWith(
      'p1', { source_asset_id: '8', speed: 1.35 }, expect.objectContaining({ silent: true }),
    );
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
    await dragSliderTo(558);
    await clickSend();
    await flush();
    const failed = speedCard();
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('音频调速失败，请重试');

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
    expect(speedCard().data.errorText).toBe('重试失败');
  });
});

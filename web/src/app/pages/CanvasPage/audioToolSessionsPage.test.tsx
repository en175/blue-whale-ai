// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canvasDocMock, flowProps, mediaNodes, renderPage, unmountPage } from './testing/canvasPageTestHarness';

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

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  canvasDocMock.current = {
    doc: {
      id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, edges: [],
      nodes: [{ id: 'a1', type: 'mediaNode', position: { x: 400, y: 0 }, data: {
        assetId: '8', src: 'http://media/a1.mp3', fileName: '片头.mp3', duration: 15, mediaType: 'audio',
      } }],
    },
    assets: { 8: { asset_id: 8, type: 'audio', access_url: 'http://media/a1.mp3', duration: 15 } },
    refetch: async () => [], acceptDoc: vi.fn(),
  };
});
afterEach(async () => { await unmountPage(); vi.clearAllMocks(); });

it.each([
  ['onTrimAudio', 'audio-trim-send-bar'],
  ['onAudioSpeed', 'audio-speed-send-bar'],
  ['onVocalBackgroundSplit', 'vocal-split-send-bar'],
] as const)('%s：源卡删除后运行时清除编辑状态，浮条不悬挂', async (entry, bar) => {
  if (entry === 'onVocalBackgroundSplit') {
    const doc = canvasDocMock.current.doc as { nodes: Array<{ data: Record<string, unknown> }> };
    Object.assign(doc.nodes[0].data, { mediaType: 'video', src: 'http://media/v1.mp4', fileName: '视频.mp4' });
    canvasDocMock.current.assets = { 8: { asset_id: 8, type: 'video', access_url: 'http://media/v1.mp4', duration: 15 } };
  }
  await renderPage();
  await act(async () => {
    (mediaNodes()[0].data[entry] as (id: string) => void)('a1');
  });
  expect(document.body.querySelector(`[data-testid="${bar}"]`)).not.toBeNull();
  await act(async () => { flowProps.current.onDeleteNode(['a1']); });
  expect(document.body.querySelector(`[data-testid="${bar}"]`)).toBeNull();
  expect(mediaNodes()).toEqual([]);
});

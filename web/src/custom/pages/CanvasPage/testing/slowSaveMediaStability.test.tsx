// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/http';
import { apiMocks, canvasDocMock, enableReactActEnvironment, flowProps, realCanvasMode, renderPage, unmountPage } from './canvasPageTestHarness';

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

realCanvasMode.current = true;

const VIDEO_NODE_ID = 'media-v1';
const TEXT_ID = 'text-v1';
const SLOW_SAVE_MS = 3000;

const videoNode = (x: number) => ({
  id: VIDEO_NODE_ID,
  type: 'mediaNode',
  width: 200,
  height: 150,
  position: { x, y: 40 },
  data: { mediaType: 'video', src: 'https://example.com/v.mp4', fileName: '视频1', assetId: '9002', toolMode: 'select' },
});

function textNode() {
  return {
    id: TEXT_ID,
    type: 'textNode',
    width: 220,
    height: 120,
    position: { x: 40, y: 60 },
    data: {
      title: '提示词',
      text: '视频1',
      promptMentions: [],
      promptMaterials: [],
      mediaMentions: [{ start: 0, end: 3, nodeId: VIDEO_NODE_ID, assetId: '9002' }],
      mediaRefs: [{ nodeId: VIDEO_NODE_ID, assetId: '9002', mediaType: 'video', name: '视频1', url: 'https://example.com/v.mp4' }],
    },
  };
}

const textIndexEdge = { id: 'e-v1', source: VIDEO_NODE_ID, target: TEXT_ID, type: 'custom', data: { textIndex: true } };

function seedDoc() {
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [textNode(), videoNode(320)], edges: [textIndexEdge] },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

function chipVideo() {
  return document.querySelector<HTMLVideoElement>(`[data-media-node="${VIDEO_NODE_ID}"] video`);
}

function watchChipReloads() {
  const reloads: Element[] = [];
  const isChipVideo = (element: Element) =>
    element.tagName === 'VIDEO' && element.closest(`[data-media-node="${VIDEO_NODE_ID}"]`) !== null;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (isChipVideo(record.target as Element)) reloads.push(record.target as Element);
        continue;
      }
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (isChipVideo(node)) reloads.push(node);
        reloads.push(...[...node.querySelectorAll('video')].filter(isChipVideo));
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  return { count: () => reloads.length, stop: () => observer.disconnect() };
}

function expectChipStable(loadedChip: HTMLVideoElement | null, watch: { count: () => number }) {
  expect(watch.count()).toBe(0);
  expect(chipVideo()).toBe(loadedChip);
}

function sleep(ms: number) {
  return act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

function savedReceipt(version: number) {
  return { id: 11, project_id: 1, version, viewport: '{}', nodes: '[]' };
}

function payloadOf(callIndex: number) {
  return apiMocks.saveCanvasDoc.mock.calls[callIndex]![1] as {
    nodes: Array<{ id: string; position: { x: number } }>;
    edges: unknown[];
    viewport: unknown;
    confirmEmpty?: boolean;
  };
}

async function dragMediaNodeTo(x: number) {
  const node = { id: VIDEO_NODE_ID, type: 'mediaNode', position: { x, y: 40 }, data: {} };
  await act(async () => {
    flowProps.current.onNodeDragStop(node, [node]);
  });
}

async function waitForSaveCalls(count: number, timeout = 4000) {
  await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(count), { timeout });
}

beforeEach(() => {
  enableReactActEnvironment();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  document.elementsFromPoint = () => [];
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800,
    toJSON: () => ({}),
  } as DOMRect);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await unmountPage();
  Reflect.deleteProperty(document, 'elementsFromPoint');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('IKNBH7 慢保存与重试期间文本视频引用稳定', () => {
  it('慢保存在途、成功回执与在途修改的后续保存期间视频引用不重新加载', async () => {
    seedDoc();
    await renderPage();
    expect(document.querySelector('.react-flow')).not.toBeNull();
    const loadedChip = chipVideo();
    expect(loadedChip?.getAttribute('src')).toBe('https://example.com/v.mp4');
    const watch = watchChipReloads();
    expect(watch.count()).toBe(0);

    await act(async () => {
      document.querySelector('.react-flow__pane')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    });
    await sleep(1200);
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
    expectChipStable(loadedChip, watch);

    let resolveFirst!: (value: ReturnType<typeof savedReceipt>) => void;
    apiMocks.saveCanvasDoc.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));

    const editAt = Date.now();
    await dragMediaNodeTo(380);
    await waitForSaveCalls(1);
    expect(Date.now() - editAt).toBeGreaterThanOrEqual(800);
    expect(payloadOf(0).nodes.map((node) => node.id).sort()).toEqual([TEXT_ID, VIDEO_NODE_ID].sort());
    expect(payloadOf(0).nodes.find((node) => node.id === VIDEO_NODE_ID)!.position.x).toBe(380);
    expect(payloadOf(0).edges).toHaveLength(1);
    expect(payloadOf(0).viewport).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), zoom: expect.any(Number) }));
    expect(payloadOf(0).confirmEmpty).toBe(false);

    await sleep(1200);
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expectChipStable(loadedChip, watch);
    expect(document.body.textContent).toContain('保存中');

    await dragMediaNodeTo(440);
    await sleep(1000);
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expectChipStable(loadedChip, watch);

    const elapsed = Date.now() - editAt;
    if (elapsed < SLOW_SAVE_MS) await sleep(SLOW_SAVE_MS - elapsed);
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expectChipStable(loadedChip, watch);

    await act(async () => { resolveFirst(savedReceipt(4)); });
    await waitForSaveCalls(2);
    expect(payloadOf(1).nodes.find((node) => node.id === VIDEO_NODE_ID)!.position.x).toBe(440);

    await sleep(1500);
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2);
    expectChipStable(loadedChip, watch);
    expect(document.body.textContent).toContain('已保存');
    watch.stop();
  }, 20000);

  it('慢保存失败后保留真实编辑与提示，重试成功期间视频引用不重新加载', async () => {
    seedDoc();
    await renderPage();
    const loadedChip = chipVideo();
    expect(loadedChip).not.toBeNull();
    const watch = watchChipReloads();

    let rejectFirst!: (error: unknown) => void;
    apiMocks.saveCanvasDoc.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));

    const editAt = Date.now();
    await dragMediaNodeTo(390);
    await waitForSaveCalls(1);

    await sleep(1200);
    expectChipStable(loadedChip, watch);

    const elapsed = Date.now() - editAt;
    if (elapsed < SLOW_SAVE_MS) await sleep(SLOW_SAVE_MS - elapsed);
    expectChipStable(loadedChip, watch);

    await act(async () => { rejectFirst(new ApiError(500, '服务器开小差')); });
    await vi.waitFor(() => expect(document.body.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expectChipStable(loadedChip, watch);
    expect(document.querySelector<HTMLElement>(`.react-flow__node[data-id="${VIDEO_NODE_ID}"]`)?.style.transform).toContain('translate(390px');

    apiMocks.saveCanvasDoc.mockImplementationOnce(async () => savedReceipt(4));
    const retryButton = [...document.querySelectorAll('button')].find((button) => button.textContent === '重试保存');
    expect(retryButton).toBeTruthy();
    await act(async () => { retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await sleep(200);

    expect(payloadOf(1).nodes.find((node) => node.id === VIDEO_NODE_ID)!.position.x).toBe(390);
    expectChipStable(loadedChip, watch);
    await vi.waitFor(() => expect(document.body.textContent).toContain('已保存'), { timeout: 3000 });
    expect([...document.querySelectorAll('button')].some((button) => button.textContent === '重试保存')).toBe(false);
    expectChipStable(loadedChip, watch);
    watch.stop();
  }, 20000);
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Edge, Node, Viewport } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';
import { useCanvasSave, type CanvasSaveHost } from './useCanvasSave';

const saveCanvasDoc = vi.hoisted(() => vi.fn());
const putCanvasDocWithRecovery = vi.hoisted(() => vi.fn());
vi.mock('@/custom/api/canvas', () => ({
  readCanvasConflictVersion: (error: unknown) =>
    (error as { conflictVersion?: number } | null)?.conflictVersion,
  saveCanvasDoc,
  serializeNodes: (nodes: Node[]) => JSON.stringify(nodes.map((n) => n.id)),
  serializeEdges: (edges: Edge[]) => JSON.stringify(edges.map((e) => `${e.source}-${e.target}`)),
}));
vi.mock('@/custom/api/canvasRecovery', () => ({ putCanvasDocWithRecovery }));
vi.mock('@/shared/api/http', () => ({
  isApiError: (e: unknown) => Boolean((e as { apiError?: boolean } | null)?.apiError),
}));

function ref<T>(current: T) {
  return { current } as { current: T };
}

type Captured = ReturnType<typeof useCanvasSave>;

let latest: Captured;
let draftErrorIds: string[] = [];
const savedStatuses: Array<'idle' | 'saving' | 'saved' | 'error'> = [];
let savedAtCalls = 0;
let toastCalls: Array<{ type: string; msg: string }> = [];

function buildHost(over: Partial<CanvasSaveHost> = {}): CanvasSaveHost {
  const statusRef = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const blockRef = ref(false);
  return {
    activeProjectRef: ref<string | null>('p1'),
    hydratedProjectRef: ref<string | null>('p1'),
    textNodesRef: ref<Node[]>([{ id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: {} }]),
    mediaNodesRef: ref<Node[]>([]),
    productNodesRef: ref<Node[]>([]),
    assetNodesRef: ref<Node[]>([]),
    groupsRef: ref([]),
    edgesRef: ref<Edge[]>([]),
    draftErrorsRef: ref(new Map<string, string>()),
    versionRef: ref<number | null>(1),
    lastSavedRef: ref(''),
    retainedRecoverySaveRef: ref(null),
    pendingNodeIdsRef: ref(new Set<string>()),
    savePromiseRef: ref<Promise<unknown> | null>(null),
    generationRuntimeRef: ref(null),
    confirmedNonEmptyRef: ref(true),
    emptyClearConflictRef: ref(false),
    emptyOverwriteRejectedRef: ref(false),
    recoverySaveConflictRef: ref(false),
    viewportRef: ref<Viewport>({ x: 0, y: 0, zoom: 1 }),
    setSaveEpoch: vi.fn(),
    setSaveStatus: ((value: SetStateAction<'idle' | 'saving' | 'saved' | 'error'>) => {
      const next = typeof value === 'function' ? value(statusRef.current) : value;
      statusRef.current = next;
      savedStatuses.push(next);
    }) as unknown as Dispatch<SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>,
    setSaveBlocked: ((value: SetStateAction<boolean>) => {
      blockRef.current = typeof value === 'function' ? value(blockRef.current) : value;
    }) as unknown as Dispatch<SetStateAction<boolean>>,
    setSavedAt: (() => { savedAtCalls += 1; }) as unknown as Dispatch<SetStateAction<string>>,
    saveBlocked: false,
    submittingNodeId: null,
    audioMixInFlightRef: ref(false),
    currentId: 'p1',
    doc: { nodes: [] },
    applyingRef: ref(false),
    blockInvalidDraft: (ids: string[]) => ids.some((id) => draftErrorIds.includes(id)),
    showToast: (type: 'success' | 'error' | 'warn', msg: string) => { toastCalls.push({ type, msg }); },
    ...over,
  };
}

function Probe({ host }: { host: CanvasSaveHost }) {
  latest = useCanvasSave(host);
  return null;
}

let root: Root;
let container: HTMLDivElement;

async function render(host: CanvasSaveHost) {
  await act(async () => { root.render(createElement(Probe, { host })); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  saveCanvasDoc.mockReset();
  putCanvasDocWithRecovery.mockReset();
  savedStatuses.length = 0;
  toastCalls = [];
  savedAtCalls = 0;
  draftErrorIds = [];
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it('保存成功：置 saved、写回版本与签名、刷新时间', async () => {
  const host = buildHost();
  saveCanvasDoc.mockResolvedValue({ version: 2 });
  await render(host);
  let result = false;
  await act(async () => { result = await latest.flushCanvasSave('p1'); });
  expect(result).toBe(true);
  expect(host.versionRef.current).toBe(2);
  expect(host.lastSavedRef.current).not.toBe('');
  expect(savedStatuses).toContain('saved');
  expect(savedAtCalls).toBeGreaterThan(0);
  expect(host.pendingNodeIdsRef.current.size).toBe(0);
});

it('422 覆盖被拒：置待复核、报错、阻止落盘', async () => {
  const host = buildHost();
  saveCanvasDoc.mockRejectedValue({ apiError: true, status: 422 });
  await render(host);
  await act(async () => {
    await expect(latest.flushCanvasSave('p1')).rejects.toBeTruthy();
  });
  expect(host.emptyOverwriteRejectedRef.current).toBe(true);
  expect(savedStatuses).toContain('error');
  expect(latest.blockedByPendingCanvasReview()).toBe(true);
  expect(toastCalls.some((c) => c.msg.includes('不一致'))).toBe(true);
});

it('同一时刻并发 flush：串行队列，第二次在第一次落盘后才发', async () => {
  const host = buildHost();
  const order: string[] = [];
  let resolveFirst!: (value: { version: number }) => void;
  saveCanvasDoc
    .mockImplementationOnce(() => { order.push('call1'); return new Promise((r) => { resolveFirst = r; }); })
    .mockImplementationOnce(() => { order.push('call2'); return Promise.resolve({ version: 3 }); });
  await render(host);
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  await act(async () => {
    first = latest.flushCanvasSave('p1');
    second = latest.flushCanvasSave('p1');
  });
  expect(order).toEqual(['call1']);
  host.textNodesRef.current = [
    { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: {} },
    { id: 't2', type: 'textNode', position: { x: 40, y: 0 }, data: {} },
  ];
  await act(async () => { resolveFirst({ version: 2 }); await first; await second; });
  expect(order).toEqual(['call1', 'call2']);
});

it('切项目守卫：saveBlocked 与待复核状态均阻断且不发请求', async () => {
  const blocked = buildHost({ saveBlocked: true });
  await render(blocked);
  let result = true;
  await act(async () => { result = await latest.ensureSavedBeforeProjectSwitch(); });
  expect(result).toBe(false);
  expect(saveCanvasDoc).not.toHaveBeenCalled();
  expect(toastCalls.some((c) => c.msg.includes('保存失败'))).toBe(true);

  toastCalls = [];
  const pendingReview = buildHost();
  pendingReview.emptyClearConflictRef.current = true;
  await render(pendingReview);
  await act(async () => { result = await latest.ensureSavedBeforeProjectSwitch(); });
  expect(result).toBe(false);
  expect(saveCanvasDoc).not.toHaveBeenCalled();
});

it('仅视口变化不算真实修改：flush 不再提交相同内容', async () => {
  const host = buildHost();
  saveCanvasDoc.mockResolvedValue({ version: 2 });
  await render(host);
  await act(async () => { await latest.flushCanvasSave('p1'); });
  expect(saveCanvasDoc).toHaveBeenCalledTimes(1);
  host.viewportRef.current = { x: 120, y: 80, zoom: 1.4 };
  let result = false;
  await act(async () => { result = await latest.flushCanvasSave('p1'); });
  expect(result).toBe(true);
  expect(saveCanvasDoc).toHaveBeenCalledTimes(1);
});

it('无变更的强制保存不刷新保存状态与时间', async () => {
  const host = buildHost();
  saveCanvasDoc.mockResolvedValue({ version: 2 });
  await render(host);
  await act(async () => { await latest.flushCanvasSave('p1'); });
  const statusCount = savedStatuses.length;
  const savedAtCount = savedAtCalls;
  let result = false;
  await act(async () => { result = await latest.flushCanvasSave('p1'); });
  expect(result).toBe(true);
  expect(saveCanvasDoc).toHaveBeenCalledTimes(1);
  expect(savedStatuses.length).toBe(statusCount);
  expect(savedAtCalls).toBe(savedAtCount);
});

function autosaveHost(): CanvasSaveHost {
  let host: CanvasSaveHost;
  host = buildHost({
    graph: { allNodes: () => host.textNodesRef.current },
    rollbackPendingNodes: () => {},
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  return host;
}

it('自动保存：仅视口变化不提交，真实内容变化仍提交并携带当前视口', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const host = autosaveHost();
    saveCanvasDoc.mockResolvedValue({ version: 2 });
    await render(host);
    await act(async () => { vi.advanceTimersByTime(800); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(saveCanvasDoc).toHaveBeenCalledTimes(1);

    const lastViewport: Viewport = { x: 320, y: 120, zoom: 2 };
    for (const viewport of [{ x: 120, y: 80, zoom: 1.4 }, { x: 240, y: 40, zoom: 0.8 }, lastViewport]) {
      await render({ ...host, viewport });
      await act(async () => { vi.advanceTimersByTime(800); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(saveCanvasDoc).toHaveBeenCalledTimes(1);
    }

    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(saveCanvasDoc).toHaveBeenCalledTimes(1);

    const grown: Node[] = [
      { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: {} },
      { id: 't2', type: 'textNode', position: { x: 40, y: 0 }, data: {} },
    ];
    host.textNodesRef.current = grown;
    await render({ ...host, viewport: lastViewport, textNodes: grown });
    await act(async () => { vi.advanceTimersByTime(800); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(saveCanvasDoc).toHaveBeenCalledTimes(2);
    expect(saveCanvasDoc.mock.calls[1][1].viewport).toEqual(lastViewport);
  } finally {
    vi.useRealTimers();
  }
});

it('慢保存在途：等待与回执期间不重复提交', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const host = autosaveHost();
    let resolveSave!: (value: { version: number }) => void;
    saveCanvasDoc.mockImplementationOnce(
      () => new Promise<{ version: number }>((resolve) => { resolveSave = resolve; }),
    );
    await render(host);
    await act(async () => { vi.advanceTimersByTime(800); });
    expect(saveCanvasDoc).toHaveBeenCalledTimes(1);

    await render({ ...host, viewport: { x: 160, y: 60, zoom: 1.2 } });
    await act(async () => { vi.advanceTimersByTime(3000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(saveCanvasDoc).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave({ version: 2 });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(host.versionRef.current).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasNodeDeletion, type CanvasNodeDeletionHost } from './useCanvasNodeDeletion';

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}
function node(id: string, data: Record<string, unknown> = {}): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data };
}
function edge(id: string, source: string, target: string): Edge {
  return { id, source, target, type: 'custom' };
}
function applyUpdater<T>(spy: ReturnType<typeof vi.fn>, prev: T): T {
  const updater = spy.mock.calls[spy.mock.calls.length - 1]![0] as SetStateAction<T>;
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
}

type Captured = ReturnType<typeof useCanvasNodeDeletion>;

let latest: Captured;

function buildHost(over: Partial<CanvasNodeDeletionHost> = {}): CanvasNodeDeletionHost {
  return {
    currentId: 'p1',
    mediaNodesRef: ref<Node[]>([]),
    textNodesRef: ref<Node[]>([]),
    productNodesRef: ref<Node[]>([]),
    assetNodesRef: ref<Node[]>([]),
    edgesRef: ref<Edge[]>([]),
    historyRef: ref(null),
    generationRuntimeRef: ref(null),
    activeJobByNodeRef: ref(new Map<string, string>()),
    pendingNodeIdsRef: ref(new Set<string>()),
    isGeneratingNode: () => false,
    setTextNodes: vi.fn() as unknown as Dispatch<SetStateAction<Node[]>>,
    setMediaNodes: vi.fn() as unknown as Dispatch<SetStateAction<Node[]>>,
    setProductNodes: vi.fn() as unknown as Dispatch<SetStateAction<Node[]>>,
    setAssetNodes: vi.fn() as unknown as Dispatch<SetStateAction<Node[]>>,
    setEdges: vi.fn() as unknown as Dispatch<SetStateAction<Edge[]>>,
    flushCanvasSave: vi.fn(async () => true),
    ...over,
  };
}

function Probe({ host }: { host: CanvasNodeDeletionHost }) {
  latest = useCanvasNodeDeletion(host);
  return null;
}

let root: Root;
let container: HTMLDivElement;

async function render(host: CanvasNodeDeletionHost) {
  await act(async () => { root.render(createElement(Probe, { host })); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it('空 id 列表：完全空操作', async () => {
  const host = buildHost();
  await render(host);
  latest.removeCanvasNodes([]);
  expect(host.setMediaNodes).not.toHaveBeenCalled();
  expect(host.setEdges).not.toHaveBeenCalled();
});

it('删除普通节点：走历史并过滤，不触发落盘', async () => {
  const pushDelete = vi.fn();
  const m = node('m1');
  const e = edge('e1', 'm1', 'other');
  const host = buildHost({
    mediaNodesRef: ref([m]),
    edgesRef: ref([e]),
    historyRef: ref({ pushDelete } as never),
  });
  await render(host);
  latest.removeCanvasNodes(['m1']);
  expect(pushDelete).toHaveBeenCalledTimes(1);
  expect(pushDelete.mock.calls[0]![0]).toEqual([m]);
  expect(applyUpdater(host.setMediaNodes as never, [m, node('m2')]).map((n) => n.id)).toEqual(['m2']);
  expect(host.flushCanvasSave).not.toHaveBeenCalled();
});

it('生成中节点：命中运行时认领则走 runtime.remove，不再走本地删除', async () => {
  const claims = vi.fn(() => true);
  const remove = vi.fn();
  const m = node('m1', { genStatus: 'generating' });
  const host = buildHost({
    mediaNodesRef: ref([m]),
    generationRuntimeRef: ref({ claims, remove } as never),
    isGeneratingNode: () => true,
  });
  await render(host);
  latest.removeCanvasNodes(['m1']);
  expect(remove).toHaveBeenCalledWith('m1');
  expect(host.setMediaNodes).not.toHaveBeenCalled();
});

it('生成中节点：未认领则本地删除并回收 blob url', async () => {
  const m = node('m1', { genStatus: 'generating', src: 'blob:xyz' });
  const host = buildHost({
    mediaNodesRef: ref([m]),
    generationRuntimeRef: ref({ claims: vi.fn(() => false), remove: vi.fn() } as never),
    isGeneratingNode: () => true,
  });
  await render(host);
  latest.removeCanvasNodes(['m1']);
  const result = applyUpdater(host.setMediaNodes as never, [m]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:xyz');
  expect(result).toEqual([]);
});

it('全部为生成中节点：idSet 为空，提前返回不写历史', async () => {
  const pushDelete = vi.fn();
  const m = node('m1', { genStatus: 'generating' });
  const host = buildHost({
    mediaNodesRef: ref([m]),
    historyRef: ref({ pushDelete } as never),
    generationRuntimeRef: ref({ claims: vi.fn(() => true), remove: vi.fn() } as never),
    isGeneratingNode: () => true,
  });
  await render(host);
  latest.removeCanvasNodes(['m1']);
  expect(pushDelete).not.toHaveBeenCalled();
});

it('音频混合节点被删：同步 ref 并触发落盘', async () => {
  const m = node('audio-mix-1');
  const host = buildHost({ mediaNodesRef: ref([m]) });
  await render(host);
  latest.removeCanvasNodes(['audio-mix-1']);
  expect(host.mediaNodesRef.current).toEqual([]);
  expect(host.flushCanvasSave).toHaveBeenCalledWith('p1');
});

it('removeAudioMixCardNow：清 ref、清在途任务并落盘', async () => {
  const m = node('audio-mix-1');
  const inFlight = new Map([['audio-mix-1', 'job']]);
  const host = buildHost({
    mediaNodesRef: ref([m]),
    edgesRef: ref([edge('e1', 'audio-mix-1', 'x')]),
    activeJobByNodeRef: ref(inFlight),
  });
  await render(host);
  latest.removeAudioMixCardNow('audio-mix-1');
  expect(host.mediaNodesRef.current).toEqual([]);
  expect(host.edgesRef.current).toEqual([]);
  expect(inFlight.has('audio-mix-1')).toBe(false);
  expect(host.flushCanvasSave).toHaveBeenCalledWith('p1');
});

it('handleRemoveMediaNode：委托给 removeCanvasNodes', async () => {
  const pushDelete = vi.fn();
  const m = node('m1');
  const host = buildHost({ mediaNodesRef: ref([m]), historyRef: ref({ pushDelete } as never) });
  await render(host);
  latest.handleRemoveMediaNode('m1');
  expect(pushDelete).toHaveBeenCalledTimes(1);
});

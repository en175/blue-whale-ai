// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasEdgeOps, type CanvasEdgeOpsHost } from './useCanvasEdgeOps';

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}
function edge(id: string, source: string, target: string, data: Record<string, unknown> = {}): Edge {
  return { id, source, target, type: 'custom', data };
}
function textNode(id: string, data: Record<string, unknown> = {}): Node {
  return { id, type: 'textNode', position: { x: 0, y: 0 }, data };
}

type Captured = ReturnType<typeof useCanvasEdgeOps>;

let latest: Captured;
let pushAddEdges: ReturnType<typeof vi.fn>;
let pushReplaceEdges: ReturnType<typeof vi.fn>;

function buildHost(over: Partial<CanvasEdgeOpsHost> = {}): CanvasEdgeOpsHost {
  return {
    edgesRef: ref<Edge[]>([]),
    setEdges: vi.fn() as unknown as Dispatch<SetStateAction<Edge[]>>,
    historyRef: ref({ pushAddEdges, pushReplaceEdges } as never),
    isApplying: () => false,
    findCanvasNode: () => undefined,
    getTextNodes: () => [],
    ...over,
  };
}

function Probe({ host }: { host: CanvasEdgeOpsHost }) {
  latest = useCanvasEdgeOps(host);
  return null;
}

let root: Root;
let container: HTMLDivElement;

async function render(host: CanvasEdgeOpsHost) {
  await act(async () => { root.render(createElement(Probe, { host })); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  pushAddEdges = vi.fn();
  pushReplaceEdges = vi.fn();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it('addCanvasEdge 新建：生成 id、走历史并写入 edges', async () => {
  const host = buildHost();
  await render(host);
  latest.addCanvasEdge('a', 'b', 'first', { origin: 'test' });
  expect(pushAddEdges).toHaveBeenCalledTimes(1);
  expect(host.edgesRef.current).toHaveLength(1);
  expect(host.edgesRef.current[0]).toMatchObject({ id: 'e-a-b', source: 'a', target: 'b', data: { refRole: 'first', origin: 'test' } });
});

it('addCanvasEdge 已存在且无 manual/角色变化：空操作', async () => {
  const host = buildHost({ edgesRef: ref([edge('e1', 'a', 'b')]) });
  await render(host);
  latest.addCanvasEdge('a', 'b');
  expect(pushReplaceEdges).not.toHaveBeenCalled();
  expect(pushAddEdges).not.toHaveBeenCalled();
  expect(host.edgesRef.current).toHaveLength(1);
});

it('addCanvasEdge 已存在且 inputSources 非 manual：标记为 manual', async () => {
  const host = buildHost({
    edgesRef: ref([edge('e1', 'a', 'b', { inputSources: { manual: false, planNodeIds: [] } })]),
  });
  await render(host);
  latest.addCanvasEdge('a', 'b');
  expect(pushReplaceEdges).toHaveBeenCalledTimes(1);
  expect((host.edgesRef.current[0]!.data as { inputSources: { manual: boolean } }).inputSources.manual).toBe(true);
});

it('addCanvasEdge 已存在且角色变化：更新 refRole', async () => {
  const host = buildHost({ edgesRef: ref([edge('e1', 'a', 'b', { refRole: 'reference' })]) });
  await render(host);
  latest.addCanvasEdge('a', 'b', 'first');
  expect((host.edgesRef.current[0]!.data as { refRole: string }).refRole).toBe('first');
});

it('removeTargetInputs：过滤边并走历史；applying 时空操作', async () => {
  const host = buildHost({ edgesRef: ref([edge('e1', 'a', 'b'), edge('e2', 'c', 'd')]) });
  await render(host);
  latest.removeTargetInputs(['e1']);
  expect(pushReplaceEdges).toHaveBeenCalledTimes(1);
  expect(host.edgesRef.current.map((e) => e.id)).toEqual(['e2']);

  const applying = buildHost({ edgesRef: ref([edge('e1', 'a', 'b')]), isApplying: () => true });
  await render(applying);
  latest.removeTargetInputs(['e1']);
  expect(applying.edgesRef.current).toHaveLength(1);
});

it('syncTextIndexEdges 新增：生成 textIndex 边', async () => {
  const host = buildHost();
  await render(host);
  latest.syncTextIndexEdges('t1', { added: ['s1'], removed: [] });
  expect(pushAddEdges).toHaveBeenCalledTimes(1);
  expect(host.edgesRef.current[0]).toMatchObject({ id: 'e-s1-t1', source: 's1', target: 't1', data: { textIndex: true } });
});

it('syncTextIndexEdges 移除：走 removeTargetInputs 删除既有边', async () => {
  const host = buildHost({ edgesRef: ref([edge('e-s1-t1', 's1', 't1', { textIndex: true })]) });
  await render(host);
  latest.syncTextIndexEdges('t1', { added: [], removed: ['s1'] });
  expect(pushReplaceEdges).toHaveBeenCalledTimes(1);
  expect(host.edgesRef.current).toHaveLength(0);
});

it('syncTextIndexEdges 新增已存在：不重复添加', async () => {
  const host = buildHost({ edgesRef: ref([edge('e-s1-t1', 's1', 't1', { textIndex: true })]) });
  await render(host);
  latest.syncTextIndexEdges('t1', { added: ['s1'], removed: [] });
  expect(pushAddEdges).not.toHaveBeenCalled();
  expect(host.edgesRef.current).toHaveLength(1);
});

it('connectPlanToDraft：为方案节点与目标建立带绑定标记的边', async () => {
  const host = buildHost({ getTextNodes: () => [textNode('p1')] });
  await render(host);
  latest.connectPlanToDraft('p1', 't1');
  expect(host.edgesRef.current).toHaveLength(1);
  expect(host.edgesRef.current[0]).toMatchObject({ id: 'e-p1-t1', source: 'p1', target: 't1' });
});

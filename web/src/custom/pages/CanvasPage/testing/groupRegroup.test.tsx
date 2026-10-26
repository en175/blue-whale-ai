// @vitest-environment jsdom
import { act } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exclusiveMembersInGroup, groupFrameBBox, groupToNode, type CanvasGroup } from '../graph/canvasGroups';
import {
  apiMocks, canvasDocMock, enableReactActEnvironment, flowProps,
  pressUndo, renderPage, unmountPage,
} from './canvasPageTestHarness';

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

function card(id: string, x: number, y = 0): Node {
  return { id, type: 'textNode', position: { x, y }, data: { title: id, text: `内容 ${id}` } };
}

function group(id: string, members: Node[], excludedIds: string[] = []): CanvasGroup {
  return { id, box: groupFrameBBox(members)!, excludedIds };
}

function seed(nodes: Node[], groups: CanvasGroup[], edges: Edge[] = []) {
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [...nodes, ...groups.map(groupToNode)], edges },
    assets: {}, refetch: async () => [], acceptDoc: vi.fn(),
  };
}

function groups(): CanvasGroup[] { return flowProps.current.groups; }
function nodes(): Node[] { return flowProps.current.textNodes; }
function members(g: CanvasGroup): string[] {
  return exclusiveMembersInGroup(nodes(), g, groups()).map(n => n.id);
}

async function regroup(ids: string[], measuredNodes = nodes()) {
  await act(async () => { flowProps.current.onCreateGroup(measuredNodes.filter(n => ids.includes(n.id)), measuredNodes); });
}

async function redo() {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
  });
}

async function saveAndReopen() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
  const payload = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
  await unmountPage();
  canvasDocMock.current.doc = { id: 11, version: 4, ...payload };
  await renderPage();
  return payload;
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('页面测试禁止真实出网'); }));
});
afterEach(async () => {
  await unmountPage();
  vi.unstubAllGlobals();
});

describe('IKI6C1 合并成组', () => {
  it.each([1, 2])('旧组剩 %i 个成员时收尾，新组不吸收矩形内未选节点，撤销重做保持一致', async (remainingCount) => {
    const cards = [card('1', 0), card('2', 300), card('3', 0, 400), ...(remainingCount === 2 ? [card('4', 300, 400)] : []), card('X', 900), card('U', 600)];
    const old = group('A', cards.filter(n => !['X', 'U'].includes(n.id)));
    seed(cards, [old]);
    await renderPage();
    const beforeNodes = nodes();
    await regroup(['1', '2', 'X']);
    expect(groups()).toHaveLength(remainingCount === 1 ? 1 : 2);
    expect(members(groups().at(-1)!)).toEqual(['1', '2', 'X']);
    expect(groups().some(g => members(g).includes('U'))).toBe(false);
    if (remainingCount === 1) expect(groups().some(g => members(g).includes('3'))).toBe(false);
    const after = groups();
    expect(nodes()).toEqual(beforeNodes);
    await pressUndo();
    expect(groups()).toEqual([old]);
    await redo();
    expect(groups()).toEqual(after);
    const payload = await saveAndReopen();
    expect(groups()).toEqual(after);
    expect((payload.nodes as Node[]).filter(n => n.type === 'groupFrame').map(n => n.id)).toEqual(after.map(g => g.id));
    expect(nodes().map(n => ({ id: n.id, position: n.position, text: n.data.text }))).toEqual(cards.map(n => ({ id: n.id, position: n.position, text: n.data.text })));
  });

  it('多个完整旧组一次合并，重叠组框仍保持唯一成员归属', async () => {
    const cards = [card('1', 0), card('2', 600), card('3', 300), card('4', 900)];
    const a = group('A', [cards[0], cards[1]], ['3']);
    const b = group('B', [cards[2], cards[3]], ['2']);
    seed(cards, [a, b]);
    await renderPage();
    expect(members(groups()[0])).toEqual(['1', '2']);
    expect(members(groups()[1])).toEqual(['3', '4']);
    await regroup(['1', '2', '3', '4']);
    expect(groups()).toHaveLength(1);
    expect(members(groups()[0])).toEqual(['1', '2', '3', '4']);
    await pressUndo();
    expect(groups()).toEqual([a, b]);
  });

  it('部分重组按剩余节点的实际尺寸收紧，排除留白内的独立节点', async () => {
    const cards = [card('1', 0), card('2', 300), card('3', 0, 400), card('4', 300, 400), card('X', 900), card('U', 250, 410)];
    const measured = cards.map(n => ({ ...n, measured: { width: n.id === '4' ? 500 : 200, height: 120 } }));
    const old = group('A', measured.slice(0, 4), ['U']);
    old.box = { x: -100, y: -100, w: 1100, h: 800 };
    seed(cards, [old]);
    await renderPage();
    await regroup(['1', '2', 'X'], measured);
    expect(groups()[0].box).toEqual({ x: -48, y: 352, w: 896, h: 216 });
    expect(members(groups()[0])).toEqual(['3', '4']);
    expect(members(groups()[1])).toEqual(['1', '2', 'X']);
    await pressUndo();
    expect(groups()).toEqual([old]);
  });

  it('完整旧组加独立节点只留下新组，一次撤销和重做整体恢复', async () => {
    const cards = [card('1', 0), card('2', 300), card('X', 600)];
    const old = group('A', cards.slice(0, 2));
    seed(cards, [old], [{ id: 'e1', source: '1', target: '2' }]);
    await renderPage();
    const beforeNodes = nodes();
    const beforeEdges = flowProps.current.edges;

    await regroup(['1', '2', 'X']);
    expect(groups()).toHaveLength(1);
    expect(groups()[0].id).not.toBe('A');
    expect(members(groups()[0])).toEqual(['1', '2', 'X']);
    expect(nodes()).toEqual(beforeNodes);
    expect(flowProps.current.edges).toEqual(beforeEdges);
    const after = groups();

    await pressUndo();
    expect(groups()).toEqual([old]);
    expect(members(groups()[0])).toEqual(['1', '2']);
    await redo();
    expect(groups()).toEqual(after);
    const payload = await saveAndReopen();
    expect(groups()).toEqual(after);
    expect(payload.edges).toEqual(beforeEdges);
  });
});

describe('IKI6C1 历史空组清理', () => {
  it.each([false, true])('加载失败时不清理历史组，含内容节点=%s', async (hasContent) => {
    const cards = hasContent ? [card('1', 0)] : [];
    const empty = { id: 'empty', box: { x: 2000, y: 2000, w: 600, h: 400 }, excludedIds: [] };
    seed(cards, [empty]);
    canvasDocMock.current.loadFailed = true;
    await renderPage();
    await act(async () => { flowProps.current.onNodesMeasured(nodes().map((node) => ({ ...node, measured: { width: 200, height: 120 } }))); });
    expect(groups()).toEqual([empty]);
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });

  it('延迟测量时删除历史单节点组的成员，清理后撤销恢复被删节点且保留单节点组', async () => {
    const cards = [card('1', 0), card('2', 300)];
    const singleton = { id: 'single', box: { x: -48, y: -48, w: 116, h: 116 }, excludedIds: [] };
    const empty = { id: 'empty', box: { x: -48, y: -48, w: 600, h: 216 }, excludedIds: ['1', '2'] };
    seed(cards, [empty, singleton]);
    await renderPage();
    await act(async () => { flowProps.current.onDeleteNode(['1']); });
    await act(async () => { flowProps.current.onNodesMeasured(nodes().map(n => ({ ...n, measured: { width: 20, height: 20 } }))); });
    expect(groups()).toEqual([singleton]);
    await pressUndo();
    expect(nodes().map(n => n.id)).toContain('1');
    expect(groups()).toEqual([singleton]);
  });

  it.each(['drag', 'delete'])('延迟测量期间发生 %s 后仍清理历史空组，保留普通拖动后的有效组', async action => {
    const cards = [card('1', 0), card('2', 300), card('3', 900)];
    const old = group('A', cards.slice(0, 2));
    const empty = { id: 'empty', box: old.box, excludedIds: ['1', '2'] };
    seed(cards, [old, empty]);
    await renderPage();
    if (action === 'drag') {
      const moved = { ...nodes()[0], position: { x: 3000, y: 0 }, measured: { width: 200, height: 120 } };
      await act(async () => { flowProps.current.onNodeDragStop(moved, [moved]); });
    } else {
      await act(async () => { flowProps.current.onDeleteNode(['3']); });
    }
    const measured = nodes().map(n => ({ ...n, measured: { width: 200, height: 120 } }));
    await act(async () => { flowProps.current.onNodesMeasured(measured); });
    expect(groups()).toEqual([old]);
    if (action === 'drag') expect(members(groups()[0])).toEqual(['2']);
  });

  it('延迟测量窗口内把节点拖进历史空框后，恢复清理保留该组', async () => {
    const cards = [card('1', 0)];
    const empty = { id: 'empty', box: { x: 500, y: 0, w: 400, h: 400 }, excludedIds: [] };
    seed(cards, [empty]);
    await renderPage();
    const measured = nodes().map(n => ({ ...n, measured: { width: 200, height: 120 } }));
    const moved = { ...measured[0], position: { x: 700, y: 100 } };
    await act(async () => { flowProps.current.onNodeDragStop(moved, [moved]); });
    const measuredAfterDrag = nodes().map(n => ({ ...n, measured: { width: 200, height: 120 } }));
    await act(async () => { flowProps.current.onNodesMeasured(measuredAfterDrag); });
    expect(groups()).toEqual([empty]);
  });

  it('仅含历史空框的文档完成恢复后清理并保存空文档', async () => {
    seed([], [{ id: 'empty', box: { x: 0, y: 0, w: 600, h: 400 }, excludedIds: [] }]);
    await renderPage();
    expect(groups()).toEqual([]);
    const payload = await saveAndReopen();
    expect(payload.nodes).toEqual([]);
    expect(groups()).toEqual([]);
  });

  it('恢复清理只执行一次，后续普通拖动不会自动解组或收紧组框', async () => {
    const cards = [card('1', 0), card('2', 300)];
    const old = group('A', cards);
    seed(cards, [old]);
    await renderPage();
    const measured = nodes().map(n => ({ ...n, measured: { width: 200, height: 120 } }));
    await act(async () => { flowProps.current.onNodesMeasured(measured); });
    const dragged = measured.map(n => ({ ...n, position: { x: n.position.x + 2000, y: 0 } }));
    await act(async () => { flowProps.current.onNodeDragStop(dragged[0], dragged); });
    await act(async () => { flowProps.current.onNodesMeasured(dragged); });
    expect(groups()).toEqual([old]);
    expect(members(groups()[0])).toEqual([]);
  });

  it('等待全部节点实测恢复才清理空组，保留历史单节点组与连线，并保存清理结果', async () => {
    const cards = [card('1', 0), card('2', 300)];
    const singleton = { id: 'single', box: { x: -48, y: -48, w: 116, h: 116 }, excludedIds: [] };
    const empty = { id: 'empty', box: { x: -48, y: -48, w: 600, h: 216 }, excludedIds: ['1', '2'] };
    seed(cards, [empty, singleton], [{ id: 'e1', source: '1', target: '2' }]);
    await renderPage();
    expect(groups()).toEqual([empty, singleton]);
    const beforeNodes = nodes();
    const beforeEdges = flowProps.current.edges;
    const measured = nodes().map(n => ({ ...n, measured: { width: 20, height: 20 } }));
    await act(async () => { flowProps.current.onNodesMeasured(nodes()); });
    expect(groups()).toEqual([empty, singleton]);
    await act(async () => { flowProps.current.onNodesMeasured(measured.slice(0, 1)); });
    expect(groups()).toEqual([empty, singleton]);
    await act(async () => { flowProps.current.onNodesMeasured(measured); });
    expect(groups()).toEqual([singleton]);
    expect(nodes()).toEqual(beforeNodes);
    expect(flowProps.current.edges).toEqual(beforeEdges);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
    const payload = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect((payload.nodes as Node[]).filter(n => n.type === 'groupFrame').map(n => n.id)).toEqual(['single']);
    expect((payload.nodes as Node[]).filter(n => n.type !== 'groupFrame').map(n => n.id)).toEqual(['1', '2']);
    expect(payload.edges).toEqual(beforeEdges);
    await unmountPage();
    canvasDocMock.current.doc = { id: 11, version: 4, ...payload };
    apiMocks.saveCanvasDoc.mockClear();
    await renderPage();
    await act(async () => { flowProps.current.onNodesMeasured(measured); });
    expect(groups()).toEqual([singleton]);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });
});

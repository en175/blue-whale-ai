// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Connection, Edge, Node } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../videoModes', () => ({ draftVideoModeOf: () => null }));
vi.mock('@/app/utils/video-modes', () => ({
  frameSlotCountOf: () => 0,
  isFrameMode: () => false,
}));
vi.mock('../videoMediaRefs', () => ({ mergedVideoMediaRefsOf: () => ({}) }));
vi.mock('../mediaRefs', () => ({ imageRefSourceError: () => null }));
vi.mock('../audioVideoMux', () => ({
  AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON: '音视频合成绑定边锁定',
  audioVideoMuxIdentityOf: () => null,
  isAudioVideoMuxAudioEdge: () => false,
  isAudioVideoMuxBindEdge: () => false,
}));

import { useCanvasConnectPair, type CanvasConnectPairHost } from './useCanvasConnectPair';

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}
function mediaNode(id: string, mediaType: 'image' | 'video' | 'audio', extra: Record<string, unknown> = {}): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data: { src: `${id}.png`, mediaType, ...extra } };
}
function genNode(id: string, mediaType: 'image' | 'video' | 'audio'): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true, mediaType } };
}
function textNode(id: string, extra: Record<string, unknown> = {}): Node {
  return { id, type: 'textNode', position: { x: 0, y: 0 }, data: extra };
}

type Captured = ReturnType<typeof useCanvasConnectPair>;

let latest: Captured;

function buildHost(over: Partial<CanvasConnectPairHost> = {}): CanvasConnectPairHost {
  return {
    isApplying: () => false,
    showToast: vi.fn(),
    isGeneratingNode: () => false,
    findCanvasNode: () => undefined,
    edgesRef: ref<Edge[]>([]),
    getMediaNodes: () => [],
    toolConnect: () => null,
    addCanvasEdge: vi.fn(),
    connectPlanToDraft: vi.fn(),
    removeTargetInputs: vi.fn(),
    validateImageRefConnect: () => true,
    validateVideoRefConnect: () => true,
    validateAudioRefConnect: () => true,
    validateAudioTextConnect: () => true,
    withHistoryBatch: (fn: () => void) => fn(),
    patchMediaNode: vi.fn(),
    onEdgesChange: vi.fn(),
    setEdges: vi.fn() as unknown as Dispatch<SetStateAction<Edge[]>>,
    submittingNodeId: null,
    ...over,
  };
}

function Probe({ host }: { host: CanvasConnectPairHost }) {
  latest = useCanvasConnectPair(host);
  return null;
}

let root: Root;
let container: HTMLDivElement;

async function render(host: CanvasConnectPairHost) {
  await act(async () => { root.render(createElement(Probe, { host })); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it('connectPair：isApplying 为真时空操作', async () => {
  const host = buildHost({ isApplying: () => true });
  await render(host);
  expect(latest.connectPair('a', 'b')).toBe(false);
  expect(host.addCanvasEdge).not.toHaveBeenCalled();
});

it('connectPair：目标生成中，toast 并返回 false', async () => {
  const host = buildHost({ isGeneratingNode: () => true });
  await render(host);
  expect(latest.connectPair('a', 'b')).toBe(false);
  expect(host.showToast).toHaveBeenCalledWith('warn', '生成中，输入连线只读');
});

it('connectPair：自连或空 id 返回 false', async () => {
  const host = buildHost();
  await render(host);
  expect(latest.connectPair('a', 'a')).toBe(false);
  expect(latest.connectPair('', 'b')).toBe(false);
});

it('connectPair：工具会话接管控权则直接返回其结果，不落边', async () => {
  const host = buildHost({
    findCanvasNode: (id) => (id === 'a' ? mediaNode('a', 'image') : genNode('b', 'image')),
    toolConnect: () => true,
  });
  await render(host);
  expect(latest.connectPair('a', 'b')).toBe(true);
  expect(host.addCanvasEdge).not.toHaveBeenCalled();
});

it('connectPair：媒体到文本卡节点被拦并 toast', async () => {
  const host = buildHost({
    findCanvasNode: (id) => (id === 'a' ? mediaNode('a', 'image') : textNode('b')),
  });
  await render(host);
  expect(latest.connectPair('a', 'b')).toBe(false);
  expect(host.showToast).toHaveBeenCalledWith('warn', '媒体到文本卡的关系线由正文 @ 索引建立');
});

it('connectPair：成环时返回 false', async () => {
  const host = buildHost({
    findCanvasNode: (id) => (id === 'a' ? mediaNode('a', 'image') : genNode('b', 'image')),
    edgesRef: ref<Edge[]>([{ id: 'e-b-a', source: 'b', target: 'a', type: 'custom' }]),
  });
  await render(host);
  expect(latest.connectPair('a', 'b')).toBe(false);
  expect(host.addCanvasEdge).not.toHaveBeenCalled();
});

it('connectPair：合法媒体→图片目标时新增边', async () => {
  const host = buildHost({
    findCanvasNode: (id) => (id === 'a' ? mediaNode('a', 'image') : genNode('b', 'image')),
  });
  await render(host);
  expect(latest.connectPair('a', 'b')).toBe(true);
  expect(host.addCanvasEdge).toHaveBeenCalledWith('a', 'b', undefined);
});

it('connectPair：文本卡带 promptSource→图片走 connectPlanToDraft', async () => {
  const host = buildHost({
    findCanvasNode: (id) => (id === 'a' ? textNode('a', { promptSource: true }) : genNode('b', 'image')),
  });
  await render(host);
  expect(latest.connectPair('a', 'b')).toBe(true);
  expect(host.connectPlanToDraft).toHaveBeenCalledWith('a', 'b');
  expect(host.addCanvasEdge).not.toHaveBeenCalled();
});

it('handleConnect：委托 connectPair', async () => {
  const host = buildHost({
    findCanvasNode: (id) => (id === 'a' ? mediaNode('a', 'image') : genNode('b', 'image')),
  });
  await render(host);
  latest.handleConnect({ source: 'a', target: 'b' } as Connection);
  expect(host.addCanvasEdge).toHaveBeenCalledTimes(1);
});

it('handleConnectGroupToTarget：批量经 withHistoryBatch 调 connectPair', async () => {
  const withHistoryBatch = vi.fn((fn: () => void) => fn());
  const host = buildHost({
    findCanvasNode: (id) => (id.startsWith('m') ? mediaNode(id, 'image') : genNode('t', 'image')),
    withHistoryBatch,
  });
  await render(host);
  latest.handleConnectGroupToTarget(['m1', 'm2'], 't');
  expect(withHistoryBatch).toHaveBeenCalledTimes(1);
  expect(host.addCanvasEdge).toHaveBeenCalledTimes(2);
});

it('guardEdgesChange：生成中节点的删除被拦并 toast', async () => {
  const host = buildHost({
    isGeneratingNode: (id) => id === 't',
    edgesRef: ref<Edge[]>([{ id: 'e1', source: 's', target: 't', type: 'custom' }]),
  });
  await render(host);
  latest.guardEdgesChange([{ id: 'e1', type: 'remove' }] as never);
  expect(host.showToast).toHaveBeenCalledWith('warn', '生成中，输入连线只读');
  expect(host.removeTargetInputs).not.toHaveBeenCalled();
  expect(host.onEdgesChange).not.toHaveBeenCalled();
});

it('guardEdgesChange：普通删除经 removeTargetInputs，非删除变更透传 onEdgesChange', async () => {
  const host = buildHost({
    edgesRef: ref<Edge[]>([{ id: 'e1', source: 's', target: 't', type: 'custom' }]),
  });
  await render(host);
  latest.guardEdgesChange([
    { id: 'e1', type: 'remove' },
    { id: 'e2', type: 'select', selected: true },
  ] as never);
  expect(host.removeTargetInputs).toHaveBeenCalledWith(['e1']);
  expect(host.onEdgesChange).toHaveBeenCalledWith([{ id: 'e2', type: 'select', selected: true }]);
});

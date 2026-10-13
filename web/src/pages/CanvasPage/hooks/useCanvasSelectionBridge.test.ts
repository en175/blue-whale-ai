// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Node } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasSelectionBridge, type CanvasSelectionBridgeHost } from './useCanvasSelectionBridge';

function mediaNode(id: string, data: Record<string, unknown> = {}, selected = true): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data, selected };
}

type Captured = ReturnType<typeof useCanvasSelectionBridge>;

let latest: Captured;

function buildHost(over: Partial<CanvasSelectionBridgeHost> = {}): CanvasSelectionBridgeHost {
  return {
    mediaNodesRef: { current: [] },
    pickMode: null,
    pickTarget: null,
    onSelectionChange: vi.fn(() => false),
    editSessionActive: false,
    draftOfNode: vi.fn(() => null),
    hasGenerationRecord: vi.fn(() => false),
    showImageDialog: false,
    showBottomDialog: false,
    showAudioDialog: false,
    imageDraftId: null,
    videoDraftId: null,
    audioDraftId: null,
    openMediaDraftDialog: vi.fn(),
    setSoloSelectedNodeId: vi.fn(),
    selection: vi.fn(),
    submittingNodeId: null,
    ...over,
  };
}

function Probe({ host }: { host: CanvasSelectionBridgeHost }) {
  latest = useCanvasSelectionBridge(host);
  return null;
}

let root: Root;
let container: HTMLDivElement;

async function render(host: CanvasSelectionBridgeHost) {
  await act(async () => { root.render(createElement(Probe, { host })); });
}

function select(nodes: Node[]) {
  latest.handleSelectionChangeStable({ nodes } as never);
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

it('挑选模式下只更新 solo 选中，不下发选择事件', async () => {
  const host = buildHost({ pickMode: 'image' });
  await render(host);
  select([mediaNode('m1')]);
  expect(host.setSoloSelectedNodeId).toHaveBeenCalledWith('m1');
  expect(host.onSelectionChange).not.toHaveBeenCalled();
  expect(host.selection).not.toHaveBeenCalled();
});

it('单选普通媒体节点：下发 selection，不打开草稿对话框', async () => {
  const host = buildHost({ mediaNodesRef: { current: [mediaNode('m1', { mediaType: 'image' })] } });
  await render(host);
  select([mediaNode('m1', { mediaType: 'image' })]);
  expect(host.openMediaDraftDialog).not.toHaveBeenCalled();
  expect(host.selection).toHaveBeenCalledWith({
    soloId: 'm1', multiSelect: false, editing: false, submittingNodeId: null,
  });
});

it('单选草稿节点且面板未开：打开草稿对话框并早退', async () => {
  const node = mediaNode('m1', { draft: true, mediaType: 'image' });
  const host = buildHost({
    mediaNodesRef: { current: [node] },
    openMediaDraftDialog: vi.fn(() => undefined),
  });
  await render(host);
  select([node]);
  expect(host.openMediaDraftDialog).toHaveBeenCalledWith('m1', 'image', 'selection');
  expect(host.selection).not.toHaveBeenCalled();
});

it('打开草稿对话框返回 false：继续下发 selection', async () => {
  const node = mediaNode('m1', { draft: true, mediaType: 'video' });
  const host = buildHost({
    mediaNodesRef: { current: [node] },
    openMediaDraftDialog: vi.fn(() => false),
  });
  await render(host);
  select([node]);
  expect(host.openMediaDraftDialog).toHaveBeenCalledWith('m1', 'video', 'selection');
  expect(host.selection).toHaveBeenCalled();
});

it('工具会话 consume 选择事件时早退', async () => {
  const node = mediaNode('m1', { draft: true, mediaType: 'image' });
  const host = buildHost({
    mediaNodesRef: { current: [node] },
    onSelectionChange: vi.fn(() => true),
  });
  await render(host);
  select([node]);
  expect(host.openMediaDraftDialog).not.toHaveBeenCalled();
  expect(host.selection).not.toHaveBeenCalled();
});

it('显式取消选中节点在另有选中媒体时被过滤出候选', async () => {
  const deselected = mediaNode('m1', {}, false);
  const selected = mediaNode('m2');
  const host = buildHost({ mediaNodesRef: { current: [deselected, selected] } });
  await render(host);
  select([deselected, selected]);
  expect(host.selection).toHaveBeenCalledWith({
    soloId: 'm2', multiSelect: false, editing: false, submittingNodeId: null,
  });
});

it('多选时 soloId 为空且 multiSelect 为真', async () => {
  const a = mediaNode('a', { genStatus: 'generating' });
  const b = mediaNode('b');
  const host = buildHost({ mediaNodesRef: { current: [a, b] } });
  await render(host);
  select([a, b]);
  expect(host.selection).toHaveBeenCalledWith({
    soloId: null, multiSelect: true, editing: false, submittingNodeId: null,
  });
});

it('重渲染后稳定回调引用不变', async () => {
  const host = buildHost();
  await render(host);
  const first = latest.handleSelectionChangeStable;
  await act(async () => { root.render(createElement(Probe, { host: { ...host } })); });
  expect(latest.handleSelectionChangeStable).toBe(first);
});

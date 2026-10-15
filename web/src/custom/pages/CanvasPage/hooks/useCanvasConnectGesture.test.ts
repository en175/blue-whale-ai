// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Edge, Node } from '@xyflow/react';
import type { GenerationModel } from '@/custom/api/generation';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { availableGenKinds, isConnectableSource } from '../connectAbility';
import { audioRefSourceError } from '../audioMediaRefs';
import { imageRefSourceError } from '../mediaRefs';
import { mergedVideoMediaRefsOf, videoRefSourceError } from '../videoMediaRefs';
import { useCanvasConnectHandlers } from './useCanvasConnectHandlers';
import { useCanvasConnectSurface } from './useCanvasConnectSurface';
import { useCanvasHistory, type CanvasHistoryApi } from './useCanvasHistory';

function mediaNode(id: string, extra: Record<string, unknown> = {}): Node {
  return {
    id, type: 'mediaNode', position: { x: 0, y: 0 },
    data: { src: `https://example.com/${id}.png`, assetId: id, mediaType: 'image', ...extra },
  };
}

function createFixture() {
  const source = mediaNode('101');
  const draft = mediaNode('draft', { draft: true, genStatus: 'draft', mediaType: 'video', draftMode: 'omni' });
  const mediaNodesRef = { current: [source, draft] };
  const videoModelsRef = { current: [] as GenerationModel[] };
  const generatingNodes = new Set<string>();
  const edgesRef = { current: [] as Edge[] };
  const historyRef = { current: null as CanvasHistoryApi | null };
  const connectingSourceRef = { current: source.id as string | null };
  const setEdges: Parameters<typeof useCanvasConnectSurface>[0]['setEdges'] = (next) => {
    edgesRef.current = typeof next === 'function' ? next(edgesRef.current) : next;
  };
  const findCanvasNode = (id: string) => mediaNodesRef.current.find(node => node.id === id);
  const showToast = vi.fn();
  const setConnectMenu = vi.fn();
  const wireStart = vi.fn();
  let connect!: ReturnType<typeof useCanvasConnectSurface>;
  let handlers!: ReturnType<typeof useCanvasConnectHandlers>;
  let history!: CanvasHistoryApi;

  function Probe() {
    history = useCanvasHistory({
      getTextNodes: () => [], getMediaNodes: () => mediaNodesRef.current,
      getProductNodes: () => [], getAssetNodes: () => [], getEdges: () => edgesRef.current,
      getGroups: () => [], setTextNodes: () => {}, setMediaNodes: () => {},
      setProductNodes: () => {}, setAssetNodes: () => {}, setEdges, setGroups: () => {}, historyRef,
    });
    connect = useCanvasConnectSurface({
      edgesRef, setEdges, setTextNodes: () => {}, historyRef,
      isApplying: () => false, findCanvasNode, textNodesRef: { current: [] }, mediaNodesRef,
      videoModelsRef, imageModelsRef: { current: [] },
      isGeneratingNode: id => generatingNodes.has(id), showToast, toolConnect: () => null,
      withHistoryBatch: fn => fn(), patchMediaNode: () => {}, onEdgesChange: () => {}, submittingNodeId: null,
    });
    handlers = useCanvasConnectHandlers({
      connectMenu: null, connectingSourceRef, edgesRef, findCanvasNode,
      isConnectableSource, availableGenKinds, setConnectMenu,
      addCanvasEdge: connect.addCanvasEdge, connectPlanToDraft: connect.connectPlanToDraft,
      connectPair: connect.connectPair, videoRefSourceError, imageRefSourceError, audioRefSourceError,
      spawnNearScreen: point => point, withHistoryBatch: fn => fn(),
      creators: {
        createVideoDraftCard: () => '', createImageDraftCard: () => '',
        createAudioDraftCard: () => '', createTextGenDraft: () => '',
      },
      openVideoDraftDialog: () => {}, openImageDraftDialog: () => {},
      openAudioDraftDialog: () => {}, openTextGenDialog: () => {}, toolSessions: { wireStart },
    });
    return null;
  }

  return {
    Probe, source, draft, mediaNodesRef, videoModelsRef, generatingNodes,
    edgesRef, connectingSourceRef, showToast, setConnectMenu, wireStart,
    get connect() { return connect; }, get handlers() { return handlers; }, get history() { return history; },
    refs: () => mergedVideoMediaRefsOf(draft.id, edgesRef.current, mediaNodesRef.current),
    dragToHandle: (node = source) => {
      connectingSourceRef.current = node.id;
      connect.handleConnect({ source: node.id, target: draft.id, sourceHandle: null, targetHandle: null });
      handlers.handleConnectEnd(new MouseEvent('mouseup'), {
        fromNode: node, toNode: draft, toHandle: { nodeId: draft.id }, isValid: true,
      });
    },
  };
}

let root: Root;
let container: HTMLDivElement;
const elementsFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (elementsFromPointDescriptor) Object.defineProperty(document, 'elementsFromPoint', elementsFromPointDescriptor);
  else Reflect.deleteProperty(document, 'elementsFromPoint');
  vi.restoreAllMocks();
});

async function renderFixture(configure?: (fixture: ReturnType<typeof createFixture>) => void) {
  const fixture = createFixture();
  configure?.(fixture);
  await act(async () => root.render(createElement(fixture.Probe)));
  return fixture;
}

it('首次拖线到视频草稿只添加一个参考，无重复警告，撤销一次可移除连接', async () => {
  const fixture = await renderFixture();
  await act(async () => fixture.dragToHandle());
  expect(fixture.edgesRef.current).toHaveLength(1);
  expect(fixture.refs().reference.map(ref => ref.assetId)).toEqual(['101']);
  expect(fixture.showToast).not.toHaveBeenCalled();
  expect(fixture.connectingSourceRef.current).toBeNull();
  expect(fixture.wireStart).toHaveBeenCalledWith(null);
  await act(async () => fixture.history.undo());
  expect(fixture.edgesRef.current).toEqual([]);
  expect(fixture.refs().reference).toEqual([]);
  expect(fixture.history.canUndo).toBe(false);
});

it.each(['video', 'audio'])('%s 首次拖线作为普通参考时无重复警告', async mediaType => {
  const fixture = await renderFixture(({ source }) => { source.data.mediaType = mediaType; });
  await act(async () => fixture.dragToHandle());
  expect(fixture.edgesRef.current).toHaveLength(1);
  expect(fixture.refs().reference.map(ref => ref.mediaType)).toEqual([mediaType]);
  expect(fixture.showToast).not.toHaveBeenCalled();
});

it.each(['first_frame', 'first_last_frame'])('%s 首尾帧拖线无重复警告或帧位误报', async draftMode => {
  const fixture = await renderFixture(({ draft }) => { draft.data.draftMode = draftMode; });
  await act(async () => fixture.dragToHandle());
  expect(fixture.refs().first?.assetId).toBe('101');
  if (draftMode === 'first_last_frame') {
    const last = mediaNode('102');
    fixture.mediaNodesRef.current.push(last);
    await act(async () => fixture.dragToHandle(last));
    expect(fixture.refs().last?.assetId).toBe('102');
  }
  expect(fixture.edgesRef.current).toHaveLength(draftMode === 'first_frame' ? 1 : 2);
  expect(fixture.refs().reference).toEqual([]);
  expect(fixture.showToast).not.toHaveBeenCalled();
});

it.each(['same-node', 'same-asset', 'same-material'])('另一次独立拖线保留 %s 的素材重复提示', async identity => {
  const fixture = await renderFixture(({ source }) => { source.data.materialId = 'material-101'; });
  await act(async () => fixture.dragToHandle());
  fixture.showToast.mockClear();
  const source = identity === 'same-node' ? fixture.source : mediaNode('102', {
    assetId: identity === 'same-asset' ? '101' : '102',
    materialId: identity === 'same-material' ? 'material-101' : 'material-102',
  });
  if (identity !== 'same-node') fixture.mediaNodesRef.current.push(source);
  await act(async () => fixture.dragToHandle(source));
  expect(fixture.edgesRef.current).toHaveLength(1);
  expect(fixture.refs().reference).toHaveLength(1);
  expect(fixture.showToast.mock.calls).toEqual([['warn', '重复的素材已跳过']]);
});

it('拖线释放到节点卡面仍连接一次', async () => {
  const fixture = await renderFixture();
  const nodeElement = document.createElement('div');
  nodeElement.className = 'react-flow__node';
  nodeElement.setAttribute('data-id', fixture.draft.id);
  container.appendChild(nodeElement);
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [nodeElement] });
  await act(async () => fixture.handlers.handleConnectEnd(new MouseEvent('mouseup'), {
    fromNode: fixture.source, toNode: null, toHandle: null, isValid: false,
  }));
  expect(fixture.edgesRef.current).toHaveLength(1);
  expect(fixture.refs().reference.map(ref => ref.assetId)).toEqual(['101']);
  expect(fixture.showToast).not.toHaveBeenCalled();
  expect(fixture.setConnectMenu).not.toHaveBeenCalled();
});

it('拖线释放到画布空白处仍打开类型菜单', async () => {
  const fixture = await renderFixture();
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [] });
  fixture.handlers.handleConnectEnd(new MouseEvent('mouseup', { clientX: 120, clientY: 240 }), {
    fromNode: fixture.source, isValid: false,
  });
  expect(fixture.setConnectMenu).toHaveBeenCalledWith({ sourceIds: ['101'], x: 120, y: 240 });
  expect(fixture.edgesRef.current).toEqual([]);
  expect(fixture.showToast).not.toHaveBeenCalled();
});

it('有效连线被生成中只读拦截时仅提示一次', async () => {
  const fixture = await renderFixture(({ draft, generatingNodes }) => generatingNodes.add(draft.id));
  await act(async () => fixture.dragToHandle());
  expect(fixture.edgesRef.current).toEqual([]);
  expect(fixture.showToast.mock.calls).toEqual([['warn', '生成中，输入连线只读']]);
  expect(fixture.setConnectMenu).not.toHaveBeenCalled();
});

it('模型参考上限仍阻止新增素材且同一次手势仅提示一次', async () => {
  const fixture = await renderFixture(({ draft, videoModelsRef }) => {
    draft.data.draftModelId = 'fixture-video';
    videoModelsRef.current = [{
      model_id: 'fixture-video', provider_id: 'fixture', model_label: 'Fixture', icon: null,
      supported_sizes: [], supported_aspect_ratios: [], supported_formats: [], supported_durations: null,
      default_size: null, default_format: null, default_aspect_ratio: null, default_duration: null,
      features: {
        reference_image: true, watermark: false, quantity_max: 1, sequential_image_generation: false,
        stream: false, tools: false, first_frame: true, last_frame: true, first_last_frame: true,
        audio: true, video_reference: true, audio_reference: true, image_reference_max: 1,
      },
      is_default: true, version: 1, digest: 'fixture',
    }];
  });
  await act(async () => fixture.dragToHandle());
  const next = mediaNode('102');
  fixture.mediaNodesRef.current.push(next);
  fixture.showToast.mockClear();
  await act(async () => fixture.dragToHandle(next));
  expect(fixture.edgesRef.current).toHaveLength(1);
  expect(fixture.refs().reference.map(ref => ref.assetId)).toEqual(['101']);
  expect(fixture.showToast.mock.calls).toEqual([['warn', '参考图最多 1 张']]);
});

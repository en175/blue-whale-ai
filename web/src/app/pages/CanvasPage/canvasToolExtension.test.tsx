// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MediaNodeData } from './components/MediaNode';
import { canvasDocMock, enableReactActEnvironment, mediaNodes, renderPage, unmountPage, flowProps } from './testing/canvasPageTestHarness';

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
vi.mock('./canvasToolSessions', async (importOriginal) => {
  const original = await importOriginal<typeof import('./canvasToolSessions')>();
  const { assembleCanvasTools, registerCanvasTool } = await import('./canvasToolRegistry');
  return { ...original, createCanvasToolSessions(...args: Parameters<typeof original.createCanvasToolSessions>) {
    const tools = original.createCanvasToolSessions(...args);
    const extension = registerCanvasTool(tools.runtime, {
      kind: 'extension', initialize: (nodeId: string) => ({ nodeId }), target: (state) => state.nodeId,
      capture: () => null, submit: async () => {}, onError() {},
    }, {
      callbacks: (handle) => ({ onCropImage: (id) => { handle.open(id, args[2]()); } }),
      render: (handle) => handle.getSnapshot().state ? <div data-testid="extension-tool">新增工具专属界面</div> : null,
      decorateNode: (handle, node) => handle.getSnapshot().state?.nodeId === node.id ? { ...node, data: { ...node.data, cropEditing: true } } : node,
    });
    return { ...tools, ...assembleCanvasTools({ ...tools.entries, extension }) };
  } };
});
afterEach(unmountPage);
it('新增一份定义和专属装配注册一次，真实Page自动提供原入口、渲染、装饰、Esc/画布退出', async () => {
  enableReactActEnvironment();
  canvasDocMock.current.doc = { nodes: [{ id: 'image', type: 'mediaNode', position: { x: 0, y: 0 }, data: { mediaType: 'image', assetId: '1', src: 'https://assets/image.png', width: 1024, height: 768 } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, version: 3 };
  canvasDocMock.current.assets = { 1: { asset_id: 1, type: 'image', access_url: 'https://assets/image.png', width: 1024, height: 768 } };
  await renderPage();
  const open = async () => { await act(async () => { (mediaNodes()[0].data as MediaNodeData).onCropImage!('image'); }); };
  await open();
  expect(document.querySelector('[data-testid="extension-tool"]')).not.toBeNull();
  expect(mediaNodes()[0].data.cropEditing).toBe(true);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(document.querySelector('[data-testid="extension-tool"]')).toBeNull();
  expect(mediaNodes()[0].data.cropEditing).toBeUndefined();
  await open();
  await act(async () => { flowProps.current.onPaneClick(); });
  expect(document.querySelector('[data-testid="extension-tool"]')).toBeNull();
});

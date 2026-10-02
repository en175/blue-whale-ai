import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { assembleCanvasTools, registerCanvasTool } from './canvasToolRegistry';

it('新工具一次注册即接入入口、渲染、节点装饰与共同退出，无需新增 kind 名单', async () => {
  const runtime = createToolSessionRuntime();
  const deps = { dismissGenPanels() {}, selectNode() {} };
  const entry = registerCanvasTool(
    runtime,
    {
      kind: 'extension',
      initialize: (nodeId: string) => ({ nodeId }),
      target: (state) => state.nodeId,
      capture: (state) => state.nodeId,
      submit: async (_, context) => {
        context.close();
      },
      onError() {},
    },
    {
      callbacks: (handle) => ({
        onCropImage: (id: string) => {
          handle.open(id, deps);
        },
      }),
      render: (handle) =>
        handle.getSnapshot().state ? <span>新增工具</span> : null,
      decorateNode: (handle, node) =>
        handle.getSnapshot().state?.nodeId === node.id
          ? { ...node, data: { ...node.data, cropEditing: true } }
          : node,
    },
  );
  const tools = assembleCanvasTools({ extension: entry });
  tools.callbacks.onCropImage?.('card');
  expect(renderToStaticMarkup(<>{tools.render()}</>)).toContain('新增工具');
  expect(
    tools.decorateNode({ id: 'card', position: { x: 0, y: 0 }, data: {} }).data
      .cropEditing,
  ).toBe(true);
  expect(entry.handle.send()).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(entry.handle.getSnapshot().state).toBeNull();
  tools.callbacks.onCropImage?.('card');
  runtime.beforeGenPanel(deps);
  expect(renderToStaticMarkup(<>{tools.render()}</>)).toBe('');
});

import { Fragment, type ReactNode } from 'react';
import type { Node } from '@xyflow/react';
import type { ComponentProps } from 'react';
import type FlowCanvas from './components/Canvas';
import type { MediaNodeData } from './components/MediaNode';
import type {
  createToolSessionRuntime,
  ToolSessionDefinition,
  ToolSessionHandle,
} from './toolSessionRuntime';

type NodeCallbacks = {
  [K in keyof MediaNodeData as K extends `on${string}`
    ? K
    : never]: MediaNodeData[K];
};
type CanvasLayers = Pick<
  ComponentProps<typeof FlowCanvas>,
  'cropFrame' | 'outpaintFrame'
>;
interface DraftEntry {
  hidden: boolean;
  visible: boolean;
  open(): void;
}
type Runtime = ReturnType<typeof createToolSessionRuntime>;
export interface CanvasToolAssembly {
  render(): ReactNode;
  decorateNode(node: Node): Node;
  callbacks: NodeCallbacks;
  modal(): boolean;
  draft(node: Node): DraftEntry | null;
  toolbarNode(): Node | null;
  canvasLayers(): CanvasLayers;
  dedicatedEscape(): void;
  connect(source: Node, target: Node): boolean | null;
  wireStart(nodeId: string | null): void;
  blocksCanvasDrag(): boolean;
}
/** 类型明确的句柄封在闭包里，公共遍历不擦除异构参数。 */
export function registerCanvasTool<State, Entry, Input, Request = void>(
  runtime: Runtime,
  definition: ToolSessionDefinition<State, Entry, Input, Request>,
  ui: {
    render(handle: ToolSessionHandle<State, Entry, Request>): ReactNode;
    decorateNode?(
      handle: ToolSessionHandle<State, Entry, Request>,
      node: Node,
    ): Node;
    connect?(source: Node, target: Node): boolean | null;
    wireStart?(
      handle: ToolSessionHandle<State, Entry, Request>,
      nodeId: string | null,
    ): void;
    blocksCanvasDrag?(
      handle: ToolSessionHandle<State, Entry, Request>,
    ): boolean;
    modal?(handle: ToolSessionHandle<State, Entry, Request>): boolean;
    draft?(
      handle: ToolSessionHandle<State, Entry, Request>,
      node: Node,
    ): DraftEntry | null;
    toolbarNode?(handle: ToolSessionHandle<State, Entry, Request>): Node | null;
    canvasLayers?(
      handle: ToolSessionHandle<State, Entry, Request>,
    ): CanvasLayers;
    callbacks?(handle: ToolSessionHandle<State, Entry, Request>): NodeCallbacks;
  },
) {
  const handle = runtime.register(definition);
  return {
    handle,
    render: () => ui.render(handle),
    decorateNode: (node: Node) => ui.decorateNode?.(handle, node) ?? node,
    callbacks: ui.callbacks?.(handle) ?? {},
    connect: (source: Node, target: Node) =>
      ui.connect?.(source, target) ?? null,
    wireStart: (nodeId: string | null) => ui.wireStart?.(handle, nodeId),
    blocksCanvasDrag: () => ui.blocksCanvasDrag?.(handle) ?? false,
    modal: () =>
      ui.modal?.(handle) ??
      (!definition.panel && handle.getSnapshot().state !== null),
    draft: (node: Node) => ui.draft?.(handle, node) ?? null,
    toolbarNode: () => ui.toolbarNode?.(handle) ?? null,
    canvasLayers: () => ui.canvasLayers?.(handle) ?? {},
    dedicatedEscape: () => {
      if (
        definition.escape === 'dedicated' &&
        handle.getSnapshot().state !== null
      )
        handle.close();
    },
  };
}
export function assembleCanvasTools<
  T extends Record<string, CanvasToolAssembly>,
>(entries: T) {
  const tools = Object.entries(entries);
  return {
    entries,
    kinds: Object.keys(entries) as (keyof T)[],
    connect: (source: Node, target: Node) =>
      tools
        .map(([, tool]) => tool.connect(source, target))
        .find((handled) => handled !== null) ?? null,
    wireStart: (nodeId: string | null) =>
      tools.forEach(([, tool]) => tool.wireStart(nodeId)),
    blocksCanvasDrag: () => tools.some(([, tool]) => tool.blocksCanvasDrag()),
    isModal: () => tools.some(([, tool]) => tool.modal()),
    draft: (node: Node) =>
      tools
        .map(([, tool]) => tool.draft(node))
        .find((draft) => draft !== null) ?? null,
    toolbarNode: () =>
      tools
        .map(([, tool]) => tool.toolbarNode())
        .find((node) => node !== null) ?? null,
    canvasLayers: () =>
      Object.assign(
        {},
        ...tools.map(([, tool]) => tool.canvasLayers()),
      ) as CanvasLayers,
    dedicatedEscape: () => tools.forEach(([, tool]) => tool.dedicatedEscape()),
    callbacks: Object.assign(
      {},
      ...tools.map(([, tool]) => tool.callbacks),
    ) as NodeCallbacks,
    render: () =>
      tools.map(([kind, tool]) => (
        <Fragment key={kind}>{tool.render()}</Fragment>
      )),
    decorateNode: (node: Node) =>
      tools.reduce((current, [, tool]) => tool.decorateNode(current), node),
  };
}

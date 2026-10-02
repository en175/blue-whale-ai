/** 注册工具提供差异，共同画布事件规则只在此执行；状态和完整退出由 runtime 持有。 */
export interface CoordinatedTool {
  kind: string;
  panel: boolean;
  nodeClick?: 'consume';
  escape?: 'dedicated';
  target(): string | null;
  close(): void;
}
export interface ToolSessionDeps {
  dismissGenPanels(): void;
  selectNode(nodeId: string): void;
}
export type ToolSessionEventDisposition = 'consumed' | 'pass';
export function enterToolSession(
  kind: string,
  tools: Iterable<CoordinatedTool>,
  deps: ToolSessionDeps,
  init: () => void,
): void {
  for (const tool of tools)
    if (tool.kind !== kind && tool.target() !== null) tool.close();
  deps.dismissGenPanels();
  init();
}
export function exitAllToolSessions(tools: Iterable<CoordinatedTool>): void {
  for (const tool of tools) if (tool.target() !== null) tool.close();
}
export function handleToolSessionPaneClick(
  tools: Iterable<CoordinatedTool>,
): ToolSessionEventDisposition {
  let disposition: ToolSessionEventDisposition = 'pass';
  for (const tool of tools)
    if (tool.target() !== null) {
      tool.close();
      disposition = 'consumed';
    }
  return disposition;
}
export function handleToolSessionNodeClick(
  nodeId: string,
  tools: Iterable<CoordinatedTool>,
  deps: ToolSessionDeps,
): ToolSessionEventDisposition {
  for (const tool of tools) {
    const target = tool.target();
    if (tool.nodeClick !== 'consume' || target === null) continue;
    if (nodeId !== target) {
      tool.close();
      deps.selectNode(nodeId);
    }
    return 'consumed';
  }
  return 'pass';
}
export function handleToolSessionSelectionChange(
  selection: { soloId: string | null; multiSelect: boolean },
  tools: Iterable<CoordinatedTool>,
): boolean {
  const current = [...tools];
  if (
    current.some(
      (tool) => tool.nodeClick === 'consume' && tool.target() !== null,
    )
  )
    return true;
  for (const tool of current) {
    const target = tool.target();
    if (
      !tool.panel &&
      target !== null &&
      ((selection.soloId !== null && selection.soloId !== target) ||
        selection.multiSelect)
    )
      tool.close();
  }
  return false;
}
export function escDefersToToolSessionHandler(
  tools: Iterable<CoordinatedTool>,
): boolean {
  return [...tools].some(
    (tool) => tool.escape === 'dedicated' && tool.target() !== null,
  );
}
export function exitToolSessionOnEsc(
  tools: Iterable<CoordinatedTool>,
): boolean {
  for (const tool of tools)
    if (tool.escape !== 'dedicated' && tool.target() !== null) {
      tool.close();
      return true;
    }
  return false;
}
export function hasEscExitSession(tools: Iterable<CoordinatedTool>): boolean {
  return [...tools].some(
    (tool) => !tool.panel && tool.escape !== 'dedicated' && tool.target() !== null,
  );
}

export interface ToolSessionEpoch<Kind extends string = string> {
  enter(kind: Kind): void;
  exit(kind: Kind): void;
  advanceAll(): void;
  capture(kind: Kind): number;
  isCurrent(kind: Kind, captured: number): boolean;
}
/** 注册与首次捕获共同建立 kind，新增工具无需维护第二份名单。 */
export function createToolSessionEpoch<Kind extends string = string>(
  kinds: readonly Kind[] = [],
): ToolSessionEpoch<Kind> {
  const epochs = new Map<Kind, number>(kinds.map((kind) => [kind, 0]));
  const capture = (kind: Kind) => {
    if (!epochs.has(kind)) epochs.set(kind, 0);
    return epochs.get(kind)!;
  };
  return {
    enter(kind) {
      epochs.set(kind, capture(kind) + 1);
    },
    exit(kind) {
      epochs.set(kind, capture(kind) + 1);
    },
    advanceAll() {
      for (const [kind, value] of epochs) epochs.set(kind, value + 1);
    },
    capture,
    isCurrent: (kind, captured) => capture(kind) === captured,
  };
}

import {
  TOOL_SESSION_KINDS,
  createToolSessionEpoch,
  enterToolSession,
  escDefersToToolSessionHandler,
  exitAllToolSessions,
  exitToolSessionOnEsc,
  handleToolSessionNodeClick,
  handleToolSessionPaneClick,
  handleToolSessionSelectionChange,
  type ToolSessionDeps,
  type ToolSessionKind,
} from './toolSessionCoordinator';

export const TOOL_PANEL_KINDS = ['imageEnhance', 'videoEnhance', 'frameInterpolation'] as const;
export type ToolPanelKind = (typeof TOOL_PANEL_KINDS)[number];
type RuntimeToolKind = ToolSessionKind | ToolPanelKind;

export interface ToolSubmissionContext {
  isCurrent(): boolean;
  close(): void;
  /** 发送即退出：保留本次失败反馈身份，后来会话或项目切换使其失效。 */
  exitForSubmission(): void;
}

export interface ToolSessionDefinition<State, Entry, Input, Request = void> {
  kind: RuntimeToolKind;
  /** 高清/HD 可见同卡重入保留内容；插帧每次重算 seed 与按卡在途状态。 */
  panel?: 'preserve' | 'reinitialize';
  initialize(entry: Entry, previous?: State): State | null;
  /** 门槛通过并完成互斥后，执行工具专属的进入动作。 */
  opened?(state: State): State;
  target(state: State): string | null;
  capture(state: State, request?: Request): Input | null;
  submit(input: Input, context: ToolSubmissionContext): Promise<void>;
  onError(error: unknown, input: Input): void;
  cleanup?(state: State): void;
  /** 源卡旁路变更后校准专属编辑状态；无变化时返回原对象。 */
  reconcile?(state: State): State | null;
}

export interface ToolSessionSnapshot<State> {
  state: State | null;
  submitting: boolean;
  /** 仅面板工具持有可见性与显式关闭后的选中豁免。 */
  visible?: boolean;
  hidden?: boolean;
}

export type LegacyToolSessionDeps = Omit<ToolSessionDeps, 'activity' | 'exits'> & {
  activity: Partial<ToolSessionDeps['activity']>;
  exits: Partial<ToolSessionDeps['exits']>;
};

export interface ToolSessionHandle<State, Entry, Request = void> {
  getSnapshot(): ToolSessionSnapshot<State>;
  open(entry: Entry, deps: LegacyToolSessionDeps): boolean;
  edit(update: (state: State) => State): void;
  close(): void;
  send(request?: Request): boolean;
}

/** 注册工具的编辑状态与纪元由此持有；节点、连线和任务处理仍由宿主提供。 */
export function createToolSessionRuntime() {
  const epoch = createToolSessionEpoch<RuntimeToolKind>([...TOOL_SESSION_KINDS, ...TOOL_PANEL_KINDS]);
  const tools = new Map<RuntimeToolKind, { panel: boolean; target(): string | null; close(): void; reset(): void; reconcile(): void; select(selection: { soloId: string | null; multiSelect: boolean }): void }>();
  const listeners = new Set<() => void>();
  let version = 0;
  let projectId: string | null | undefined;
  function changed(notify = true) {
    version += 1;
    if (notify) listeners.forEach((listener) => listener());
  }
  function coordinate(deps: LegacyToolSessionDeps): ToolSessionDeps {
    const activity = Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, deps.activity[kind] ?? null])) as ToolSessionDeps['activity'];
    const exits = Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, deps.exits[kind] ?? (() => {})])) as ToolSessionDeps['exits'];
    for (const [kind, tool] of tools) {
      if (tool.panel) continue;
      activity[kind as ToolSessionKind] = tool.target();
      exits[kind as ToolSessionKind] = tool.close;
    }
    return { ...deps, activity, exits };
  }
  function enterLegacy(kind: ToolSessionKind, deps: LegacyToolSessionDeps, init: () => void) {
    epoch.advanceAll();
    epoch.enter(kind);
    closePanels();
    enterToolSession(kind, coordinate(deps), init);
  }
  function closePanels(except?: RuntimeToolKind) {
    for (const [kind, tool] of tools) if (tool.panel && kind !== except) tool.close();
  }
  return {
    /** 仅供尚未迁移的工具共用同一纪元；迁移完毕后删除该过渡接口。 */
    epoch,
    coordinate,
    enterLegacy,
    closePanels,
    onPaneClick(deps: LegacyToolSessionDeps) {
      const disposition = handleToolSessionPaneClick(coordinate(deps));
      const hasPanel = [...tools.values()].some((tool) => tool.panel && tool.target() !== null);
      closePanels();
      return hasPanel ? 'consumed' : disposition;
    },
    onNodeClick: (nodeId: string, deps: LegacyToolSessionDeps) => handleToolSessionNodeClick(nodeId, coordinate(deps)),
    onSelectionChange(selection: { soloId: string | null; multiSelect: boolean }, deps: LegacyToolSessionDeps) {
      const freeze = handleToolSessionSelectionChange(selection, coordinate(deps));
      if (!freeze) for (const tool of tools.values()) if (tool.panel) tool.select(selection);
      return freeze;
    },
    onEscape(deps: LegacyToolSessionDeps) {
      const current = coordinate(deps);
      if (escDefersToToolSessionHandler(current)) return false;
      if (exitToolSessionOnEsc(current)) return true;
      const hasPanel = [...tools.values()].some((tool) => tool.panel && tool.target() !== null);
      if (hasPanel) closePanels();
      return hasPanel;
    },
    beforeGenPanel(deps: LegacyToolSessionDeps) {
      exitAllToolSessions(coordinate(deps));
      closePanels();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getVersion: () => version,
    setProject(nextProjectId: string | null) {
      if (projectId === nextProjectId) return;
      projectId = nextProjectId;
      epoch.advanceAll();
      for (const tool of tools.values()) tool.reset();
    },
    reconcileSources(nodeIds: ReadonlySet<string>) {
      for (const tool of tools.values()) {
        const target = tool.target();
        if (target !== null && !nodeIds.has(target)) tool.close();
        else tool.reconcile();
      }
    },
    register<State, Entry, Input, Request = void>(definition: ToolSessionDefinition<State, Entry, Input, Request>): ToolSessionHandle<State, Entry, Request> {
      let snapshot: ToolSessionSnapshot<State> = { state: null, submitting: false, ...(definition.panel ? { visible: false, hidden: false } : {}) };
      const close = (notify = true) => {
        epoch.exit(definition.kind);
        if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
        snapshot = { state: null, submitting: false, ...(definition.panel ? { visible: false, hidden: true } : {}) };
        changed(notify);
      };
      const tool = {
        getSnapshot: () => snapshot,
        open(entry: Entry, deps: LegacyToolSessionDeps) {
          const previous = definition.panel === 'preserve' && !snapshot.visible ? undefined : snapshot.state ?? undefined;
          const state = definition.initialize(entry, previous);
          if (state === null) return false;
          if (definition.panel === 'preserve' && snapshot.visible && state === snapshot.state) return true;
          const initialize = () => {
            if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
            snapshot = { state: definition.opened?.(state) ?? state, submitting: false, ...(definition.panel ? { visible: true, hidden: false } : {}) };
            changed();
          };
          if (definition.panel) {
            epoch.advanceAll();
            epoch.enter(definition.kind);
            exitAllToolSessions(coordinate(deps));
            closePanels(definition.kind);
            deps.dismissGenPanels();
            initialize();
          } else enterLegacy(definition.kind as ToolSessionKind, deps, initialize);
          return true;
        },
        edit(update: (state: State) => State) {
          if (snapshot.state === null) return;
          snapshot = { ...snapshot, state: update(snapshot.state) };
          changed();
        },
        close: () => close(),
        send(request?: Request) {
          if (snapshot.state === null || snapshot.submitting || snapshot.visible === false) return false;
          const input = definition.capture(snapshot.state, request);
          if (input === null) return false;
          let captured = epoch.capture(definition.kind);
          const isCurrent = () => epoch.isCurrent(definition.kind, captured);
          snapshot = { ...snapshot, submitting: true };
          changed();
          void (async () => {
            try {
              await definition.submit(input, {
                isCurrent,
                close: () => { if (isCurrent()) close(); },
                exitForSubmission: () => {
                  if (!isCurrent()) return;
                  close();
                  captured = epoch.capture(definition.kind);
                },
              });
            } catch (error: unknown) {
              if (isCurrent()) definition.onError(error, input);
            } finally {
              if (isCurrent() && snapshot.state !== null) {
                snapshot = { ...snapshot, submitting: false };
                changed();
              }
            }
          })();
          return true;
        },
      };
      tools.set(definition.kind, {
        panel: Boolean(definition.panel),
        target: () => snapshot.state === null ? null : definition.target(snapshot.state),
        close: () => close(),
        reset() {
          close(false);
          if (definition.panel) snapshot = { ...snapshot, hidden: false };
        },
        select({ soloId, multiSelect }) {
          if (snapshot.state === null || snapshot.hidden || (!soloId && !multiSelect)) return;
          const visible = soloId === definition.target(snapshot.state) && !multiSelect;
          if (snapshot.visible === visible) return;
          epoch.exit(definition.kind);
          snapshot = { ...snapshot, visible, submitting: false };
          changed();
        },
        reconcile() {
          if (snapshot.state === null || !definition.reconcile) return;
          const state = definition.reconcile(snapshot.state);
          if (state === null) { close(); return; }
          if (state === snapshot.state) return;
          snapshot = { ...snapshot, state };
          changed();
        },
      });
      return tool;
    },
  };
}

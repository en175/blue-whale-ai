import {
  createToolSessionEpoch,
  enterToolSession,
  escDefersToToolSessionHandler,
  exitAllToolSessions,
  exitToolSessionOnEsc,
  handleToolSessionNodeClick,
  handleToolSessionPaneClick,
  handleToolSessionSelectionChange,
  type ToolSessionDeps,
  hasEscExitSession,
  type CoordinatedTool,
} from './toolSessionCoordinator';

export interface ToolSubmissionContext {
  isCurrent(): boolean;
  close(): void;
  /** 发送即退出：保留本次失败反馈身份，后来会话或项目切换使其失效。 */
  exitForSubmission(): void;
}

export interface ToolSessionDefinition<State, Entry, Input, Request = void> {
  kind: string;
  nodeClick?: 'consume';
  escape?: 'dedicated';
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

export interface ToolSessionHandle<State, Entry, Request = void> {
  getSnapshot(): ToolSessionSnapshot<State>;
  open(entry: Entry, deps: ToolSessionDeps): boolean;
  edit(update: (state: State) => State): void;
  close(): void;
  send(request?: Request): boolean;
}

/** 注册工具的编辑状态与纪元由此持有；节点、连线和任务处理仍由宿主提供。 */
export function createToolSessionRuntime() {
  const epoch = createToolSessionEpoch();
  const tools = new Map<string, CoordinatedTool & { reset(): void; reconcile(): void; select(selection: { soloId: string | null; multiSelect: boolean }): void }>();
  const listeners = new Set<() => void>();
  let version = 0;
  let projectId: string | null | undefined;
  function changed(notify = true) {
    version += 1;
    if (notify) listeners.forEach((listener) => listener());
  }
  function closePanels() {
    for (const tool of tools.values()) if (tool.panel) tool.close();
  }
  return {
    closePanels,
    hasEditSession: () => [...tools.values()].some((tool) => !tool.panel && tool.target() !== null),
    hasEscExitSession: () => hasEscExitSession(tools.values()),
    escDefersToToolSessionHandler: () => escDefersToToolSessionHandler(tools.values()),
    onPaneClick() { return handleToolSessionPaneClick(tools.values()); },
    onNodeClick: (nodeId: string, deps: ToolSessionDeps) => handleToolSessionNodeClick(nodeId, tools.values(), deps),
    onSelectionChange(selection: { soloId: string | null; multiSelect: boolean }) {
      const freeze = handleToolSessionSelectionChange(selection, tools.values());
      if (!freeze) for (const tool of tools.values()) if (tool.panel) tool.select(selection);
      return freeze;
    },
    onEscape() {
      if (escDefersToToolSessionHandler(tools.values())) return false;
      return exitToolSessionOnEsc(tools.values());
    },
    beforeGenPanel() { exitAllToolSessions(tools.values()); },
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
        open(entry: Entry, deps: ToolSessionDeps) {
          const previous = definition.panel === 'preserve' && !snapshot.visible ? undefined : snapshot.state ?? undefined;
          const state = definition.initialize(entry, previous);
          if (state === null) return false;
          if (definition.panel === 'preserve' && snapshot.visible && state === snapshot.state) return true;
          const initialize = () => {
            if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
            snapshot = { state: definition.opened?.(state) ?? state, submitting: false, ...(definition.panel ? { visible: true, hidden: false } : {}) };
            changed();
          };
          epoch.advanceAll();
          epoch.enter(definition.kind);
          enterToolSession(definition.kind, tools.values(), deps, initialize);
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
      epoch.capture(definition.kind);
      tools.set(definition.kind, {
        kind: definition.kind, nodeClick: definition.nodeClick, escape: definition.escape,
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

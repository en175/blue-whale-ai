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

export interface ToolSubmissionContext {
  isCurrent(): boolean;
  close(): void;
  /** 发送即退出：保留本次失败反馈身份，后来会话或项目切换使其失效。 */
  exitForSubmission(): void;
}

export interface ToolSessionDefinition<State, Entry, Input, Request = void> {
  kind: ToolSessionKind;
  initialize(entry: Entry, previous?: State): State | null;
  target(state: State): string | null;
  capture(state: State, request?: Request): Input | null;
  submit(input: Input, context: ToolSubmissionContext): Promise<void>;
  onError(error: unknown, input: Input): void;
  cleanup?(state: State): void;
  /** 源卡旁路变更后校准专属编辑状态；无变化时返回原对象。 */
  reconcile?(state: State): State;
}

export interface ToolSessionSnapshot<State> {
  state: State | null;
  submitting: boolean;
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
  const epoch = createToolSessionEpoch();
  const tools = new Map<ToolSessionKind, { target(): string | null; close(): void; reset(): void; reconcile(): void }>();
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
      activity[kind] = tool.target();
      exits[kind] = tool.close;
    }
    return { ...deps, activity, exits };
  }
  function enterLegacy(kind: ToolSessionKind, deps: LegacyToolSessionDeps, init: () => void) {
    epoch.advanceAll();
    epoch.enter(kind);
    enterToolSession(kind, coordinate(deps), init);
  }
  return {
    /** 仅供尚未迁移的工具共用同一纪元；迁移完毕后删除该过渡接口。 */
    epoch,
    coordinate,
    enterLegacy,
    onPaneClick: (deps: LegacyToolSessionDeps) => handleToolSessionPaneClick(coordinate(deps)),
    onNodeClick: (nodeId: string, deps: LegacyToolSessionDeps) => handleToolSessionNodeClick(nodeId, coordinate(deps)),
    onSelectionChange: (selection: { soloId: string | null; multiSelect: boolean }, deps: LegacyToolSessionDeps) => handleToolSessionSelectionChange(selection, coordinate(deps)),
    onEscape(deps: LegacyToolSessionDeps) {
      const current = coordinate(deps);
      return !escDefersToToolSessionHandler(current) && exitToolSessionOnEsc(current);
    },
    beforeGenPanel: (deps: LegacyToolSessionDeps) => exitAllToolSessions(coordinate(deps)),
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
      let snapshot: ToolSessionSnapshot<State> = { state: null, submitting: false };
      const close = (notify = true) => {
        epoch.exit(definition.kind);
        if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
        snapshot = { state: null, submitting: false };
        changed(notify);
      };
      const tool = {
        getSnapshot: () => snapshot,
        open(entry: Entry, deps: LegacyToolSessionDeps) {
          const state = definition.initialize(entry, snapshot.state ?? undefined);
          if (state === null) return false;
          enterLegacy(definition.kind, deps, () => {
            if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
            snapshot = { state, submitting: false };
            changed();
          });
          return true;
        },
        edit(update: (state: State) => State) {
          if (snapshot.state === null) return;
          snapshot = { ...snapshot, state: update(snapshot.state) };
          changed();
        },
        close: () => close(),
        send(request?: Request) {
          if (snapshot.state === null || snapshot.submitting) return false;
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
        target: () => snapshot.state === null ? null : definition.target(snapshot.state),
        close: () => close(), reset: () => close(false),
        reconcile() {
          if (snapshot.state === null || !definition.reconcile) return;
          const state = definition.reconcile(snapshot.state);
          if (state === snapshot.state) return;
          snapshot = { ...snapshot, state };
          changed();
        },
      });
      return tool;
    },
  };
}

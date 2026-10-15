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
  exitForSubmission(): void;
}

export interface ToolSessionDefinition<State, Entry, Input, Request = void> {
  kind: string;
  nodeClick?: 'consume';
  escape?: 'dedicated';
  panel?: 'preserve' | 'reinitialize';
  initialize(entry: Entry, previous?: State): State | null;
  opened?(state: State): State;
  target(state: State): string | null;
  capture(state: State, request?: Request): Input | null;
  submit(input: Input, context: ToolSubmissionContext): Promise<void>;
  onError(error: unknown, input: Input): void;
  cleanup?(state: State): void;
  reconcile?(state: State): State | null;
  inFlight?(state: State): boolean;
}

export interface ToolSessionSnapshot<State> {
  state: State | null;
  submitting: boolean;
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

export function createToolSessionRuntime() {
  const epoch = createToolSessionEpoch();
  const tools = new Map<string, CoordinatedTool & { reset(): void; reconcile(): void; select(selection: { soloId: string | null; multiSelect: boolean }): void; lockForInFlight(targetId: string): void; captureOwnership(): (() => boolean) }>();
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
    notifyInFlight(kind: string, targetId: string) {
      tools.get(kind)?.lockForInFlight(targetId);
    },
    captureSessionOwnership(kind: string): () => boolean {
      const tool = tools.get(kind);
      return tool ? tool.captureOwnership() : () => true;
    },
    register<State, Entry, Input, Request = void>(definition: ToolSessionDefinition<State, Entry, Input, Request>): ToolSessionHandle<State, Entry, Request> {
      let snapshot: ToolSessionSnapshot<State> = { state: null, submitting: false, ...(definition.panel ? { visible: false, hidden: false } : {}) };
      let ownershipGeneration = 0;
      const close = (notify = true) => {
        epoch.exit(definition.kind);
        if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
        snapshot = { state: null, submitting: false, ...(definition.panel ? { visible: false, hidden: true } : {}) };
        changed(notify);
      };
      const tool = {
        getSnapshot: () => snapshot,
        open(entry: Entry, deps: ToolSessionDeps) {
          const previous = snapshot.state ?? undefined;
          const state = definition.initialize(entry, previous);
          if (state === null) return false;
          if (definition.panel === 'preserve' && snapshot.visible && state === snapshot.state) return true;
          const sameTarget = snapshot.state !== null && !snapshot.hidden
            && definition.target(snapshot.state) === definition.target(state);
          const initialize = () => {
            if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
            const resume = sameTarget;
            if (!resume) ownershipGeneration += 1;
            const submitting = resume && definition.inFlight ? definition.inFlight(state) : false;
            snapshot = { state: definition.opened?.(state) ?? state, submitting, ...(definition.panel ? { visible: true, hidden: false } : {}) };
            changed();
          };
          const sameTargetResume = definition.panel === 'preserve' && sameTarget;
          if (!sameTargetResume) {
            epoch.advanceAll();
            epoch.enter(definition.kind);
          }
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
                const submitting = definition.inFlight ? definition.inFlight(snapshot.state) : false;
                if (submitting !== snapshot.submitting) {
                  snapshot = { ...snapshot, submitting };
                  changed();
                }
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
        lockForInFlight(targetId: string) {
          if (snapshot.state === null || snapshot.submitting || snapshot.visible === false) return;
          if (definition.target(snapshot.state) !== targetId) return;
          snapshot = { ...snapshot, submitting: true };
          changed();
        },
        reset() {
          ownershipGeneration += 1;
          close(false);
          if (definition.panel) snapshot = { ...snapshot, hidden: false };
        },
        captureOwnership(): (() => boolean) {
          const captured = ownershipGeneration;
          return () => ownershipGeneration === captured;
        },
        select({ soloId, multiSelect }) {
          if (snapshot.state === null || snapshot.hidden || (!soloId && !multiSelect)) return;
          const visible = soloId === definition.target(snapshot.state) && !multiSelect;
          if (snapshot.visible === visible) return;
          epoch.exit(definition.kind);
          const submitting = visible && definition.inFlight?.(snapshot.state) === true;
          snapshot = { ...snapshot, visible, submitting };
          changed();
        },
        reconcile() {
          if (snapshot.state === null || !definition.reconcile) return;
          const state = definition.reconcile(snapshot.state);
          if (state === null) { close(); return; }
          const submitting = snapshot.submitting && definition.inFlight ? definition.inFlight(state) : snapshot.submitting;
          if (state === snapshot.state && submitting === snapshot.submitting) return;
          snapshot = { ...snapshot, state, submitting };
          changed();
        },
      });
      return tool;
    },
  };
}

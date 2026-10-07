export interface DockSelection {
  soloId: string | null;
  multiSelect: boolean;
  editing: boolean;
  submittingNodeId: string | null;
}

export interface GenerationDockDefinition {
  view(): { readonly visible: boolean };
  canOpen?(input: never): boolean;
  beforeOpen?(input: never): void;
  open(input: never): unknown;
  hide(nextPanel: string): void;
  close(): void;
  updateDraft(input: never): unknown;
  submit(input: never): unknown;
  selection?(input: DockSelection): void;
  reconcile?(): void;
  render?(): import('react').ReactNode;
  tool?: boolean;
  referencePicked?(): void;
  submitted?(nodeId: string): void;
  subscribe?(listener: () => void): () => void;
  getVersion?(): number;
}

export function createGenerationDockCoordinator<R extends Record<string, GenerationDockDefinition>>(registry: R) {
  const entries = Object.entries(registry);
  return {
    subscribe(listener: () => void) {
      const cleanups = entries.flatMap(([, definition]) => definition.subscribe ? [definition.subscribe(listener)] : []);
      return () => cleanups.forEach(cleanup => cleanup());
    },
    getVersion: () => entries.reduce((version, [, definition]) => version + (definition.getVersion?.() ?? 0), 0),
    get view() {
      return { activePanel: (entries.find(([, definition]) => definition.view().visible)?.[0] ?? null) as keyof R | null } as const;
    },
    panel<K extends keyof R>(kind: K): ReturnType<R[K]['view']> {
      return registry[kind].view() as ReturnType<R[K]['view']>;
    },
    open<K extends keyof R>(kind: K, input: Parameters<R[K]['open']>[0]) {
      const definition = registry[kind];
      if (definition.canOpen?.(input as never) === false) return false;
      definition.beforeOpen?.(input as never);
      entries.forEach(([otherKind, other]) => { if (otherKind !== kind) other.hide(String(kind)); });
      definition.open(input as never);
      return true;
    },
    close<K extends keyof R>(kind: K) { registry[kind].close(); },
    dismissAll(scope: 'all' | 'ordinary' = 'all') {
      entries.forEach(([, definition]) => { if (scope === 'all' || !definition.tool) definition.close(); });
    },
    updateDraft<K extends keyof R>(kind: K, input: Parameters<R[K]['updateDraft']>[0]) {
      return registry[kind].updateDraft(input as never) as ReturnType<R[K]['updateDraft']>;
    },
    submit<K extends keyof R>(kind: K, input: Parameters<R[K]['submit']>[0]) {
      return registry[kind].submit(input as never) as ReturnType<R[K]['submit']>;
    },
    selection(input: DockSelection) { entries.forEach(([, definition]) => definition.selection?.(input)); },
    referencePicked<K extends keyof R>(kind: K) { registry[kind].referencePicked?.(); },
    submitted<K extends keyof R>(kind: K, nodeId: string) { registry[kind].submitted?.(nodeId); },
    reconcile() { entries.forEach(([, definition]) => definition.reconcile?.()); },
    render<K extends keyof R>(kind: K) { return registry[kind].render?.(); },
  };
}

export interface CompatibilityDockEntry { nodeId?: string; preset?: import('./components/BottomDialog').VideoGenSeedParams; invoke?: () => void }
export interface CompatibilityDockHost {
  view(): { visible: boolean };
  canOpen?(input: CompatibilityDockEntry): boolean;
  beforeOpen?(): void;
  open(input: CompatibilityDockEntry): void;
  hide(nextPanel: string): void;
  close(): void;
}

export function createCompatibilityDock(getHost: () => CompatibilityDockHost, tool = false) {
  return {
    tool,
    view: () => getHost().view(),
    canOpen: (input: CompatibilityDockEntry) => getHost().canOpen?.(input) !== false,
    beforeOpen: () => getHost().beforeOpen?.(),
    open: (input: CompatibilityDockEntry) => getHost().open(input),
    hide: (nextPanel: string) => getHost().hide(nextPanel),
    close: () => getHost().close(),
    updateDraft(_input: never) {},
    submit(_input: never) {},
  };
}

export interface GenerationDockSubmissionHost {
  getProjectId(): string | null;
  isApplying(): boolean;
  isSaveBlocked(): boolean;
  setApplying(value: boolean): void;
  setSubmittingNode(nodeId: string | null): void;
  toast(type: 'warn' | 'error', message: string): void;
  reportError(error: unknown): void;
}

export function captureGenerationDockSubmission(host: GenerationDockSubmissionHost): string | null {
  return host.isApplying() || host.isSaveBlocked() ? null : host.getProjectId();
}

export async function runGenerationDockSubmission<Prepared>(
  host: GenerationDockSubmissionHost,
  targetNodeId: string | undefined,
  prepare: () => Promise<Prepared | undefined>,
  handoff: (prepared: Prepared) => void,
  errorMessage: string,
): Promise<void> {
  host.setApplying(true);
  host.setSubmittingNode(targetNodeId ?? null);
  try {
    const prepared = await prepare();
    if (prepared !== undefined) handoff(prepared);
  } catch (error) {
    host.toast('error', errorMessage);
    host.reportError(error);
  } finally {
    host.setApplying(false);
    host.setSubmittingNode(null);
  }
}

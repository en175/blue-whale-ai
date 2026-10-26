import { createElement, Fragment } from 'react';
export interface DockSelection {
  soloId: string | null;
  multiSelect: boolean;
  editing: boolean;
  submittingNodeId: string | null;
}

export function mediaDockSelectionVisibility(
  state: { visible: boolean; boundId: string | null; selectionExempt: boolean },
  { soloId, multiSelect, editing, submittingNodeId }: DockSelection,
): boolean | undefined {
  if (state.selectionExempt) return;
  if (state.boundId) {
    if (submittingNodeId && state.boundId !== submittingNodeId) return;
    if (soloId === state.boundId) return editing ? undefined : true;
  } else if (!state.visible) return;
  if (soloId || multiSelect) return false;
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
  writeSelf?(): void;
  subscribe?(listener: () => void): () => void;
  getVersion?(): number;
}

export function createGenerationDockCoordinator<R extends Record<string, GenerationDockDefinition>>(registry: R) {
  const entries = Object.entries(registry);
  const subscriptions = [...new Set(entries.flatMap(([, definition]) => definition.subscribe ? [definition.subscribe] : []))];
  const versions = [...new Set(entries.flatMap(([, definition]) => definition.getVersion ? [definition.getVersion] : []))];
  const renderedToolKinds: ReadonlySet<string> = new Set(entries.filter(([, definition]) => definition.tool && definition.render).map(([kind]) => kind));
  return {
    renderedToolKinds,
    subscribe(listener: () => void) {
      const cleanups = subscriptions.map(subscribe => subscribe(listener));
      return () => cleanups.forEach(cleanup => cleanup());
    },
    getVersion: () => versions.reduce((version, getVersion) => version + getVersion(), 0),
    get view() {
      return { activePanel: (entries.find(([, definition]) => definition.view().visible)?.[0] ?? null) as keyof R | null } as const;
    },
    panel<K extends keyof R>(kind: K): ReturnType<R[K]['view']> {
      return registry[kind].view() as ReturnType<R[K]['view']>;
    },
    open<K extends keyof R>(kind: K, input: Parameters<R[K]['open']>[0]) {
      const definition = registry[kind];
      if (definition.tool) return definition.open(input as never) !== false;
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
    writeSelf<K extends keyof R>(kind: K) { registry[kind].writeSelf?.(); },
    reconcile() { entries.forEach(([, definition]) => definition.reconcile?.()); },
    render<K extends keyof R>(kind?: K) {
      return kind !== undefined ? registry[kind].render?.() : entries.map(([key, definition]) => createElement(Fragment, { key }, definition.render?.()));
    },
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
  const release = holdGenerationDockSubmission(host, targetNodeId ?? null);
  try {
    const prepared = await prepare();
    if (prepared !== undefined) handoff(prepared);
  } catch (error) {
    reportGenerationDockSubmissionError(host, errorMessage, error);
  } finally {
    release();
  }
}

export function holdGenerationDockSubmission(host: Pick<GenerationDockSubmissionHost, 'setApplying' | 'setSubmittingNode'>, targetNodeId: string | null | undefined) {
  host.setApplying(true);
  if (targetNodeId !== undefined) host.setSubmittingNode(targetNodeId);
  return () => { host.setApplying(false); host.setSubmittingNode(null); };
}

export function runSynchronousGenerationDockSubmission(host: Pick<GenerationDockSubmissionHost, 'setApplying' | 'setSubmittingNode'>, targetNodeId: string | undefined, handoff: () => void): void {
  const release = holdGenerationDockSubmission(host, targetNodeId);
  try { handoff(); } finally { release(); }
}

export function reportGenerationDockSubmissionError(host: Pick<GenerationDockSubmissionHost, 'toast' | 'reportError'>, message: string, error: unknown): void {
  host.toast('error', message);
  host.reportError(error);
}

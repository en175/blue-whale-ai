import type { GenerationRuntime, GenerationRuntimeHost, InFlightTaskState } from './types';
import {
  createContext, resetContext,
  type GenerationRuntimeDeps,
} from './runtimeState';
import { createPolling } from './runtimePolling';
import { createActions } from './runtimeActions';
import { createRecovery } from './runtimeRecovery';
import { createSave } from './runtimeSave';

export type { GenerationRuntime, GenerationRuntimeHost, GenerationTaskDefinition, InFlightTaskState } from './types';
export type { GenerationRuntimeDeps } from './runtimeState';

export function createGenerationRuntime(host: GenerationRuntimeHost, deps: GenerationRuntimeDeps = {}): GenerationRuntime {
  const ctx = createContext(host, deps);
  const polling = createPolling(ctx);
  const actions = createActions(ctx, polling);
  const recovery = createRecovery(ctx, polling);
  const save = createSave(ctx);

  const runtime: GenerationRuntime = {
    register: (def) => { ctx.defs.push(def); },
    claims: (nodeId, nodeData) => ctx.defs.some((def) => def.identify(nodeId, nodeData)),
    submit: actions.submit as GenerationRuntime['submit'],
    retry: actions.retry,
    cancel: actions.cancel,
    remove: actions.remove,
    noteRemovedOutput: ctx.noteRemovedOutput,
    markLocallyRemoved: ctx.host.markLocallyRemoved,
    recover: recovery.recover,
    isRecoverySettled: recovery.isRecoverySettled,
    resumeFromHydration: recovery.resumeFromHydration,
    statusOf: (nodeId: string): InFlightTaskState | null => {
      const entry = ctx.active.get(nodeId);
      if (!entry) return null;
      return { phase: entry.phase, jobId: entry.jobId, submissionId: entry.submissionId };
    },
    bindingRevisionOf: (nodeId: string): number => ctx.nodeBindings.get(nodeId) ?? 0,
    composeSaveFields: save.composeSaveFields,
    onSaveReceipt: save.onSaveReceipt,
    reconcileConflictItems: recovery.reconcileConflictItems,
    reset: () => resetContext(ctx),
  };
  return runtime;
}

import { vi } from 'vitest';
import type { GenerationDockDefinition } from '../generation/generationDockCoordinator';

export const dockActions = { close: vi.fn(), submit: vi.fn(), updateDraft: vi.fn() };

vi.mock('../generation/generationDockCoordinator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generation/generationDockCoordinator')>();
  return { ...actual, createGenerationDockCoordinator<R extends Record<string, GenerationDockDefinition>>(registry: R) {
    const dock = actual.createGenerationDockCoordinator(registry);
    const close = dock.close, submit = dock.submit, updateDraft = dock.updateDraft;
    dock.close = kind => { dockActions.close(kind); close(kind); };
    dock.submit = (kind, input) => { dockActions.submit(kind, input); return submit(kind, input); };
    dock.updateDraft = (kind, input) => { dockActions.updateDraft(kind, input); return updateDraft(kind, input); };
    return dock;
  } };
});

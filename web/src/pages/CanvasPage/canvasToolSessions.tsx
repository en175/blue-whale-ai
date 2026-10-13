import { useEffect } from 'react';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { type ToolSessionDeps } from './toolSessionCoordinator';
import { assembleCanvasTools } from './canvasToolRegistry';
import { canUndoMaskEdit, canRedoMaskEdit, undoMaskEdit, redoMaskEdit } from './eraseMask';
import { isEditableKeyboardTarget } from './components/Canvas/keyboardDelete';
import { createCanvasToolEntries } from './canvasToolEntries';
import type { CanvasToolHosts, CanvasToolView } from './canvasToolEntries';

export type { CanvasToolHosts, CanvasToolView } from './canvasToolEntries';

export function createCanvasToolSessions(
  getHosts: () => Partial<CanvasToolHosts>,
  getView: () => CanvasToolView,
  getDeps: () => ToolSessionDeps,
) {
  const runtime = createToolSessionRuntime();
  const entries = createCanvasToolEntries({ runtime, getHosts, getView, getDeps });
  const tools = assembleCanvasTools(entries);
  return {
    ...tools,
    runtime,
    hasPanel: () =>
      Object.values(entries).some(
        (entry) => entry.handle.getSnapshot().visible === true,
      ),
    eraseHistory() {
      const s = entries.erase.handle.getSnapshot().state;
      return {
        active: s !== null,
        canUndo: s ? canUndoMaskEdit(s.mask) : false,
        canRedo: s ? canRedoMaskEdit(s.mask) : false,
        undo: () =>
          entries.erase.handle.edit((state) => ({
            ...state,
            mask: undoMaskEdit(state.mask),
          })),
        redo: () =>
          entries.erase.handle.edit((state) => ({
            ...state,
            mask: redoMaskEdit(state.mask),
          })),
      };
    },
  };
}
export type CanvasToolKind = keyof ReturnType<
  typeof createCanvasToolSessions
>['entries'];
export function useCanvasToolSessionEffects(
  tools: ReturnType<typeof createCanvasToolSessions>,
) {
  const dedicated = tools.runtime.escDefersToToolSessionHandler();
  useEffect(() => {
    if (!dedicated) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isEditableKeyboardTarget(event.target))
        return;
      event.preventDefault();
      tools.dedicatedEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tools, dedicated]);
}


import { useEffect, type RefObject } from 'react';
import { canvasUndoKeyAction } from '../../components/Canvas/keyboardUndo';
import { isMentionMenuOpen } from '../../components/Canvas/canvasKeyboard';
import type { CanvasHistoryApi } from '../document/useCanvasHistory';

export function useCanvasUndoHotkeys(input: {
  applyingRef: RefObject<boolean>;
  eraseHistoryRef: RefObject<{ active: boolean; undo: () => void; redo: () => void }>;
  canvasHistory: Pick<CanvasHistoryApi, 'undo' | 'redo'>;
}): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (input.applyingRef.current) return;
      const action = canvasUndoKeyAction({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        target: e.target,
        mentionMenuOpen: isMentionMenuOpen(),
      });
      if (action === 'ignore') return;
      e.preventDefault();
      e.stopPropagation();
      if (input.eraseHistoryRef.current.active) {
        if (action === 'redo') input.eraseHistoryRef.current.redo();
        else input.eraseHistoryRef.current.undo();
        return;
      }
      if (action === 'redo') input.canvasHistory.redo();
      else input.canvasHistory.undo();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.canvasHistory.undo, input.canvasHistory.redo]);
}

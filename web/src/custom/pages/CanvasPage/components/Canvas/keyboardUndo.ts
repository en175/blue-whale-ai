import { isEditableKeyboardTarget } from './keyboardDelete';
import type { CanvasKeyboardInput } from './canvasKeyboard';

export type CanvasUndoKeyAction = 'undo' | 'redo' | 'ignore';

export type CanvasUndoKeyInput = CanvasKeyboardInput;

export function canvasUndoKeyAction(input: CanvasUndoKeyInput): CanvasUndoKeyAction {
  if (input.mentionMenuOpen) return 'ignore';
  if (isEditableKeyboardTarget(input.target)) return 'ignore';
  if (!(input.metaKey || input.ctrlKey)) return 'ignore';
  const key = input.key.toLowerCase();
  if (key === 'y') return 'redo';
  if (key !== 'z') return 'ignore';
  return input.shiftKey ? 'redo' : 'undo';
}

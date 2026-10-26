import { isEditableKeyboardTarget } from './keyboardDelete';
import type { CanvasKeyboardInput } from './canvasKeyboard';

export type CanvasClipboardKeyAction = 'copy' | 'paste' | 'ignore';

export type CanvasClipboardKeyInput = CanvasKeyboardInput;

export function canvasClipboardKeyAction(input: CanvasClipboardKeyInput): CanvasClipboardKeyAction {
  if (!input.metaKey && !input.ctrlKey) return 'ignore';
  if (input.shiftKey) return 'ignore';
  if (input.mentionMenuOpen) return 'ignore';
  if (isEditableKeyboardTarget(input.target)) return 'ignore';
  const key = input.key.toLowerCase();
  if (key === 'c') return 'copy';
  if (key === 'v') return 'paste';
  return 'ignore';
}

export function copyableSelectedCanvasNodes(
  nodes: Array<{ id: string; type?: string; selected?: boolean }>,
): string[] {
  return nodes
    .filter((node) => node.selected && (node.type === 'textNode' || node.type === 'mediaNode'))
    .map((node) => node.id);
}

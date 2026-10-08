
export type CanvasDeleteKeyAction = 'delete-selected' | 'block' | 'ignore';

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  let el: HTMLElement | null = null;
  if (target instanceof HTMLElement) el = target;
  else if (target instanceof Node) el = target.parentElement;
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
  let current: HTMLElement | null = el;
  while (current) {
    const mode = current.contentEditable;
    if (mode === 'true' || mode === 'plaintext-only') return true;
    if (mode === 'false') return false;
    current = current.parentElement;
  }
  return false;
}

export function canvasDeleteKeyAction(key: string, target: EventTarget | null): CanvasDeleteKeyAction {
  if (target instanceof Element && target.closest('[data-canvas-keyboard-scope="mention"]')) return 'ignore';
  if (key === 'Delete' || key === 'Backspace') {
    return isEditableKeyboardTarget(target) ? 'ignore' : 'delete-selected';
  }
  if (key === 'Enter') {
    return isEditableKeyboardTarget(target) ? 'ignore' : 'block';
  }
  return 'ignore';
}

export function selectedNodeIds(nodes: Array<{ id: string; selected?: boolean }>): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id);
}

export function deleteSelectedCanvasNodes(
  nodes: Array<{ id: string; selected?: boolean }>,
  onDeleteNodes: (ids: string[]) => void,
): string[] {
  const ids = selectedNodeIds(nodes);
  if (ids.length > 0) onDeleteNodes(ids);
  return ids;
}

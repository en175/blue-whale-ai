/* ============================================
 * 画布键盘删除策略：Delete 删除选中节点，输入框内保持原语义
 * ============================================ */

export type CanvasDeleteKeyAction = 'delete-selected' | 'block' | 'ignore';

/** 输入框 / 编辑器内的 Del、Backspace、Enter 保持原语义 */
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

/**
 * 决定画布对按键的处理：
 * - Delete / Backspace：删除当前选中节点（输入框内忽略）
 * - Enter：继续拦截，避免误触发（输入框内忽略）
 */
export function canvasDeleteKeyAction(key: string, target: EventTarget | null): CanvasDeleteKeyAction {
  // 引用菜单自行处理键盘，避免确认素材被画布快捷键截断。
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

/** 对选中节点逐个调用删除回调；无选中时为 no-op。返回实际删除的 id。 */
export function deleteSelectedCanvasNodes(
  nodes: Array<{ id: string; selected?: boolean }>,
  onDeleteNode: (id: string) => void,
): string[] {
  const ids = selectedNodeIds(nodes);
  ids.forEach((id) => onDeleteNode(id));
  return ids;
}

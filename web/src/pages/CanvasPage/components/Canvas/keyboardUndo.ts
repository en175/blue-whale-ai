/* ============================================
 * 画布撤销/重做快捷键策略：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做
 * ============================================ */
import { isEditableKeyboardTarget } from './keyboardDelete';
import type { CanvasKeyboardInput } from './canvasKeyboard';

export type CanvasUndoKeyAction = 'undo' | 'redo' | 'ignore';

/** 共享键盘事件输入（canvasKeyboard.ts 收口，与剪贴板等快捷键同构） */
export type CanvasUndoKeyInput = CanvasKeyboardInput;

/**
 * 决定画布对撤销/重做按键的处理：
 * - Ctrl/Cmd+Z → undo；Ctrl/Cmd+Shift+Z 或 Ctrl+Y → redo（既有重做能力保留）
 * - 输入框/编辑器内让位浏览器原生撤销（文字编辑不进画布撤销栈，PRD §7.2 R1）
 * - @ 菜单打开期间一律让位（焦点不在输入框时 Z/Y 也不得触发画布撤销/重做）
 */
export function canvasUndoKeyAction(input: CanvasUndoKeyInput): CanvasUndoKeyAction {
  if (input.mentionMenuOpen) return 'ignore';
  if (isEditableKeyboardTarget(input.target)) return 'ignore';
  if (!(input.metaKey || input.ctrlKey)) return 'ignore';
  const key = input.key.toLowerCase();
  if (key === 'y') return 'redo';
  if (key !== 'z') return 'ignore';
  return input.shiftKey ? 'redo' : 'undo';
}

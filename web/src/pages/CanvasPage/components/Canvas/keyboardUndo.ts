/* ============================================
 * 画布撤销/重做快捷键策略：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做
 * ============================================ */
import { isEditableKeyboardTarget } from './keyboardDelete';

export type CanvasUndoKeyAction = 'undo' | 'redo' | 'ignore';

export interface CanvasUndoKeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
  /** @ 引用菜单打开期间键盘归菜单处理，Z/Y 不被画布截断 */
  mentionMenuOpen: boolean;
}

/** @ 引用菜单是否打开（Esc 链同款检测约定：DOM 挂载即打开） */
export function isMentionMenuOpen(): boolean {
  return document.querySelector('[data-canvas-keyboard-scope="mention"]') !== null;
}

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

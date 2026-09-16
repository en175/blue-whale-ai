/* ============================================
 * 画布快捷键共享输入类型与检测（IKGBP1）：keyboardClipboard / keyboardUndo
 * 等决策纯函数共用的键盘事件输入形状与 @ 引用菜单打开检测
 * ============================================ */

/** 画布快捷键决策共用的键盘事件输入（key + 跨平台修饰键 + 焦点目标 + @ 菜单态） */
export interface CanvasKeyboardInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
  /** @ 引用菜单是否打开（菜单自行处理键盘，画布不得截断） */
  mentionMenuOpen: boolean;
}

/** @ 引用菜单是否打开（Esc 链同款检测约定：DOM 挂载即打开） */
export function isMentionMenuOpen(): boolean {
  return document.querySelector('[data-canvas-keyboard-scope="mention"]') !== null;
}

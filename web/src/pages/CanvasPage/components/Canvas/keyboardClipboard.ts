/* ============================================
 * 画布键盘剪贴板策略（IKGBPA）：Ctrl/Cmd+C 快照 / Ctrl/Cmd+V 粘贴；
 * 输入框 / 编辑器 / @ 引用菜单让位浏览器原生行为
 * ============================================ */
import { isEditableKeyboardTarget } from './keyboardDelete';
import type { CanvasKeyboardInput } from './canvasKeyboard';

/**
 * 决策枚举：后续快捷键（如 Z 撤销）按同名形态扩展，'ignore' 统一表示
 * 「让位浏览器原生行为或不响应」，调用方不得 preventDefault。
 */
export type CanvasClipboardKeyAction = 'copy' | 'paste' | 'ignore';

/** 共享键盘事件输入（canvasKeyboard.ts 收口，与撤销等快捷键同构） */
export type CanvasClipboardKeyInput = CanvasKeyboardInput;

/**
 * 决定画布对 C / V 按键的处理：
 * - Cmd/Ctrl（不含 Shift）+ C → 'copy'（快照选中卡）
 * - Cmd/Ctrl（不含 Shift）+ V → 'paste'（视口中心贴出快照）
 * - 可编辑目标（输入框 / 文本卡编辑器 / 生成面板输入区）、@ 菜单打开、
 *   Shift 组合键（DevTools 检查元素等）、其余按键 → 'ignore'
 */
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

/** 可复制卡：仅文本卡与媒体卡入选（商品卡 / 资产卡静默排除，含混合多选场景） */
export function copyableSelectedCanvasNodes(
  nodes: Array<{ id: string; type?: string; selected?: boolean }>,
): string[] {
  return nodes
    .filter((node) => node.selected && (node.type === 'textNode' || node.type === 'mediaNode'))
    .map((node) => node.id);
}

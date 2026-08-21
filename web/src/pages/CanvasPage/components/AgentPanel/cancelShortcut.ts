/**
 * ESC 取消本次回答的判定（IKA4PH）。
 *
 * 抽成纯函数是为了能单测：真正的监听器挂在 document 上、只在有运行时存在，那层布线没什么
 * 可测的，值得锁住的是「什么情况下该取消」这个判断本身。
 */

/** 按下 ESC 时，事件目标处于这些元素内则不取消运行——那里的 ESC 另有含义。 */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export interface CancelShortcutEvent {
  key: string;
  /** 已被更靠近事件源的处理器消费过就不再接管。 */
  defaultPrevented: boolean;
  /** 事件目标的标签名（`HTMLElement.tagName`，大写）。 */
  targetTagName?: string | undefined;
}

/**
 * 是否应当把这次按键当作「取消本次回答」。
 *
 * 按事件目标避让，而不是按编辑态避让：生成卡的行内编辑用 ESC 取消编辑，但那份状态在
 * `GenerationCard` 内部，面板这一层拿不到；而它们用的是 input/textarea，别处后加的文本框
 * 也一样，按目标判断能一并覆盖。
 *
 * 主输入框是 Lexical 的 contentEditable div，不在避让之列——发送后焦点通常还留在那里，
 * 那正是这条快捷键最主要的使用场景。
 */
export function shouldCancelOnKey(event: CancelShortcutEvent): boolean {
  if (event.key !== 'Escape') return false;
  if (event.defaultPrevented) return false;
  return !TEXT_ENTRY_TAGS.has(event.targetTagName ?? '');
}

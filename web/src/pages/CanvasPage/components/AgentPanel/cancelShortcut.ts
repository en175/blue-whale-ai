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
  /** 事件目标的标签名（`HTMLElement.tagName`，大写）。拿不到时按「让路」处理，见下。 */
  targetTagName?: string | undefined;
  /** 事件目标是否可编辑（contentEditable）。主输入框是例外，见 `isMainComposer`。 */
  isEditable?: boolean | undefined;
  /** 事件目标是否落在弹层 / 对话框内（`closest('[role=dialog], [aria-modal=true]')`）。 */
  inOverlay?: boolean | undefined;
  /** 事件目标是否就是 Agent 面板的主输入框。 */
  isMainComposer?: boolean | undefined;
}

/**
 * 是否应当把这次按键当作「取消本次回答」。
 *
 * 按事件目标避让，而不是按编辑态避让：生成卡的行内编辑用 ESC 取消编辑，但那份状态在
 * `GenerationCard` 内部，面板这一层拿不到；而它们用的是 input/textarea，别处后加的文本框
 * 也一样，按目标判断能一并覆盖。
 *
 * **默认让路，不默认取消。** 监听挂在 document 上，能收到页面里任何地方的 ESC；而这条
 * 快捷键的破坏力是不对称的——少取消一次，用户再按一次就是了；多取消一次，一整轮回答没了。
 * 所以判断不出目标是什么的时候，宁可不接管。
 *
 * 主输入框是 Lexical 的 contentEditable div，是 `isEditable` 的唯一例外：发送后焦点通常
 * 还留在那里，那正是这条快捷键最主要的使用场景。
 */
export function shouldCancelOnKey(event: CancelShortcutEvent): boolean {
  if (event.key !== 'Escape') return false;
  if (event.defaultPrevented) return false;
  // 弹层里的 ESC 归弹层——用户的意图是关掉眼前这层，不是停掉背后的回答。
  if (event.inOverlay) return false;
  if (event.isMainComposer) return true;
  // 任何其他可编辑区域的 ESC 都另有含义（退出编辑、收起补全），不接管。
  if (event.isEditable) return false;
  const tagName = event.targetTagName;
  if (tagName === undefined) return false;
  return !TEXT_ENTRY_TAGS.has(tagName);
}

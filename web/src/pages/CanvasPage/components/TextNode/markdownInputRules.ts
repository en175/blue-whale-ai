/* IKFM3L 统一文本卡编辑：Markdown 语法即时转换（契约 §2 八类格式的输入路径）。
   匹配层为纯函数（单测覆盖）；执行层操作编辑器 DOM + execCommand，由真实浏览器验证。 */

export type MarkdownInputAction =
  | { kind: 'heading'; level: 1 | 2 | 3 }
  | { kind: 'unordered-list' }
  | { kind: 'ordered-list' }
  | { kind: 'rule' }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string };

/** 行首块级规则：输入空格时，行首标记（# / ## / ### / - / * / 1.）转为格式。 */
export function matchBlockRule(lineBefore: string): { action: MarkdownInputAction; markerLength: number } | null {
  const heading = /^(#{1,3})$/.exec(lineBefore);
  if (heading) return { action: { kind: 'heading', level: heading[1].length as 1 | 2 | 3 }, markerLength: lineBefore.length };
  if (/^[-*]$/.test(lineBefore)) return { action: { kind: 'unordered-list' }, markerLength: lineBefore.length };
  if (/^\d+\.$/.test(lineBefore)) return { action: { kind: 'ordered-list' }, markerLength: lineBefore.length };
  return null;
}

/** 行内规则：粗体/斜体标记闭合、行首 --- 完成时转为格式。 */
export function matchInlineRule(lineBefore: string, data: string): { action: MarkdownInputAction; markerLength: number } | null {
  if (data === '*') {
    const bold = /\*\*([^*\n]+)\*\*$/.exec(lineBefore);
    if (bold) return { action: { kind: 'bold', text: bold[1] }, markerLength: bold[0].length };
    const italic = /(?:^|[^*])\*([^*\n]+)\*$/.exec(lineBefore);
    if (italic) return { action: { kind: 'italic', text: italic[1] }, markerLength: italic[1].length + 2 };
  }
  if (data === '-' && /^-{3}$/.test(lineBefore)) return { action: { kind: 'rule' }, markerLength: 3 };
  return null;
}

/** 取光标前、当前文本节点起点的片段（标记输入通常发生在单一文本节点内）。 */
function lineBeforeCursor(): { node: Text; text: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !(range.startContainer instanceof Text)) return null;
  return { node: range.startContainer, text: range.startContainer.textContent?.slice(0, range.startOffset) ?? '' };
}

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

/**
 * 输入事件后应用 Markdown 语法规则；返回 true 表示已转换（调用方需同步内容）。
 * 空格触发行首块级规则（光标前文本去掉触发空格后应为纯标记）；
 * `*`/`-` 触发行内闭合规则（标记已完整闭合）。
 */
export function applyMarkdownInputRule(editor: HTMLElement, data: string | null): boolean {
  if (data !== ' ' && data !== '*' && data !== '-') return false;
  const context = lineBeforeCursor();
  if (!context || !editor.contains(context.node)) return false;
  const { node, text: lineBefore } = context;

  // 块级规则：输入的是触发空格，标记是光标前去触发字符的片段
  const block = data === ' ' ? matchBlockRule(lineBefore.slice(0, -1)) : null;
  const inline = block ? null : matchInlineRule(lineBefore, data);
  const match = block ?? inline;
  if (!match) return false;
  const { action, markerLength } = match;
  // 删除范围 = 标记 + 触发字符（块级规则把空格一并删除）
  const markerTextLength = block ? markerLength + 1 : markerLength;

  const selection = window.getSelection()!;
  const markerRange = document.createRange();
  markerRange.setStart(node, lineBefore.length - markerTextLength);
  markerRange.setEnd(node, lineBefore.length);
  selection.removeAllRanges();
  selection.addRange(markerRange);
  exec('delete');

  if (action.kind === 'heading') exec('formatBlock', `h${action.level}`);
  else if (action.kind === 'unordered-list') exec('insertUnorderedList');
  else if (action.kind === 'ordered-list') exec('insertOrderedList');
  else if (action.kind === 'rule') exec('insertHorizontalRule');
  else if (action.kind === 'bold' || action.kind === 'italic') {
    // 重新插入内容文本并选中，应用行内格式
    exec('insertText', action.text);
    const after = window.getSelection();
    if (after && after.rangeCount > 0 && after.getRangeAt(0).startContainer instanceof Text) {
      const textNode = after.getRangeAt(0).startContainer as Text;
      const offset = after.getRangeAt(0).startOffset;
      const wrapRange = document.createRange();
      wrapRange.setStart(textNode, Math.max(0, offset - action.text.length));
      wrapRange.setEnd(textNode, offset);
      after.removeAllRanges();
      after.addRange(wrapRange);
      exec(action.kind === 'bold' ? 'bold' : 'italic');
      after.getRangeAt(0).collapse(false);
    }
  }
  return true;
}

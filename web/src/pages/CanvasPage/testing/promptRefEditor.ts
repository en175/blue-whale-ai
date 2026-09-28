/* ============================================
 * 测试助手：驱动 PromptRefEditor（IKFA1M）
 * jsdom 无法向 contentEditable 注入原生输入；测试经根元素上的编辑器实例
 * （EditorRefBridge 挂的 __promptRefEditor 测试接缝）直接 editor.update。
 * ============================================ */
import { act } from 'react';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
} from 'lexical';
type EditorHost = HTMLElement & { __promptRefEditor?: LexicalEditor };

// jsdom 垫片：Range/Text 缺 getBoundingClientRect（Lexical 选区同步的滚动计算需要）
if (typeof window !== 'undefined' && !window.Range.prototype.getBoundingClientRect) {
  const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
  window.Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  window.Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
}

export function promptRefEditorInstance(container: ParentNode): LexicalEditor {
  const el = container.querySelector('[contenteditable]') as EditorHost | null;
  if (!el?.__promptRefEditor) throw new Error('PromptRefEditor 未挂载（contenteditable 未就绪）');
  return el.__promptRefEditor;
}

/** 用纯文本整体替换编辑器内容（等价旧 textarea 赋值） */
export async function typePromptRefText(container: ParentNode, text: string): Promise<void> {
  const editor = promptRefEditorInstance(container);
  await act(async () => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      if (text) paragraph.append($createTextNode(text));
      root.append(paragraph);
    }, { tag: SKIP_DOM_SELECTION_TAG });
  });
}

/** 编辑器当前纯文本投影（等价旧 textarea.value） */
export function readPromptRefText(container: ParentNode): string {
  return promptRefEditorInstance(container).read(() => $getRoot().getTextContent());
}

/** 只读状态（等价旧 textarea.disabled） */
export function promptRefReadOnly(container: ParentNode): boolean {
  return !promptRefEditorInstance(container).isEditable();
}

/** 把光标折叠在首个文本节点 offset 处（等价点击定位光标） */
export async function collapseCaretAt(editor: ReturnType<typeof promptRefEditorInstance>, offset: number) {
  await act(async () => {
    editor.update(() => {
      const text = $getRoot().getFirstDescendant();
      // 前置条件：编辑器已有文本（先调 typePromptRefText 写入），否则报可读错误而非 TypeError
      if (!text) throw new Error('collapseCaretAt 需要编辑器已有文本节点（先调 typePromptRefText）');
      const sel = $createRangeSelection();
      sel.anchor.set(text.getKey(), offset, 'text');
      sel.focus.set(text.getKey(), offset, 'text');
      $setSelection(sel);
    }, { tag: SKIP_DOM_SELECTION_TAG });
  });
}

/** 在末尾光标处逐段插入原始文本（模拟键入；用于触发 @ 查询检测） */
export async function typePromptRefRaw(container: ParentNode, text: string): Promise<void> {
  const editor = promptRefEditorInstance(container);
  await act(async () => {
    editor.update(() => {
      $getRoot().selectEnd();
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertRawText(text);
    }, { tag: SKIP_DOM_SELECTION_TAG });
  });
}

/** 折叠选区的锚点偏移（IKFXOR 光标落点断言用）；无折叠选区时返回 -1 */
export function promptRefCaretOffset(container: ParentNode): number {
  const editor = promptRefEditorInstance(container);
  let offset = -1;
  editor.read(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection) && selection.isCollapsed()) offset = selection.anchor.offset;
  });
  return offset;
}

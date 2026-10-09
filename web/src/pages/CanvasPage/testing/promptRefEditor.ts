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

export function readPromptRefText(container: ParentNode): string {
  return promptRefEditorInstance(container).read(() => $getRoot().getTextContent());
}

export function promptRefReadOnly(container: ParentNode): boolean {
  return !promptRefEditorInstance(container).isEditable();
}

export async function collapseCaretAt(editor: ReturnType<typeof promptRefEditorInstance>, offset: number) {
  await act(async () => {
    editor.update(() => {
      const text = $getRoot().getFirstDescendant();
      if (!text) throw new Error('collapseCaretAt 需要编辑器已有文本节点（先调 typePromptRefText）');
      const sel = $createRangeSelection();
      sel.anchor.set(text.getKey(), offset, 'text');
      sel.focus.set(text.getKey(), offset, 'text');
      $setSelection(sel);
    }, { tag: SKIP_DOM_SELECTION_TAG });
  });
}

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

export function promptRefCaretOffset(container: ParentNode): number {
  const editor = promptRefEditorInstance(container);
  let offset = -1;
  editor.read(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection) && selection.isCollapsed()) offset = selection.anchor.offset;
  });
  return offset;
}

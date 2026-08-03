// IK55VH — TipTap 富文本编辑器封装（文本卡三态与展开模态共用，移植自原型变体 A）。
"use client";

import { useEffect, useRef } from "react";
import { ReactRenderer, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import Mention from "@tiptap/extension-mention";
import { MentionList, type MentionListRef } from "./MentionList";
import type { TextMentionItem } from "./types";

/** @ 建议过滤：名称子串匹配（大小写不敏感），上限 8 条。 */
export function filterMentionItems(
  items: TextMentionItem[],
  query: string,
): TextMentionItem[] {
  const q = query.toLowerCase();
  return items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8);
}

/** 纯文本 → TipTap doc（旧卡兼容：无 richDoc 时以 prompt/content 播种初始内容）。 */
export function plainTextToDoc(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : undefined,
    })),
  };
}

type SuggestionProps = {
  clientRect?: (() => DOMRect | null) | null;
  editor: Editor;
  items: TextMentionItem[];
  query: string;
  command: (item: { id: string; label: string }) => void;
};

function mentionSuggestion(getItems: () => TextMentionItem[]) {
  return {
    items: ({ query }: { query: string }) =>
      filterMentionItems(getItems(), query),
    render: () => {
      let renderer: ReactRenderer<MentionListRef> | null = null;
      let popup: HTMLDivElement | null = null;
      const place = (rect?: DOMRect | null) => {
        if (!popup || !rect) return;
        popup.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;
        popup.style.top = `${rect.bottom + 6}px`;
      };
      return {
        onStart: (props: SuggestionProps) => {
          renderer = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });
          popup = document.createElement("div");
          popup.style.position = "fixed";
          popup.style.zIndex = "9999";
          popup.appendChild(renderer.element);
          document.body.appendChild(popup);
          place(props.clientRect?.());
        },
        onUpdate: (props: SuggestionProps) => {
          renderer?.updateProps(props);
          place(props.clientRect?.());
        },
        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === "Escape") {
            popup?.remove();
            renderer?.destroy();
            popup = null;
            renderer = null;
            return true;
          }
          return renderer?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          popup?.remove();
          renderer?.destroy();
          popup = null;
          renderer = null;
        },
      };
    },
  };
}

/**
 * 富文本卡编辑器：StarterKit（含 underline/heading/horizontalRule/link）+ TextStyle/Color
 * + Placeholder + Mention suggestion。mentionItems 经 ref 透传，素材列表变化无需重建编辑器。
 */
export function useRichEditor(opts: {
  doc: unknown;
  editable: boolean;
  mentionItems: TextMentionItem[];
  onCommit: (doc: unknown) => void;
}) {
  const { doc, editable, mentionItems, onCommit } = opts;
  const itemsRef = useRef(mentionItems);
  useEffect(() => {
    itemsRef.current = mentionItems;
  }, [mentionItems]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: "输入笔记， @ 可引用画布素材…" }),
      Mention.configure({
        HTMLAttributes: { class: "tc-rich-mention" },
        // suggestion 回调在 @ 输入时（事件期）经 ref 读最新素材，非渲染期访问
        // eslint-disable-next-line react-hooks/refs
        suggestion: mentionSuggestion(() => itemsRef.current),
      }),
    ],
    content: doc as never,
    editable,
    immediatelyRender: false,
    onBlur: ({ editor: e }) => onCommit(e.getJSON()),
    editorProps: {
      attributes: { class: "tc-rich-editor" },
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
    // nodrag 随可编辑态切换：编辑时保护选区不触发卡片拖拽，只读时恢复可拖（IK5U3K）
    editor?.view?.dom.classList.toggle("nodrag", editable);
  }, [editor, editable]);

  return editor;
}

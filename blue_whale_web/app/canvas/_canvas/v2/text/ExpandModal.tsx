// IK55VH — 展开大编辑视图（居中模态：完整工具栏 + 大编辑区，移植自原型变体 A）。
"use client";

import { useEffect } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { X } from "lucide-react";
import { TextFormatToolbar } from "./TextFormatToolbar";

export function ExpandModal({
  editor,
  onClose,
}: {
  editor: Editor | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2147483610] flex items-center justify-center"
      style={{ background: "var(--tc-bg-overlay)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[80vh] w-[720px] max-w-[90vw] flex-col rounded-xl"
        style={{
          background: "var(--tc-bg-surface)",
          border: "1px solid var(--tc-border)",
          boxShadow: "var(--tc-modal-shadow)",
        }}
      >
        <div
          className="flex items-center justify-between gap-2 border-b px-3 py-2"
          style={{ borderColor: "var(--tc-border-subtle)" }}
        >
          <TextFormatToolbar editor={editor} />
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--tc-text-secondary)",
              cursor: "pointer",
            }}
          >
            <X width={15} height={15} />
          </button>
        </div>
        <div className="min-h-[320px] flex-1 overflow-auto px-4 py-3">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

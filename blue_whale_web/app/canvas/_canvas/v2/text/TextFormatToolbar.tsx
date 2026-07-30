// IK55VH — 富文本卡格式工具栏（颜色/P-H3/B-I-U-S/列表/引用/分割线/清除/@/展开，移植自原型变体 A）。
"use client";

import { useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import {
  AtSign,
  Bold,
  Italic,
  List,
  ListOrdered,
  Maximize2,
  Minus,
  Palette,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from "lucide-react";

// 文本颜色是内容色（写进 richDoc），允许内联 hex，不走 token
const COLORS = [
  { name: "白", value: "#ffffff" },
  { name: "灰", value: "rgba(255,255,255,0.55)" },
  { name: "蓝", value: "#3b82f6" },
  { name: "绿", value: "#22c55e" },
  { name: "黄", value: "#eab308" },
  { name: "红", value: "#ef4444" },
] as const;

const LEVELS = [
  { key: "p", label: "P", level: 0 },
  { key: "h1", label: "H1", level: 1 },
  { key: "h2", label: "H2", level: 2 },
  { key: "h3", label: "H3", level: 3 },
] as const;

type Props = {
  editor: Editor | null;
  onExpand?: () => void;
  /** 任何格式命令生效后回调（选中态即时写回 richDoc + 派生纯文本）。 */
  onAnyCommand?: () => void;
  /**
   * 选中态（editable=false，无用户选区）：格式类命令先 selectAll 作用于全文，
   * 否则空选区 toggle 只改 stored mark，doc 不变、写回为空操作。
   * 插入类命令（分割线/@）不 selectAll，避免替换全文。
   */
  applyToAll?: boolean;
};

function Btn({
  active,
  label,
  onRun,
  children,
}: {
  active?: boolean;
  label: string;
  onRun: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className="flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-[12px]"
      style={{
        background: active ? "var(--tc-bg-surface)" : "transparent",
        color: active ? "var(--tc-text-primary)" : "var(--tc-text-secondary)",
        border: 0,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      className="mx-1 h-4 w-px"
      style={{ background: "var(--tc-border)" }}
    />
  );
}

export function TextFormatToolbar({
  editor,
  onExpand,
  onAnyCommand,
  applyToAll,
}: Props) {
  const [colorOpen, setColorOpen] = useState(false);
  const run = (fn: (e: Editor) => void, opts?: { insert?: boolean }) => () => {
    if (!editor) return;
    if (applyToAll && !opts?.insert) editor.commands.selectAll();
    fn(editor);
    onAnyCommand?.();
  };
  const I = 14;

  return (
    <div
      className="nodrag nowheel relative flex items-center gap-0.5 rounded-lg px-1.5 py-1"
      style={{
        background: "var(--tc-bg-elevated)",
        border: "1px solid var(--tc-border-subtle)",
        boxShadow: "var(--tc-dropdown-shadow)",
      }}
    >
      <div className="relative">
        <Btn
          label="文本颜色"
          active={colorOpen}
          onRun={() => setColorOpen((o) => !o)}
        >
          <Palette width={I} height={I} />
        </Btn>
        {colorOpen && (
          <div
            className="absolute top-full left-0 z-10 mt-1 flex gap-1 rounded-lg p-1.5"
            style={{
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-subtle)",
            }}
          >
            {COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={run((e) => {
                  e.chain().focus().setColor(c.value).run();
                  setColorOpen(false);
                })}
                className="rounded-full"
                style={{
                  width: 18,
                  height: 18,
                  background: c.value,
                  border: "1px solid var(--tc-border-active)",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        )}
      </div>

      <Divider />
      {LEVELS.map((lv) => (
        <Btn
          key={lv.key}
          label={`段落级别 ${lv.label}`}
          active={
            lv.level === 0
              ? !editor?.isActive("heading")
              : editor?.isActive("heading", { level: lv.level })
          }
          onRun={run((e) => {
            const c = e.chain().focus();
            if (lv.level === 0) c.setParagraph().run();
            else c.toggleHeading({ level: lv.level as 1 | 2 | 3 }).run();
          })}
        >
          <span className="font-medium">{lv.label}</span>
        </Btn>
      ))}
      <Divider />
      <Btn
        label="加粗"
        active={editor?.isActive("bold")}
        onRun={run((e) => e.chain().focus().toggleBold().run())}
      >
        <Bold width={I} height={I} />
      </Btn>
      <Btn
        label="斜体"
        active={editor?.isActive("italic")}
        onRun={run((e) => e.chain().focus().toggleItalic().run())}
      >
        <Italic width={I} height={I} />
      </Btn>
      <Btn
        label="下划线"
        active={editor?.isActive("underline")}
        onRun={run((e) => e.chain().focus().toggleUnderline().run())}
      >
        <Underline width={I} height={I} />
      </Btn>
      <Btn
        label="删除线"
        active={editor?.isActive("strike")}
        onRun={run((e) => e.chain().focus().toggleStrike().run())}
      >
        <Strikethrough width={I} height={I} />
      </Btn>
      <Divider />
      <Btn
        label="无序列表"
        active={editor?.isActive("bulletList")}
        onRun={run((e) => e.chain().focus().toggleBulletList().run())}
      >
        <List width={I} height={I} />
      </Btn>
      <Btn
        label="有序列表"
        active={editor?.isActive("orderedList")}
        onRun={run((e) => e.chain().focus().toggleOrderedList().run())}
      >
        <ListOrdered width={I} height={I} />
      </Btn>
      <Btn
        label="引用"
        active={editor?.isActive("blockquote")}
        onRun={run((e) => e.chain().focus().toggleBlockquote().run())}
      >
        <Quote width={I} height={I} />
      </Btn>
      <Btn
        label="分割线"
        onRun={run((e) => e.chain().focus().setHorizontalRule().run(), {
          insert: true,
        })}
      >
        <Minus width={I} height={I} />
      </Btn>
      <Divider />
      <Btn
        label="清除格式"
        onRun={run((e) => e.chain().focus().unsetAllMarks().clearNodes().run())}
      >
        <RemoveFormatting width={I} height={I} />
      </Btn>
      <Divider />
      <Btn
        label="@ 引用画布素材"
        onRun={run((e) => e.chain().focus().insertContent("@").run(), {
          insert: true,
        })}
      >
        <AtSign width={I} height={I} />
      </Btn>
      {onExpand && (
        <Btn label="展开大编辑视图" onRun={onExpand}>
          <Maximize2 width={I} height={I} />
        </Btn>
      )}
    </div>
  );
}

// PROTOTYPE (IK4Q4E) — 场景卡就地编辑（批注：不用 Markdown 源码编辑）。
// 文本直接编辑；素材引用渲染为「迷你缩略图 + 素材名」chip（不可编辑原子），
// 悬停浮出放大预览。保存时把 DOM 序列化回 content_markdown（契约：markdown 仍是唯一权威）。
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AssetChip, parseMarkdown, type MdBlock } from "./markdown";
import { useProto } from "./shared";

/** 段落内联：文本片段 + asset chip（chip 带 data-md，供序列化还原）。 */
function InlineSegments({ text }: { text: string }) {
  const parts = text.split(/(!\[[^\]]*\]\(asset:\/\/[^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^!\[([^\]]*)\]\(asset:\/\/([^)]+)\)$/);
        if (m) {
          return (
            <AssetChip key={i} label={m[1]} assetId={m[2]} editable={false} />
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** 把编辑器内联 DOM 序列化回 markdown 文本。 */
function serializeInline(el: HTMLElement): string {
  let s = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      s += n.textContent;
      return;
    }
    const c = n as HTMLElement;
    if (c.dataset?.md) {
      s += c.dataset.md;
      return;
    }
    if (c.tagName === "BR") return;
    s += serializeInline(c);
  });
  return s;
}

/** 把编辑器根 DOM 序列化回 markdown（块级 data-prefix + 内联 chip data-md）。 */
function serializeRoot(root: HTMLElement): string {
  const out: string[] = [];
  root.childNodes.forEach((n) => {
    if (n.nodeType !== Node.ELEMENT_NODE) {
      const t = n.textContent?.trim();
      if (t) out.push(t);
      return;
    }
    const el = n as HTMLElement;
    const prefix = el.dataset?.prefix ?? "";
    const body = serializeInline(el).trim();
    if (body) out.push(prefix + body);
  });
  return out.join("\n\n");
}

/** 块级渲染：h1 / h2 / p，均带 data-prefix 供序列化还原。 */
function EditorBlocks({ blocks }: { blocks: MdBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "h1") {
          return (
            <div
              key={i}
              data-prefix="# "
              className="text-[14px] font-semibold leading-6"
              style={{ color: "var(--tc-text-primary)" }}
            >
              <InlineSegments text={b.text} />
            </div>
          );
        }
        if (b.kind === "h2") {
          return (
            <div
              key={i}
              data-prefix="## "
              className="mt-1 text-[13px] font-medium leading-5"
              style={{ color: "var(--tc-text-primary)" }}
            >
              <InlineSegments text={b.text} />
            </div>
          );
        }
        return (
          <p
            key={i}
            data-prefix=""
            className="m-0 text-[12.5px] leading-[1.7]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <InlineSegments text={b.text} />
          </p>
        );
      })}
    </>
  );
}

/** 通用富文本 Markdown 输入框（非受控）：素材引用显示为缩略图 chip。
 *  onChange 在每次输入时给出序列化后的 markdown。 */
export function RichPromptInput({
  initialMarkdown,
  onChange,
  className,
  style,
}: {
  initialMarkdown: string;
  onChange?: (md: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [blocks] = useState<MdBlock[]>(() => parseMarkdown(initialMarkdown));
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={() => {
        if (ref.current && onChange) onChange(serializeRoot(ref.current));
      }}
      className={className}
      style={style}
    >
      <EditorBlocks blocks={blocks} />
    </div>
  );
}

/** 双击进入的就地编辑态：Esc 取消，⌘/Ctrl+Enter 或失焦保存。
 *  height 为渲染态内容高度：编辑态锁死同高，超出部分内部滚动（批注）。 */
export function SceneRichEditor({ height }: { height?: number }) {
  const api = useProto();
  const ref = useRef<HTMLDivElement>(null);
  // 初始内容只在进入编辑时解析一次（contentEditable 非受控）
  const [blocks] = useState<MdBlock[]>(() => parseMarkdown(api.content));

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => {
    const root = ref.current;
    if (!root) {
      api.cancelEdit();
      return;
    }
    api.commitEdit(serializeRoot(root));
  };

  return (
    <div
      className="nodrag nowheel flex flex-col gap-1"
      style={height ? { height } : undefined}
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") api.cancelEdit();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto rounded-md p-2 outline-none"
        style={{
          background: "var(--tc-bg-canvas)",
          border: "1px solid var(--tc-border-active)",
        }}
      >
        <EditorBlocks blocks={blocks} />
      </div>
      <span className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
        直接编辑文本 · 素材引用显示为缩略图 chip · Esc 取消 · ⌘↵ / 失焦保存
      </span>
    </div>
  );
}

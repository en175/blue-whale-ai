// PROTOTYPE (IK4Q4E) — 场景卡 Markdown 渲染：Scene 头 / Shot 标题 / 段落（内联 asset chip）。
// 视觉按需求方截图：内联引用是「图标 + Image N」灰底 pill，嵌在正文行内。
"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon } from "lucide-react";

export type MdBlock =
  { kind: "h1" | "h2"; text: string } | { kind: "p"; text: string };

export function parseMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", text: line.slice(3) });
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ kind: "h1", text: line.slice(2) });
      continue;
    }
    blocks.push({ kind: "p", text: line });
  }
  return blocks;
}

/** 内联 asset chip：正文里的 ![Image N](asset://id) → 迷你缩略图 + 素材名。
 *  悬停时在上方浮出放大预览（批注：让用户认出是哪张素材）。
 *  assetId 仅在编辑器内传入（序列化回 markdown 用）；editable=false 用于
 *  contentEditable 环境（chip 是不可编辑的原子）。 */
export function AssetChip({
  label,
  assetId,
  editable = true,
}: {
  label: string;
  assetId?: string;
  editable?: boolean;
}) {
  // 悬停预览用 fixed 定位：编辑器/面板是滚动容器，absolute 会被裁剪（批注）
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const PREVIEW_W = 128;
  const PREVIEW_H = 80;
  return (
    <span
      ref={wrapRef}
      className="relative mx-0.5 inline-flex translate-y-[2px] items-center gap-1 rounded px-1.5 py-0.5 align-baseline"
      style={{
        background: "var(--tc-bg-elevated)",
        border: "1px solid var(--tc-border-subtle)",
      }}
      contentEditable={editable ? undefined : false}
      suppressContentEditableWarning
      {...(assetId ? { "data-md": `![${label}](asset://${assetId})` } : {})}
      onMouseEnter={() => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (r)
          setPos({
            x: r.left + r.width / 2 - PREVIEW_W / 2,
            y: r.top - PREVIEW_H - 6,
          });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {/* 迷你缩略图（mock 渐变，真实实现换成素材缩略图） */}
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-[3px]"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--tc-bg-surface) 0%, var(--tc-border-active) 60%, var(--tc-bg-surface) 100%)",
          border: "1px solid var(--tc-border-subtle)",
        }}
      />
      <span
        className="text-[11px] leading-none"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        {label}
      </span>
      {/* 悬停放大预览：portal 到 body，避免 transformed 祖先使 fixed 错位 */}
      {pos &&
        createPortal(
          <span
            className="pointer-events-none fixed z-[60] block overflow-hidden rounded-lg"
            style={{
              left: pos.x,
              top: pos.y,
              width: PREVIEW_W,
              height: PREVIEW_H,
              backgroundImage:
                "linear-gradient(135deg, var(--tc-bg-elevated) 0%, var(--tc-bg-surface) 50%, var(--tc-bg-elevated) 100%)",
              border: "1px solid var(--tc-border-active)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            <span className="absolute inset-0 flex items-center justify-center">
              <ImageIcon
                width={22}
                height={22}
                stroke="var(--tc-text-muted)"
                strokeWidth={1.2}
              />
            </span>
            <span
              className="absolute bottom-1 left-1.5 text-[10px]"
              style={{ color: "var(--tc-text-tertiary)" }}
            >
              {label}
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}

/** 段落渲染：把 asset:// 引用替换为内联 chip，其余按文本。 */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(!\[[^\]]*\]\(asset:\/\/[^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^!\[([^\]]*)\]\(asset:\/\/[^)]+\)$/);
        if (m) return <AssetChip key={i} label={m[1]} />;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Scene 头：`Scene 01 · 15s` → 主标题加粗，「·」后弱化。 */
function SceneHeader({ text }: { text: string }) {
  const [main, ...rest] = text.split("·");
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="text-[14px] font-semibold leading-6"
        style={{ color: "var(--tc-text-primary)" }}
      >
        {main.trim()}
      </span>
      {rest.length > 0 && (
        <span className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
          {rest.join("·").trim()}
        </span>
      )}
    </div>
  );
}

export function MarkdownBody({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b, i) => {
        if (b.kind === "h1") return <SceneHeader key={i} text={b.text} />;
        if (b.kind === "h2") {
          return (
            <div
              key={i}
              className="mt-1 text-[13px] font-medium leading-5"
              style={{ color: "var(--tc-text-primary)" }}
            >
              {b.text}
            </div>
          );
        }
        return (
          <p
            key={i}
            className="m-0 text-[12.5px] leading-[1.7]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <InlineText text={b.text} />
          </p>
        );
      })}
    </div>
  );
}

"use client";

/**
 * SceneCardNode 阅读态 Markdown 渲染（spec §3.1 / §7.3）。
 * 轻量解析规则（与评审原型一致）：`# ` 一级标题（主标题 · 弱化时长）、`## ` 二级标题、
 * 其余非空行按段落；`![说明](asset://<asset_id>)` 渲染为「迷你缩略图 + 说明」chip。
 * 其他 Markdown 语法（列表/表格/链接/HTML 等）一律按不可信普通文字显示，不执行、不内嵌。
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon } from "lucide-react";

import { useCanvasStore } from "../store";

export type SceneCardMdBlock =
  { kind: "h1" | "h2"; text: string } | { kind: "p"; text: string };

export function parseSceneCardMarkdown(md: string): SceneCardMdBlock[] {
  const blocks: SceneCardMdBlock[] = [];
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

const PREVIEW_W = 128;
const PREVIEW_H = 80;

/** asset:// 引用 chip：迷你缩略图 + 说明文本；悬停浮出 128×80 放大预览（portal 到 body，
 *  避免 transformed 祖先与滚动容器裁剪，spec §3.1）。素材失效时回退图标占位。 */
function AssetRefChip({ label, assetId }: { label: string; assetId: string }) {
  const asset = useCanvasStore((s) => s.assets[assetId]);
  const src = asset?.src;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={wrapRef}
      className="relative mx-0.5 inline-flex translate-y-[2px] items-center gap-1 rounded px-1.5 py-0.5 align-baseline"
      style={{
        background: "var(--tc-bg-elevated)",
        border: "1px solid var(--tc-border-subtle)",
      }}
      onMouseEnter={() => {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (rect) {
          setPos({
            x: rect.left + rect.width / 2 - PREVIEW_W / 2,
            y: rect.top - PREVIEW_H - 6,
          });
        }
      }}
      onMouseLeave={() => setPos(null)}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- asset src 为签名 URL，不交 next/image 优化器
        <img
          src={src}
          alt={label}
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-[3px] object-cover"
          style={{ border: "1px solid var(--tc-border-subtle)" }}
        />
      ) : (
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-[3px]"
          style={{
            backgroundImage:
              "linear-gradient(135deg, var(--tc-bg-surface) 0%, var(--tc-border-active) 60%, var(--tc-bg-surface) 100%)",
            border: "1px solid var(--tc-border-subtle)",
          }}
        />
      )}
      <span
        className="text-[11px] leading-none"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        {label}
      </span>
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
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element -- asset src 为签名 URL，不交 next/image 优化器
              <img
                src={src}
                alt={label}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center">
                <ImageIcon
                  width={22}
                  height={22}
                  stroke="var(--tc-text-muted)"
                  strokeWidth={1.2}
                />
              </span>
            )}
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

/** 段落内联：asset:// 引用替换为 chip，其余按纯文本。 */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(!\[[^\]]*\]\(asset:\/\/[^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^!\[([^\]]*)\]\(asset:\/\/([^)]+)\)$/);
        if (m) return <AssetRefChip key={i} label={m[1]} assetId={m[2]} />;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** 一级标题：`主标题 · 时长` → 主标题加粗，「·」后弱化（spec §3.1 显示约定）。 */
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

export function SceneCardMarkdownBody({ markdown }: { markdown: string }) {
  const blocks = parseSceneCardMarkdown(markdown);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        if (block.kind === "h1")
          return <SceneHeader key={i} text={block.text} />;
        if (block.kind === "h2") {
          return (
            <div
              key={i}
              className="mt-1 text-[13px] font-medium leading-5"
              style={{ color: "var(--tc-text-primary)" }}
            >
              {block.text}
            </div>
          );
        }
        return (
          <p
            key={i}
            className="m-0 text-[12.5px] leading-[1.7]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <InlineText text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

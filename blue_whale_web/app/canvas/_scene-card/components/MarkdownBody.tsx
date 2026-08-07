"use client";

import { Image as ImageIcon } from "lucide-react";

/** 只读 SceneCard Markdown 渲染（IK67HB/T13，提纯自 prototype scene-card markdown）。
 *  去掉 contentEditable 与悬停预览，纯展示：Scene 头 / Shot 标题 / 段落（内联只读 asset chip）。 */
type MdBlock =
  { kind: "h1" | "h2"; text: string } | { kind: "p"; text: string };

function parseMarkdown(md: string): MdBlock[] {
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

function AssetChipReadonly({ label }: { label: string }) {
  return (
    <span
      className="mx-0.5 inline-flex translate-y-[2px] items-center gap-1 rounded px-1.5 py-0.5 align-baseline"
      style={{
        background: "var(--tc-bg-elevated)",
        border: "1px solid var(--tc-border-subtle)",
      }}
    >
      <ImageIcon
        width={14}
        height={14}
        stroke="var(--tc-text-muted)"
        strokeWidth={1.2}
      />
      <span
        className="text-[11px] leading-none"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        {label}
      </span>
    </span>
  );
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(!\[[^\]]*\]\(asset:\/\/[^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^!\[([^\]]*)\]\(asset:\/\/[^)]+\)$/);
        if (m) return <AssetChipReadonly key={i} label={m[1]} />;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

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

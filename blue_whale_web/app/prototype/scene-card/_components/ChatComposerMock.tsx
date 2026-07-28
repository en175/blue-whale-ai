// PROTOTYPE (IK4Q4E) — 对话输入区 mock：演示「选中场景卡 → 头顶 @ → 插入 chip」。
"use client";

import { Clapperboard, X } from "lucide-react";

export type MentionChip = { id: string; label: string };

export function ChatComposerMock({
  chips,
  onRemoveChip,
}: {
  chips: MentionChip[];
  onRemoveChip: (id: string) => void;
}) {
  return (
    <div
      className="fixed right-4 bottom-24 z-40 flex w-[340px] flex-col gap-2 rounded-xl p-3"
      style={{
        background: "var(--tc-bg-surface)",
        border: "1px solid var(--tc-border-subtle)",
      }}
    >
      <span
        className="text-[11px] font-medium tracking-wide"
        style={{ color: "var(--tc-text-muted)" }}
      >
        AGENT 对话（MOCK）
      </span>
      <div
        className="flex min-h-[64px] flex-wrap content-start gap-1.5 rounded-lg p-2"
        style={{
          background: "var(--tc-bg-canvas)",
          border: "1px solid var(--tc-border-subtle)",
        }}
      >
        {chips.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-[12px]"
            style={{
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-active)",
              color: "var(--tc-text-primary)",
            }}
          >
            <Clapperboard width={12} height={12} stroke="var(--tc-accent)" />
            {c.label}
            <button
              type="button"
              aria-label="移除引用"
              onClick={() => onRemoveChip(c.id)}
              className="flex items-center justify-center rounded-full"
              style={{
                width: 16,
                height: 16,
                border: 0,
                background: "transparent",
                color: "var(--tc-text-muted)",
              }}
            >
              <X width={11} height={11} />
            </button>
          </span>
        ))}
        <span
          className="p-1 text-[12.5px]"
          style={{ color: "var(--tc-text-muted)" }}
        >
          {chips.length === 0
            ? "选中场景卡，点头顶「@」把卡片引用挂到这里…"
            : "基于这张场景卡继续修改…"}
        </span>
      </div>
    </div>
  );
}

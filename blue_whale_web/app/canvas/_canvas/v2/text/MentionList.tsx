// IK55VH — @ 建议列表（TipTap Mention suggestion 的下拉，移植自原型变体 A）。
"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { FileImage, Film, Music } from "lucide-react";
import type { TextMentionItem } from "./types";

export type MentionListRef = {
  onKeyDown: (e: KeyboardEvent) => boolean;
};

type Props = {
  items: TextMentionItem[];
  command: (item: { id: string; label: string }) => void;
};

const TYPE_ICON = {
  image: FileImage,
  video: Film,
  audio: Music,
} as const;

export const MentionList = forwardRef<MentionListRef, Props>(
  function MentionList({ items, command }, ref) {
    const [index, setIndex] = useState(0);

    useEffect(() => setIndex(0), [items]);

    const pick = (i: number) => {
      const it = items[i];
      if (it) command({ id: it.id, label: it.name });
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: (e) => {
        if (items.length === 0) return false;
        if (e.key === "ArrowUp") {
          setIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (e.key === "ArrowDown") {
          setIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (e.key === "Enter") {
          pick(index);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div
          className="rounded-xl px-3 py-2 text-[12px]"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
            color: "var(--tc-text-muted)",
          }}
        >
          无匹配素材
        </div>
      );
    }

    return (
      <div
        className="flex w-[220px] flex-col overflow-hidden rounded-xl py-1"
        style={{
          background: "var(--tc-bg-elevated)",
          border: "1px solid var(--tc-border-subtle)",
          boxShadow: "var(--tc-dropdown-shadow)",
        }}
      >
        {items.map((it, i) => {
          const Icon = TYPE_ICON[it.type];
          return (
            <button
              key={it.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              onMouseEnter={() => setIndex(i)}
              className="flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px]"
              style={{
                background:
                  i === index ? "var(--tc-menu-item-hover)" : "transparent",
                border: 0,
                color: "var(--tc-text-secondary)",
                cursor: "pointer",
              }}
            >
              <Icon width={14} height={14} style={{ flexShrink: 0 }} />
              <span className="truncate">{it.name}</span>
            </button>
          );
        })}
      </div>
    );
  },
);

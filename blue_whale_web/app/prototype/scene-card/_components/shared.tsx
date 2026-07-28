// PROTOTYPE (IK4Q4E) — 场景卡节点共享交互件。
// 交互规则（map Notes + 截图批注定稿）：
// 单击仅选中可拖拽 / 双击就地编辑 / 删除无确认 / 选中时头部 @ 与删除按钮 /
// 底部「生成视频」+ 右侧下拉（直接生成视频 / 先预览分镜图 / 分镜图设置）。
"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  AtSign,
  Trash2,
  Clapperboard,
  ChevronDown,
  Film,
  Images,
  SlidersHorizontal,
} from "lucide-react";

export type ProtoApi = {
  content: string;
  editing: boolean;
  startEdit: () => void;
  commitEdit: (md: string) => void;
  cancelEdit: () => void;
  atReference: () => void;
  removeNode: () => void;
  /** 主按钮：直接打开视频生成面板（预填卡片内容）。 */
  openVideoPanel: () => void;
  /** 下拉项：直接基于场景卡内容生成分镜图。 */
  previewStoryboard: () => void;
  /** 下拉项：分镜图设置弹窗。 */
  openStoryboardSettings: () => void;
};

export const ProtoCtx = createContext<ProtoApi | null>(null);

export function useProto(): ProtoApi {
  const v = useContext(ProtoCtx);
  if (!v) throw new Error("ProtoCtx missing");
  return v;
}

/** 选中描边（与 ImageNode/TextNode 同一 token）。 */
export function selectedOutline(selected: boolean | undefined) {
  return {
    outline: selected
      ? "2px solid var(--tc-card-selected-stroke)"
      : "2px solid transparent",
    outlineOffset: 0,
  } as const;
}

/** 选中时头部按钮组（截图批注 2）：@ 引用 + 删除（无确认），卡片上方居中。 */
export function HeadActions() {
  const api = useProto();
  const btn = {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: "var(--tc-bg-elevated)",
    border: "1px solid var(--tc-border-subtle)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  } as const;
  return (
    <div className="nodrag absolute -top-14 left-1/2 z-10 flex -translate-x-1/2 gap-2">
      <button
        type="button"
        aria-label="@ 引用到对话"
        title="@ 引用到对话"
        onClick={api.atReference}
        style={{ ...btn, color: "var(--tc-text-primary)" }}
      >
        <AtSign width={18} height={18} />
      </button>
      <button
        type="button"
        aria-label="删除（无确认）"
        title="删除（无确认）"
        onClick={api.removeNode}
        style={{ ...btn, color: "var(--tc-destructive)" }}
      >
        <Trash2 width={17} height={17} />
      </button>
    </div>
  );
}

/**
 * 卡片底部生成栏（截图批注 1/3/5）：通栏「生成视频」主按钮 + 右侧 chevron。
 * chevron 弹出上拉菜单：直接生成视频 / 先预览分镜图 / 分镜图设置…。
 */
export function CardGenerateBar() {
  const api = useProto();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as globalThis.Node))
        setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const items = [
    {
      icon: <Film width={14} height={14} />,
      label: "直接生成视频",
      run: api.openVideoPanel,
    },
    {
      icon: <Images width={14} height={14} />,
      label: "先预览分镜图",
      run: api.previewStoryboard,
    },
    {
      icon: <SlidersHorizontal width={14} height={14} />,
      label: "分镜图设置…",
      run: api.openStoryboardSettings,
    },
  ];

  return (
    <div ref={wrapRef} className="nodrag relative flex gap-1.5">
      <button
        type="button"
        onClick={api.openVideoPanel}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] transition-colors hover:bg-[var(--tc-menu-item-hover)]"
        style={{
          background: "var(--tc-bg-elevated)",
          border: "1px solid var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
        }}
      >
        <Clapperboard width={14} height={14} />
        生成视频
      </button>
      <button
        type="button"
        aria-label="更多生成方式"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--tc-menu-item-hover)]"
        style={{
          width: 34,
          background: "var(--tc-bg-elevated)",
          border: "1px solid var(--tc-border-subtle)",
          color: open ? "var(--tc-text-primary)" : "var(--tc-text-tertiary)",
        }}
      >
        <ChevronDown
          width={14}
          height={14}
          style={{
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 120ms",
          }}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 bottom-full mb-1.5 flex w-[180px] flex-col overflow-hidden rounded-xl py-1"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setOpen(false);
                it.run();
              }}
              className="flex items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--tc-menu-item-hover)]"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--tc-text-secondary)",
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

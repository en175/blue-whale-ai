"use client";

/**
 * SceneCardNode —— 画布内场景卡节点（spec §3.1 视觉 / §6.2 数据契约）。
 * 卡片 400px 宽、全文自然展开；内容不存画布 JSON，由 data.sceneCardId → 快照投影
 * （projectSnapshotToSceneCards，经 NodeActionsContext.sceneCards 注入）查得。
 * 选中态：2px 描边 + 卡片上方居中「删除」按钮（无确认；Backspace/Delete 由 CanvasSurface
 * deleteKeyCode 覆盖）。查不到 SceneCard 时按 spec §5.6 显示「场景卡不可用」占位，仍可删除。
 *
 * TODO(spec §2.4)：双击就地富文本编辑（锁高、内部滚动、Esc 取消、⌘↵/失焦保存，
 * 保存走 PUT content_markdown + If-Match ETag）。本期服务端尚无 SceneCard 内容更新
 * API 路由（app/api 下 scene-cards 仅有 generate / generation-preset / storyboard-preview），
 * 故卡片只读，不绑定双击编辑；路由就绪后在此补接。
 */
import { useContext, useEffect, useRef, useState } from "react";
import { NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import {
  ChevronDown,
  Clapperboard,
  Film,
  Images,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { SCENE_CARD_WIDTH } from "@blue-whale/core/placement";

import type { CanvasNodeData } from "../model";
import { NodeActionsContext, NodeHandles } from "./node-shared";
import { SceneCardMarkdownBody } from "./scene-card-markdown";

/** 底部生成栏（spec §3.1）：通栏「生成视频」主按钮 + 右侧 34px chevron 上拉菜单。
 *  纯视觉占位：菜单可展开，三项点击均无动作（生成面板属后续工单）。 */
function SceneCardGenerateBar() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as globalThis.Node))
        setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const items = [
    { icon: <Film width={14} height={14} />, label: "直接生成视频" },
    { icon: <Images width={14} height={14} />, label: "先预览分镜图" },
    {
      icon: <SlidersHorizontal width={14} height={14} />,
      label: "分镜图设置…",
    },
  ];

  return (
    <div ref={wrapRef} className="nodrag relative flex gap-1.5">
      <button
        type="button"
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
        onClick={() => setOpen((value) => !value)}
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
          role="menu"
          className="absolute bottom-full right-0 mb-1.5 flex w-[180px] flex-col overflow-hidden rounded-xl py-1"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--tc-menu-item-hover)]"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--tc-text-secondary)",
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SceneCardNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as CanvasNodeData;
  const { onRemoveNode, sceneCards } = useContext(NodeActionsContext);
  const card = sceneCards?.find(
    (candidate) => String(candidate.scene_card_id) === d.sceneCardId,
  );

  return (
    <>
      {/* 选中态头部操作：卡片上方居中「删除」（40×40、圆角 10，无确认；spec §2.5）。
          已决策本期隐藏「@ 引用」按钮（spec §2.3 入口属后续工单）。 */}
      <NodeToolbar position={Position.Top} offset={8} isVisible={selected}>
        <button
          type="button"
          aria-label="删除场景卡"
          title="删除场景卡"
          className="nodrag flex items-center justify-center"
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
            color: "var(--tc-destructive)",
            cursor: "pointer",
          }}
          onClick={() => onRemoveNode?.(id)}
        >
          <Trash2 width={17} height={17} />
        </button>
      </NodeToolbar>
      <div
        className="tc-scene-card-node relative flex flex-col rounded-xl"
        style={{
          width: SCENE_CARD_WIDTH,
          background: "var(--tc-bg-surface)",
          border: "1px solid var(--tc-border-subtle)",
          outline: selected
            ? "2px solid var(--tc-card-selected-stroke)"
            : "2px solid transparent",
          outlineOffset: 0,
        }}
      >
        <NodeHandles kind="scene_card" />
        <div className="p-4">
          {card ? (
            <SceneCardMarkdownBody markdown={card.content_markdown} />
          ) : (
            /* spec §5.6：重复/失效/越权 SceneCardNode 统一显示「场景卡不可用」，允许移除 */
            <div className="flex flex-col items-center gap-1 py-6">
              <span
                className="text-[13px]"
                style={{ color: "var(--tc-text-secondary)" }}
              >
                场景卡不可用
              </span>
              <span
                className="text-[11px]"
                style={{ color: "var(--tc-text-muted)" }}
              >
                场景卡已删除或不可访问，可移除此节点
              </span>
            </div>
          )}
        </div>
        {card && (
          <div
            className="p-3"
            style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
          >
            <SceneCardGenerateBar />
          </div>
        )}
      </div>
    </>
  );
}

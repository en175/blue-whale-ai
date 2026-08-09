"use client";

/**
 * SceneCardNode —— 画布内场景卡节点（spec §3.1 视觉 / §6.2 数据契约）。
 * 卡片 400px 宽、全文自然展开；内容不存画布 JSON，由 data.sceneCardId → 快照投影
 * （projectSnapshotToSceneCards，经 NodeActionsContext.sceneCards 注入）查得。
 * 选中态：2px 描边 + 卡片上方居中「删除」按钮（无确认）；按钮和 Backspace/Delete
 * 都走 SceneCard 条件删除，再保存 Canvas。查不到 SceneCard 时显示「场景卡不可用」，可移除节点。
 *
 * TODO(spec §2.4)：双击就地富文本编辑（锁高、内部滚动、Esc 取消、⌘↵/失焦保存，
 * 保存走 PUT content_markdown + If-Match ETag）。本期服务端尚无 SceneCard 内容更新
 * API（当前资源路由只有 GET/DELETE），故卡片只读，不绑定双击编辑；PUT 就绪后在此补接。
 */
import { useContext } from "react";
import { NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { SCENE_CARD_WIDTH } from "@blue-whale/core/placement";

import type { CanvasNodeData } from "../model";
import { NodeActionsContext, NodeHandles } from "./node-shared";
import { SceneCardMarkdownBody } from "./scene-card-markdown";

export function SceneCardNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as CanvasNodeData;
  const { onDeleteSceneCard, onRemoveNode, sceneCards } =
    useContext(NodeActionsContext);
  const card = d.unavailableReason
    ? undefined
    : sceneCards?.find(
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
          onClick={() => {
            if (card && d.sceneCardId && onDeleteSceneCard) {
              void onDeleteSceneCard(id, d.sceneCardId);
              return;
            }
            onRemoveNode?.(id);
          }}
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
      </div>
    </>
  );
}

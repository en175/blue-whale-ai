"use client";

import { useState } from "react";
import type { ProjectSnapshot } from "@/lib/project-recovery";
import { projectSnapshotToSceneCards } from "../_canvas/conversationRecovery";
import { SceneCardGenerationEditor } from "./components/SceneCardGenerationEditor";

/** SceneCard 列表面板 + 生成编辑器入口（IK67HB/T13）。
 *  snapshot 来自父组件 useProjectConversation；按 scene_card_id 渲染卡片，点"生成"打开编辑器。 */
export function SceneCardPanel({
  projectId,
  snapshot,
}: {
  projectId: string;
  snapshot: ProjectSnapshot | null;
}) {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const cards = snapshot ? projectSnapshotToSceneCards(snapshot) : [];

  return (
    <section className="flex flex-col gap-2">
      <header
        className="text-[12px] font-medium"
        style={{ color: "var(--tc-text-muted)" }}
      >
        场景卡
      </header>
      {cards.length === 0 && (
        <span className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
          暂无场景卡
        </span>
      )}
      {cards.map((card) => (
        <div
          key={String(card.scene_card_id)}
          className="flex items-center justify-between rounded p-2"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
          }}
        >
          <span
            className="truncate text-[12px]"
            style={{ color: "var(--tc-text-primary)" }}
          >
            {card.title}
          </span>
          <button
            type="button"
            onClick={() => setActiveCardId(String(card.scene_card_id))}
            className="shrink-0 rounded px-2 py-1 text-[11px]"
            style={{
              background: "var(--tc-accent)",
              color: "var(--tc-text-primary)",
            }}
          >
            生成
          </button>
        </div>
      ))}
      {activeCardId && (
        <div
          className="mt-2 rounded"
          style={{
            background: "var(--tc-bg-surface)",
            border: "1px solid var(--tc-border-subtle)",
          }}
        >
          <SceneCardGenerationEditor
            projectId={projectId}
            sceneCardId={activeCardId}
            onClose={() => setActiveCardId(null)}
          />
        </div>
      )}
    </section>
  );
}

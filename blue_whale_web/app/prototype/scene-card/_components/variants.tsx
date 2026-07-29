// PROTOTYPE (IK4Q4E) — 场景卡节点（定稿）。
// 形态（截图批注确认）：卡片始终全文自然展开；选中不改变高度/形态，
// 只加选中描边 + 头部 @ 引用与删除按钮；底部「生成视频」+ 下拉；双击就地编辑。
"use client";

import { useEffect, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import {
  CardGenerateBar,
  HeadActions,
  selectedOutline,
  useProto,
} from "./shared";
import { SceneRichEditor } from "./editor";
import { MarkdownBody } from "./markdown";

const WIDTH = 400;

export function SceneCardNode({ selected }: NodeProps) {
  const api = useProto();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [viewHeight, setViewHeight] = useState<number>();

  // 记录渲染态内容高度：进入编辑后锁死同高，超出滚动（批注）
  useEffect(() => {
    if (!api.editing && bodyRef.current) {
      setViewHeight(bodyRef.current.offsetHeight);
    }
  }, [api.editing, api.content]);

  return (
    <div
      className="relative flex flex-col rounded-xl"
      style={{
        width: WIDTH,
        background: "var(--tc-bg-surface)",
        border: "1px solid var(--tc-border-subtle)",
        ...selectedOutline(selected),
      }}
    >
      {selected && <HeadActions />}
      <div className="p-4">
        {api.editing ? (
          <SceneRichEditor height={viewHeight} />
        ) : (
          <div ref={bodyRef}>
            <MarkdownBody markdown={api.content} />
          </div>
        )}
      </div>
      <div
        className="p-3"
        style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
      >
        <CardGenerateBar />
      </div>
    </div>
  );
}

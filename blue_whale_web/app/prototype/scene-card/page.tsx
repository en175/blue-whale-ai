// PROTOTYPE (IK4Q4E 场景卡画布交互与视觉原型) — 一次性评审路由，评审后删除。
// 视觉与交互按需求方截图批注定稿（单变体）：
// 卡片始终全文自然展开；选中不改变形态，只加描边 + 头部 @ 引用与删除（无确认）按钮；
// 双击就地编辑 Markdown；底部「生成视频」+ 下拉（直接生成视频 / 先预览分镜图 / 分镜图设置）；
// 生成面板/设置弹窗点击外部空白收起；产物为独立节点，落在卡片下方。
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Play, Loader2, Image as ImageIcon } from "lucide-react";

import { ProtoCtx, selectedOutline, type ProtoApi } from "./_components/shared";
import { SceneCardNode } from "./_components/variants";
import { SAMPLE_MARKDOWN, cardDisplayName } from "./_components/mock";
import {
  ChatComposerMock,
  type MentionChip,
} from "./_components/ChatComposerMock";
import {
  VideoGenPanelMock,
  StoryboardSettingsMock,
} from "./_components/panels";

const SCENE_NODE_ID = "scene-card:sc-1";
const CARD_X = 120;
const CARD_Y = 100;

/** 产物节点：生成的视频（独立节点，批注 1-②）。带播放键 + 时长；生成中转圈。 */
function MockVideoNode({ data, selected }: NodeProps) {
  const d = data as { status: "generating" | "done"; duration: string };
  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        width: 400,
        height: 225,
        backgroundImage:
          "linear-gradient(135deg, var(--tc-bg-elevated) 0%, var(--tc-bg-surface) 50%, var(--tc-bg-elevated) 100%)",
        ...selectedOutline(selected),
      }}
    >
      <div className="flex h-full w-full items-center justify-center">
        {d.status === "generating" ? (
          <div
            className="flex items-center gap-2 text-[12px]"
            style={{ color: "var(--tc-text-muted)" }}
          >
            <Loader2 width={16} height={16} className="animate-spin" />
            生成中…
          </div>
        ) : (
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: "var(--tc-bg-overlay)" }}
          >
            <Play
              width={18}
              height={18}
              fill="var(--tc-text-primary)"
              stroke="var(--tc-text-primary)"
            />
          </div>
        )}
      </div>
      {d.status === "done" && (
        <span
          className="absolute bottom-2 left-2 text-[13px] font-medium"
          style={{ color: "var(--tc-text-primary)" }}
        >
          {d.duration}
        </span>
      )}
      <div
        className="nodrag absolute -top-6 left-0 text-xs select-none"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        生成产物 · 视频
      </div>
    </div>
  );
}

/** 产物节点：分镜图（独立节点）。 */
function MockStoryboardNode({ data, selected }: NodeProps) {
  const d = data as { label: string };
  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        width: 200,
        height: 112,
        backgroundImage:
          "linear-gradient(135deg, var(--tc-bg-elevated) 0%, var(--tc-bg-surface) 50%, var(--tc-bg-elevated) 100%)",
        ...selectedOutline(selected),
      }}
    >
      <div
        className="flex h-full w-full items-center justify-center"
        style={{ color: "var(--tc-text-muted)" }}
      >
        <ImageIcon width={22} height={22} strokeWidth={1.2} />
      </div>
      <div
        className="nodrag absolute -top-6 left-0 text-xs select-none"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        {d.label}
      </div>
    </div>
  );
}

const nodeTypes = {
  sceneCard: SceneCardNode,
  mockVideo: MockVideoNode,
  mockStoryboard: MockStoryboardNode,
};

const INITIAL_NODES: Node[] = [
  {
    id: SCENE_NODE_ID,
    type: "sceneCard",
    position: { x: CARD_X, y: CARD_Y },
    data: {},
  },
  // 批注 1-②：生成后的素材是独立节点，位于卡片下方
  {
    id: "seed-video",
    type: "mockVideo",
    position: { x: CARD_X, y: CARD_Y + 1080 },
    data: { status: "done", duration: "00:15" },
  },
];

function PrototypeApp() {
  const [content, setContent] = useState(SAMPLE_MARKDOWN);
  const [editing, setEditing] = useState(false);
  const [nodes, setNodes] = useState<Node[]>(INITIAL_NODES);
  const [chips, setChips] = useState<MentionChip[]>([]);
  const [videoPanelOpen, setVideoPanelOpen] = useState(false);
  const [storySettingsOpen, setStorySettingsOpen] = useState(false);
  const chipNonce = useRef(0);
  const genNonce = useRef(0);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  // 预置的视频节点：卡片渲染出实测高度后，挪到卡片下方 10px 处（仅调一次）
  const seedAdjusted = useRef(false);
  useEffect(() => {
    if (seedAdjusted.current) return;
    setNodes((ns) => {
      const card = ns.find((n) => n.id === SCENE_NODE_ID);
      const h = card?.measured?.height;
      if (!card || !h || !ns.some((n) => n.id === "seed-video")) return ns;
      seedAdjusted.current = true;
      return ns.map((n) =>
        n.id === "seed-video"
          ? {
              ...n,
              position: { x: card.position.x, y: card.position.y + h + 10 },
            }
          : n,
      );
    });
  }, [nodes]);

  /** 新产物节点放在场景卡下方 10px 间距处（按卡片实测高度，批注：不要黏在一起）。 */
  const placeBelowCard = useCallback(
    (make: (id: string, x: number, y: number) => Node) => {
      genNonce.current += 1;
      const id = `gen-${genNonce.current}`;
      setNodes((ns) => {
        const card = ns.find((n) => n.id === SCENE_NODE_ID);
        const siblings = ns.filter((n) => n.id.startsWith("gen-")).length;
        const cardH = card?.measured?.height ?? 1080;
        const x = card?.position.x ?? CARD_X;
        const y = (card?.position.y ?? CARD_Y) + cardH + 10 + siblings * 235;
        return [...ns, make(id, x, y)];
      });
      return id;
    },
    [],
  );

  const generateVideo = useCallback(() => {
    setVideoPanelOpen(false);
    const id = placeBelowCard((nid, x, y) => ({
      id: nid,
      type: "mockVideo",
      position: { x, y },
      data: { status: "generating", duration: "00:15" },
    }));
    window.setTimeout(() => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, status: "done" } } : n,
        ),
      );
    }, 1800);
  }, [placeBelowCard]);

  const generateStoryboards = useCallback(() => {
    setStorySettingsOpen(false);
    for (let i = 0; i < 3; i++) {
      placeBelowCard((nid, x, y) => ({
        id: nid,
        type: "mockStoryboard",
        position: { x: x + i * 220, y },
        data: { label: `分镜图 ${i + 1}` },
      }));
    }
  }, [placeBelowCard]);

  const api: ProtoApi = useMemo(
    () => ({
      content,
      editing,
      startEdit: () => setEditing(true),
      commitEdit: (md: string) => {
        setContent(md);
        setEditing(false);
      },
      cancelEdit: () => setEditing(false),
      atReference: () => {
        chipNonce.current += 1;
        setChips((cs) => [
          ...cs,
          {
            id: `chip-${chipNonce.current}`,
            label: cardDisplayName(content),
          },
        ]);
      },
      removeNode: () =>
        setNodes((ns) => ns.filter((n) => n.id !== SCENE_NODE_ID)),
      openVideoPanel: () => setVideoPanelOpen(true),
      previewStoryboard: generateStoryboards,
      openStoryboardSettings: () => setStorySettingsOpen(true),
    }),
    [content, editing, generateStoryboards],
  );

  return (
    <ProtoCtx.Provider value={api}>
      <div
        className="h-screen w-screen"
        style={{ background: "var(--tc-bg-canvas)" }}
      >
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDoubleClick={(_, node) => {
            if (node.id === SCENE_NODE_ID) setEditing(true);
          }}
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="var(--tc-canvas-dot)" />
        </ReactFlow>
        <ChatComposerMock
          chips={chips}
          onRemoveChip={(id) => setChips((cs) => cs.filter((c) => c.id !== id))}
        />
        {videoPanelOpen && (
          <VideoGenPanelMock
            content={content}
            onClose={() => setVideoPanelOpen(false)}
            onSubmit={generateVideo}
          />
        )}
        {storySettingsOpen && (
          <StoryboardSettingsMock
            onClose={() => setStorySettingsOpen(false)}
            onGenerate={generateStoryboards}
          />
        )}
      </div>
    </ProtoCtx.Provider>
  );
}

export default function SceneCardPrototypePage() {
  return (
    <ReactFlowProvider>
      <PrototypeApp />
    </ReactFlowProvider>
  );
}

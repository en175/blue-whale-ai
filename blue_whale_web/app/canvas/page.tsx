"use client";

/**
 * Canvas Page —— 画布路由页面（编排层 / 状态管理）
 * 仅承载页面级状态与交互编排：视口变换、节点增删、Dock 开关、Agent 面板联动等。
 * 所有 UI 子模块（顶栏、工具条、画布节点、Dock、Agent 面板、缩放控件）经统一出口 ./_canvas 引入。
 *
 * Project 聚合根：useReducer(projectReducer) 管理多项目的画布+对话，active 项目派生
 * nodes/viewport/messages。切换项目 = 更换画布节点集合 + 对话历史（CONTEXT.md L44–50）。
 */
import { Suspense, useState, useRef, useEffect, useCallback, useReducer } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  TopBar,
  TopBarCenter,
  TopBarRight,
  LeftToolbar,
  CanvasSurface,
  BottomDock,
  AgentChatPanel,
  ZoomControls,
} from "./_canvas";
import type { Viewport, NodeItem, NodeType, DockMediaItem, CardMessage, ChatMessage } from "./_canvas";
import { nodeFromCard, projectReducer, initialProjectState } from "./_canvas";
import { PROJECTS } from "./_canvas";

function CanvasPageInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  // Project 聚合根：多项目画布+对话的单一真相源
  const [projectState, dispatch] = useReducer(projectReducer, PROJECTS, initialProjectState);
  const activeProject =
    projectState.projects.find((p) => p.id === projectState.activeProjectId) ?? projectState.projects[0];
  // 派生：当前项目的画布与对话（读取走 active，写入走 dispatch）
  const { nodes, viewport } = activeProject.canvas;
  const messages = activeProject.messages;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAgentOpen, setIsAgentOpen] = useState(true);
  const [isBottomDockOpen, setIsBottomDockOpen] = useState(false);
  const [bottomDockMode, setBottomDockMode] = useState<"image" | "video">("image");
  const [imageDockMedia, setImageDockMedia] = useState<DockMediaItem[]>([]);
  const [videoDockMedia, setVideoDockMedia] = useState<DockMediaItem[]>([]);
  const [agentPendingMention, setAgentPendingMention] = useState<{ name: string; nonce: number } | null>(null);
  // 「从画布选择」模式：非 null 表示正在为哪个 Dock 挑图（image/video）
  const [pickingFor, setPickingFor] = useState<"image" | "video" | null>(null);

  // CanvasSurface 期望 Dispatch<SetStateAction<...>> 类型的 setter（高频拖拽/缩放内部用）。
  // 适配为对当前 active project 的 dispatch：解析值或 updater 后整体写回画布。
  const setViewport = useCallback(
    (next: Viewport | ((prev: Viewport) => Viewport)) => {
      const resolved =
        typeof next === "function" ? (next as (prev: Viewport) => Viewport)(activeProject.canvas.viewport) : next;
      dispatch({ type: "set-viewport", projectId: activeProject.id, viewport: resolved });
    },
    [activeProject.id, activeProject.canvas.viewport]
  );
  const setNodes = useCallback(
    (next: NodeItem[] | ((prev: NodeItem[]) => NodeItem[])) => {
      const resolved =
        typeof next === "function" ? (next as (prev: NodeItem[]) => NodeItem[])(activeProject.canvas.nodes) : next;
      dispatch({ type: "set-nodes", projectId: activeProject.id, nodes: resolved });
    },
    [activeProject.id, activeProject.canvas.nodes]
  );

  // 画布素材节点操作面板的统一动作分发
  const handleNodeAction = useCallback(
    (node: NodeItem, actionId: string) => {
      const name = node.content || "未命名素材";
      switch (actionId) {
        case "refresh": {
          // 重新编辑：唤起底部图片 Dock（不带素材）
          setBottomDockMode("image");
          setIsBottomDockOpen(true);
          break;
        }
        case "shuffle": {
          // 再创作：带入参考图占位 + 唤起图片 Dock
          if (node.imageUrl) {
            setImageDockMedia([{ id: node.id, type: "image", name, src: node.imageUrl }]);
          }
          setBottomDockMode("image");
          setIsBottomDockOpen(true);
          break;
        }
        case "mention": {
          // 添加到对话：打开右侧面板并 @ 素材名
          setIsAgentOpen(true);
          setAgentPendingMention({ name, nonce: Date.now() });
          break;
        }
        case "video": {
          // 生成视频：带入参考图占位 + 唤起视频 Dock
          if (node.imageUrl) {
            setVideoDockMedia([{ id: node.id, type: "image", name, src: node.imageUrl }]);
          }
          setBottomDockMode("video");
          setIsBottomDockOpen(true);
          break;
        }
        case "info": {
          // 详情信息：暂忽略，后续补充
          break;
        }
        case "download": {
          // 下载：仅图片素材
          if (node.imageUrl) {
            const a = document.createElement("a");
            a.href = node.imageUrl;
            a.download = name || "image";
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          break;
        }
        default:
          break;
      }
    },
    []
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pickingFor) {
        setPickingFor(null);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (!selectedId) return;
      e.preventDefault();
      setNodes((prev) => prev.filter((n) => n.id !== selectedId));
      setSelectedId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, pickingFor]);

  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setViewport({ x: cx, y: cy, scale: 1 });
  }, []);

  const addNode = useCallback(
    (type: NodeType, extra?: Partial<NodeItem>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      const worldX = (cx - viewport.x) / viewport.scale;
      const worldY = (cy - viewport.y) / viewport.scale;
      const id = `${type}-${Date.now()}`;
      const base: NodeItem =
        type === "text"
          ? {
              id,
              type,
              x: worldX - 100,
              y: worldY - 24,
              width: 200,
              height: 48,
              content: "文本节点",
            }
          : {
              id,
              type,
              x: worldX - 120,
              y: worldY - 120,
              width: 240,
              height: 240,
              content: "占位图片节点",
            };
      const node: NodeItem = { ...base, ...extra, id: base.id };
      // 写入走 reducer：节点归属当前 active project（位置在此算好作为 x/y 传入）
      dispatch({ type: "add-node", projectId: activeProject.id, node });
      setSelectedId(id);
      return id;
    },
    [viewport, activeProject.id]
  );

  // 对话流出现 card 的同一时刻，在画布同步创建对应图片 NodeItem（同一生成结果两种视图）。
  // 仅透 content/width/height；x/y/id 留给 addNode（addNode 内部强制 id=image-${Date.now()}）。
  const handleCardGenerated = useCallback(
    (card: CardMessage) => {
      const partial = nodeFromCard(card, () => 0);
      addNode("image", { content: partial.content, width: partial.width, height: partial.height });
    },
    [addNode]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string | undefined;
        if (url) {
          addNode("image", {
            content: file.name,
            imageUrl: url,
          });
        }
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [addNode]
  );

  // Dock「本地上传」：既建画布节点，又把同一资产塞进对应 Dock 的参考 media（共享 id/src）
  const handleDockLocalUpload = useCallback(
    (file: File, mode: "image" | "video") => {
      const url = URL.createObjectURL(file);
      const id = addNode("image", { content: file.name, imageUrl: url });
      const item: DockMediaItem = { id, type: "image", name: file.name, src: url };
      if (mode === "image") {
        setImageDockMedia((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, item]));
      } else {
        setVideoDockMedia((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, item]));
      }
    },
    [addNode]
  );

  // 进入/退出「从画布选择」模式
  const handleRequestPick = useCallback((mode: "image" | "video") => {
    setPickingFor(mode);
  }, []);
  const handleExitPick = useCallback(() => setPickingFor(null), []);

  // 选择模式下点中合格图片节点 → 单选即带回对应 Dock media，并退出模式
  const handlePickNode = useCallback(
    (node: NodeItem) => {
      if (!node.imageUrl) {
        setPickingFor(null);
        return;
      }
      const item: DockMediaItem = {
        id: node.id,
        type: "image",
        name: node.content || "图片",
        src: node.imageUrl,
      };
      if (pickingFor === "image") {
        setImageDockMedia((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item]));
      } else if (pickingFor === "video") {
        setVideoDockMedia((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item]));
      }
      setPickingFor(null);
    },
    [pickingFor]
  );

  // 可选图片节点数（带 imageUrl），用于胶囊空态提示
  const pickableCount = nodes.filter((n) => n.type === "image" && n.imageUrl).length;

  const handleToolClick = useCallback(
    (id: string) => {
      if (id === "upload") {
        handleUploadClick();
      } else if (id === "ai-image") {
        setBottomDockMode("image");
        setIsBottomDockOpen((open) => {
          if (bottomDockMode === "image" && open) {
            return false;
          }
          return true;
        });
      } else if (id === "ai-video") {
        setBottomDockMode("video");
        setIsBottomDockOpen((open) => {
          if (bottomDockMode === "video" && open) {
            return false;
          }
          return true;
        });
      } else if (id === "text") {
        addNode("text");
      }
    },
    [addNode, bottomDockMode, handleUploadClick]
  );

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden="true"
      />
      <TopBar
        activeProject={activeProject}
        projects={projectState.projects}
        onSwitch={(id) => dispatch({ type: "switch", projectId: id })}
        onCreate={() => dispatch({ type: "create", name: `项目 ${Date.now().toString().slice(-4)}`, idGen: () => `p-${Date.now()}` })}
        onDelete={(id) => dispatch({ type: "delete", projectId: id })}
      />
      <TopBarCenter />
      <TopBarRight
        isAgentOpen={isAgentOpen}
        onAgentToggle={() => setIsAgentOpen((v) => !v)}
      />

      <CanvasSurface
        containerRef={containerRef}
        viewport={viewport}
        nodes={nodes}
        selectedId={selectedId}
        setViewport={setViewport}
        setNodes={setNodes}
        setSelectedId={setSelectedId}
        onNodeAction={handleNodeAction}
        picking={pickingFor !== null}
        onPickNode={handlePickNode}
        onExitPick={handleExitPick}
      />

      <LeftToolbar onToolClick={handleToolClick} />
      {pickingFor && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2147483603,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px 6px 14px",
            borderRadius: 9999,
            background: "rgba(26, 26, 26, 0.92)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(12px)",
            color: "rgba(255, 255, 255, 0.85)",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--tc-accent, #3b82f6)", fontWeight: 600 }}>从画布选择</span>
          <span style={{ color: "rgba(255, 255, 255, 0.55)" }}>
            {pickableCount === 0 ? "画布上还没有可用的图片" : "点击画布中的图片加入"}
          </span>
          <span style={{ color: "rgba(255, 255, 255, 0.22)" }}>·</span>
          <button
            type="button"
            onClick={handleExitPick}
            style={{
              padding: "2px 10px",
              borderRadius: 9999,
              border: 0,
              background: "rgba(255, 255, 255, 0.08)",
              color: "rgba(255, 255, 255, 0.8)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            取消 · Esc
          </button>
        </div>
      )}
      {isBottomDockOpen && (
        <BottomDock
          mode={bottomDockMode}
          onClose={() => setIsBottomDockOpen(false)}
          imageMedia={imageDockMedia}
          videoMedia={videoDockMedia}
          onRemoveImageMedia={(id) => setImageDockMedia((prev) => prev.filter((m) => m.id !== id))}
          onRemoveVideoMedia={(id) => setVideoDockMedia((prev) => prev.filter((m) => m.id !== id))}
          onLocalUpload={(file) => handleDockLocalUpload(file, bottomDockMode)}
          onPickFromCanvas={() => handleRequestPick(bottomDockMode)}
          onExitPick={handleExitPick}
          isPicking={pickingFor === bottomDockMode}
        />
      )}
      <AgentChatPanel
        key={activeProject.id}
        messages={messages}
        isOpen={isAgentOpen}
        onClose={() => setIsAgentOpen(false)}
        pendingMention={agentPendingMention}
        onMentionConsumed={() => setAgentPendingMention(null)}
        onCardGenerated={handleCardGenerated}
        onAppendMessages={(msgs: ChatMessage[]) =>
          dispatch({ type: "append-messages", projectId: activeProject.id, messages: msgs })
        }
        onSetCardStatus={(cardId, status) =>
          dispatch({ type: "set-card-status", projectId: activeProject.id, cardId, status })
        }
      />
      <ZoomControls
        containerRef={containerRef}
        viewport={viewport}
        setViewport={setViewport}
      />

      <Link
        href="/"
        className="absolute bottom-4 left-4 z-[400] inline-flex h-8 items-center gap-1.5 rounded-full bg-[#141414]/90 px-3 text-xs font-medium text-white/70 border border-white/[0.04] backdrop-blur-md transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <ArrowLeft width={14} height={14} />
        返回首页
      </Link>
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-black text-white/60 text-sm">
          加载画布…
        </div>
      }
    >
      <CanvasPageInner />
    </Suspense>
  );
}

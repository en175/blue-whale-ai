"use client";

/**
 * Canvas Page —— 画布路由页面（编排层 / 状态管理）
 * 仅承载页面级状态与交互编排：节点增删、Dock 开关、Agent 面板联动、生成流程等。
 * 画布的视口平移/缩放/拖拽/选中/resize 由 React Flow（CanvasSurface）受控承接，
 * nodes 与 viewport 仍以 projectReducer 为单一真相源（多 project 切换 + 持久化基础）。
 *
 * Project 聚合根：useReducer(projectReducer) 管理多项目的画布+对话，active 项目派生
 * nodes/viewport/messages。切换项目 = 更换画布节点集合 + 对话历史（CONTEXT.md L44–50）。
 */
import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ReactFlowProvider } from "@xyflow/react";
import { useAuth } from "@/components/auth/AuthContext";
import { toast } from "@/components/Toast";
import { loadUser, SKIP_AUTH } from "@/components/auth/authStorage";
import { newCommandIdentity } from "@/lib/command-identity";
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
import type {
  Viewport,
  NodeItem,
  NodeType,
  DockMediaItem,
  CardMessage,
  ChatMessage,
} from "./_canvas";
import { nodeFromCard, useCanvasProjects } from "./_canvas";
import type { GenerateArgs } from "./_canvas";
import {
  cancelProjectGenerationJob,
  createProjectGenerationJob,
  retryMissingProjectGenerationJobOutputs,
} from "./_canvas/api/generation";
import {
  setProjectSubmitting,
  type ProjectSubmissionState,
} from "./_canvas/projectGenerationState";
import { isApiError } from "@/lib/api/errors";

/** 把后端/网络错误映射为用户友好提示，避免暴露内部配置。 */
function userFriendlyErrorMessage(e: unknown): string {
  // ApiError：诊断事实（code + request_id）只进日志，不回传用户（IK2BCH）。
  if (isApiError(e)) {
    console.error(
      "[generate] ApiError code=%s requestId=%s msg=%s",
      e.code,
      e.requestId ?? "-",
      e.message,
    );
  }
  if (!(e instanceof Error)) return "生成失败，请稍后重试";
  const msg = e.message;
  if (msg.includes("后端未启动") || msg.includes("无法连接")) {
    return "无法连接到服务，请检查网络或稍后重试";
  }
  if (msg.includes("参考素材尚未成为可用 Asset")) {
    return "参考素材尚未上传完成，请先使用已有资产";
  }
  if (msg.includes("当前闭环仅支持单图生成")) {
    return "当前仅支持每次生成 1 张图片";
  }
  if (msg.includes("当前闭环仅支持单视频生成")) {
    return "当前仅支持每次生成 1 个视频";
  }
  if (msg.includes("ARK_API_KEY") || msg.includes("数据库")) {
    return "服务暂时不可用，请稍后重试";
  }
  return "生成失败，请稍后重试";
}

function expectedOutputCount(quantity: string): number {
  const count = Number(quantity.replace(/x$/i, ""));
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new Error("输出数量无效");
  }
  return count;
}

function CanvasPageInner() {
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt") || "";
  const { openLogin } = useAuth();
  const guardRouter = useRouter();
  // 画布视口容器：addNode 据其中心换算 world 坐标（viewport 为受控 {x,y,zoom}）。
  const containerRef = useRef<HTMLDivElement>(null);
  const retryIdempotencyKeysRef = useRef<Record<string, string>>({});

  // gating：未登录直访 /canvas 时，先空白守卫再决定渲染或跳转，避免画布内容首帧闪烁。
  // TODO: 接真实数据后改为路由守卫（middleware 或 server component 检查登录态）。
  const [gated, setGated] = useState(true);
  useEffect(() => {
    const storedUser = loadUser();
    // 本地开发跳过鉴权（SKIP_AUTH）时，不做未登录跳转
    if (!SKIP_AUTH && !storedUser) {
      console.warn(
        "[Canvas] gate: loadUser()=null → 踢回首页 + 弹登录。localStorage keys:",
        Object.keys(localStorage).filter((k) => k.startsWith("bw-")),
      );
      guardRouter.replace("/");
      openLogin();
    } else {
      console.log(
        "[Canvas] gate: loadUser() 成功，user:",
        storedUser?.username,
      );
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project 聚合根：多项目画布+对话的单一真相源（hook 缝合后端持久化，见 useCanvasProjects）
  // ?project=<id>：URL 指定初始活动项目（生成页「打开项目」闭环），无效则忽略回退默认。
  const {
    state: projectState,
    dispatch,
    activeProject,
    saveStatus,
    booting,
    backendReady,
    generationJobs,
    createProjectAction,
    switchProject,
    deleteProjectAction,
    submitConversationMessageAction,
  } = useCanvasProjects(searchParams.get("project"));
  // 派生：当前项目的画布与对话（读取走 active，写入走 dispatch）
  const { nodes, viewport } = activeProject.canvas;
  const messages = activeProject.messages;

  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [isBottomDockOpen, setIsBottomDockOpen] = useState(false);
  const [bottomDockMode, setBottomDockMode] = useState<"image" | "video">(
    "image",
  );
  const [imageDockMedia, setImageDockMedia] = useState<DockMediaItem[]>([]);
  const [videoDockMedia, setVideoDockMedia] = useState<DockMediaItem[]>([]);
  const [agentPendingMention, setAgentPendingMention] = useState<{
    name: string;
    nonce: number;
  } | null>(null);
  // 「从画布选择」模式：非 null 表示正在为哪个 Dock 挑图（image/video）
  const [pickingFor, setPickingFor] = useState<"image" | "video" | null>(null);
  const [submittingByProject, setSubmittingByProject] =
    useState<ProjectSubmissionState>({});
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [activeVideoJobIdByProject, setActiveVideoJobIdByProject] = useState<
    Record<string, number>
  >({});
  const [cancellingVideo, setCancellingVideo] = useState(false);
  const generating = Boolean(submittingByProject[activeProject.id]);
  const activeVideoJobId = activeVideoJobIdByProject[activeProject.id];

  const videoJobs = generationJobs.filter(
    (job) => job.source === "bottom_dock" && job.type === "video",
  );
  const activeVideoJob = videoJobs.find(
    (job) => Number(job.job_id) === activeVideoJobId,
  );
  const currentVideoJob =
    activeVideoJob ??
    (generating || activeVideoJobId
      ? undefined
      : [...videoJobs].sort(
          (left, right) => Number(right.job_id) - Number(left.job_id),
        )[0]);
  const currentVideoJobId = Number(currentVideoJob?.job_id);
  const currentVideoStatus =
    typeof currentVideoJob?.status === "string" ? currentVideoJob.status : null;
  const videoJobActive =
    (activeVideoJobId !== undefined && !activeVideoJob) ||
    currentVideoStatus === "queued" ||
    currentVideoStatus === "processing" ||
    currentVideoStatus === "cancel_requested";
  const currentVideoError =
    currentVideoJob?.error && typeof currentVideoJob.error === "object"
      ? (currentVideoJob.error as Record<string, unknown>)
      : null;
  const currentVideoErrorMessage =
    typeof currentVideoError?.message === "string"
      ? currentVideoError.message
      : null;

  // 受控流写回适配：CanvasSurface 的 onNodesCommit / onViewportChange 解析后整体写回当前 active project。
  const setViewport = useCallback(
    (next: Viewport) => {
      dispatch({
        type: "set-viewport",
        projectId: activeProject.id,
        viewport: next,
      });
    },
    [activeProject.id, dispatch],
  );
  const setNodes = useCallback(
    (next: NodeItem[]) => {
      dispatch({ type: "set-nodes", projectId: activeProject.id, nodes: next });
    },
    [activeProject.id, dispatch],
  );

  // 画布素材节点操作面板的统一动作分发（按 nodeId 反查 node）
  const handleNodeAction = useCallback((node: NodeItem, actionId: string) => {
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
          setImageDockMedia([
            {
              id: node.id,
              type: "image",
              name,
              assetId: node.assetId,
              src: node.imageUrl,
            },
          ]);
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
          setVideoDockMedia([
            {
              id: node.id,
              type: "image",
              name,
              assetId: node.assetId,
              src: node.imageUrl,
            },
          ]);
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
  }, []);

  // Esc 退出「从画布选择」模式（节点删除由 RF deleteKeyCode 承接）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pickingFor) {
        setPickingFor(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pickingFor]);

  const addNode = useCallback(
    (type: NodeType, extra?: Partial<NodeItem>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      // world 坐标 = (屏幕中心 - 视口平移) / zoom；等价于 RF screenToFlowPosition({cx,cy})。
      const worldX = (cx - viewport.x) / viewport.zoom;
      const worldY = (cy - viewport.y) / viewport.zoom;
      const id = `${type}-${Date.now()}`;
      const base: NodeItem =
        type === "text"
          ? {
              id,
              type,
              position: { x: worldX - 100, y: worldY - 24 },
              width: 200,
              height: 48,
              content: "文本节点",
            }
          : {
              id,
              type,
              position: { x: worldX - 120, y: worldY - 120 },
              width: 240,
              height: 240,
              content: "占位图片节点",
            };
      const node: NodeItem = { ...base, ...extra, id: base.id };
      // 写入走 reducer：节点归属当前 active project（位置在此算好作为 position 传入）
      dispatch({ type: "add-node", projectId: activeProject.id, node });
      return id;
    },
    [viewport, activeProject.id, dispatch],
  );

  // 对话流出现 card 的同一时刻，在画布同步创建对应图片 NodeItem（同一生成结果两种视图）。
  // 仅透 content/width/height；position/id 留给 addNode。
  const handleCardGenerated = useCallback(
    (card: CardMessage) => {
      if (
        card.assetId &&
        activeProject.canvas.nodes.some((node) => node.assetId === card.assetId)
      ) {
        return;
      }
      const partial = nodeFromCard(card, () => 0);
      addNode("image", {
        content: partial.content,
        width: partial.width,
        height: partial.height,
        assetId: partial.assetId,
        imageUrl: partial.imageUrl,
      });
    },
    [activeProject.canvas.nodes, addNode],
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
    [addNode],
  );

  // Dock「本地上传」：既建画布节点，又把同一资产塞进对应 Dock 的参考 media（共享 id/src）
  const handleDockLocalUpload = useCallback(
    (file: File, mode: "image" | "video") => {
      const url = URL.createObjectURL(file);
      const id = addNode("image", { content: file.name, imageUrl: url });
      const item: DockMediaItem = {
        id,
        type: "image",
        name: file.name,
        src: url,
      };
      if (mode === "image") {
        setImageDockMedia((prev) =>
          prev.some((m) => m.id === id) ? prev : [...prev, item],
        );
      } else {
        setVideoDockMedia((prev) =>
          prev.some((m) => m.id === id) ? prev : [...prev, item],
        );
      }
    },
    [addNode],
  );

  // 图片与视频统一提交 Project 命令；结果都由 Snapshot/SSE 恢复。
  const handleGenerate = useCallback(
    async (promptText: string, args: GenerateArgs) => {
      const trimmed = promptText.trim();
      if (!trimmed) return;
      const submittingProjectId = activeProject.id;
      setSubmittingByProject((current) =>
        setProjectSubmitting(current, submittingProjectId, true),
      );
      try {
        if (!backendReady) {
          throw new Error("后端未启动或无法连接");
        }
        if (args.mode === "image") {
          const projectId = Number(activeProject.id);
          const outputCount = expectedOutputCount(args.settings.quantity);
          const inputAssetIds = imageDockMedia.map((media) =>
            Number(media.assetId),
          );
          if (
            !Number.isSafeInteger(projectId) ||
            projectId <= 0 ||
            inputAssetIds.some(
              (assetId) => !Number.isSafeInteger(assetId) || assetId <= 0,
            )
          ) {
            throw new Error("参考素材尚未成为可用 Asset");
          }
          await createProjectGenerationJob(
            projectId,
            {
              type: "image",
              input_asset_ids: inputAssetIds,
              parameters: {
                prompt: trimmed,
                aspect_ratio: args.settings.aspectRatio.id,
                model_id: args.settings.modelId,
                size: args.settings.size,
                web_search: args.settings.webSearch,
              },
              expected_output_count: outputCount,
            },
            newCommandIdentity(),
          );
          setGenerateError(null);
        } else {
          if (videoDockMedia.length > 1) {
            throw new Error("视频参考素材数量超出限制");
          }
          const projectId = Number(activeProject.id);
          const outputCount = expectedOutputCount(args.settings.quantity);
          const inputAssetIds = videoDockMedia.map((media) =>
            Number(media.assetId),
          );
          if (
            !Number.isSafeInteger(projectId) ||
            projectId <= 0 ||
            inputAssetIds.some(
              (assetId) => !Number.isSafeInteger(assetId) || assetId <= 0,
            )
          ) {
            throw new Error("参考素材尚未成为可用 Asset");
          }
          const result = await createProjectGenerationJob(
            projectId,
            {
              type: "video",
              input_asset_ids: inputAssetIds,
              parameters: {
                prompt: trimmed,
                aspect_ratio: args.settings.aspectRatio.id,
                resolution: args.settings.resolution.id,
                duration: args.settings.duration,
              },
              expected_output_count: outputCount,
            },
            newCommandIdentity(),
          );
          setActiveVideoJobIdByProject((current) => ({
            ...current,
            [submittingProjectId]: result.generation_job_id,
          }));
          setGenerateError(null);
        }
      } catch (e) {
        console.error("generate failed", e);
        setGenerateError(userFriendlyErrorMessage(e));
      } finally {
        setSubmittingByProject((current) =>
          setProjectSubmitting(current, submittingProjectId, false),
        );
      }
    },
    [activeProject.id, backendReady, imageDockMedia, videoDockMedia],
  );

  const handleRetryGenerationJob = useCallback(
    async (generationJobId: number | string) => {
      if (!backendReady) throw new Error("后端未启动或无法连接");
      const projectId = Number(activeProject.id);
      const jobId = Number(generationJobId);
      if (
        !Number.isSafeInteger(projectId) ||
        projectId <= 0 ||
        !Number.isSafeInteger(jobId) ||
        jobId <= 0
      ) {
        throw new Error("GenerationJob 身份无效");
      }
      const identity =
        retryIdempotencyKeysRef.current[String(jobId)] ?? newCommandIdentity();
      retryIdempotencyKeysRef.current[String(jobId)] = identity;
      await retryMissingProjectGenerationJobOutputs(projectId, jobId, identity);
    },
    [activeProject.id, backendReady],
  );

  // Project SSE 到达终态后呈现稳定错误；节点由恢复投影统一创建。
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (currentVideoStatus === "failed") {
      setGenerateError(currentVideoErrorMessage || "视频生成失败，请稍后重试");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [currentVideoErrorMessage, currentVideoStatus]);

  const handleCancelVideo = useCallback(async () => {
    if (!Number.isSafeInteger(currentVideoJobId) || currentVideoJobId <= 0)
      return;
    setCancellingVideo(true);
    try {
      await cancelProjectGenerationJob(
        Number(activeProject.id),
        currentVideoJobId,
      );
    } catch (error) {
      setGenerateError(userFriendlyErrorMessage(error));
    } finally {
      setCancellingVideo(false);
    }
  }, [activeProject.id, currentVideoJobId]);

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
        assetId: node.assetId,
        src: node.imageUrl,
      };
      if (pickingFor === "image") {
        setImageDockMedia((prev) =>
          prev.some((m) => m.id === item.id) ? prev : [...prev, item],
        );
      } else if (pickingFor === "video") {
        setVideoDockMedia((prev) =>
          prev.some((m) => m.id === item.id) ? prev : [...prev, item],
        );
      }
      setPickingFor(null);
    },
    [pickingFor],
  );

  // CanvasSurface 节点点击：选择模式下拦截为挑图，否则交 RF 默认选中
  const handleCanvasNodeClick = useCallback(
    (node: NodeItem) => {
      if (pickingFor && node.type === "image" && node.imageUrl) {
        handlePickNode(node);
      }
    },
    [pickingFor, handlePickNode],
  );

  // 操作浮层动作：按 nodeId 反查 node 后走 handleNodeAction
  const handleCanvasNodeAction = useCallback(
    (nodeId: string, actionId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) handleNodeAction(node, actionId);
    },
    [nodes, handleNodeAction],
  );

  // 可选图片节点数（带 imageUrl），用于胶囊空态提示
  const pickableCount = nodes.filter(
    (n) => n.type === "image" && n.imageUrl,
  ).length;

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
    [addNode, bottomDockMode, handleUploadClick],
  );

  if (gated) {
    return null;
  }
  if (booting) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white/60 text-sm">
        加载画布…
      </div>
    );
  }

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
        onSwitch={switchProject}
        onCreate={createProjectAction}
        onDelete={deleteProjectAction}
      />
      <TopBarCenter />
      <TopBarRight
        isAgentOpen={isAgentOpen}
        onAgentToggle={() => setIsAgentOpen((v) => !v)}
      />

      <ReactFlowProvider>
        <div ref={containerRef} className="absolute inset-0 z-0">
          <CanvasSurface
            nodes={nodes}
            viewport={viewport}
            onNodesCommit={setNodes}
            onViewportChange={setViewport}
            onNodeClick={handleCanvasNodeClick}
            onPaneClick={handleExitPick}
            onNodeAction={handleCanvasNodeAction}
            picking={pickingFor !== null}
          />
        </div>
        <ZoomControls />
      </ReactFlowProvider>

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
            background: "var(--tc-bg-surface)",
            border: "1px solid var(--tc-border-subtle)",
            boxShadow: "var(--tc-menu-pill-shadow)",
            backdropFilter: "blur(12px)",
            color: "var(--tc-text-secondary)",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--tc-accent)", fontWeight: 600 }}>
            从画布选择
          </span>
          <span style={{ color: "var(--tc-text-tertiary)" }}>
            {pickableCount === 0
              ? "画布上还没有可用的图片"
              : "点击画布中的图片加入"}
          </span>
          <span style={{ color: "var(--tc-text-muted)" }}>·</span>
          <button
            type="button"
            onClick={handleExitPick}
            style={{
              padding: "2px 10px",
              borderRadius: 9999,
              border: "1px solid var(--tc-border-subtle)",
              background: "var(--tc-menu-item-hover)",
              color: "var(--tc-text-secondary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            取消 · Esc
          </button>
        </div>
      )}
      {/* BottomDock 始终挂载（display 控制显隐），保留用户调好的参数 */}
      <div style={{ display: isBottomDockOpen ? undefined : "none" }}>
        <BottomDock
          mode={bottomDockMode}
          onClose={() => setIsBottomDockOpen(false)}
          imageMedia={imageDockMedia}
          videoMedia={videoDockMedia}
          onRemoveImageMedia={(id) =>
            setImageDockMedia((prev) => prev.filter((m) => m.id !== id))
          }
          onRemoveVideoMedia={(id) =>
            setVideoDockMedia((prev) => prev.filter((m) => m.id !== id))
          }
          onLocalUpload={(file) => handleDockLocalUpload(file, bottomDockMode)}
          onPickFromCanvas={() => handleRequestPick(bottomDockMode)}
          onExitPick={handleExitPick}
          isPicking={pickingFor === bottomDockMode}
          onGenerate={handleGenerate}
          generating={
            generating || (bottomDockMode === "video" && videoJobActive)
          }
          generateError={generateError}
          onClearGenerateError={() => setGenerateError(null)}
          videoJobStatus={currentVideoStatus}
          videoJobError={currentVideoErrorMessage}
          onCancelVideoJob={handleCancelVideo}
          cancellingVideo={cancellingVideo}
        />
      </div>
      <AgentChatPanel
        key={activeProject.id}
        prompt={prompt}
        messages={messages}
        isOpen={isAgentOpen}
        onClose={() => setIsAgentOpen(false)}
        pendingMention={agentPendingMention}
        onMentionConsumed={() => setAgentPendingMention(null)}
        onCardGenerated={handleCardGenerated}
        onAppendMessages={(msgs: ChatMessage[]) =>
          dispatch({
            type: "append-messages",
            projectId: activeProject.id,
            messages: msgs,
          })
        }
        onSubmitMessage={
          backendReady ? submitConversationMessageAction : undefined
        }
        onSetCardStatus={(cardId, status) =>
          dispatch({
            type: "set-card-status",
            projectId: activeProject.id,
            cardId,
            status,
          })
        }
        onRetryGenerationJob={handleRetryGenerationJob}
      />

      <div className="absolute bottom-4 left-4 z-[400] flex items-center gap-2">
        <Link
          href="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:text-white"
          style={{
            background: "var(--tc-bg-surface)",
            border: "1px solid var(--tc-menu-pill-border)",
          }}
        >
          <ArrowLeft width={14} height={14} />
          返回首页
        </Link>
        {backendReady && saveStatus !== "idle" && (
          <span
            className="text-xs"
            style={{
              color:
                saveStatus === "error"
                  ? "var(--tc-destructive)"
                  : "var(--tc-text-muted)",
            }}
          >
            {saveStatus === "saving"
              ? "保存中…"
              : saveStatus === "saved"
                ? "已保存"
                : "保存失败"}
          </span>
        )}
      </div>
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

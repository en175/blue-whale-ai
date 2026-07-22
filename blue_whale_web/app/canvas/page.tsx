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
import { loadUser, SKIP_AUTH } from "@/components/auth/authStorage";
import { ArrowLeft } from "lucide-react";
import type { MentionItem } from "./_canvas/components/dock/mention";
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
import { nodeFromCard, useCanvasProjects } from "./_canvas";
import type { GenerateArgs } from "./_canvas";
import { generateImage, createVideoJob, streamJob, listJobs } from "./_canvas/api/generation";
import { findPlacement } from "./_canvas/placement";
import { parseAspectRatio } from "./_canvas/aspectRatio";
import { jobToPlaceholder } from "./_canvas/recover";
import { uploadAsset } from "@/lib/assets";
import { readMediaNaturalSize } from "@/lib/mediaSize";
import { useJobStatus } from "./_canvas/hooks/useJobStatus";

/** "1x"/"2x" → 数字；解析失败回落 1。 */
function parseQuantity(q: string): number {
  const n = parseInt(q, 10);
  return Number.isNaN(n) ? 1 : n;
}

/** 把后端/网络错误映射为用户友好提示，避免暴露内部配置。 */
function userFriendlyErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return "生成失败，请稍后重试";
  const msg = e.message;
  if (msg.includes("后端未启动") || msg.includes("无法连接")) {
    return "无法连接到服务，请检查网络或稍后重试";
  }
  if (msg.includes("ARK_API_KEY") || msg.includes("数据库")) {
    return "服务暂时不可用，请稍后重试";
  }
  return "生成失败，请稍后重试";
}

function CanvasPageInner() {
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt") || "";
  const { openLogin } = useAuth();
  const guardRouter = useRouter();
  // 画布视口容器：addNode 据其中心换算 world 坐标（viewport 为受控 {x,y,zoom}）。
  const containerRef = useRef<HTMLDivElement>(null);

  // gating：未登录直访 /canvas 时，先空白守卫再决定渲染或跳转，避免画布内容首帧闪烁。
  // TODO: 接真实数据后改为路由守卫（middleware 或 server component 检查登录态）。
  const [gated, setGated] = useState(true);
  useEffect(() => {
    const storedUser = loadUser();
    // 本地开发跳过鉴权（SKIP_AUTH）时，不做未登录跳转
    if (!SKIP_AUTH && !storedUser) {
      console.warn("[Canvas] gate: loadUser()=null → 踢回首页 + 弹登录。localStorage keys:",
        Object.keys(localStorage).filter(k => k.startsWith("bw-")));
      guardRouter.replace("/");
      openLogin();
    } else {
      console.log("[Canvas] gate: loadUser() 成功，user:", storedUser?.username);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project 聚合根：多项目画布+对话的单一真相源（hook 缝合后端持久化，见 useCanvasProjects）
  const {
    state: projectState,
    dispatch,
    activeProject,
    saveStatus,
    booting,
    backendReady,
    loadedCanvasId,
    loadError,
    retry,
    createProjectAction,
    renameProjectAction,
    switchProject,
    deleteProjectAction,
  } = useCanvasProjects();
  // 派生：当前项目的画布与对话（空列表时 activeProject=undefined，给空默认避免崩；空态在下方 return 处理）
  const { nodes, viewport } = activeProject?.canvas ?? { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const messages = activeProject?.messages ?? [];

  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [isBottomDockOpen, setIsBottomDockOpen] = useState(false);
  const [bottomDockMode, setBottomDockMode] = useState<"image" | "video">("image");
  const [imageDockMedia, setImageDockMedia] = useState<DockMediaItem[]>([]);
  /** 重新编辑（refresh）触发 dock 输入框聚焦 + 闪烁信号（nonce，递增触发 effect） */
  const [dockFocusSignal, setDockFocusSignal] = useState(0);
  /** 插入参考图 mention pill 信号（nonce 触发 BottomDock insertMention effect，X3） */
  const [dockMentionSignal, setDockMentionSignal] = useState<{ nonce: number; item: MentionItem | null; replace?: boolean }>({
    nonce: 0,
    item: null,
  });
  const [videoDockMedia, setVideoDockMedia] = useState<DockMediaItem[]>([]);
  // 视频首尾帧模式：已上传首/尾帧的 TOS url（后端可访问，非本地 blob）
  const [firstFrameUrl, setFirstFrameUrl] = useState<string | undefined>(undefined);
  const [lastFrameUrl, setLastFrameUrl] = useState<string | undefined>(undefined);
  const [agentPendingMention, setAgentPendingMention] = useState<{ name: string; nonce: number } | null>(null);
  // 「从画布选择」模式：非 null 表示正在为哪个 Dock 挑图（image/video）
  const [pickingFor, setPickingFor] = useState<"image" | "video" | null>(null);
  // 生成：视频异步轮询 hook + 生成中状态 + 待落节点的 prompt
  const { state: jobState, start: startJob, reset: resetJob } = useJobStatus();
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const pendingVideoNodeRef = useRef<string | null>(null);

  // 受控流写回适配：CanvasSurface 的 onNodes_commit / onViewportChange 解析后整体写回当前 active project。
  const setViewport = useCallback(
    (next: Viewport) => {
      if (!activeProject) return;
      dispatch({ type: "set-viewport", projectId: activeProject.id, viewport: next });
    },
    [activeProject?.id]
  );
  const setNodes = useCallback(
    (next: NodeItem[]) => {
      if (!activeProject) return;
      dispatch({ type: "set-nodes", projectId: activeProject.id, nodes: next });
    },
    [activeProject?.id]
  );

  // 画布素材节点操作面板的统一动作分发（按 nodeId 反查 node）
  const handleNodeAction = useCallback(
    (node: NodeItem, actionId: string) => {
      const name = node.content || "未命名素材";
      switch (actionId) {
        case "refresh": {
          // 重新编辑（X4）：唤起底部图片 Dock（不带素材）+ 聚焦输入框原生 caret
          setBottomDockMode("image");
          setIsBottomDockOpen(true);
          setDockFocusSignal((n) => n + 1);
          break;
        }
        case "shuffle":
        case "image": {
          // 生成图片 / 再创作（X3）：唤起图片 Dock + 参考图同步进顶部缩略图和 mention pill
          setBottomDockMode("image");
          setIsBottomDockOpen(true);
          setDockFocusSignal((n) => n + 1);
          if (node.imageUrl) {
            const item: DockMediaItem = { id: node.id, type: "image", name, src: node.imageUrl };
            setImageDockMedia([item]);
            setDockMentionSignal({ nonce: Date.now(), item: { src: node.imageUrl, name, id: node.id }, replace: true });
          }
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
      const id = extra?.id ?? `${type}-${Date.now()}`;
      // 节点尺寸：text 固定 200×48；媒体取 extra（生成 parseAspectRatio / 上传 readMediaNaturalSize），默认 200×200
      const w = extra?.width ?? 200;
      const h = extra?.height ?? (type === "text" ? 48 : 200);
      // 媒体节点：视口中心锚 + 行优先网格不重叠搜索（design D2），绝不覆盖已有节点；text 居中
      const position =
        type === "text"
          ? { x: worldX - w / 2, y: worldY - h / 2 }
          : findPlacement({
              existing: (activeProject?.canvas.nodes ?? []).map((n) => ({
                x: n.position.x,
                y: n.position.y,
                width: n.width,
                height: n.height,
              })),
              anchor: { x: worldX, y: worldY },
              nodeWidth: w,
              nodeHeight: h,
            });
      const base: NodeItem = {
        id,
        type,
        position,
        width: w,
        height: h,
        content: type === "text" ? "文本节点" : type === "video" ? "占位视频节点" : "占位图片节点",
      };
      const node: NodeItem = { ...base, ...extra, id: base.id };
      // 写入走 reducer：节点归属当前 active project（位置在此算好作为 position 传入）
      if (!activeProject) return id;
      dispatch({ type: "add-node", projectId: activeProject.id, node });
      return id;
    },
    [viewport, activeProject]
  );

  // 占位→出图/失败原地流转（design D1/D7）：按 nodeId patch，不删重建保位置。
  const updateNode = useCallback(
    (nodeId: string, patch: Partial<NodeItem>) => {
      console.log("[DEBUG-genbug] updateNode", nodeId, patch);
      if (!activeProject) return;
      dispatch({ type: "update-node", projectId: activeProject.id, nodeId, patch });
    },
    [activeProject?.id],
  );

  // 对话流出现 card 的同一时刻，在画布同步创建对应图片 NodeItem（同一生成结果两种视图）。
  // 仅透 content/width/height；position/id 留给 addNode。
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

  // 左工具栏「上传」：图片/视频都收，上传 TOS 拿持久 url 建画布节点（视频由 ImageNode 按 url 后缀自动切 <video>）
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      if (!activeProject) return;
      const mediaType: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
      try {
        const result = await uploadAsset(file, Number(activeProject.id), mediaType);
        const size = await readMediaNaturalSize(result.url, mediaType);
        addNode("image", { content: file.name, imageUrl: result.url, width: size.width, height: size.height });
      } catch (err) {
        setGenerateError(userFriendlyErrorMessage(err));
      }
    },
    [addNode, activeProject?.id]
  );

  // Dock「本地上传」：上传 TOS 拿持久 url，按 MIME 分 image/video/audio；
  // 图片建画布节点，视频/音频只入 Dock media（画布暂不承载视频/音频节点）
  const handleDockLocalUpload = useCallback(
    async (file: File, mode: "image" | "video") => {
      if (!activeProject) return;
      const mediaType: DockMediaItem["type"] = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : "audio";
      try {
        const result = await uploadAsset(file, Number(activeProject.id), mediaType);
        // 图片/视频上画布（视频由 ImageNode 按 url 后缀自动切 <video>）；音频不入画布
        const onCanvas = mediaType === "image" || mediaType === "video";
        let id: string;
        if (onCanvas) {
          const size = await readMediaNaturalSize(result.url, mediaType as "image" | "video");
          id = addNode("image", {
            content: file.name,
            imageUrl: result.url,
            width: size.width,
            height: size.height,
          });
        } else {
          id = `${mediaType}-${Date.now()}`;
        }
        const item: DockMediaItem = { id, type: mediaType, name: file.name, src: result.url, assetId: result.id };
        if (mode === "image") {
          setImageDockMedia((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, item]));
        } else {
          setVideoDockMedia((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, item]));
        }
      } catch (e) {
        setGenerateError(userFriendlyErrorMessage(e));
      }
    },
    [addNode, activeProject?.id]
  );

  // 首尾帧上传：调后端 asset upload 拿 TOS url 回填（后端可访问，非本地 blob）
  const handleFrameUpload = useCallback(
    async (file: File, slot: "first" | "last") => {
      if (!activeProject) return;
      try {
        const result = await uploadAsset(file, Number(activeProject.id), "image");
        if (slot === "first") setFirstFrameUrl(result.url);
        else setLastFrameUrl(result.url);
      } catch (e) {
        setGenerateError(userFriendlyErrorMessage(e));
      }
    },
    [activeProject?.id],
  );

  const handleFrameClear = useCallback((slot: "first" | "last") => {
    if (slot === "first") setFirstFrameUrl(undefined);
    else setLastFrameUrl(undefined);
  }, []);

  const handleSwapFrames = useCallback(() => {
    const tmp = firstFrameUrl;
    setFirstFrameUrl(lastFrameUrl);
    setLastFrameUrl(tmp);
  }, [firstFrameUrl, lastFrameUrl]);

  // 生成：占位节点即时上屏（loading）→ 出图/失败原地 update（design D1/D3/D14）
  // 图片非流式同步、图片流式 SSE 逐张、视频异步轮询三路径。
  const handleGenerate = useCallback(
    async (promptText: string, args: GenerateArgs) => {
      const trimmed = promptText.trim();
      if (!trimmed) return;
      if (!activeProject) return;
      setGenerating(true);
      setGenerateError(null);
      let placeholderId: string | null = null;
      try {
        if (args.mode === "image") {
          // 图片：先放占位 loading 节点（design D1），按目标宽高比放（aspect-ratio-frame D8），出图原地 update
          const ar = parseAspectRatio(args.settings.aspectRatio.id);
          placeholderId = addNode("image", { content: trimmed, status: "loading", ...ar });
          const result = await generateImage({
            prompt: trimmed,
            projectId: Number(activeProject.id),
            modelId: args.settings.model.id,
            sizeId: args.settings.resolution.id,
            aspectRatio: args.settings.aspectRatio.id,
            quantity: parseQuantity(args.settings.quantity),
            referenceImages: args.referenceImages ?? imageDockMedia
              .map((m) => m.src)
              .filter((s): s is string => Boolean(s)),
          });
          console.log("[DEBUG-genbug] generateImage result", { stream: result.stream, jobId: result.jobId, url: result.url, assetId: result.assetId, placeholderId });
          if (result.stream && result.jobId != null) {
            // 流式（design D14）：1 占位代表首张 + 增量新增；中间失败建独立 error 节点
            let firstReady = false;
            streamJob(result.jobId, {
              onImage: (url, assetId, imageIndex) => {
                if (imageIndex === 0) {
                  firstReady = true;
                  updateNode(placeholderId!, { imageUrl: url, assetId, status: "ready" });
                } else {
                  addNode("image", { content: trimmed, imageUrl: url, assetId, status: "ready", ...ar });
                }
              },
              onImageFailed: (imageIndex, _code, message) => {
                addNode("image", {
                  content: `第 ${imageIndex + 1} 张`,
                  status: "error",
                  errorMessage: message || "该张生成失败",
                });
              },
              onDone: () => {
                // 占位仍 loading（0 张成功）→ 转 error（design D14）
                if (!firstReady && placeholderId) {
                  updateNode(placeholderId, { status: "error", errorMessage: "未生成任何图片" });
                }
                setGenerating(false);
              },
              onError: (message) => {
                if (placeholderId) updateNode(placeholderId, { status: "error", errorMessage: message });
                setGenerateError(message);
                setGenerating(false);
              },
            });
          } else {
            // 非流式：同步单图，占位 → ready/error
            if (result.url) {
              updateNode(placeholderId, {
                imageUrl: result.url,
                assetId: result.assetId,
                status: "ready",
              });
            } else {
              updateNode(placeholderId, { status: "error", errorMessage: "未返回图片" });
            }
            setGenerating(false);
          }
        } else {
          // 视频（design D1/D16）：createVideoJob 成功后放 video 占位 loading，轮询流转
          const result = await createVideoJob({
            prompt: trimmed,
            projectId: Number(activeProject.id),
            modelId: args.settings.model.id,
            resolution: args.settings.resolution.id,
            aspectRatio: args.settings.aspectRatio.id,
            duration: args.settings.duration,
            firstFrameUrl: args.settings.firstFrameUrl,
            lastFrameUrl: args.settings.lastFrameUrl,
            referenceImages: args.settings.referenceImages,
            referenceVideos: args.settings.referenceVideos,
            referenceAudios: args.settings.referenceAudios,
          });
          // 视频占位按目标宽高比（aspect-ratio-frame D8）
          const ar = parseAspectRatio(args.settings.aspectRatio.id);
          placeholderId = addNode("video", { content: trimmed, status: "loading", progress: 0, ...ar });
          pendingVideoNodeRef.current = placeholderId;
          startJob(result.jobId);
          // generating 在 jobState 终态时由下方 effect 复位
        }
      } catch (e) {
        console.error("generate failed", e);
        // 图片非流式：generateImage 抛错时占位已建 → 转 error（video 占位在 createVideoJob 后才建，抛错时尚未建）
        if (placeholderId && args.mode === "image") {
          updateNode(placeholderId, { status: "error", errorMessage: userFriendlyErrorMessage(e) });
        }
        setGenerateError(userFriendlyErrorMessage(e));
        setGenerating(false);
      }
    },
    [addNode, updateNode, imageDockMedia, startJob, activeProject?.id]
  );

  // 视频任务轮询流转（design D16）：polling 更新 progress；succeeded 占位→ready；failed 占位→error
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const nodeId = pendingVideoNodeRef.current;
    if (jobState.status === "polling" && nodeId) {
      updateNode(nodeId, { progress: jobState.progress });
    } else if (jobState.status === "succeeded") {
      if (nodeId) updateNode(nodeId, { imageUrl: jobState.assetUrl, status: "ready" });
      setGenerating(false);
      resetJob();
    } else if (jobState.status === "failed") {
      const msg = jobState.message || "视频生成失败";
      if (nodeId) updateNode(nodeId, { status: "error", errorMessage: msg });
      setGenerateError(msg);
      setGenerating(false);
      resetJob();
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [jobState, updateNode, resetJob]);

  // 刷新恢复（design D12 方案 A）：进 project 扫 processing job，重建占位 + 续轮询/SSE。
  // recoveredRef 防同 project 重入（切走切回不重复恢复）；刷新=重挂载，ref 重置→恢复。
  const recoveredRef = useRef<Set<string>>(new Set());
  const recoverProcessingJobs = useCallback(
    async (pid: string) => {
      try {
        const jobs = await listJobs({ projectId: Number(pid), status: "processing", size: 50 });
        for (const job of jobs) {
          const ph = jobToPlaceholder(job);
          addNode(ph.type, { id: ph.id, ...ph.patch });
          if (ph.type === "video") {
            // 视频续轮询（useJobStatus 单 job：多个 video processing 时续最后一个，MVP 限制）
            pendingVideoNodeRef.current = ph.id;
            startJob(job.jobId);
          } else {
            // 图片流式重连：后端 JobStreamBus 补发历史 image/done（方案 A 零后端改动）
            let firstReady = false;
            streamJob(job.jobId, {
              onImage: (url, assetId, imageIndex) => {
                if (imageIndex === 0) {
                  firstReady = true;
                  updateNode(ph.id, { imageUrl: url, assetId, status: "ready" });
                } else {
                  addNode("image", {
                    content: ph.patch.content ?? "",
                    imageUrl: url,
                    assetId,
                    status: "ready",
                    width: ph.patch.width,
                    height: ph.patch.height,
                  });
                }
              },
              onImageFailed: (imageIndex, _code, message) =>
                addNode("image", {
                  content: `第 ${imageIndex + 1} 张`,
                  status: "error",
                  errorMessage: message || "该张生成失败",
                }),
              onDone: () => {
                if (!firstReady) updateNode(ph.id, { status: "error", errorMessage: "未生成任何图片" });
              },
              onError: (message) => updateNode(ph.id, { status: "error", errorMessage: message }),
            });
          }
        }
      } catch (e) {
        console.warn("[canvas] recover processing jobs failed:", e);
      }
    },
    [addNode, updateNode, startJob],
  );
  useEffect(() => {
    // 等 loadCanvas 完成（loadedCanvasId）再恢复：避免 set-canvas 覆盖 recover 占位
    if (!loadedCanvasId) return;
    if (recoveredRef.current.has(loadedCanvasId)) return;
    recoveredRef.current.add(loadedCanvasId);
    void recoverProcessingJobs(loadedCanvasId);
  }, [loadedCanvasId, recoverProcessingJobs]);

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

  // CanvasSurface 节点点击：选择模式下拦截为挑图，否则交 RF 默认选中
  const handleCanvasNodeClick = useCallback(
    (node: NodeItem) => {
      if (pickingFor && node.type === "image" && node.imageUrl) {
        handlePickNode(node);
      }
    },
    [pickingFor, handlePickNode]
  );

  // 操作浮层动作：按 nodeId 反查 node 后走 handleNodeAction
  const handleCanvasNodeAction = useCallback(
    (nodeId: string, actionId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) handleNodeAction(node, actionId);
    },
    [nodes, handleNodeAction]
  );

  // 占位/error 节点重试（design D13）：唤起对应 Dock 重配（节点 content 已存 prompt）
  const handleNodeRetry = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setBottomDockMode(node.type === "video" ? "video" : "image");
      setIsBottomDockOpen(true);
    },
    [nodes],
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
  if (!activeProject) {
    // 空态：后端不可达（loadError）或未登录无 token。显示重试 + 引导新建，不露写死的假数据。
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-black">
        <p className="text-sm" style={{ color: "var(--tc-text-secondary)" }}>
          {loadError ? "项目加载失败" : "暂无项目"}
        </p>
        <div className="flex items-center gap-3">
          {loadError && (
            <button
              type="button"
              onClick={retry}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm transition-colors"
              style={{
                background: "var(--tc-bg-surface)",
                border: "1px solid var(--tc-border-subtle)",
                color: "var(--tc-text-secondary)",
              }}
            >
              重试
            </button>
          )}
          <button
            type="button"
            onClick={createProjectAction}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm transition-colors"
            style={{
              background: "var(--tc-accent)",
              color: "var(--tc-on-accent)",
            }}
          >
            新建项目
          </button>
        </div>
        {saveStatus === "error" && (
          <p className="text-xs" style={{ color: "var(--tc-destructive)" }}>
            操作失败，请检查服务是否可用
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
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
        onRename={renameProjectAction}
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
            onNodeRetry={handleNodeRetry}
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
          <span style={{ color: "var(--tc-accent)", fontWeight: 600 }}>从画布选择</span>
          <span style={{ color: "var(--tc-text-tertiary)" }}>
            {pickableCount === 0 ? "画布上还没有可用的图片" : "点击画布中的图片加入"}
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
          focusSignal={dockFocusSignal}
          dockMentionSignal={dockMentionSignal}
          onRemoveImageMedia={(id) => setImageDockMedia((prev) => prev.filter((m) => m.id !== id))}
          onRemoveVideoMedia={(id) => setVideoDockMedia((prev) => prev.filter((m) => m.id !== id))}
          firstFrameUrl={firstFrameUrl}
          lastFrameUrl={lastFrameUrl}
          onFrameUpload={handleFrameUpload}
          onFrameClear={handleFrameClear}
          onSwapFrames={handleSwapFrames}
          onLocalUpload={(file) => handleDockLocalUpload(file, bottomDockMode)}
          onPickFromCanvas={() => handleRequestPick(bottomDockMode)}
          onExitPick={handleExitPick}
          isPicking={pickingFor === bottomDockMode}
          onGenerate={handleGenerate}
          generating={generating}
          generateError={generateError}
          onClearGenerateError={() => setGenerateError(null)}
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
          dispatch({ type: "append-messages", projectId: activeProject.id, messages: msgs })
        }
        onSetCardStatus={(cardId, status) =>
          dispatch({ type: "set-card-status", projectId: activeProject.id, cardId, status })
        }
      />

      <div className="absolute bottom-4 left-4 z-[400] flex items-center gap-2">
        <Link
          href="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:text-white"
          style={{ background: "var(--tc-bg-surface)", border: "1px solid var(--tc-menu-pill-border)" }}
        >
          <ArrowLeft width={14} height={14} />
          返回首页
        </Link>
        {backendReady && saveStatus !== "idle" && (
          <span
            className="text-xs"
            style={{
              color:
                saveStatus === "error" ? "var(--tc-destructive)" : "var(--tc-text-muted)",
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

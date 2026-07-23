"use client";
/**
 * Canvas v2 /[projectId] —— 具体项目画布（projectId 来自 URL 路由）。
 * canvas 数据走 useCanvasDoc hook（React state，本地快，不卡）；assets 走 zustand（业务/接口缓存）。
 * 切项目 = router.push；load 按 URL projectId 触发。
 */
import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import { useAuth } from "@/components/auth/AuthContext";
import { loadUser, SKIP_AUTH } from "@/components/auth/authStorage";
import { uploadAsset } from "@/lib/assets";
import { readMediaNaturalSize, detectMediaKind } from "@/lib/mediaSize";

import { useCanvasStore } from "../../canvas/_canvas/store";
import { useCanvasDoc } from "../../canvas/_canvas/v2/useCanvasDoc";
import type { CanvasNode, CanvasNodeData, NodeKindId, MediaKind, NodeRecipe, RecipeInput } from "../../canvas/_canvas/model";
import { CanvasSurface } from "../../canvas/_canvas/v2/CanvasSurface";
import type { MenuPayload } from "../../canvas/_canvas/v2/CanvasSurface";
import { ContextMenu, type ContextMenuKind } from "../../canvas/_canvas/v2/ContextMenu";
import { useV2Projects } from "../../canvas/_canvas/v2/useV2Projects";
import { cardToV2ImageFields, jobToV2Placeholder, recipeToDockPrefill, buildCrossmodalRefill } from "../../canvas/_canvas/v2/mappers";
import { resolveInputs, toRecipeInputs, buildGenerationRecipe } from "../../canvas/_canvas/engine";
import { nodeKinds } from "../../canvas/_canvas/kinds";
import { findPlacement } from "../../canvas/_canvas/placement";
import { dockAccept } from "../../canvas/_canvas/utils";
import { parseAspectRatio } from "../../canvas/_canvas/aspectRatio";
import { generateImage, createVideoJob, streamJob, listJobs, getImageModels, getVideoModels, generateAudio } from "../../canvas/_canvas/api/generation";
import { useVideoJobs } from "../../canvas/_canvas/hooks/useVideoJobs";
import type { MentionItem } from "../../canvas/_canvas/components/dock/mention";
import {
  TopBar,
  TopBarCenter,
  TopBarRight,
  LeftToolbar,
  BottomDock,
  AgentChatPanel,
  ZoomControls,
} from "../../canvas/_canvas";
import type { DockMediaItem, GenerateArgs, PrefillSignal } from "../../canvas/_canvas";
import type { CardMessage, ChatMessage } from "../../canvas/_canvas";

function parseQuantity(q: string): number {
  const n = parseInt(q, 10);
  return Number.isNaN(n) ? 1 : n;
}

function userFriendlyErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return "生成失败，请稍后重试";
  const msg = e.message;
  if (msg.includes("后端未启动") || msg.includes("无法连接")) return "无法连接到服务，请检查网络或稍后重试";
  if (msg.includes("ARK_API_KEY") || msg.includes("数据库")) return "服务暂时不可用，请稍后重试";
  return "生成失败，请稍后重试";
}

function CanvasV2ProjectInner() {
  const params = useParams<{ projectId: string }>();
  const pid = params.projectId;
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt") || "";
  const { openLogin } = useAuth();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [gated, setGated] = useState(true);
  useEffect(() => {
    const u = loadUser();
    if (!SKIP_AUTH && !u) {
      router.replace("/");
      openLogin();
      return;
    }
    setGated(false);
  }, [openLogin, router]);

  const {
    projects,
    activeProject,
    messages,
    booting,
    backendReady,
    loadError,
    retry,
    createProject: createProjectAction,
    renameProject,
    deleteProject: deleteProjectAction,
    appendMessages,
    setCardStatus,
  } = useV2Projects(pid);

  // canvas 数据 = useCanvasDoc hook（本地 state，不卡）；assets = zustand（业务缓存）
  const { nodes, edges, viewport, saveState, onNodesChange, onEdgesChange, onConnect, addNodeFull, addEdgeFull, patchNode, setViewport: setViewportAction, load: loadDoc } = useCanvasDoc();
  const assets = useCanvasStore((s) => s.assets);
  const addAsset = useCanvasStore((s) => s.addAsset);
  const ensureAsset = useCanvasStore((s) => s.ensureAsset);

  const switchProject = useCallback((id: string) => {
    router.push(`/canvas-v2/${id}`);
  }, [router]);
  const createProject = useCallback(async () => {
    const id = await createProjectAction();
    if (id) router.push(`/canvas-v2/${id}`);
  }, [createProjectAction, router]);
  const deleteProject = useCallback(async (id: string) => {
    await deleteProjectAction(id);
    if (id === pid) router.replace("/canvas-v2");
  }, [deleteProjectAction, pid, router]);

  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [isBottomDockOpen, setIsBottomDockOpen] = useState(false);
  const [bottomDockMode, setBottomDockMode] = useState<"image" | "video" | "audio">("image");
  const [imageDockMedia, setImageDockMedia] = useState<DockMediaItem[]>([]);
  const [dockFocusSignal, setDockFocusSignal] = useState(0);
  /** 重新编辑预填（P2）：recipe.generation → Dock 参数回填信号 */
  const [prefillSignal, setPrefillSignal] = useState<PrefillSignal | null>(null);
  const [dockMentionSignal, setDockMentionSignal] = useState<{ nonce: number; item: MentionItem | null; replace?: boolean }>({
    nonce: 0,
    item: null,
  });
  const [videoDockMedia, setVideoDockMedia] = useState<DockMediaItem[]>([]);
  const [audioDockMedia, setAudioDockMedia] = useState<DockMediaItem[]>([]);
  const [firstFrameUrl, setFirstFrameUrl] = useState<string | undefined>(undefined);
  const [lastFrameUrl, setLastFrameUrl] = useState<string | undefined>(undefined);
  const [agentPendingMention, setAgentPendingMention] = useState<{ name: string; nonce: number } | null>(null);
  const [pickingFor, setPickingFor] = useState<"image" | "video" | "audio" | "firstFrame" | "lastFrame" | null>(null);
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const videoJobs = useVideoJobs();
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const addNode = useCallback(
    (kind: NodeKindId, extra?: { id?: string; width?: number; height?: number; data?: Partial<CanvasNodeData> }): string => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      const worldX = (cx - viewport.x) / viewport.zoom;
      const worldY = (cy - viewport.y) / viewport.zoom;
      const w = extra?.width ?? (kind === "text" ? 200 : 256);
      const h = extra?.height ?? (kind === "text" ? 48 : 200);
      const id = extra?.id ?? `n_${Math.random().toString(36).slice(2, 10)}`;
      const position =
        kind === "text"
          ? { x: worldX - w / 2, y: worldY - h / 2 }
          : findPlacement({
              existing: nodes.map((n) => ({ x: n.position.x, y: n.position.y, width: n.width ?? 200, height: n.height ?? 200 })),
              anchor: { x: worldX, y: worldY },
              nodeWidth: w,
              nodeHeight: h,
            });
      const node: CanvasNode = { id, type: kind, position, width: w, height: h, data: { kind, ...(extra?.data ?? {}) } };
      addNodeFull(node);
      return id;
    },
    [nodes, viewport, addNodeFull],
  );

  const updateNode = useCallback((nodeId: string, patch: Partial<CanvasNodeData>) => {
    patchNode(nodeId, patch);
  }, [patchNode]);

  // 出图：注册 asset + 节点 assetId 引用 + status=done（assetId 全链路 String）；recipe 随生成冻结写回
  const setNodeAsset = useCallback(
    (nodeId: string, assetId: string, kind: MediaKind, src: string, source: "generated" | "uploaded" = "generated", recipe?: NodeRecipe) => {
      addAsset({ id: assetId, kind, src, source });
      patchNode(nodeId, recipe ? { assetId, status: "done", recipe } : { assetId, status: "done" });
    },
    [addAsset, patchNode],
  );

  // 视频 job 编排：nodeId 闭包注入 useVideoJobs 回调。recipe 已在节点上（创建即写），
  // 此处只按 job 生命周期更新 progress / 写 assetId / 报错——不再依赖单 ref，多视频可并发。
  const startVideoJob = useCallback(
    (nodeId: string, jobId: number) => {
      videoJobs.start(jobId, {
        onProgress: (progress) => updateNode(nodeId, { progress }),
        onSucceeded: ({ assetId, assetUrl }) => setNodeAsset(nodeId, assetId, "video", assetUrl, "generated"),
        onFailed: (message) => {
          updateNode(nodeId, { status: "error", errorMessage: message });
          setGenerateError(message);
        },
      });
    },
    [videoJobs, updateNode, setNodeAsset],
  );

  const buildImageStreamHandlers = useCallback(
    (placeholderId: string, content: string, w: number, h: number, onSettled?: () => void, recipe?: NodeRecipe) => ({
      onImage: (url: string, assetId: number, imageIndex: number) => {
        if (imageIndex === 0) {
          setNodeAsset(placeholderId, String(assetId), "image", url, "generated", recipe);
        } else {
          const aid = String(assetId);
          addAsset({ id: aid, kind: "image", src: url, source: "generated" });
          addNode("image", { width: w, height: h, data: { content, status: "done", assetId: aid, recipe } });
        }
      },
      onImageFailed: (imageIndex: number, _code?: string, message?: string) => {
        addNode("image", { width: w, height: h, data: { content: `第 ${imageIndex + 1} 张`, status: "error", errorMessage: message || "该张生成失败" } });
      },
      onDone: () => {
        const ph = nodes.find((n) => n.id === placeholderId);
        if (ph && ph.data.status === "running") updateNode(placeholderId, { status: "error", errorMessage: "未生成任何图片" });
        onSettled?.();
      },
      onError: (message: string) => {
        updateNode(placeholderId, { status: "error", errorMessage: message });
        setGenerateError(message);
        onSettled?.();
      },
    }),
    [addNode, setNodeAsset, updateNode, nodes],
  );

  // 节点「生成」：resolveInputs 取上游 text prompt（连线驱动）→ 默认 model 生成（image 非流式 / video 轮询）
  const handleGenerateFromNode = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || (node.data.kind !== "image" && node.data.kind !== "video")) return;
      const inputs = resolveInputs(node, nodes, edges, assets);
      const task = nodeKinds[node.data.kind].buildTask(node, inputs);
      const recipeInputs = toRecipeInputs(node, nodes, edges, assets);
      const prompt = task.prompt?.trim();
      if (!prompt) {
        setGenerateError("请先连一个文本节点作 prompt");
        return;
      }
      setGenerating(true);
      setGenerateError(null);
      try {
        if (node.data.kind === "image") {
          const models = await getImageModels();
          const model = models[0];
          if (!model) throw new Error("无可用图片模型");
          patchNode(nodeId, { status: "running" });
          const result = await generateImage({ prompt, projectId: Number(pid), modelId: model.modelId, sizeId: model.defaultSize, aspectRatio: model.defaultAspectRatio, quantity: 1 });
          if (result.url && result.assetId != null) {
            const recipe = buildGenerationRecipe({ mediaKind: "image", model: model.modelId, params: { aspectRatio: model.defaultAspectRatio, resolution: model.defaultSize, quantity: 1 }, inputs: recipeInputs });
            setNodeAsset(nodeId, String(result.assetId), "image", result.url, "generated", recipe);
          }
          else patchNode(nodeId, { status: "error", errorMessage: "未返回图片" });
          setGenerating(false);
        } else {
          // video：createVideoJob → recipe 创建即写节点 → startVideoJob per-job 轮询（并发安全）
          const models = await getVideoModels();
          const model = models[0];
          // recipe 创建即写节点：配方发起那刻全有，running/失败窗口期也带溯源（不再拖到 succeeded）
          const videoRecipe = buildGenerationRecipe({ mediaKind: "video", model: model?.modelId ?? "", params: { aspectRatio: model?.defaultAspectRatio ?? "16:9", resolution: model?.defaultResolution ?? "1080p", duration: model?.defaultDuration ?? 5, refMode: "none" }, inputs: recipeInputs });
          patchNode(nodeId, { status: "running", progress: 0, recipe: videoRecipe });
          const result = await createVideoJob({
            prompt,
            projectId: Number(pid),
            modelId: model?.modelId,
            resolution: model?.defaultResolution,
            aspectRatio: model?.defaultAspectRatio,
            duration: model?.defaultDuration ?? 5,
            firstFrameUrl: task.firstFrame?.src,
          });
          startVideoJob(nodeId, result.jobId);
          setGenerating(false); // 视频转后台轮询（节点自身 running/progress 反馈），不阻塞后续并发生成
        }
      } catch (e) {
        patchNode(nodeId, { status: "error", errorMessage: userFriendlyErrorMessage(e) });
        setGenerateError(userFriendlyErrorMessage(e));
        setGenerating(false);
      }
    },
    [nodes, edges, assets, pid, patchNode, setNodeAsset, startVideoJob],
  );

  const handleNodeAction = useCallback(
    (node: CanvasNode, actionId: string) => {
      const name = (node.data.content as string) || "未命名素材";
      const src = node.data.assetId ? assets[node.data.assetId]?.src : undefined;
      switch (actionId) {
        case "refresh": {
          const gen = node.data.recipe?.generation;
          if (gen) {
            // P2：从 recipe 回填底部栏（prompt+参数经 prefillSignal；首尾帧+参考图是 page 受控）
            const p = recipeToDockPrefill(gen);
            setBottomDockMode(gen.mediaKind === "video" ? "video" : "image");
            if (p.firstFrameUrl !== undefined) setFirstFrameUrl(p.firstFrameUrl);
            if (p.lastFrameUrl !== undefined) setLastFrameUrl(p.lastFrameUrl);
            if (p.references?.length) {
              const items: DockMediaItem[] = p.references.map((r, i) => ({ id: `prefill-${Date.now()}-${i}`, type: r.kind, name: "", src: r.url }));
              if (gen.mediaKind === "video") setVideoDockMedia(items);
              else setImageDockMedia(items);
            }
            setPrefillSignal({ nonce: Date.now(), prefill: p });
          } else {
            setBottomDockMode(node.data.kind === "video" ? "video" : "image");
          }
          setIsBottomDockOpen(true);
          setDockFocusSignal((n) => n + 1);
          break;
        }
        case "shuffle":
        case "image": {
          setBottomDockMode("image");
          setIsBottomDockOpen(true);
          setDockFocusSignal((n) => n + 1);
          if (src) {
            const item: DockMediaItem = { id: node.id, type: "image", name, src };
            setImageDockMedia([item]);
            setDockMentionSignal({ nonce: Date.now(), item: { src, name, id: node.id, type: "image" }, replace: true });
          }
          break;
        }
        case "mention": {
          setIsAgentOpen(true);
          setAgentPendingMention({ name, nonce: Date.now() });
          break;
        }
        case "video":
        case "audio":
        case "extract-audio": {
          // D 跨模态点击式：buildCrossmodalRefill 算 mode + 带参考 media / derived
          const refill = buildCrossmodalRefill(node, actionId, src);
          if (!refill) break;
          if (refill.derived) {
            setGenerateError("提取音频：后端未接入（占位）");
            break;
          }
          if (refill.mode && refill.media) {
            setBottomDockMode(refill.mode);
            setIsBottomDockOpen(true);
            if (refill.mode === "video") setVideoDockMedia([refill.media]);
            else if (refill.mode === "audio") setAudioDockMedia([refill.media]);
          }
          break;
        }
        case "download": {
          if (src) {
            const a = document.createElement("a");
            a.href = src;
            a.download = name || "image";
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          break;
        }
        case "generate": {
          void handleGenerateFromNode(node.id);
          break;
        }
        default:
          break;
      }
    },
    [assets, handleGenerateFromNode],
  );

  // 文本节点 prompt 编辑写回
  const onEditPrompt = useCallback((id: string, text: string) => {
    patchNode(id, { prompt: text });
  }, [patchNode]);

  // 右键/drop 菜单：插节点（+ drop 时连边 source→newNode.prompt）
  const onMenuInsert = useCallback((kind: ContextMenuKind) => {
    if (!menu) return;
    const m = menu;
    setMenu(null);
    const w = kind === "text" ? 200 : 256;
    const h = kind === "text" ? 48 : 200;
    const node: CanvasNode = { id: `n_${Math.random().toString(36).slice(2, 10)}`, type: kind, position: { x: m.x - w / 2, y: m.y - h / 2 }, width: w, height: h, data: { kind } };
    addNodeFull(node);
    const targetHandle = kind === "text" ? undefined : "prompt";
    if (m.source && targetHandle) {
      addEdgeFull({ id: `e_${m.source}_${node.id}`, source: m.source, target: node.id, sourceHandle: m.sourceHandle, targetHandle });
    }
  }, [menu, addNodeFull, addEdgeFull]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pickingFor) setPickingFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingFor]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // 命令式设 accept 再 click：避免 setState 异步导致 accept 未刷新就弹选择框
  const openFilePicker = useCallback((accept: string) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !pid) return;
      e.target.value = "";
      const kind = detectMediaKind(file);
      try {
        const result = await uploadAsset(file, Number(pid), kind);
        const size = await readMediaNaturalSize(result.url, kind);
        const aid = String(result.id);
        addAsset({ id: aid, kind, src: result.url, source: "uploaded" });
        addNode(kind, { width: size.width, height: size.height, data: { content: file.name, status: "done", assetId: aid, recipe: { origin: "uploaded" } } });
      } catch (err) {
        setGenerateError(userFriendlyErrorMessage(err));
      }
    },
    [addNode, addAsset, pid],
  );

  const handleDockLocalUpload = useCallback(
    async (file: File, mode: "image" | "video" | "audio") => {
      if (!pid) return;
      const mediaType = detectMediaKind(file); // image/video/audio 均建画布节点（IJZY0Z 上传落画布）
      try {
        const result = await uploadAsset(file, Number(pid), mediaType);
        const size = await readMediaNaturalSize(result.url, mediaType);
        const aid = String(result.id);
        addAsset({ id: aid, kind: mediaType, src: result.url, source: "uploaded" });
        const id = addNode(mediaType, { width: size.width, height: size.height, data: { content: file.name, status: "done", assetId: aid, recipe: { origin: "uploaded" } } });
        const item: DockMediaItem = { id, type: mediaType, name: file.name, src: result.url, assetId: result.id };
        if (mode === "image") setImageDockMedia((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, item]));
        else if (mode === "audio") setAudioDockMedia((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, item]));
        else setVideoDockMedia((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, item]));
      } catch (e) {
        setGenerateError(userFriendlyErrorMessage(e));
      }
    },
    [addNode, addAsset, pid],
  );

  const handleFrameUpload = useCallback(
    async (file: File, slot: "first" | "last") => {
      if (!pid) return;
      try {
        const result = await uploadAsset(file, Number(pid), "image");
        if (slot === "first") setFirstFrameUrl(result.url);
        else setLastFrameUrl(result.url);
      } catch (e) {
        setGenerateError(userFriendlyErrorMessage(e));
      }
    },
    [pid],
  );

  const handleFrameClear = useCallback((slot: "first" | "last") => {
    if (slot === "first") setFirstFrameUrl(undefined);
    else setLastFrameUrl(undefined);
  }, []);

  const handleSwapFrames = useCallback(() => {
    setFirstFrameUrl(lastFrameUrl);
    setLastFrameUrl(firstFrameUrl);
  }, [firstFrameUrl, lastFrameUrl]);

  const handleGenerate = useCallback(
    async (promptText: string, args: GenerateArgs) => {
      const trimmed = promptText.trim();
      if (!trimmed || !pid) return;
      setGenerating(true);
      setGenerateError(null);
      let placeholderId: string | null = null;
      try {
        if (args.mode === "image") {
          const ar = parseAspectRatio(args.settings.aspectRatio.id);
          const imageRefs: RecipeInput[] = (args.referenceImages ?? imageDockMedia.map((m) => m.src).filter((s): s is string => Boolean(s))).map((u) => ({ kind: "image", url: u }));
          const imageRecipe = buildGenerationRecipe({ mediaKind: "image", model: args.settings.model.id, params: { aspectRatio: args.settings.aspectRatio.id, resolution: args.settings.resolution.id, quantity: parseQuantity(args.settings.quantity) }, inputs: { prompt: { kind: "text", text: trimmed }, references: imageRefs.length ? imageRefs : undefined } });
          placeholderId = addNode("image", { width: ar.width, height: ar.height, data: { content: trimmed, status: "running" } });
          const result = await generateImage({
            prompt: trimmed,
            projectId: Number(pid),
            modelId: args.settings.model.id,
            sizeId: args.settings.resolution.id,
            aspectRatio: args.settings.aspectRatio.id,
            quantity: parseQuantity(args.settings.quantity),
            referenceImages:
              args.referenceImages ??
              imageDockMedia.map((m) => m.src).filter((s): s is string => Boolean(s)),
          });
          if (result.stream && result.jobId != null) {
            streamJob(result.jobId, buildImageStreamHandlers(placeholderId, trimmed, ar.width, ar.height, () => setGenerating(false), imageRecipe));
          } else {
            if (result.url && result.assetId != null) {
              setNodeAsset(placeholderId, String(result.assetId), "image", result.url, "generated", imageRecipe);
            } else {
              updateNode(placeholderId, { status: "error", errorMessage: "未返回图片" });
            }
            setGenerating(false);
          }
        } else if (args.mode === "video") {
          const result = await createVideoJob({
            prompt: trimmed,
            projectId: Number(pid),
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
          const ar = parseAspectRatio(args.settings.aspectRatio.id);
          const vidRefs: RecipeInput[] = [
            ...(args.settings.referenceImages?.map((u) => ({ kind: "image" as const, url: u })) ?? []),
            ...(args.settings.referenceVideos?.map((u) => ({ kind: "video" as const, url: u })) ?? []),
            ...(args.settings.referenceAudios?.map((u) => ({ kind: "audio" as const, url: u })) ?? []),
          ];
          const videoRecipe = buildGenerationRecipe({ mediaKind: "video", model: args.settings.model.id, params: { aspectRatio: args.settings.aspectRatio.id, resolution: args.settings.resolution.id, duration: args.settings.duration, refMode: args.settings.refMode.id }, inputs: { prompt: { kind: "text", text: trimmed }, firstFrame: args.settings.firstFrameUrl ? { kind: "image", url: args.settings.firstFrameUrl } : undefined, lastFrame: args.settings.lastFrameUrl ? { kind: "image", url: args.settings.lastFrameUrl } : undefined, references: vidRefs.length ? vidRefs : undefined } });
          placeholderId = addNode("video", { width: ar.width, height: ar.height, data: { content: trimmed, status: "running", progress: 0, recipe: videoRecipe } });
          startVideoJob(placeholderId, result.jobId);
          setGenerating(false); // 视频转后台轮询，不阻塞后续并发生成
        } else if (args.mode === "audio") {
          // 音频生成（IJZXW7-B）：generateAudio 当前 mock（后端无音频 provider），就绪切真不改签名
          placeholderId = addNode("audio", { width: 240, height: 120, data: { content: trimmed, status: "running" } });
          const result = await generateAudio({
            prompt: trimmed,
            projectId: Number(pid),
            modelId: args.settings.model.id,
            duration: args.settings.duration,
            sampleRate: args.settings.sampleRate,
            format: args.settings.format.id,
          });
          const audioRecipe = buildGenerationRecipe({
            mediaKind: "audio",
            model: args.settings.model.id,
            params: { duration: args.settings.duration, sampleRate: args.settings.sampleRate, format: args.settings.format.id },
            inputs: { prompt: { kind: "text", text: trimmed } },
          });
          setNodeAsset(placeholderId, String(result.assetId), "audio", result.url, "generated", audioRecipe);
          setGenerating(false);
        }
      } catch (e) {
        if (placeholderId && args.mode === "image") updateNode(placeholderId, { status: "error", errorMessage: userFriendlyErrorMessage(e) });
        setGenerateError(userFriendlyErrorMessage(e));
        setGenerating(false);
      }
    },
    [addNode, updateNode, setNodeAsset, buildImageStreamHandlers, imageDockMedia, startVideoJob, pid],
  );

  // 视频 job 进度 / 出图 / 报错已由 useVideoJobs 的 per-job 回调（startVideoJob）驱动，
  // 每个 job 更新自己的 nodeId，多视频并发互不干扰——不再需要单 jobState effect。

  // load：useCanvasDoc 拉画布 → ensureAsset 填 assets → recover processing jobs
  const recoveredRef = useRef<Set<string>>(new Set());
  const recoverProcessingJobs = useCallback(
    async (projectId: string, existingNodeIds: Set<string>) => {
      try {
        const jobs = await listJobs({ projectId: Number(projectId), status: "processing", size: 50 });
        for (const job of jobs) {
          const ph = jobToV2Placeholder(job);
          if (existingNodeIds.has(ph.id)) continue; // 去重：画布已 persist 该 job 占位则跳过（防重复堆积）
          const input = (job.input ?? {}) as { prompt?: string; aspectRatio?: string; resolution?: string; duration?: number; refMode?: string };
          if (ph.kind === "video") {
            // recover recipe（best-effort 从 job.input 重建；model 字段 JobListItem 暂无，留空待后端补）→ 创建即写节点
            const recoverRecipe = buildGenerationRecipe({
              mediaKind: "video",
              model: "",
              params: { aspectRatio: input.aspectRatio ?? "16:9", resolution: input.resolution ?? "720p", duration: input.duration ?? 5, refMode: input.refMode ?? "omni" },
              inputs: { prompt: { kind: "text", text: input.prompt ?? "" } },
            });
            addNode(ph.kind, { id: ph.id, width: ph.width, height: ph.height, data: { ...ph.data, recipe: recoverRecipe } });
            startVideoJob(ph.id, job.jobId); // per-job 独立轮询：多个 processing 视频并发 recover，不再单 ref 覆盖
          } else {
            addNode(ph.kind, { id: ph.id, width: ph.width, height: ph.height, data: ph.data });
            streamJob(job.jobId, buildImageStreamHandlers(ph.id, ph.data.content ?? "", ph.width, ph.height));
          }
        }
      } catch (e) {
        console.warn("[canvas-v2] recover processing jobs failed:", e);
      }
    },
    [addNode, startVideoJob, buildImageStreamHandlers],
  );
  useEffect(() => {
    if (!pid) return;
    if (recoveredRef.current.has(pid)) return;
    recoveredRef.current.add(pid);
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDoc(pid);
        if (cancelled) return;
        await Promise.all(
          d.nodes
            .filter((n) => n.data.assetId)
            .map((n) => ensureAsset(n.data.assetId as string)),
        );
        void recoverProcessingJobs(pid, new Set(d.nodes.map((n) => n.id)));
      } catch (e) {
        console.warn("[canvas-v2] load failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pid, loadDoc, ensureAsset, recoverProcessingJobs]);

  const handleRequestPick = useCallback((mode: "image" | "video" | "audio") => setPickingFor(mode), []);
  const handlePickFrameFromCanvas = useCallback((slot: "first" | "last") => setPickingFor(slot === "first" ? "firstFrame" : "lastFrame"), []);
  const handleExitPick = useCallback(() => setPickingFor(null), []);
  const handlePickNode = useCallback(
    (node: CanvasNode) => {
      const src = node.data.assetId ? assets[node.data.assetId]?.src : undefined;
      if (!src) {
        setPickingFor(null);
        return;
      }
      const item: DockMediaItem = { id: node.id, type: "image", name: (node.data.content as string) || "图片", src };
      if (pickingFor === "image") setImageDockMedia((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item]));
      else if (pickingFor === "video") setVideoDockMedia((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item]));
      else if (pickingFor === "audio") setAudioDockMedia((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item]));
      else if (pickingFor === "firstFrame") setFirstFrameUrl(src);
      else if (pickingFor === "lastFrame") setLastFrameUrl(src);
      setPickingFor(null);
    },
    [pickingFor, assets],
  );
  const handleCanvasNodeClick = useCallback(
    (node: CanvasNode) => {
      if (pickingFor && node.data.assetId) handlePickNode(node);
    },
    [pickingFor, handlePickNode],
  );
  const handleCanvasNodeAction = useCallback(
    (nodeId: string, actionId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) handleNodeAction(node, actionId);
    },
    [nodes, handleNodeAction],
  );
  const handleNodeRetry = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setBottomDockMode(node.data.kind === "video" ? "video" : "image");
      setIsBottomDockOpen(true);
    },
    [nodes],
  );

  const handleCardGenerated = useCallback(
    (card: CardMessage) => {
      const f = cardToV2ImageFields(card);
      addNode("image", { width: f.width, height: f.height, data: { content: f.content, recipe: { origin: "generated" } } });
    },
    [addNode],
  );

  const pickableCount = nodes.filter((n) => n.data.assetId && n.data.status !== "running" && n.data.status !== "error").length;

  const handleToolClick = useCallback(
    (id: string) => {
      if (id === "upload") {
        openFilePicker("image/*,video/*,audio/*");
      } else if (id === "audio") {
        setBottomDockMode("audio");
        setIsBottomDockOpen((open) => (bottomDockMode === "audio" && open ? false : true));
      } else if (id === "ai-image") {
        setBottomDockMode("image");
        setIsBottomDockOpen((open) => (bottomDockMode === "image" && open ? false : true));
      } else if (id === "ai-video") {
        setBottomDockMode("video");
        setIsBottomDockOpen((open) => (bottomDockMode === "video" && open ? false : true));
      } else if (id === "text") {
        addNode("text");
      }
    },
    [addNode, bottomDockMode, openFilePicker],
  );

  if (gated) return null;
  if (booting) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white/60 text-sm">
        加载画布 v2…
      </div>
    );
  }
  if (!activeProject) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-black">
        <p className="text-sm" style={{ color: "var(--tc-text-secondary)" }}>
          {loadError ? "项目加载失败" : "项目不存在"}
        </p>
        {loadError && (
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm transition-colors"
            style={{ background: "var(--tc-bg-surface)", border: "1px solid var(--tc-border-subtle)", color: "var(--tc-text-secondary)" }}
          >
            重试
          </button>
        )}
        <Link
          href="/canvas-v2"
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm transition-colors"
          style={{ background: "var(--tc-accent)", color: "var(--tc-on-accent)" }}
        >
          返回项目列表
        </Link>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
      <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" className="sr-only" onChange={handleFileChange} aria-hidden="true" />
      <TopBar
        activeProject={activeProject}
        projects={projects}
        onSwitch={switchProject}
        onCreate={createProject}
        onDelete={deleteProject}
        onRename={renameProject}
      />
      <TopBarCenter />
      <TopBarRight isAgentOpen={isAgentOpen} onAgentToggle={() => setIsAgentOpen((v) => !v)} />

      <ReactFlowProvider>
        <div ref={containerRef} className="absolute inset-0 z-0">
          <CanvasSurface
            nodes={nodes}
            edges={edges}
            viewport={viewport}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onViewportChange={setViewportAction}
            onNodeClick={handleCanvasNodeClick}
            onPaneClick={handleExitPick}
            onNodeAction={handleCanvasNodeAction}
            onNodeRetry={handleNodeRetry}
            onEditPrompt={onEditPrompt}
            picking={pickingFor !== null}
            pickingAccept={pickingFor ? dockAccept(pickingFor) : undefined}
          />
        </div>
        <ZoomControls />
      </ReactFlowProvider>

      {menu && (
        <ContextMenu
          screenX={menu.screenX}
          screenY={menu.screenY}
          hasSource={!!menu.source}
          onInsert={onMenuInsert}
          onClose={() => setMenu(null)}
        />
      )}

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
      {isBottomDockOpen && (
        <BottomDock
          mode={bottomDockMode}
          onClose={() => setIsBottomDockOpen(false)}
          imageMedia={imageDockMedia}
          videoMedia={videoDockMedia}
          audioMedia={audioDockMedia}
          focusSignal={dockFocusSignal}
          dockMentionSignal={dockMentionSignal}
          prefillSignal={prefillSignal ?? undefined}
          onRemoveImageMedia={(id) => setImageDockMedia((prev) => prev.filter((m) => m.id !== id))}
          onRemoveVideoMedia={(id) => setVideoDockMedia((prev) => prev.filter((m) => m.id !== id))}
          onRemoveAudioMedia={(id) => setAudioDockMedia((prev) => prev.filter((m) => m.id !== id))}
          firstFrameUrl={firstFrameUrl}
          lastFrameUrl={lastFrameUrl}
          onFrameUpload={handleFrameUpload}
          onFrameClear={handleFrameClear}
          onSwapFrames={handleSwapFrames}
          onPickFrameFromCanvas={handlePickFrameFromCanvas}
          onLocalUpload={(file) => handleDockLocalUpload(file, bottomDockMode)}
          onPickFromCanvas={() => handleRequestPick(bottomDockMode)}
          onExitPick={handleExitPick}
          isPicking={pickingFor === bottomDockMode}
          onGenerate={handleGenerate}
          generating={generating}
          generateError={generateError}
          onClearGenerateError={() => setGenerateError(null)}
        />
      )}
      <AgentChatPanel
        key={activeProject.id}
        prompt={prompt}
        messages={messages}
        isOpen={isAgentOpen}
        onClose={() => setIsAgentOpen(false)}
        pendingMention={agentPendingMention}
        onMentionConsumed={() => setAgentPendingMention(null)}
        onCardGenerated={handleCardGenerated}
        onAppendMessages={(msgs: ChatMessage[]) => appendMessages(msgs)}
        onSetCardStatus={(cardId, status) => setCardStatus(cardId, status)}
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
        {backendReady && saveState !== "idle" && (
          <span className="text-xs" style={{ color: "var(--tc-text-muted)" }}>
            {saveState === "saving" ? "保存中…" : "已保存"}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CanvasV2ProjectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-black text-white/60 text-sm">
          加载画布 v2…
        </div>
      }
    >
      <CanvasV2ProjectInner />
    </Suspense>
  );
}

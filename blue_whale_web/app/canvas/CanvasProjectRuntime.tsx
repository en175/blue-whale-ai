"use client";
/**
 * Canvas v2 /[projectId] —— 具体项目画布（projectId 来自 URL 路由）。
 * canvas 数据走 useCanvasDoc hook（React state，本地快，不卡）；assets 走 zustand（业务/接口缓存）。
 * 切项目 = router.push；load 按 URL projectId 触发。
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import { useAuth } from "@/components/auth/AuthContext";
import { loadUser, SKIP_AUTH } from "@/components/auth/authStorage";
import { toast } from "@/components/Toast";
import { uploadAsset } from "@/lib/assets";
import { UPLOAD_ACCEPT, selectUploadFiles } from "@/lib/uploadRules";

import { useCanvasStore } from "./_canvas/store";
import { uploadMediaToCanvas } from "./_canvas/uploadMedia";
import { useCanvasDoc } from "./_canvas/v2/useCanvasDoc";
import type { CanvasNode, CanvasNodeData, NodeKindId } from "./_canvas/model";
import { CanvasSurface } from "./_canvas/v2/CanvasSurface";
import type { MenuPayload } from "./_canvas/v2/CanvasSurface";
import { ContextMenu, type ContextMenuKind } from "./_canvas/v2/ContextMenu";
import { effectiveToolMode, type ToolMode } from "./_canvas/v2/toolMode";
import { useSpaceHeld } from "./_canvas/v2/useSpaceHeld";
import { useV2Projects } from "./_canvas/v2/useV2Projects";
import {
  buildCrossmodalRefill,
  canvasNodeToDockMedia,
  cardToV2ImageFields,
  recipeToDockPrefill,
} from "./_canvas/v2/mappers";
import { findPlacement, type Rect } from "./_canvas/placement";
import { dockAccept, dockPickHint } from "./_canvas/utils";
import { useCanvasGeneration } from "./_canvas/hooks/useCanvasGeneration";
import { useCanvasProjectHydration } from "./_canvas/hooks/useCanvasProjectHydration";
import type { MentionItem } from "./_canvas/components/dock/mention";
import {
  TopBar,
  TopBarCenter,
  TopBarRight,
  LeftToolbar,
  BottomDock,
  AgentChatPanel,
  ZoomControls,
} from "./_canvas";
import { ToolbarFlyout } from "./_canvas/components/ToolbarFlyout";
import { AUDIO_FLYOUT_ITEMS } from "./_canvas/config";
import type { DockMediaItem, GenerateArgs, PrefillSignal } from "./_canvas";
import type { CardMessage, ChatMessage } from "./_canvas";
import { canonicalCanvasHref } from "./canonical-project";

function userFriendlyErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return "生成失败，请稍后重试";
  const msg = e.message;
  if (msg.includes("后端未启动") || msg.includes("无法连接"))
    return "无法连接到服务，请检查网络或稍后重试";
  if (msg.includes("ARK_API_KEY") || msg.includes("数据库"))
    return "服务暂时不可用，请稍后重试";
  return "生成失败，请稍后重试";
}

export function CanvasProjectRuntime({
  projectId: pid,
}: {
  projectId: string;
}) {
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
    // Authentication is read from external storage after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const {
    nodes,
    edges,
    viewport,
    saveState,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNodeFull,
    addEdgeFull,
    patchNode,
    resizeNode,
    patchNodeAndSave,
    setViewport: setViewportAction,
    load: loadDoc,
  } = useCanvasDoc();
  const assets = useCanvasStore((s) => s.assets);
  const addAsset = useCanvasStore((s) => s.addAsset);

  const switchProject = useCallback(
    (id: string) => {
      router.push(canonicalCanvasHref(id));
    },
    [router],
  );
  const createProject = useCallback(async () => {
    const id = await createProjectAction();
    if (id) router.push(canonicalCanvasHref(id));
  }, [createProjectAction, router]);
  const deleteProject = useCallback(
    async (id: string) => {
      await deleteProjectAction(id);
      if (id === pid) router.replace("/canvas");
    },
    [deleteProjectAction, pid, router],
  );

  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [isBottomDockOpen, setIsBottomDockOpen] = useState(false);
  /** 曾打开即常驻挂载（keep-alive）：关闭仅 display:none 隐藏，
   *  BottomDock 内 prompt/mentions 与各面板设置 state 原样保留（IK55VF） */
  const [dockEverOpened, setDockEverOpened] = useState(false);
  // keep-alive 闩锁：任何路径打开过 Dock 即置位（render 期调整 state 的官方模式）
  if (isBottomDockOpen && !dockEverOpened) setDockEverOpened(true);
  const [bottomDockMode, setBottomDockMode] = useState<
    "image" | "video" | "audio"
  >("image");
  /** 音频按钮悬浮列表锚点（IK55VM）：非 null 即展开；再点按钮/点外/Esc 关闭。 */
  const [audioFlyoutAnchor, setAudioFlyoutAnchor] =
    useState<HTMLButtonElement | null>(null);
  /** 悬浮列表点选 → BottomDock 音频子模式切换信号（仿 prefillSignal nonce 模式）。 */
  const [audioModeSignal, setAudioModeSignal] = useState<{
    nonce: number;
    subMode: "audio" | "music";
  }>({ nonce: 0, subMode: "audio" });
  const [imageDockMedia, setImageDockMedia] = useState<DockMediaItem[]>([]);
  const [dockFocusSignal, setDockFocusSignal] = useState(0);
  /** 重新编辑预填（P2）：recipe.generation → Dock 参数回填信号 */
  const [prefillSignal, setPrefillSignal] = useState<PrefillSignal | null>(
    null,
  );
  const [dockMentionSignal, setDockMentionSignal] = useState<{
    nonce: number;
    item: MentionItem | null;
    replace?: boolean;
  }>({
    nonce: 0,
    item: null,
  });
  const [videoDockMedia, setVideoDockMedia] = useState<DockMediaItem[]>([]);
  const [audioDockMedia, setAudioDockMedia] = useState<DockMediaItem[]>([]);
  const [firstFrameUrl, setFirstFrameUrl] = useState<string | undefined>(
    undefined,
  );
  const [lastFrameUrl, setLastFrameUrl] = useState<string | undefined>(
    undefined,
  );
  const [firstFrameAssetId, setFirstFrameAssetId] = useState<
    number | undefined
  >(undefined);
  const [lastFrameAssetId, setLastFrameAssetId] = useState<number | undefined>(
    undefined,
  );
  const [agentPendingMention, setAgentPendingMention] = useState<{
    name: string;
    nonce: number;
  } | null>(null);
  const [pickingFor, setPickingFor] = useState<
    | "image"
    | "video"
    | "audio"
    | "firstFrame"
    | "lastFrame"
    | "audioRef"
    | "audioImageRef"
    | null
  >(null);
  const [menu, setMenu] = useState<MenuPayload | null>(null);

  // IK55VD 工具模式：持久模式不持久化；按住空格临时切入抓手，有效模式 = 持久 OR 空格
  const [toolMode, setToolMode] = useState<ToolMode>("mouse");
  const spaceHeld = useSpaceHeld();
  const effectiveMode = effectiveToolMode(toolMode, spaceHeld);

  /** 上传失败重试/移除用：nodeId → 原 File + 本地预览 object URL（成功后 revoke 并删条目）。 */
  const uploadFilesRef = useRef(
    new Map<string, { file: File; previewUrl: string }>(),
  );
  /** 同一 tick 内连续 addNode（多选上传）时，nodes state 尚未更新，已放占位累积在此防重叠。 */
  const extraPlacedRef = useRef<Rect[]>([]);
  useEffect(() => {
    extraPlacedRef.current = [];
  }, [nodes]);
  // IK55VH findPlacement 的 existing 矩形投影（addNode/onMenuInsert 共用）
  const existingRects = useCallback(
    () =>
      nodes.map((n) => ({
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? 200,
        height: n.height ?? 200,
      })),
    [nodes],
  );

  const addNode = useCallback(
    (
      kind: NodeKindId,
      extra?: {
        id?: string;
        width?: number;
        height?: number;
        data?: Partial<CanvasNodeData>;
      },
    ): string => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      const worldX = (cx - viewport.x) / viewport.zoom;
      const worldY = (cy - viewport.y) / viewport.zoom;
      const w = extra?.width ?? (kind === "text" ? 200 : 256);
      const h = extra?.height ?? (kind === "text" ? 48 : 200);
      const id = extra?.id ?? `n_${Math.random().toString(36).slice(2, 10)}`;
      // IK55VH：text 与媒体同路径走 findPlacement 网格（视口中心锚，多次点击不重叠）；
      // 同一 tick 内多选上传的占位还没进 nodes state，用 extraPlacedRef 补齐防重叠
      const position = findPlacement({
        existing: [...existingRects(), ...extraPlacedRef.current],
        anchor: { x: worldX, y: worldY },
        nodeWidth: w,
        nodeHeight: h,
      });
      extraPlacedRef.current.push({
        x: position.x,
        y: position.y,
        width: w,
        height: h,
      });
      const node: CanvasNode = {
        id,
        type: kind,
        position,
        width: w,
        height: h,
        data: { kind, ...(extra?.data ?? {}) },
      };
      addNodeFull(node);
      return id;
    },
    [existingRects, viewport, addNodeFull],
  );

  // 生成业务（generate/generateFromNode/recover + job 轮询）抽到 useCanvasGeneration（ADR-0027）；
  // page 只调 hook 暴露的 API，不接触 setNodeAsset/startVideoJob/buildImageStreamHandlers/useVideoJobs。
  const {
    generate,
    generateFromNode,
    hydrate,
    generating,
    generateError,
    setGenerateError,
  } = useCanvasGeneration({
    nodes,
    edges,
    assets,
    addNode,
    patchNode,
    patchNodeAndSave,
    addAsset,
    projectId: pid,
  });

  const handleNodeAction = useCallback(
    (node: CanvasNode, actionId: string) => {
      const name = (node.data.content as string) || "未命名素材";
      const src = node.data.assetId
        ? assets[node.data.assetId]?.src
        : undefined;
      switch (actionId) {
        case "refresh": {
          const gen = node.data.recipe?.generation;
          if (gen) {
            // P2：从 recipe 回填底部栏（prompt+参数经 prefillSignal；首尾帧+参考图是 page 受控）
            const p = recipeToDockPrefill(gen);
            setBottomDockMode(gen.mediaKind === "video" ? "video" : "image");
            setFirstFrameUrl(p.firstFrameUrl);
            setLastFrameUrl(p.lastFrameUrl);
            const firstFrameId = Number(p.firstFrameAssetId);
            const lastFrameId = Number(p.lastFrameAssetId);
            setFirstFrameAssetId(
              Number.isSafeInteger(firstFrameId) && firstFrameId > 0
                ? firstFrameId
                : undefined,
            );
            setLastFrameAssetId(
              Number.isSafeInteger(lastFrameId) && lastFrameId > 0
                ? lastFrameId
                : undefined,
            );
            const items: DockMediaItem[] = (p.references ?? []).map((r, i) => ({
              id: `prefill-${Date.now()}-${i}`,
              type: r.kind,
              name: "",
              src: r.url,
              assetId: r.assetId,
            }));
            if (gen.mediaKind === "video") setVideoDockMedia(items);
            else setImageDockMedia(items);
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
            const item: DockMediaItem = {
              id: node.id,
              type: "image",
              name,
              src,
              assetId: node.data.assetId,
            };
            setImageDockMedia([item]);
            setDockMentionSignal({
              nonce: Date.now(),
              item: {
                src,
                name,
                id: node.id,
                type: "image",
                assetId: node.data.assetId
                  ? Number(node.data.assetId)
                  : undefined,
              },
              replace: true,
            });
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
            const media = { ...refill.media, assetId: node.data.assetId };
            if (refill.mode === "video") setVideoDockMedia([media]);
            else if (refill.mode === "audio") setAudioDockMedia([media]);
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
          void generateFromNode(node.id);
          break;
        }
        default:
          break;
      }
    },
    [assets, generateFromNode, setGenerateError],
  );

  // IK55VH 富文本卡 commit：richDoc 存文档，派生纯文本沿用 prompt 字段（连线进下游 prompt，engine/kinds 不动）
  const onEditRichText = useCallback(
    (id: string, richDoc: unknown, plainText: string) => {
      patchNode(id, { richDoc, prompt: plainText });
    },
    [patchNode],
  );

  // IK55VH 富文本卡 @ 建议素材：画布内 image/video/audio 节点投影
  const textMentionItems = useMemo(
    () =>
      nodes
        .filter(
          (n) =>
            n.data.kind === "image" ||
            n.data.kind === "video" ||
            n.data.kind === "audio",
        )
        .map((n) => ({
          id: n.id,
          type: n.data.kind as "image" | "video" | "audio",
          name: (n.data.content as string) || "未命名素材",
          assetId: n.data.assetId,
        })),
    [nodes],
  );

  // 右键/drop 菜单：插节点（+ drop 时连边 source→newNode.prompt）
  const onMenuInsert = useCallback(
    (kind: ContextMenuKind) => {
      if (!menu) return;
      const m = menu;
      setMenu(null);
      const w = kind === "text" ? 200 : 256;
      const h = kind === "text" ? 48 : 200;
      const node: CanvasNode = {
        id: `n_${Math.random().toString(36).slice(2, 10)}`,
        type: kind,
        // IK55VH：仅文本卡走 findPlacement 网格（菜单点锚，不重叠）；媒体保持菜单点精确落位
        position:
          kind === "text"
            ? findPlacement({
                existing: existingRects(),
                anchor: { x: m.x, y: m.y },
                nodeWidth: w,
                nodeHeight: h,
              })
            : { x: m.x - w / 2, y: m.y - h / 2 },
        width: w,
        height: h,
        data: { kind },
      };
      addNodeFull(node);
      const targetHandle = kind === "text" ? undefined : "prompt";
      if (m.source && targetHandle) {
        addEdgeFull({
          id: `e_${m.source}_${node.id}`,
          source: m.source,
          target: node.id,
          sourceHandle: m.sourceHandle,
          targetHandle,
        });
      }
    },
    [menu, existingRects, addNodeFull, addEdgeFull],
  );

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

  const uploadCanvasMedia = useCallback(
    (file: File) => {
      const previewUrl = URL.createObjectURL(file);
      const pending = uploadMediaToCanvas({
        file,
        projectId: Number(pid),
        previewUrl,
        addNode,
        patchNode,
        resizeNode,
        addAsset,
        onError: setGenerateError,
      });
      // 成功：revoke 预览 URL 并弃 File；失败：留存 File+URL 供错误卡重试/移除
      void pending.then((result) => {
        if (result.asset) {
          URL.revokeObjectURL(previewUrl);
          uploadFilesRef.current.delete(result.nodeId);
        } else {
          uploadFilesRef.current.set(result.nodeId, { file, previewUrl });
        }
      });
      return pending;
    },
    [addAsset, addNode, patchNode, pid, resizeNode, setGenerateError],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (!files.length || !pid) return;
      // 白名单+大小校验：合法逐个上传落画布，非法 toast 拒绝（不发请求）
      selectUploadFiles(files, {
        upload: (file) => {
          void uploadCanvasMedia(file);
        },
        reject: (reason) => toast.error(reason),
      });
    },
    [pid, uploadCanvasMedia],
  );

  const handleDockLocalUpload = useCallback(
    async (file: File, mode: "image" | "video" | "audio") => {
      if (!pid) return;
      const result = await uploadCanvasMedia(file);
      if (!result.asset) return;
      const item: DockMediaItem = {
        id: result.nodeId,
        type: result.asset.kind,
        name: file.name,
        src: result.asset.url,
        assetId: result.asset.id,
      };
      if (mode === "image")
        setImageDockMedia((prev) =>
          prev.some((m) => m.id === result.nodeId) ? prev : [...prev, item],
        );
      else if (mode === "audio")
        setAudioDockMedia((prev) =>
          prev.some((m) => m.id === result.nodeId) ? prev : [...prev, item],
        );
      else
        setVideoDockMedia((prev) =>
          prev.some((m) => m.id === result.nodeId) ? prev : [...prev, item],
        );
    },
    [pid, uploadCanvasMedia],
  );

  const handleFrameUpload = useCallback(
    async (file: File, slot: "first" | "last") => {
      if (!pid) return;
      try {
        const result = await uploadAsset(file, Number(pid), "image");
        const assetId = Number(result.id);
        if (slot === "first") {
          setFirstFrameUrl(result.url);
          setFirstFrameAssetId(
            Number.isSafeInteger(assetId) ? assetId : undefined,
          );
        } else {
          setLastFrameUrl(result.url);
          setLastFrameAssetId(
            Number.isSafeInteger(assetId) ? assetId : undefined,
          );
        }
      } catch (e) {
        setGenerateError(userFriendlyErrorMessage(e));
      }
    },
    [pid, setGenerateError],
  );

  const handleFrameClear = useCallback((slot: "first" | "last") => {
    if (slot === "first") {
      setFirstFrameUrl(undefined);
      setFirstFrameAssetId(undefined);
    } else {
      setLastFrameUrl(undefined);
      setLastFrameAssetId(undefined);
    }
  }, []);

  const handleSwapFrames = useCallback(() => {
    setFirstFrameUrl(lastFrameUrl);
    setLastFrameUrl(firstFrameUrl);
    setFirstFrameAssetId(lastFrameAssetId);
    setLastFrameAssetId(firstFrameAssetId);
  }, [firstFrameUrl, lastFrameUrl, firstFrameAssetId, lastFrameAssetId]);

  // Dock 生成经 hook.generate；image 参考图 fallback（Dock media → referenceImages）由 page 注入
  // （hook 不持有 imageDockMedia UI state）。其余 mode 原样透传。
  const handleGenerate = useCallback(
    (promptText: string, args: GenerateArgs) => {
      if (args.mode === "image" && !args.referenceImages) {
        return generate(promptText, {
          ...args,
          referenceImages: imageDockMedia
            .map((m) => m.src)
            .filter((s): s is string => Boolean(s)),
        });
      }
      return generate(promptText, args);
    },
    [generate, imageDockMedia],
  );

  // 视频 job 进度 / 出图 / 报错已由 useVideoJobs 的 per-job 回调（startVideoJob）驱动，
  // 每个 job 更新自己的 nodeId，多视频并发互不干扰——不再需要单 jobState effect。

  const [hydrationRetryKey, setHydrationRetryKey] = useState(0);
  const hydrationState = useCanvasProjectHydration({
    projectId: pid,
    loadDoc,
    hydrate,
    retryKey: hydrationRetryKey,
  });

  const handleRequestPick = useCallback(
    (mode: "image" | "video" | "audio") => setPickingFor(mode),
    [],
  );
  const handlePickFrameFromCanvas = useCallback(
    (slot: "first" | "last") =>
      setPickingFor(slot === "first" ? "firstFrame" : "lastFrame"),
    [],
  );
  const handleExitPick = useCallback(() => setPickingFor(null), []);
  const handlePickNode = useCallback(
    (node: CanvasNode) => {
      const src = node.data.assetId
        ? assets[node.data.assetId]?.src
        : undefined;
      if (!src) {
        setPickingFor(null);
        return;
      }
      const item = canvasNodeToDockMedia(node, src);
      if (!item) {
        setPickingFor(null);
        return;
      }
      if (pickingFor === "image")
        setImageDockMedia((prev) =>
          prev.some((m) => m.id === item.id) ? prev : [...prev, item],
        );
      else if (pickingFor === "video")
        setVideoDockMedia((prev) =>
          prev.some((m) => m.id === item.id) ? prev : [...prev, item],
        );
      else if (
        pickingFor === "audio" ||
        pickingFor === "audioRef" ||
        pickingFor === "audioImageRef"
      )
        setAudioDockMedia((prev) =>
          prev.some((m) => m.id === item.id) ? prev : [...prev, item],
        );
      else if (pickingFor === "firstFrame") {
        setFirstFrameUrl(src);
        setFirstFrameAssetId(
          node.data.assetId ? Number(node.data.assetId) : undefined,
        );
      } else if (pickingFor === "lastFrame") {
        setLastFrameUrl(src);
        setLastFrameAssetId(
          node.data.assetId ? Number(node.data.assetId) : undefined,
        );
      }
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
      // 上传失败卡：用留存的 File 原地重传（不新建节点）；其余维持打开底部 Dock
      const entry = uploadFilesRef.current.get(nodeId);
      if (node.data.recipe?.origin === "uploaded" && entry) {
        const pending = uploadMediaToCanvas({
          file: entry.file,
          projectId: Number(pid),
          existingNodeId: nodeId,
          previewUrl: entry.previewUrl,
          addNode,
          patchNode,
          resizeNode,
          addAsset,
          onError: setGenerateError,
        });
        void pending.then((result) => {
          if (result.asset) {
            URL.revokeObjectURL(entry.previewUrl);
            uploadFilesRef.current.delete(nodeId);
          }
        });
        return;
      }
      setBottomDockMode(node.data.kind === "video" ? "video" : "image");
      setIsBottomDockOpen(true);
    },
    [nodes, pid, addNode, patchNode, resizeNode, addAsset, setGenerateError],
  );

  /** 上传错误卡「移除」：删节点 + 清留存的 File/预览 URL。 */
  const handleNodeRemove = useCallback(
    (nodeId: string) => {
      const entry = uploadFilesRef.current.get(nodeId);
      if (entry) {
        URL.revokeObjectURL(entry.previewUrl);
        uploadFilesRef.current.delete(nodeId);
      }
      onNodesChange([{ type: "remove", id: nodeId }]);
    },
    [onNodesChange],
  );

  const handleCardGenerated = useCallback(
    (card: CardMessage) => {
      const f = cardToV2ImageFields(card);
      addNode("image", {
        width: f.width,
        height: f.height,
        data: { content: f.content, recipe: { origin: "generated" } },
      });
    },
    [addNode],
  );

  const pickableCount = nodes.filter(
    (n) =>
      n.data.assetId &&
      n.data.status !== "running" &&
      n.data.status !== "error",
  ).length;

  const handleToolClick = useCallback(
    (id: string, el?: HTMLButtonElement) => {
      if (id === "select") {
        setToolMode((m) => (m === "mouse" ? "hand" : "mouse"));
      } else if (id === "upload") {
        openFilePicker(UPLOAD_ACCEPT);
      } else if (id === "audio") {
        // IK55VM：音频按钮不再直开 Dock，而是 toggle 悬浮列表（音频生成/AI 音乐）
        setAudioFlyoutAnchor((a) => (a ? null : (el ?? null)));
      } else if (id === "ai-image") {
        setBottomDockMode("image");
        setIsBottomDockOpen((open) =>
          bottomDockMode === "image" && open ? false : true,
        );
      } else if (id === "ai-video") {
        setBottomDockMode("video");
        setIsBottomDockOpen((open) =>
          bottomDockMode === "video" && open ? false : true,
        );
      } else if (id === "text") {
        addNode("text");
      }
    },
    [addNode, bottomDockMode, openFilePicker],
  );

  /** 悬浮列表点选（IK55VM）：开 Dock 到 audio 模式并切到对应子面板（经 signal 通知 BottomDock）。 */
  const handleAudioFlyoutSelect = useCallback((subMode: "audio" | "music") => {
    setAudioFlyoutAnchor(null);
    setBottomDockMode("audio");
    setAudioModeSignal((s) => ({ nonce: s.nonce + 1, subMode }));
    setIsBottomDockOpen(true);
  }, []);

  /** 音频参考槽画布选取（IK55VM）：audioRef=音频节点，audioImageRef=图片节点。 */
  const handlePickAudioSlot = useCallback(
    (slot: "audioRef" | "audioImageRef") => setPickingFor(slot),
    [],
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
            style={{
              background: "var(--tc-bg-surface)",
              border: "1px solid var(--tc-border-subtle)",
              color: "var(--tc-text-secondary)",
            }}
          >
            重试
          </button>
        )}
        <Link
          href="/canvas"
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm transition-colors"
          style={{
            background: "var(--tc-accent)",
            color: "var(--tc-on-accent)",
          }}
        >
          返回项目列表
        </Link>
      </div>
    );
  }
  if (hydrationState !== "ready") {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-black">
        <p className="text-sm text-[var(--tc-text-secondary)]">
          {hydrationState === "error" ? "画布加载失败" : "正在加载画布…"}
        </p>
        {hydrationState === "error" && (
          <button
            type="button"
            onClick={() => setHydrationRetryKey((value) => value + 1)}
            className="inline-flex h-9 items-center rounded-full border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-4 text-sm text-[var(--tc-text-secondary)] transition-colors hover:text-[var(--tc-text-primary)]"
          >
            重试
          </button>
        )}
        <Link
          href="/canvas"
          className="inline-flex h-9 items-center rounded-full bg-[var(--tc-accent)] px-4 text-sm text-[var(--tc-on-accent)]"
        >
          返回项目列表
        </Link>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
      <input
        ref={fileInputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden="true"
      />
      <TopBar
        activeProject={activeProject}
        projects={projects}
        onSwitch={switchProject}
        onCreate={createProject}
        onDelete={deleteProject}
        onRename={renameProject}
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
            onNodeRemove={handleNodeRemove}
            onEditRichText={onEditRichText}
            mentionItems={textMentionItems}
            picking={pickingFor !== null}
            pickingAccept={pickingFor ? dockAccept(pickingFor) : undefined}
            toolMode={effectiveMode}
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

      <LeftToolbar
        onToolClick={handleToolClick}
        handActive={effectiveMode === "hand"}
      />
      {/* 音频按钮悬浮列表（IK55VM）：音频生成/AI 音乐；资产库/商品卡后续票复用 ToolbarFlyout */}
      <ToolbarFlyout
        open={audioFlyoutAnchor !== null}
        anchor={audioFlyoutAnchor}
        items={AUDIO_FLYOUT_ITEMS}
        onSelect={(id) => handleAudioFlyoutSelect(id as "audio" | "music")}
        onClose={() => setAudioFlyoutAnchor(null)}
        ariaLabel="音频功能"
      />
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
            {pickingFor ? dockPickHint(pickingFor, pickableCount) : null}
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
      {dockEverOpened && (
        <div style={{ display: isBottomDockOpen ? "contents" : "none" }}>
          <BottomDock
            mode={bottomDockMode}
            onClose={() => setIsBottomDockOpen(false)}
            imageMedia={imageDockMedia}
            videoMedia={videoDockMedia}
            audioMedia={audioDockMedia}
            focusSignal={dockFocusSignal}
            dockMentionSignal={dockMentionSignal}
            prefillSignal={prefillSignal ?? undefined}
            onRemoveImageMedia={(id) =>
              setImageDockMedia((prev) => prev.filter((m) => m.id !== id))
            }
            onRemoveVideoMedia={(id) =>
              setVideoDockMedia((prev) => prev.filter((m) => m.id !== id))
            }
            onRemoveAudioMedia={(id) =>
              setAudioDockMedia((prev) => prev.filter((m) => m.id !== id))
            }
            firstFrameUrl={firstFrameUrl}
            lastFrameUrl={lastFrameUrl}
            firstFrameAssetId={firstFrameAssetId}
            lastFrameAssetId={lastFrameAssetId}
            onFrameUpload={handleFrameUpload}
            onFrameClear={handleFrameClear}
            onSwapFrames={handleSwapFrames}
            onPickFrameFromCanvas={handlePickFrameFromCanvas}
            onLocalUpload={(file) =>
              handleDockLocalUpload(file, bottomDockMode)
            }
            onPickFromCanvas={() => handleRequestPick(bottomDockMode)}
            onPickAudioSlot={handlePickAudioSlot}
            onExitPick={handleExitPick}
            isPicking={
              pickingFor === bottomDockMode ||
              pickingFor === "audioRef" ||
              pickingFor === "audioImageRef"
            }
            audioModeSignal={audioModeSignal}
            onGenerate={handleGenerate}
            generating={generating}
            generateError={generateError}
            onClearGenerateError={() => setGenerateError(null)}
          />
        </div>
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
          style={{
            background: "var(--tc-bg-surface)",
            border: "1px solid var(--tc-menu-pill-border)",
          }}
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

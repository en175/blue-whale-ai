"use client";
/**
 * Canvas v2 /[projectId] —— 具体项目画布（projectId 来自 URL 路由）。
 * canvas 数据走 useCanvasDoc hook（React state，本地快，不卡）；assets 走 zustand（业务/接口缓存）。
 * 切项目 = router.push；load 按 URL projectId 触发。
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { loadUser, SKIP_AUTH } from "@/components/auth/authStorage";
import { toast } from "@/components/Toast";
import { deleteSceneCard } from "@/lib/conversation";
import { wireInteger, type WireInteger } from "@/lib/wire-integer";

import { useCanvasStore } from "./_canvas/store";
import { useCanvasDoc } from "./_canvas/v2/useCanvasDoc";
import { useCanvasUploads } from "./_canvas/runtime/use-canvas-uploads";
import { useNodeActions } from "./_canvas/runtime/use-node-actions";
import { useAddNode } from "./_canvas/runtime/use-add-node";
import { useCanvasSurfaceRuntime } from "./_canvas/runtime/use-canvas-surface-runtime";
import {
  useNodeClipboard,
  type CanvasNodeMenu,
} from "./_canvas/runtime/use-node-clipboard";
import {
  useCanvasPicking,
  type PickingTarget,
} from "./_canvas/runtime/use-canvas-picking";
import { useDockGeneration } from "./_canvas/runtime/use-dock-generation";
import { useToolbarActions } from "./_canvas/runtime/use-toolbar-actions";
import { useReferenceCardHandlers } from "./_canvas/runtime/use-reference-card";
import { effectiveToolMode, type ToolMode } from "./_canvas/v2/toolMode";
import { useSpaceHeld } from "./_canvas/v2/useSpaceHeld";
import { useV2Projects } from "./_canvas/v2/useV2Projects";
import { useProjectConversation } from "./_canvas/hooks/useProjectConversation";
import { useAgentMvpConversation } from "./_canvas/hooks/useAgentMvpConversation";
import { projectSnapshotToSceneCards } from "./_canvas/conversationRecovery";
import type { Rect } from "./_canvas/placement";
import { useCanvasGeneration } from "./_canvas/hooks/useCanvasGeneration";
import { useHomeJumpConsumer } from "./_canvas/runtime/use-home-jump-consumer";
import { useCanvasProjectHydration } from "./_canvas/hooks/useCanvasProjectHydration";
import { BootProgress } from "./BootProgress";
import type { MentionItem } from "./_canvas/components/dock/mention";
import type { ReferenceCardType } from "./_canvas/model";
import type {
  CanvasMenuPayload,
  DockMediaItem,
  PendingMentionBatch,
  PrefillSignal,
} from "./_canvas";
import type { ChatMessage } from "./_canvas";
import {
  CanvasRuntimeView,
  HydrationErrorShell,
  ProjectUnavailableShell,
} from "./_canvas/components/CanvasRuntimeView";
import { canonicalCanvasHref } from "./canonical-project";

export function CanvasProjectRuntime({
  projectId: pid,
}: {
  projectId: string;
}) {
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt") || "";
  // IK74TX 1.1/1.2/1.3：首页输入框跳转参数（tab 存在才算首页跳转；否则为普通画布访问）。
  // 项目由 page.tsx 新建后保留全部 query 参数跳转至此，本组件一次性消费。
  const homeJump: {
    tab: "video" | "image" | "agent";
    prompt?: string;
    model?: string;
    ratio?: string;
    size?: string;
    duration?: string;
    refMode?: string;
    assets?: string[];
    skill?: string;
    agentModel?: string;
  } | null = (() => {
    const tab = searchParams.get("tab");
    if (tab !== "video" && tab !== "image" && tab !== "agent") return null;
    const assets = (searchParams.get("assets") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return {
      tab,
      prompt: searchParams.get("prompt") ?? "",
      model: searchParams.get("model") ?? undefined,
      ratio: searchParams.get("ratio") ?? undefined,
      size: searchParams.get("size") ?? undefined,
      duration: searchParams.get("duration") ?? undefined,
      refMode: searchParams.get("refMode") ?? undefined,
      assets,
      skill: searchParams.get("skill") ?? undefined,
      agentModel: searchParams.get("agentModel") ?? undefined,
    };
  })();
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

  // 持久化 Conversation 接线（IK67GD T02）：后端可用时消息权威来自 Snapshot/SSE，
  // 提交走公开接纳 API；后端不可达时保留既有离线 mock（messages 内存态 + 无 onSubmitMessage）。
  const {
    snapshot: projectSnapshot,
    answerableActive,
    agentRunDisplay,
    applyPlan,
  } = useProjectConversation(pid, backendReady);
  const agentMvp = useAgentMvpConversation(pid);

  // 场景卡快照投影（spec §6.2）：注入画布，SceneCardNode 按 data.sceneCardId 查正文
  const sceneCards = useMemo(
    () =>
      backendReady && projectSnapshot
        ? projectSnapshotToSceneCards(projectSnapshot)
        : [],
    [backendReady, projectSnapshot],
  );

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
    removeNodeAndSave,
    setViewport: setViewportAction,
    load: loadDoc,
    // IK76K1：撤销/重做
    pushUndo,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCanvasDoc();
  const assets = useCanvasStore((s) => s.assets);
  const addAsset = useCanvasStore((s) => s.addAsset);
  const ensureAsset = useCanvasStore((s) => s.ensureAsset);

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
  const handleDeleteSceneCard = useCallback(
    async (nodeId: string, sceneCardId: string) => {
      try {
        await deleteSceneCard(wireInteger(sceneCardId), crypto.randomUUID());
      } catch {
        toast.error("场景卡删除失败，请重试");
        return false;
      }
      const removed = await removeNodeAndSave(nodeId);
      if (!removed) {
        toast.error("场景卡已删除，但画布保存冲突；节点已标记为不可用");
      }
      return removed;
    },
    [removeNodeAndSave],
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
  /** 资产库按钮悬浮列表锚点（IK55VS）：语义同音频锚点。 */
  const [assetFlyoutAnchor, setAssetFlyoutAnchor] =
    useState<HTMLButtonElement | null>(null);
  /** 商品卡按钮悬浮列表锚点（IK55VZ）：新建商品/导入商品。 */
  const [productFlyoutAnchor, setProductFlyoutAnchor] =
    useState<HTMLButtonElement | null>(null);
  /** 卡片库（共享资产）选择器开关（IK55VX）。 */
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  /** 选择器类型筛选（IK55VZ「导入商品」传 ["product"]；资产库入口为 undefined=全部）。 */
  const [cardPickerFilter, setCardPickerFilter] = useState<
    ReferenceCardType[] | undefined
  >(undefined);
  /** 悬浮列表点选 → BottomDock 音频子模式切换信号（仿 prefillSignal nonce 模式）。 */
  const [audioModeSignal, setAudioModeSignal] = useState<{
    nonce: number;
    subMode: "audio" | "music";
  }>({ nonce: 0, subMode: "audio" });
  const [imageDockMedia, setImageDockMedia] = useState<DockMediaItem[]>([]);
  const [dockFocusSignal, setDockFocusSignal] = useState(0);
  // IK6M68：节点「信息」按钮详情弹窗（消除空操作）
  const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
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
    WireInteger | undefined
  >(undefined);
  const [lastFrameAssetId, setLastFrameAssetId] = useState<
    WireInteger | undefined
  >(undefined);
  const [agentPendingMention, setAgentPendingMention] =
    useState<PendingMentionBatch | null>(null);
  const [pickingFor, setPickingFor] = useState<PickingTarget>(null);
  const [menu, setMenu] = useState<CanvasMenuPayload | null>(null);
  const [nodeMenu, setNodeMenu] = useState<CanvasNodeMenu | null>(null);

  // IK55VD 工具模式：持久模式不持久化；按住空格临时切入抓手，有效模式 = 持久 OR 空格
  const [toolMode, setToolMode] = useState<ToolMode>("mouse");
  const spaceHeld = useSpaceHeld();
  const effectiveMode = effectiveToolMode(toolMode, spaceHeld);

  /** 上传失败重试/移除用：nodeId → 原 File + 本地预览 object URL（成功后 revoke 并删条目）。 */
  const uploadFilesRef = useRef(
    new Map<string, { file: File; previewUrl: string }>(),
  );
  /** IK55VT 通道三：参考卡「生成图片」目标节点 id（一次性消费；无预填开 Dock 时武装）。 */
  const referenceGenTargetRef = useRef<string | null>(null);
  const consumeReferenceGenTarget = useCallback(() => {
    const target = referenceGenTargetRef.current;
    referenceGenTargetRef.current = null;
    return target;
  }, []);
  // IK55VT：Dock 关闭或切离 image 模式时解除武装（防陈旧目标劫持后续图像生成）
  useEffect(() => {
    if (!isBottomDockOpen || bottomDockMode !== "image")
      referenceGenTargetRef.current = null;
  }, [isBottomDockOpen, bottomDockMode]);
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
  const addNode = useAddNode({
    containerRef,
    viewport,
    addNodeFull,
    existingRects,
    extraPlacedRef,
  });

  // 生成业务（generate/generateFromNode/recover + job 轮询）抽到 useCanvasGeneration（ADR-0027）；
  // page 只调 hook 暴露的 API，不接触 setNodeAsset/startVideoJob/buildImageStreamHandlers/useVideoJobs。
  const {
    generate,
    generateFromNode,
    hydrate,
    retryNode,
    generating,
    generateError,
    setGenerateError,
    cancelVideoJob,
  } = useCanvasGeneration({
    nodes,
    edges,
    assets,
    addNode,
    patchNode,
    patchNodeAndSave,
    addAsset,
    consumeReferenceGenTarget,
    projectId: pid,
  });
  const { handleNodeAction } = useNodeActions({
    assets,
    referenceGenTargetRef,
    generateFromNode,
    setBottomDockMode,
    setImageDockMedia,
    setVideoDockMedia,
    setAudioDockMedia,
    setFirstFrameUrl,
    setLastFrameUrl,
    setFirstFrameAssetId,
    setLastFrameAssetId,
    setAgentPendingMention,
    setDockMentionSignal,
    setPrefillSignal,
    setIsAgentOpen,
    setIsBottomDockOpen,
    setDockFocusSignal,
    setInfoNodeId,
    setGenerateError,
  });

  // IK55VH 富文本卡 commit：richDoc 存文档，派生纯文本沿用 prompt 字段（连线进下游 prompt，engine/kinds 不动）
  const onEditRichText = useCallback(
    (id: string, richDoc: unknown, plainText: string) => {
      patchNode(id, { richDoc, prompt: plainText });
    },
    [patchNode],
  );

  // IK55VS 参考卡描述 commit：双击就地编辑失焦写回 description
  const onEditDescription = useCallback(
    (id: string, text: string) => {
      patchNode(id, { description: text });
    },
    [patchNode],
  );

  // IK55VT 参考卡卡名 commit：双击改名失焦写回 name
  const onEditReferenceName = useCallback(
    (id: string, name: string) => {
      patchNode(id, { name });
    },
    [patchNode],
  );

  // IK55VT 删除参考图：清空槽位回空态（历史 description 保留）
  const {
    refImageInputRef,
    handleRemoveReferenceImage,
    handleReferenceImageDrop,
    handleGenerateReferenceImage,
    handleUploadReferenceImage,
    handleRefImageFileChange,
    handleEditProductDetail,
    handleRemoveProductImage,
    handleImportProductLink,
  } = useReferenceCardHandlers({
    pid,
    nodes,
    assets,
    patchNode,
    addAsset,
    setGenerateError,
    setBottomDockMode,
    setIsBottomDockOpen,
    setDockFocusSignal,
    referenceGenTargetRef,
    notifyError: toast.error,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pickingFor) setPickingFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingFor]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // 命令式设 accept 再 click：避免 setState 异步导致 accept 未刷新就弹选择框
  const {
    openFilePicker,
    handleComposerUploadFile,
    handleFileChange,
    handleDockLocalUpload,
    handleFrameUpload,
    handleFrameClear,
    handleSwapFrames,
  } = useCanvasUploads({
    pid,
    fileInputRef,
    uploadFilesRef,
    addNode,
    patchNode,
    resizeNode,
    addAsset,
    setGenerateError,
    setImageDockMedia,
    setAudioDockMedia,
    setVideoDockMedia,
    setFirstFrameUrl,
    setLastFrameUrl,
    setFirstFrameAssetId,
    setLastFrameAssetId,
    firstFrameUrl,
    lastFrameUrl,
    firstFrameAssetId,
    lastFrameAssetId,
    notifyError: toast.error,
  });

  const handleGenerate = useDockGeneration(generate, imageDockMedia);

  // 视频 job 进度 / 出图 / 报错已由 useVideoJobs 的 per-job 回调（startVideoJob）驱动，
  // 每个 job 更新自己的 nodeId，多视频并发互不干扰——不再需要单 jobState effect。

  const [hydrationRetryKey, setHydrationRetryKey] = useState(0);
  const hydrationState = useCanvasProjectHydration({
    projectId: pid,
    loadDoc,
    hydrate,
    retryKey: hydrationRetryKey,
  });

  // IK74TX 1.1/1.2/1.3：首页跳转落地消费——hydration ready 后一次性打开 Dock/Agent 面板、
  // 预填参数并自动生成（video/image）或交给 Agent 接管（agent）。refresh/切项目不重复触发
  // （hook 内 ref 守卫；且 query 参数本身随导航变化，各自消费各自的）。
  useHomeJumpConsumer({
    ready: hydrationState === "ready",
    jump: homeJump,
    openDock: (mode) => {
      setBottomDockMode(mode);
      setIsBottomDockOpen(true);
    },
    prefillDock: (prefill) => {
      const nonce = Date.now();
      setPrefillSignal({ nonce, prefill });
    },
    openAgent: () => setIsAgentOpen(true),
    generate: (promptText, args) => generate(promptText, args),
    onError: (message) => toast.error(message),
  });

  const {
    handleRequestPick,
    handlePickFrameFromCanvas,
    handleExitPick,
    handleCanvasNodeClick,
  } = useCanvasPicking({
    assets,
    pickingFor,
    setPickingFor,
    setImageDockMedia,
    setVideoDockMedia,
    setAudioDockMedia,
    setFirstFrameUrl,
    setLastFrameUrl,
    setFirstFrameAssetId,
    setLastFrameAssetId,
  });
  const { handleNodeMenuAction } = useNodeClipboard({
    nodes,
    assets,
    nodeMenu,
    setNodeMenu,
    addNodeFull,
    onNodesChange,
    uploadFilesRef,
    setIsAgentOpen,
    setAgentPendingMention,
    notifySuccess: toast.success,
  });

  const {
    handleCanvasNodeAction,
    handleCardGenerated,
    handleNodeCancelJob,
    handleNodeMenuOpen,
    handleNodeRemove,
    handleNodeRetry,
    handleReapplyOutput,
    onMenuInsert,
    pickableCount,
    textMentionItems,
  } = useCanvasSurfaceRuntime({
    projectId: pid,
    nodes,
    assets,
    menu,
    setMenu,
    setNodeMenu,
    existingRects,
    addNode,
    addNodeFull,
    addEdgeFull,
    patchNode,
    resizeNode,
    addAsset,
    ensureAsset,
    onNodesChange,
    uploadFilesRef,
    handleNodeAction,
    cancelVideoJob,
    retryNode,
    setGenerateError,
  });

  const {
    handleToolClick,
    handleAudioFlyoutSelect,
    handleAssetFlyoutSelect,
    handleProductFlyoutSelect,
    handleCardLibraryImport,
    handlePickAudioSlot,
  } = useToolbarActions({
    nodes,
    addNode,
    openFilePicker,
    bottomDockMode,
    referenceGenTargetRef,
    setToolMode,
    setAudioFlyoutAnchor,
    setAssetFlyoutAnchor,
    setProductFlyoutAnchor,
    setBottomDockMode,
    setIsBottomDockOpen,
    setAudioModeSignal,
    setCardPickerOpen,
    setCardPickerFilter,
    setPickingFor,
    addAsset,
  });

  if (gated) return null;
  if (booting) return <BootProgress label="正在加载项目" />;
  if (!activeProject) {
    return (
      <ProjectUnavailableShell loadError={Boolean(loadError)} onRetry={retry} />
    );
  }
  if (hydrationState === "error") {
    return (
      <HydrationErrorShell
        onRetry={() => setHydrationRetryKey((value) => value + 1)}
      />
    );
  }
  if (hydrationState !== "ready") return <BootProgress />;

  return (
    <CanvasRuntimeView
      fileInputRef={fileInputRef}
      referenceImageInputRef={refImageInputRef}
      onFileChange={handleFileChange}
      onReferenceImageFileChange={(event) =>
        void handleRefImageFileChange(event)
      }
      topBar={{
        activeProject,
        projects,
        onSwitch: switchProject,
        onCreate: createProject,
        onDelete: deleteProject,
        onRename: renameProject,
      }}
      isAgentOpen={isAgentOpen}
      onAgentToggle={() => setIsAgentOpen((value) => !value)}
      containerRef={containerRef}
      canvas={{
        nodes,
        edges,
        viewport,
        onNodesChange,
        onEdgesChange,
        onConnect,
        onViewportChange: setViewportAction,
        onNodeClick: handleCanvasNodeClick,
        onPaneClick: handleExitPick,
        onNodeAction: handleCanvasNodeAction,
        onNodeRetry: handleNodeRetry,
        onNodeRemove: handleNodeRemove,
        onDeleteSceneCard: handleDeleteSceneCard,
        onNodeCancelJob: handleNodeCancelJob,
        onEditRichText,
        onEditDescription,
        onEditReferenceName,
        onUploadReferenceImage: handleUploadReferenceImage,
        onGenerateReferenceImage: handleGenerateReferenceImage,
        onRemoveReferenceImage: handleRemoveReferenceImage,
        onReferenceImageDrop: handleReferenceImageDrop,
        onEditProductDetail: handleEditProductDetail,
        onRemoveProductImage: handleRemoveProductImage,
        onImportProductLink: handleImportProductLink,
        mentionItems: textMentionItems,
        sceneCards,
        toolMode: effectiveMode,
        onNodeMenu: handleNodeMenuOpen,
        onUndo: undo,
        onRedo: redo,
        onDragStart: pushUndo,
      }}
      menus={{
        canvas: menu,
        node: nodeMenu,
        onInsert: onMenuInsert,
        onNodeAction: handleNodeMenuAction,
        onCloseCanvas: () => setMenu(null),
        onCloseNode: () => setNodeMenu(null),
      }}
      toolbar={{
        left: {
          onToolClick: handleToolClick,
          handActive: effectiveMode === "hand",
          activeFlyoutToolId: audioFlyoutAnchor
            ? "audio"
            : assetFlyoutAnchor
              ? "asset-library"
              : productFlyoutAnchor
                ? "product-card"
                : null,
        },
        audioAnchor: audioFlyoutAnchor,
        assetAnchor: assetFlyoutAnchor,
        productAnchor: productFlyoutAnchor,
        onAudioSelect: handleAudioFlyoutSelect,
        onAssetSelect: handleAssetFlyoutSelect,
        onProductSelect: handleProductFlyoutSelect,
        onCloseAudio: () => setAudioFlyoutAnchor(null),
        onCloseAsset: () => setAssetFlyoutAnchor(null),
        onCloseProduct: () => setProductFlyoutAnchor(null),
      }}
      cardPicker={{
        open: cardPickerOpen,
        props: {
          onClose: () => setCardPickerOpen(false),
          onImport: handleCardLibraryImport,
          cardTypeFilter: cardPickerFilter,
        },
      }}
      picking={{
        target: pickingFor,
        pickableCount,
        onExit: handleExitPick,
      }}
      dock={{
        mounted: dockEverOpened,
        visible: isBottomDockOpen,
        props: {
          mode: bottomDockMode,
          onClose: () => setIsBottomDockOpen(false),
          isOpen: isBottomDockOpen,
          imageMedia: imageDockMedia,
          videoMedia: videoDockMedia,
          audioMedia: audioDockMedia,
          focusSignal: dockFocusSignal,
          dockMentionSignal,
          prefillSignal: prefillSignal ?? undefined,
          onRemoveImageMedia: (id) =>
            setImageDockMedia((previous) =>
              previous.filter((media) => media.id !== id),
            ),
          onRemoveVideoMedia: (id) =>
            setVideoDockMedia((previous) =>
              previous.filter((media) => media.id !== id),
            ),
          onRemoveAudioMedia: (id) =>
            setAudioDockMedia((previous) =>
              previous.filter((media) => media.id !== id),
            ),
          firstFrameUrl,
          lastFrameUrl,
          firstFrameAssetId,
          lastFrameAssetId,
          onFrameUpload: handleFrameUpload,
          onFrameClear: handleFrameClear,
          onSwapFrames: handleSwapFrames,
          onPickFrameFromCanvas: handlePickFrameFromCanvas,
          onLocalUpload: (file) => handleDockLocalUpload(file, bottomDockMode),
          onPickFromCanvas: () => handleRequestPick(bottomDockMode),
          onPickAudioSlot: handlePickAudioSlot,
          onExitPick: handleExitPick,
          isPicking:
            pickingFor === bottomDockMode ||
            pickingFor === "audioRef" ||
            pickingFor === "audioImageRef",
          audioModeSignal,
          onGenerate: handleGenerate,
          onGenerateError: setGenerateError,
          generating,
          generateError,
          onClearGenerateError: () => setGenerateError(null),
        },
      }}
      agentChat={{
        prompt,
        initialSkillId: homeJump?.tab === "agent" ? homeJump.skill : undefined,
        projectId: activeProject.id,
        messages: agentMvp.messages,
        onSubmitMessage: agentMvp.sendMessage,
        onUploadFile: backendReady ? handleComposerUploadFile : undefined,
        answerableActive,
        activeSkillName: agentRunDisplay?.skillName,
        agentRunStatus: agentMvp.status,
        reasoningSummary: agentRunDisplay?.reasoningSummary,
        provisionalContent: agentMvp.provisionalContent,
        agentPersistence: {
          sessions: agentMvp.sessions,
          selectedSessionId: agentMvp.selectedSessionId,
          loading: agentMvp.loading,
          error: agentMvp.error,
          onSelect: agentMvp.selectSession,
          onNew: agentMvp.newConversation,
          onCancel: agentMvp.controls.canCancel ? agentMvp.cancel : undefined,
          onResume: agentMvp.controls.canResume ? agentMvp.resume : undefined,
          onSkip: agentMvp.controls.canSkip ? agentMvp.skip : undefined,
        },
        onRetryAgentRun: agentMvp.controls.canRetry
          ? agentMvp.retry
          : undefined,
        onApplyPlanMessage: backendReady ? applyPlan : undefined,
        isOpen: isAgentOpen,
        onClose: () => setIsAgentOpen(false),
        pendingMention: agentPendingMention,
        onMentionConsumed: () => setAgentPendingMention(null),
        onCardGenerated: handleCardGenerated,
        onReapplyOutput: handleReapplyOutput,
        // 权威模式渲染读 Snapshot/SSE，内存态写入不可见（幻影写入）——仅离线降级接入
        onAppendMessages: backendReady
          ? undefined
          : (nextMessages: ChatMessage[]) => appendMessages(nextMessages),
        onSetCardStatus: backendReady
          ? undefined
          : (cardId, status) => setCardStatus(cardId, status),
      }}
      scene={{
        backendReady,
        saveState,
      }}
      info={{
        nodeId: infoNodeId,
        assets,
        onClose: () => setInfoNodeId(null),
      }}
    />
  );
}

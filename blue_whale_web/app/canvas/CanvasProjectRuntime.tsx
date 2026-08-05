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
import {
  completeUploadSession,
  ensureUploadSession,
  uploadAsset,
  type UploadSession,
} from "@/lib/assets";
import {
  detectMediaKind,
  fallbackMediaSize,
  readMediaNaturalSize,
  type MediaKind,
} from "@/lib/mediaSize";
import {
  IMAGE_UPLOAD_ACCEPT,
  UPLOAD_ACCEPT,
  selectUploadFiles,
  validateUploadFile,
} from "@/lib/uploadRules";
import { wireInteger, type WireInteger } from "@/lib/wire-integer";

import { useCanvasStore } from "./_canvas/store";
import { uploadMediaToCanvas } from "./_canvas/uploadMedia";
import { useCanvasDoc } from "./_canvas/v2/useCanvasDoc";
import type { CanvasNode, CanvasNodeData, NodeKindId } from "./_canvas/model";
import { CanvasSurface } from "./_canvas/v2/CanvasSurface";
import type { MenuPayload } from "./_canvas/v2/CanvasSurface";
import { ContextMenu, type ContextMenuKind } from "./_canvas/v2/ContextMenu";
import {
  NodeContextMenu,
  type NodeMenuAction,
} from "./_canvas/v2/NodeContextMenu";
import { effectiveToolMode, type ToolMode } from "./_canvas/v2/toolMode";
import { useSpaceHeld } from "./_canvas/v2/useSpaceHeld";
import { useV2Projects } from "./_canvas/v2/useV2Projects";
import { useProjectConversation } from "./_canvas/hooks/useProjectConversation";
import {
  buildCrossmodalRefill,
  canvasNodeToDockMedia,
  cardToV2ImageFields,
  nodeToPendingMention,
  recipeToDockPrefill,
} from "./_canvas/v2/mappers";
import {
  cloneNodeWithOffset,
  parseClipboardNodes,
  serializeNodesForClipboard,
} from "./_canvas/v2/clipboard";
import { findPlacement, type Rect } from "./_canvas/placement";
import { dockAccept, dockPickHint } from "./_canvas/utils";
import { useCanvasGeneration } from "./_canvas/hooks/useCanvasGeneration";
import { useCanvasProjectHydration } from "./_canvas/hooks/useCanvasProjectHydration";
import { BootProgress } from "./BootProgress";
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
import { CardLibraryPicker } from "./_canvas/components/CardLibraryPicker";
import { NodeInfoModal } from "./_canvas/components/NodeInfoModal";
import {
  cloneCardSnapshot,
  getCardLibraryAsset,
  savedAssetsToastText,
  saveToSharedAssets,
  snapshotToNodeData,
  type CardLibraryItem,
} from "./_canvas/cardLibrary";
import {
  ASSET_LIBRARY_FLYOUT_ITEMS,
  AUDIO_FLYOUT_ITEMS,
  PRODUCT_FLYOUT_ITEMS,
} from "./_canvas/config";
import { REFERENCE_CARD_WIDTH, referenceCardHeight } from "./_canvas/constants";
import { newProductCardData } from "./_canvas/model";
import type { ReferenceCardType } from "./_canvas/model";
import {
  mergeProductImageIds,
  parseProductUrl,
  productImportHydrationAssets,
  productImportImageId,
  productImportPatch,
} from "./_canvas/productImport";
import type {
  DockMediaItem,
  GenerateArgs,
  PendingMention,
  PendingMentionBatch,
  PrefillSignal,
} from "./_canvas";
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

/** IK55VT：图片自然宽高比探测（参考图落槽存 aspect，已填态高度按比自适应）；失败回 undefined。 */
function probeImageAspect(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? img.naturalWidth / img.naturalHeight
          : undefined,
      );
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
}

/** ReactFlow 节点 selected 标记（CanvasNode 类型未声明，运行时存在）。 */
function isNodeSelected(n: CanvasNode): boolean | undefined {
  return (n as CanvasNode & { selected?: boolean }).selected;
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

  // 持久化 Conversation 接线（IK67GD T02）：后端可用时消息权威来自 Snapshot/SSE，
  // 提交走公开接纳 API；后端不可达时保留既有离线 mock（messages 内存态 + 无 onSubmitMessage）。
  const {
    messages: conversationMessages,
    sendMessage: sendConversationMessage,
    answerableActive,
    agentRunDisplay,
    runControl,
    provisionalText,
    retryRun,
  } = useProjectConversation(pid, backendReady);

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
  const [nodeMenu, setNodeMenu] = useState<{
    screenX: number;
    screenY: number;
    targetIds: string[];
  } | null>(null);

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

  const handleNodeAction = useCallback(
    (node: CanvasNode, actionId: string) => {
      const name = (node.data.content as string) || "未命名素材";
      const src = node.data.assetId
        ? assets[node.data.assetId]?.src
        : undefined;
      // 其他路径打开 Dock 时解除参考卡生成目标武装（防陈旧目标劫持后续生成）
      referenceGenTargetRef.current = null;
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
                  ? wireInteger(node.data.assetId)
                  : undefined,
              },
              replace: true,
            });
          }
          break;
        }
        case "mention": {
          setIsAgentOpen(true);
          const batchId = Date.now();
          setAgentPendingMention({
            mentions: [
              {
                name,
                nonce: batchId,
                // 与右键「添加到聊天」一致：带 assetId 走 pill 路径，发送时进 referenced_asset_ids
                ...(src ? { src } : {}),
                ...(node.data.assetId
                  ? { assetId: wireInteger(node.data.assetId) }
                  : {}),
                ...(node.data.kind === "image" ||
                node.data.kind === "video" ||
                node.data.kind === "audio"
                  ? { type: node.data.kind }
                  : {}),
              },
            ],
            batchId,
          });
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
        case "info": {
          // IK6M68：信息按钮 → 节点详情弹窗（原为空操作）
          setInfoNodeId(node.id);
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
  const handleRemoveReferenceImage = useCallback(
    (id: string) => {
      patchNode(id, {
        referenceAssetId: undefined,
        referenceImageAspect: undefined,
      });
    },
    [patchNode],
  );

  // IK55VT 通道一：画布图片素材拖放上卡落槽（宽高比取 asset 尺寸，回退节点框尺寸）
  const handleReferenceImageDrop = useCallback(
    (refNodeId: string, sourceNodeId: string) => {
      const source = nodes.find((n) => n.id === sourceNodeId);
      const assetId = source?.data.assetId;
      if (!source || !assetId) return;
      const target = nodes.find((n) => n.id === refNodeId);
      // IK55VZ 商品卡：追加进 imageAssetIds(≤8,满了不再追加)而非覆盖单槽
      if (target?.data.cardType === "product") {
        const merged = mergeProductImageIds(target.data.imageAssetIds, [
          assetId,
        ]);
        if (merged.length !== (target.data.imageAssetIds?.length ?? 0))
          patchNode(refNodeId, { imageAssetIds: merged });
        return;
      }
      const asset = assets[assetId];
      const aspect =
        asset?.width && asset.height
          ? asset.width / asset.height
          : source.width && source.height
            ? source.width / source.height
            : undefined;
      patchNode(refNodeId, {
        referenceAssetId: assetId,
        referenceImageAspect: aspect,
      });
    },
    [nodes, assets, patchNode],
  );

  // IK55VT 通道三：参考卡「生成图片」→ 武装目标 + 无预填开图像 Dock（结果回落卡槽，见 useCanvasGeneration）
  const handleGenerateReferenceImage = useCallback((id: string) => {
    referenceGenTargetRef.current = id;
    setBottomDockMode("image");
    setIsBottomDockOpen(true);
    setDockFocusSignal((n) => n + 1);
  }, []);

  // IK55VT 通道二：参考卡「添加图片」→ 隐藏 file input（仅图片白名单）→ uploadAsset 落槽（不建画布节点）
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const pendingRefUploadNodeIdRef = useRef<string | null>(null);
  const handleUploadReferenceImage = useCallback((id: string) => {
    pendingRefUploadNodeIdRef.current = id;
    const input = refImageInputRef.current;
    if (!input) return;
    input.accept = IMAGE_UPLOAD_ACCEPT;
    input.click();
  }, []);
  const handleRefImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      const nodeId = pendingRefUploadNodeIdRef.current;
      pendingRefUploadNodeIdRef.current = null;
      if (!file || !nodeId || !pid) return;
      const validation = validateUploadFile(file);
      if (!validation.ok || validation.kind !== "image") {
        toast.error(validation.ok ? "仅支持图片格式" : validation.reason);
        return;
      }
      try {
        const result = await uploadAsset(file, Number(pid), "image");
        const assetId = String(result.id);
        addAsset({
          id: assetId,
          kind: "image",
          src: result.url,
          source: "uploaded",
        });
        // IK55VZ 商品卡:追加进 imageAssetIds(≤8)而非覆盖单槽(无需探测宽高比)
        const target = nodes.find((n) => n.id === nodeId);
        if (target?.data.cardType === "product") {
          patchNode(nodeId, {
            imageAssetIds: mergeProductImageIds(target.data.imageAssetIds, [
              assetId,
            ]),
          });
          return;
        }
        const aspect = await probeImageAspect(result.url);
        patchNode(nodeId, {
          referenceAssetId: assetId,
          referenceImageAspect: aspect,
        });
      } catch (err) {
        toast.error(userFriendlyErrorMessage(err));
      }
    },
    [pid, nodes, addAsset, patchNode],
  );

  // IK55VZ 商品卡详情 commit：写回 detail
  const handleEditProductDetail = useCallback(
    (id: string, text: string) => {
      patchNode(id, { detail: text });
    },
    [patchNode],
  );

  // IK55VZ 商品卡移除单张图：从 imageAssetIds 摘除(asset 保留在 store,画布其他引用不受影响)
  const handleRemoveProductImage = useCallback(
    (id: string, assetId: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      patchNode(id, {
        imageAssetIds: (node.data.imageAssetIds ?? []).filter(
          (a) => a !== assetId,
        ),
      });
    },
    [nodes, patchNode],
  );

  // IK55VZ 商品卡链接导入:mock 解析 → 注册 4 张图 assets(确定性 id,刷新后可重建) →
  // 填充 imageAssetIds/detail/sourceUrl(名称仅当仍是「商品 N」自动编号或未填时才用解析名)
  const handleImportProductLink = useCallback(
    (id: string, url: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const parsed = parseProductUrl(url);
      const newIds = parsed.images.map((src, i) => {
        const aid = productImportImageId(url, i);
        addAsset({ id: aid, kind: "image", src, source: "uploaded" });
        return aid;
      });
      patchNode(id, productImportPatch(node.data, parsed, url, newIds));
    },
    [nodes, addAsset, patchNode],
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
        projectId: wireInteger(pid),
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

  /**
   * 对话面板上传（IK67GX T03）：持久化 Asset → 创建 NodeItem 并首次放置 → 面板插入 pill。
   * 会话按 File 弱引用缓存：PUT/complete 失败后重试沿用同一 storage_key，
   * complete 幂等 ⇒ 每个文件至多一个 Asset，重试不重复创建。
   */
  const composerUploadSessionsRef = useRef(new WeakMap<File, UploadSession>());
  const handleComposerUploadFile = useCallback(
    async (
      file: File,
    ): Promise<{ assetId: string; url: string; kind: MediaKind }> => {
      const kind = detectMediaKind(file);
      const session = await ensureUploadSession(
        file,
        kind,
        composerUploadSessionsRef.current.get(file) ?? null,
      );
      // PUT 前先存会话：这一步之后任何失败，重试都能沿用同一 storage_key
      composerUploadSessionsRef.current.set(file, session);
      const { assetId, url } = await completeUploadSession({
        file,
        projectId: wireInteger(pid),
        kind,
        session,
      });
      addAsset({ id: assetId, kind, src: url, source: "uploaded" });
      let size = fallbackMediaSize(kind);
      try {
        size = await readMediaNaturalSize(url, kind);
      } catch {
        // 尺寸探测失败不阻断：Asset 已持久化，节点用默认尺寸落位
      }
      addNode(kind, {
        width: size.width,
        height: size.height,
        data: {
          content: file.name,
          status: "done",
          assetId,
          recipe: { origin: "uploaded" },
        },
      });
      // 节点落地成功后才丢弃会话：此前任何失败，重试沿用同一 storage_key
      // （complete 幂等），不会重复创建 Asset
      composerUploadSessionsRef.current.delete(file);
      return { assetId, url, kind };
    },
    [pid, addNode, addAsset],
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
      // IK6M68：Dock 上传补白名单 + 大小校验（对齐工具栏上传；音频参考无规则，跳过）
      if (mode !== "audio") {
        const validation = validateUploadFile(file);
        if (!validation.ok) {
          toast.error(validation.reason);
          return;
        }
      }
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
        const result = await uploadAsset(file, wireInteger(pid), "image");
        const assetId = wireInteger(result.id);
        if (slot === "first") {
          setFirstFrameUrl(result.url);
          setFirstFrameAssetId(assetId);
        } else {
          setLastFrameUrl(result.url);
          setLastFrameAssetId(assetId);
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
          node.data.assetId ? wireInteger(node.data.assetId) : undefined,
        );
      } else if (pickingFor === "lastFrame") {
        setLastFrameUrl(src);
        setLastFrameAssetId(
          node.data.assetId ? wireInteger(node.data.assetId) : undefined,
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
  // IK55VL：视频卡生成中取消入口——按节点持久 taskId 取消（刷新后也可用）
  const handleNodeCancelJob = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      const taskId = Number(node?.data.taskId);
      if (Number.isSafeInteger(taskId) && taskId > 0) cancelVideoJob(taskId);
    },
    [nodes, cancelVideoJob],
  );

  const handleNodeRetry = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      // 上传失败卡：用留存的 File 原地重传（不新建节点）；生成失败卡走下方 retryNode 后端重试
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
      // 生成失败：调后端 retry（仅终态失败 job 有效）→ 节点回 running + 续轮询；不再只是重开 dock。
      void retryNode(nodeId);
    },
    [
      nodes,
      pid,
      addNode,
      patchNode,
      resizeNode,
      addAsset,
      setGenerateError,
      retryNode,
    ],
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

  const handleNodeMenuOpen = useCallback(
    (payload: MenuPayload & { nodeId: string }) => {
      setMenu(null);
      const clickedSelected = nodes.some(
        (n) => n.id === payload.nodeId && isNodeSelected(n),
      );
      const targetIds = clickedSelected
        ? nodes.filter(isNodeSelected).map((n) => n.id)
        : [payload.nodeId];
      setNodeMenu({
        screenX: payload.screenX,
        screenY: payload.screenY,
        targetIds,
      });
    },
    [nodes],
  );

  /** 拷贝节点到系统剪贴板（菜单「拷贝」与 ⌘C 共用）。 */
  const copyNodesToClipboard = useCallback((targets: CanvasNode[]) => {
    void navigator.clipboard.writeText(serializeNodesForClipboard(targets));
  }, []);

  /** 复制节点：偏移落点生成副本（菜单「复制」与 ⌘D 共用）。 */
  const duplicateNodes = useCallback(
    (targets: CanvasNode[]) => {
      for (const src of targets) addNodeFull(cloneNodeWithOffset(src));
    },
    [addNodeFull],
  );

  /** 粘贴（⌘V）：读剪贴板节点 JSON 重建落画布；非本格式/无权限静默忽略。 */
  const pasteNodesFromClipboard = useCallback(async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    for (const node of parseClipboardNodes(text)) addNodeFull(node);
  }, [addNodeFull]);

  const handleNodeMenuAction = useCallback(
    (action: NodeMenuAction) => {
      if (!nodeMenu) return;
      const { targetIds } = nodeMenu;
      setNodeMenu(null);
      const targets = nodes.filter((n) => targetIds.includes(n.id));

      switch (action) {
        case "delete": {
          for (const id of targetIds) {
            const entry = uploadFilesRef.current.get(id);
            if (entry) {
              URL.revokeObjectURL(entry.previewUrl);
              uploadFilesRef.current.delete(id);
            }
          }
          onNodesChange(
            targetIds.map((id) => ({ type: "remove" as const, id })),
          );
          break;
        }
        case "copy":
          copyNodesToClipboard(targets);
          break;
        case "duplicate":
          duplicateNodes(targets);
          break;
        case "save-to-assets": {
          const text = savedAssetsToastText(saveToSharedAssets(targets));
          if (text) toast.success(text);
          break;
        }
        case "add-to-chat": {
          // 分组无内容可引用，与保存语义一致跳过
          const mentionTargets = targets.filter((n) => n.data.kind !== "group");
          if (mentionTargets.length === 0) break;
          const batchId = Date.now();
          const mentions: PendingMention[] = mentionTargets.map((n, i) =>
            nodeToPendingMention(n, assets, batchId + i),
          );
          setIsAgentOpen(true);
          setAgentPendingMention({ mentions, batchId });
          break;
        }
        default:
          break;
      }
    },
    [
      nodeMenu,
      nodes,
      onNodesChange,
      copyNodesToClipboard,
      duplicateNodes,
      assets,
    ],
  );

  /** ⌘C/⌘D/⌘V 节点级快捷键：与右键菜单共用同一套拷贝/复制/粘贴逻辑。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "d" && key !== "v") return;
      // 输入框/富文本内保留系统默认编辑行为
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (key === "v") {
        e.preventDefault();
        void pasteNodesFromClipboard();
        return;
      }
      // 页面上有文本选区时放行系统拷贝（如聊天文本），不劫持 ⌘C/⌘D
      if (window.getSelection()?.toString()) return;
      const selected = nodes.filter(isNodeSelected);
      if (selected.length === 0) return;
      e.preventDefault();
      if (key === "c") copyNodesToClipboard(selected);
      else duplicateNodes(selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, copyNodesToClipboard, duplicateNodes, pasteNodesFromClipboard]);

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
      } else if (id === "asset-library") {
        // IK55VS：资产库按钮 toggle 悬浮列表（共享资产 + 五类参考卡）
        setAssetFlyoutAnchor((a) => (a ? null : (el ?? null)));
      } else if (id === "product-card") {
        // IK55VZ：商品卡按钮 toggle 悬浮列表（新建商品/导入商品）
        setProductFlyoutAnchor((a) => (a ? null : (el ?? null)));
      } else if (id === "ai-image") {
        referenceGenTargetRef.current = null; // 工具栏开 Dock：解除参考卡生成目标
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

  /** IK55VZ 新建商品空卡:名称自动编号 + detail/imageAssetIds 默认,findPlacement 落视口中心。 */
  const addEmptyProductCard = useCallback(() => {
    addNode("reference", {
      width: REFERENCE_CARD_WIDTH,
      height: referenceCardHeight("product"),
      data: newProductCardData(nodes),
    });
  }, [addNode, nodes]);

  /** 资产库悬浮列表点选（IK55VS/IK55VX）：共享资产=打开卡片库选择器；五类参考卡在视口中心起网格新增空卡。 */
  const handleAssetFlyoutSelect = useCallback(
    (id: string) => {
      setAssetFlyoutAnchor(null);
      if (id === "import") {
        setCardPickerFilter(undefined);
        setCardPickerOpen(true);
        return;
      }
      const cardType = id as ReferenceCardType;
      // IK55VZ：商品卡走专属新建（名称自动编号 + detail/imageAssetIds 默认）
      if (cardType === "product") {
        addEmptyProductCard();
        return;
      }
      addNode("reference", {
        width: REFERENCE_CARD_WIDTH,
        height: referenceCardHeight(cardType),
        data: { cardType },
      });
    },
    [addNode, addEmptyProductCard],
  );

  /** 商品卡悬浮列表点选（IK55VZ）：新建商品=空卡落视口中心；导入商品=卡片库选择器限 product。 */
  const handleProductFlyoutSelect = useCallback(
    (id: string) => {
      setProductFlyoutAnchor(null);
      if (id === "new") {
        addEmptyProductCard();
        return;
      }
      if (id === "import") {
        setCardPickerFilter(["product"]);
        setCardPickerOpen(true);
      }
    },
    [addEmptyProductCard],
  );

  /** 卡片库导入（IK55VX）：复制快照落画布——带图卡先登记独立 asset 再让节点引用，编辑不回写库。 */
  const handleCardLibraryImport = useCallback(
    (item: CardLibraryItem) => {
      const snap = cloneCardSnapshot(item);
      if (snap.referenceAssetId) {
        const asset = getCardLibraryAsset(snap.referenceAssetId);
        if (asset) {
          addAsset({
            id: snap.referenceAssetId,
            kind: "image",
            src: asset.src,
            source: "uploaded",
          });
        }
      }
      // IK55VZ 商品卡多图:每个 snap asset 同样先登记再引用
      for (const aid of snap.imageAssetIds ?? []) {
        const asset = getCardLibraryAsset(aid);
        if (asset) {
          addAsset({
            id: aid,
            kind: "image",
            src: asset.src,
            source: "uploaded",
          });
        }
      }
      addNode("reference", {
        width: REFERENCE_CARD_WIDTH,
        height: referenceCardHeight(snap.cardType),
        data: snapshotToNodeData(snap),
      });
      setCardPickerOpen(false);
    },
    [addAsset, addNode],
  );

  // IK55VX：mock 快照 asset 持久化重载后再水合（画布 JSON 只存 id,src 从 mock 注册表确定性重建）
  useEffect(() => {
    for (const n of nodes) {
      // IK55VZ:商品卡多图(imageAssetIds)与单图参考卡(referenceAssetId)同通道水合
      const ids = [
        ...(n.data.referenceAssetId ? [n.data.referenceAssetId] : []),
        ...(n.data.imageAssetIds ?? []),
      ];
      for (const id of ids) {
        if (!id.startsWith("libimg-") || assets[id]) continue;
        const a = getCardLibraryAsset(id);
        if (a) addAsset({ id, kind: "image", src: a.src, source: "uploaded" });
      }
    }
    // IK55VZ:链接导入图(impimg-)按 sourceUrl 确定性重建缺失 asset
    for (const a of productImportHydrationAssets(nodes, assets)) addAsset(a);
  }, [nodes, assets, addAsset]);

  /** 音频参考槽画布选取（IK55VM）：audioRef=音频节点，audioImageRef=图片节点。 */
  const handlePickAudioSlot = useCallback(
    (slot: "audioRef" | "audioImageRef") => setPickingFor(slot),
    [],
  );

  if (gated) return null;
  if (booting) return <BootProgress label="正在加载项目" />;
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
  if (hydrationState === "error") {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-black">
        <p className="text-sm text-[var(--tc-text-secondary)]">画布加载失败</p>
        <button
          type="button"
          onClick={() => setHydrationRetryKey((value) => value + 1)}
          className="inline-flex h-9 items-center rounded-full border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-4 text-sm text-[var(--tc-text-secondary)] transition-colors hover:text-[var(--tc-text-primary)]"
        >
          重试
        </button>
        <Link
          href="/canvas"
          className="inline-flex h-9 items-center rounded-full bg-[var(--tc-accent)] px-4 text-sm text-[var(--tc-on-accent)]"
        >
          返回项目列表
        </Link>
      </div>
    );
  }
  if (hydrationState !== "ready") return <BootProgress />;

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
      {/* IK55VT 参考卡「添加图片」专用 input（仅图片白名单，单选；accept 命令式设置） */}
      <input
        ref={refImageInputRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="sr-only"
        onChange={(e) => void handleRefImageFileChange(e)}
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
            onNodeCancelJob={handleNodeCancelJob}
            onEditRichText={onEditRichText}
            onEditDescription={onEditDescription}
            onEditReferenceName={onEditReferenceName}
            onUploadReferenceImage={handleUploadReferenceImage}
            onGenerateReferenceImage={handleGenerateReferenceImage}
            onRemoveReferenceImage={handleRemoveReferenceImage}
            onReferenceImageDrop={handleReferenceImageDrop}
            onEditProductDetail={handleEditProductDetail}
            onRemoveProductImage={handleRemoveProductImage}
            onImportProductLink={handleImportProductLink}
            mentionItems={textMentionItems}
            picking={pickingFor !== null}
            pickingAccept={pickingFor ? dockAccept(pickingFor) : undefined}
            toolMode={effectiveMode}
            onNodeMenu={handleNodeMenuOpen}
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

      {nodeMenu && (
        <NodeContextMenu
          screenX={nodeMenu.screenX}
          screenY={nodeMenu.screenY}
          hideSaveToAssets={nodes
            .filter((n) => nodeMenu.targetIds.includes(n.id))
            .every((n) => n.data.kind === "group")}
          onAction={handleNodeMenuAction}
          onClose={() => setNodeMenu(null)}
        />
      )}

      <LeftToolbar
        onToolClick={handleToolClick}
        handActive={effectiveMode === "hand"}
        activeFlyoutToolId={
          audioFlyoutAnchor
            ? "audio"
            : assetFlyoutAnchor
              ? "asset-library"
              : productFlyoutAnchor
                ? "product-card"
                : null
        }
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
      {/* 资产库按钮悬浮列表（IK55VS）：共享资产(IK55VX 卡片库选择器) + 五类参考卡空卡新建 */}
      <ToolbarFlyout
        open={assetFlyoutAnchor !== null}
        anchor={assetFlyoutAnchor}
        items={ASSET_LIBRARY_FLYOUT_ITEMS}
        onSelect={handleAssetFlyoutSelect}
        onClose={() => setAssetFlyoutAnchor(null)}
        ariaLabel="资产库"
      />
      {/* 商品卡按钮悬浮列表（IK55VZ）：新建商品(空卡) / 导入商品(卡片库选择器限 product) */}
      <ToolbarFlyout
        open={productFlyoutAnchor !== null}
        anchor={productFlyoutAnchor}
        items={PRODUCT_FLYOUT_ITEMS}
        onSelect={handleProductFlyoutSelect}
        onClose={() => setProductFlyoutAnchor(null)}
        ariaLabel="商品卡"
      />
      {/* 卡片库（共享资产）选择器（IK55VX）：导入=复制快照，编辑不回写库 */}
      {cardPickerOpen && (
        <CardLibraryPicker
          onClose={() => setCardPickerOpen(false)}
          onImport={handleCardLibraryImport}
          cardTypeFilter={cardPickerFilter}
        />
      )}
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
            isOpen={isBottomDockOpen}
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
            onGenerateError={setGenerateError}
            generating={generating}
            generateError={generateError}
            onClearGenerateError={() => setGenerateError(null)}
          />
        </div>
      )}
      <AgentChatPanel
        key={activeProject.id}
        prompt={prompt}
        projectId={activeProject.id}
        messages={backendReady ? conversationMessages : messages}
        onSubmitMessage={backendReady ? sendConversationMessage : undefined}
        onUploadFile={backendReady ? handleComposerUploadFile : undefined}
        answerableActive={answerableActive}
        activeSkillName={agentRunDisplay?.skillName}
        agentRunStatus={agentRunDisplay?.status}
        reasoningSummary={agentRunDisplay?.reasoningSummary}
        provisionalContent={provisionalText}
        onRetryAgentRun={
          backendReady && runControl.canRetry ? retryRun : undefined
        }
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

      {/* IK6M68：节点「信息」详情弹窗（消除空操作） */}
      {infoNodeId &&
        (() => {
          const node = nodes.find((n) => n.id === infoNodeId);
          if (!node) return null;
          const asset = node.data.assetId
            ? assets[node.data.assetId]
            : undefined;
          return (
            <NodeInfoModal
              node={node}
              asset={asset}
              onClose={() => setInfoNodeId(null)}
            />
          );
        })()}
    </div>
  );
}

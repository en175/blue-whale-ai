/* ============================================
 * CanvasPage 画布编辑页：节点/连线/工具栏编排
 * ============================================ */
import { releaseRemovedPromptSources, promptBindingList, promptBindingsSchema, type PromptBinding } from '@lib/contracts/prompt-target';
import { promptMentionSchema, validPromptMentions } from '@lib/contracts/prompt-preview';
import { unifiedTextNodeText } from '@lib/contracts/text-node-markdown';
import { replaceImageMentionsWithAssetTokens, type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Map as MapIcon, Link, Link2Off, CheckCircle, XCircle, AlertTriangle, Magnet } from 'lucide-react';
import { newNodeId } from './nodeId';
import { nextDraftPosition, type SpawnBox } from './draftSpawn';
import {
  computeFollowAnchor,
  enabledVideoFollowModes,
  FOLLOW_GAP,
  FOLLOW_PAD,
  type VideoFollowMode,
} from './followDialog';
import { imageMediaRefsOf, imageRefSourceError, isImageDraftNode, isMaterialLibraryId, readAssetId, baseSourceError } from './mediaRefs';
import { appliedPlanAssetIds, dropReversedTextIndexEdges, textIndexEdgesForAppliedPlan } from './planApplyEdges';
import { mergedImageRefsOf, imageTextIndexSendError, mergedVideoRefsWithTextIndex, videoTextIndexSendError, mergedAudioRefsWithTextIndex, audioTextIndexSendError, nextUsedInputState, DEFAULT_IMAGE_REFERENCE_LIMIT } from './textIndexSync';
import { audioMediaRefsOf, audioRefSourceError, checkAddAudioRef, isAudioDraftNode } from './audioMediaRefs';
import { PANEL_REF_MEDIA_TYPES, panelCanvasRefError } from './refSourceTypes';
import { cancelledTerminalAction, hasGenerationRecord, isInPlaceRegenTarget } from './mediaReEdit';
import {
  asVideoRefMediaType,
  isLibraryOnlyVideoRef,
  isVideoDraftNode,
  readRefRole,
  readDraftMaterialRefs,
  freshVideoCanvasRefs,
  mergedVideoMediaRefsOf,
  supportsVideoReferenceModel,
  videoRefConflict,
  videoRefSourceError,
  checkAddVideoRef,
  incomingVideoRefOccupied,
  occupiedVideoRefIds,
  type VideoMediaRef,
  type VideoMediaRefs,
  type VideoRefRole,
} from './videoMediaRefs';
import { refOverflowToast } from '@/utils/ref-overflow';
import { mediaContentBox, MEDIA_CONTENT_TOP_OFFSET } from './components/MediaNode/mediaContentSize';
import { downloadFileNameOf } from './components/cardName';
import type { MediaGenStatus } from './components/MediaNode';
import type { MediaDims } from './components/MediaNode/mediaContentSize';
import {
  buildMediaExtractPlaceholderNode,
  isMediaExtractNodeId,
  MEDIA_EXTRACT_EDGE_ORIGIN,
  mediaExtractNodeId,
  mediaExtractTerminalPatch,
} from './mediaExtract';
import {
  IMAGE_ENHANCE_EDGE_ORIGIN,
  buildImageEnhanceInput,
  imageEnhanceDraftPosition,
  restoreImageEnhanceParams,
  type ImageEnhanceIdentity,
  type ImageEnhancePanelParams,
} from './imageEnhance';
import {
  IMAGE_ERASE_EDGE_ORIGIN,
  maskHasPaintArea,
  type ImageEraseIdentity,
  type ImageEraseInput,
} from './imageErase';
import {
  applyMaskOp,
  canRedoMaskEdit,
  canUndoMaskEdit,
  EMPTY_MASK_EDIT,
  redoMaskEdit,
  undoMaskEdit,
  type MaskCoordinateSpace,
  type MaskEditState,
  type MaskOp,
  type MaskPoint,
} from './eraseMask';
import {
  IMAGE_OUTPAINT_EDGE_ORIGIN,
  ZERO_EXPANDS,
  buildImageOutpaintInput,
  expandRatiosOf,
  maxExpandPerSide,
  outpaintGateReason,
  presetExpands,
  type ExpandSides,
  type ImageOutpaintIdentity,
  type OutpaintPresetKey,
  type SourceRect,
} from './imageOutpaint';
import ImageEnhanceDialog from './components/ImageEnhanceDialog';
import ImageEraseDialog, { type EraseTool } from './components/ImageEraseDialog';
import CropDialog from './components/CropDialog';
import {
  clampCropRect,
  cropOutputFormat,
  cropPresetRatio,
  cropRectToNatural,
  fullCropRect,
  IMAGE_CROP_EDGE_ORIGIN,
  inscribeCropRect,
  minCropSideDisplay,
  type CropCoordinateSpace,
  type CropNaturalRect,
  type CropOutputFormat,
  type CropPresetKey,
  type CropRect,
} from './imageCrop';
import OutpaintDialog from './components/OutpaintDialog';
import { persistSnapAlignmentEnabled, readSnapAlignmentEnabled } from './snapPreference';
import CanvasHeader from './components/CanvasHeader';
import AgentPanel from './components/AgentPanel';
import CanvasToolbar from './components/CanvasToolbar';
import BottomDialog, { type VideoGenOptions, type VideoGenSeedParams } from './components/BottomDialog';
import ImageDialog, { composeImageSendPrompt, IMAGE_COMPOSED_PROMPT_LIMIT, IMAGE_COMPOSED_PROMPT_OVER_LIMIT, type UploadedFile, type ImageGenSeedParams, type ImageTextAttachment } from './components/ImageDialog';
import { orderRefStripItems, videoRefStripKey } from './components/RefThumbnail/strip-dnd';
import TextGenDialog from './components/TextGenDialog';
import { flattenPromptDocForSend, restorePromptDoc, type PromptDoc, type StoredPromptDoc } from '@/lib/prompt-doc';
import AudioDialog, { type CanvasPickItem, type AudioRefItem } from './components/AudioDialog';
import MusicDialog, { type MusicGenOptions } from './components/MusicDialog';
import SharedAssetsModal from './components/SharedAssetsModal';
import LegacyHistoryModal from './components/LegacyHistoryModal';
import AssetsPickerModal from './components/AssetsPickerModal';
import CharacterLibraryModal from './components/CharacterLibraryModal';
import type { MaterialAsset } from '@/api/material';
import type { ImageOutpaintInput } from '@lib/contracts/image-outpaint';
import type { AssetCardKind } from './components/AssetCardNode';
import type { CanvasProject } from './components/ProjectSelector';
import FlowCanvas from './components/Canvas';
import { isEditableKeyboardTarget } from './components/Canvas/keyboardDelete';
import { canvasUndoKeyAction } from './components/Canvas/keyboardUndo';
import { isMentionMenuOpen } from './components/Canvas/canvasKeyboard';
import { useEdgesState, type Connection, type Edge, type Node, type Viewport, type OnSelectionChangeParams } from '@xyflow/react';
import { useAuthStore } from '@/stores/auth';
import { fetchMe, fetchQuota, toSessionUser } from '@/api/auth';
import {
  fetchProjects,
  createProject,
  renameProject,
  deleteProject,
  projectKeys,
} from '@/api/projects';
import { UPLOAD_SIZE_LIMIT, fetchUploadPresign, putToPresignedUrl, completeUpload, fetchAllAssets, fetchAssetDetail, linkAssetToProject, type AssetRecord, type AssetType, type UploadCompleteData } from '@/api/assets';
import AssetDetailModal from '@/pages/Assets/components/AssetDetailModal';
import { rememberAssetUrl } from './components/AgentPanel/MessageAssetPreview';
import { referencePromptPlan, applyPromptPreview, createConversationQuote, legacyCardHistoryOptions, saveCanvasDoc, serializeEdges, serializeNodes } from '@/api/canvas';
import { isApiError } from '@/api/http';
import { useAuthPromptStore } from '@/stores/authPrompt';
import { blockIfQuotaInsufficient, openRechargeForQuotaError } from '@/utils/quotaGate';
import type { GenerationCardBlock, SessionContentBlock } from '@/api/agentSessions';
import {
  createGenerationJob,
  cancelGenerationJob,
  retryGenerationJob,
  fetchJobStatus,
  createMediaExtraction,
  createImageEnhancement,
  createImageErase,
  createImageOutpaint,
  readJobFailText,
  type ImageJobParameters,
  type VideoJobParameters,
  type AudioJobParameters,
  type GenerationRefItem,
} from '@/api/jobs';
import { removeCancelledGenerationNode, stopJobPolling } from './generationPolling';
import {
  saveSharedAsset,
  type SaveSharedAssetRequest,
  type SharedAssetView,
} from '@/api/sharedAssets';
import { uploadAssetFile, probeMediaMeta } from '@/utils/upload';
import ConfirmModal from '@/components/ConfirmModal';
import CanvasContextMenu from './components/CanvasContextMenu';
import { copyImageToClipboard, readCanvasClipboard } from './clipboardPaste';
import { COMPLIANCE_SUCCESS_TOAST, COMPLIANCE_FAILED_TOAST, depositCanvasAssetToCharacterLibrary, isComplianceFailedError, resolveCharacterLibraryMaterialId, waitComplianceAssetReady } from './characterLibraryDeposit';
import { importLivenessLibraryAssets, isPendingLivenessLibraryAsset } from './livenessLibraryImport';
import { buildImageJobReferences, buildVideoJobReferences, buildVideoJobReferencesFromList } from './videoJobReferences';
import {
  availableGenKinds,
  canConnectSourcesToGen,
  genKindOf,
  isConnectableSource,
  sourceKindOf,
  wouldCreateCycle,
  type ConnectGenKind,
} from './connectAbility';
import ConnectTypeMenu from './components/ConnectTypeMenu';
import { checkFileBeforeUpload, isFileRejected } from '@/utils/fileSignature';
import { takeGenHandoff, type GenHandoff } from '@/utils/gen-handoff';
import { takeAgentHandoff } from '@/utils/agent-handoff';
import { defaultProjectName } from '@/lib/projectName';
import { useCanvasDoc } from './hooks/useCanvasDoc';
import { useCanvasHistory, type CanvasHistoryApi } from './hooks/useCanvasHistory';
import {
  applyIndependentGroupDrag,
  bringGroupToFront,
  exclusiveMembersInGroup,
  groupFrameBBox,
  groupToNode,
  isolateNewGroupMembers,
  isForeignGroupMember,
  isGroupMember,
  nodeInsideGroupBox,
  nodePressesGroupEdge,
  parseGroupsFromNodes,
  selectionHasUngroupableCards,
  selectionHasUngroupableGenNodes,
  MIN_GROUP_MEMBERS,
  GROUP_FRAME_PADDING,
  type CanvasGroup,
  type GroupFrameDragResult,
} from './canvasGroups';
import { collectMediaBlocks, type CanvasGalleryRef } from './collectMediaBlocks';
import { blobToUint8Array, buildStoreZip, sniffMediaMime, uniqueDownloadName } from './groupDownloadZip';
import { QUOTE_TEXT_LIMIT, extractTextNodeText, quoteChipLabel, readPromptSource, textQuoteBlock, type QuoteConversationInput } from './quoteConversation';
import {
  canvasLocationSearch,
  pickCanvasIdAfterLoad,
  readCanvasIdFromSearch,
  shouldReturnToProjectsAfterDelete,
} from './canvasQuery';
import type { AtMentionItem } from './atMention';
import styles from './index.module.css';

type ToolMode = 'drag' | 'select';

/** 草稿回退显示名（IKDMQW）：取消回待生成/创建回退共用（节点 data 宽松类型，按字面量收窄） */
function draftFileNameOf(type: unknown): string {
  return type === 'video' ? '视频草稿' : type === 'audio' ? '音频草稿' : '图片草稿';
}

/** 卡片名称已被用户自定义（IKFA8X）：显式 customName 标记，不靠名称内容推断 */
function hasCustomName(node: Node | undefined): boolean {
  return ((node?.data ?? {}) as Record<string, unknown>).customName === true;
}

/** 裁切执行（IKGW1S）：加载源图 → 离屏 canvas（尺寸=裁切结果自然分辨率）drawImage 框内画面
 *  → toBlob 重编码（格式与质量由调用方按 cropOutputFormat 决定）为 File。
 *  返回 null 表示源图加载或编码失败（调用方 toast 后留在裁切模式；jsdom 无 canvas 编码与
 *  图加载，页面测试打桩 getContext/toBlob/Image，真实编码由人工回归覆盖，规格 Testing Decisions）。 */
function cropImageToFile(
  src: string,
  natural: CropNaturalRect,
  format: CropOutputFormat,
): Promise<File | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = natural.width;
    canvas.height = natural.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        ctx.drawImage(img, natural.x, natural.y, natural.width, natural.height, 0, 0, natural.width, natural.height);
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], `crop.${format.ext}`, { type: blob.type || format.mime }) : null),
          format.mime,
          format.quality,
        );
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 裁切内容区矩形（IKGW1N）：源图卡内容盒（mediaContentBox 保持源图宽高比，宽高缺失时
 *  兜底默认尺寸）置于卡片位置 + 22.5 标题偏移；进入裁切（默认全幅框）与渲染期派生共用。 */
function cropBoundsOf(node: Node): CropRect {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const box = mediaContentBox({
    mediaType: 'image',
    width: typeof d.width === 'number' ? d.width : undefined,
    height: typeof d.height === 'number' ? d.height : undefined,
  });
  return {
    x: node.position.x,
    y: node.position.y + MEDIA_CONTENT_TOP_OFFSET,
    width: box.width,
    height: box.height,
  };
}

/** 裁切坐标空间（显示尺寸 × 源图自然分辨率）：自然分辨率缺失（存量图未实测）时为 null。 */
function cropSpaceOf(node: Node, bounds: CropRect): CropCoordinateSpace | null {
  const d = (node.data ?? {}) as Record<string, unknown>;
  if (typeof d.width !== 'number' || typeof d.height !== 'number') return null;
  return {
    displayWidth: bounds.width,
    displayHeight: bounds.height,
    naturalWidth: d.width,
    naturalHeight: d.height,
  };
}

export default function CanvasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  // 优先选中 ?project= 指定的画布（顶部展示该画布名）；切换时回写同一 query 以便刷新还原
  const [currentId, setCurrentId] = useState(() => readCanvasIdFromSearch(searchParams));
  const [showAgent, setShowAgent] = useState(false);
  // 同一画布关闭面板只隐藏，保留会话、编辑器与未发送引用。
  const [agentOpened, setAgentOpened] = useState(false);
  useEffect(() => { if (showAgent) setAgentOpened(true); }, [showAgent]);
  const [agentCandidate, setAgentCandidate] = useState<SessionContentBlock[] | null>(null);
  const cancelAgentCandidate = useCallback(() => setAgentCandidate(null), []);
  useEffect(() => {
    if (!showAgent) setAgentCandidate(null);
  }, [showAgent]);
  useEffect(() => {
    if (!agentCandidate) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAgentCandidate(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [agentCandidate]);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const [connectMenu, setConnectMenu] = useState<{ sourceIds: string[]; x: number; y: number } | null>(null);
  const connectingSourceRef = useRef<string | null>(null);
  const paneUploadRef = useRef<HTMLInputElement>(null);
  const paneUploadPosRef = useRef<{ x: number; y: number } | null>(null);
  const [showBottomDialog, setShowBottomDialog] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showTextGenDialog, setShowTextGenDialog] = useState(false);
  const [textGenDraftId, setTextGenDraftId] = useState<string | null>(null);
  const skipTextGenOpenRef = useRef(false);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperSize, setWrapperSize] = useState({ width: 0, height: 0 });
  const [liveViewport, setLiveViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1.1 });
  /** 「到节点选择」：画布节点选取模式（image/video/audio 对应三个底部对话框；product 商品卡选图） */
  const [pickMode, setPickMode] = useState<'image' | 'video' | 'audio' | 'product' | 'asset' | null>(null);
  /** 选取发起对话框（决定选取结果注入哪个对话框；视频对话框图片槽/首尾帧只选图片节点，视频槽只选视频节点） */
  const [pickTarget, setPickTarget] = useState<'image' | 'video' | 'audio' | 'product' | 'asset' | null>(null);
  /** 视频草稿「到节点选择」的目标参考角色（IKDMQS）：首帧/尾帧由 Dock 入口显式指定，缺省普通参考 */
  const [pickRefRole, setPickRefRole] = useState<VideoRefRole | null>(null);
  /** IKFR4X 图片持续选取会话：undefined=无会话；string=发起时绑定的目标节点 id；null=自由面板会话。
   *  会话身份 = 发起瞬间的画布与生成目标（快照），普通节点选中变化不改变该绑定；纯界面交互态不持久化 */
  const [imagePickSession, setImagePickSession] = useState<string | null | undefined>(undefined);
  /** IKFR4X 结束图片持续选取会话：保留已建参考与原目标 Dock，恢复普通编辑（不生成、不二次确认） */
  const endImagePickSession = useCallback(() => {
    setImagePickSession(undefined);
    setPickMode(null);
    setPickTarget(null);
  }, []);
  /** IKFR4X 图片持续选取会话进行中（派生布尔，会话身份三条件单点收敛） */
  const imagePickSessionActive = pickMode === 'image' && pickTarget === 'image' && imagePickSession !== undefined;
  /** IKFR4Y 视频持续选取会话：undefined=无会话；string=发起时绑定的视频草稿节点 id；null=自由面板会话。
   *  会话角色由 pickRefRole 快照承载（发起入口指定，会话期间无其他写入点）；首尾帧入口发起的
   *  会话槽位已占时以最后一次有效选择替换（IKFR4Y），普通参考入口连续并入。纯界面交互态不持久化 */
  const [videoPickSession, setVideoPickSession] = useState<string | null | undefined>(undefined);
  /** IKFR4Y 结束视频持续选取会话：保留已建参考与原目标 Dock，恢复普通编辑（不生成、不二次确认） */
  const endVideoPickSession = useCallback(() => {
    setVideoPickSession(undefined);
    setPickMode(null);
    setPickTarget(null);
    setPickRefRole(null);
  }, []);
  /** IKFR4Y 视频持续选取会话进行中（派生布尔：视频目标 + 发起槽位类型 + 会话三条件单点收敛） */
  const videoPickSessionActive = pickTarget === 'video'
    && (pickMode === 'image' || pickMode === 'video')
    && videoPickSession !== undefined;
  /** IKFR4Z 音频持续选取会话：undefined=无会话；string=发起时绑定的音频草稿节点 id；null=自由面板会话。
   *  会话身份 = 发起瞬间的画布与生成目标（快照），普通节点选中变化不改变该绑定；音频参考无槽位角色
   *  （服务端契约恒 reference），会话内所有合法来源连续并入。纯界面交互态不持久化 */
  const [audioPickSession, setAudioPickSession] = useState<string | null | undefined>(undefined);
  /** IKFR4Z 结束音频持续选取会话：保留已建参考与原目标 Dock，恢复普通编辑（不生成、不二次确认） */
  const endAudioPickSession = useCallback(() => {
    setAudioPickSession(undefined);
    setPickMode(null);
    setPickTarget(null);
  }, []);
  /** IKFR4Z 音频持续选取会话进行中（派生布尔，会话身份三条件单点收敛） */
  const audioPickSessionActive = pickMode === 'audio' && pickTarget === 'audio' && audioPickSession !== undefined;
  /** 商品卡选取目标节点ID（选中的图片注入哪个商品卡） */
  const [pickProductId, setPickProductId] = useState<string | null>(null);
  /** 资产卡选取目标节点ID（选中的图片注入哪个资产卡） */
  const [pickAssetId, setPickAssetId] = useState<string | null>(null);
  /** 画布节点选取/角色库多选结果（ts 驱动注入图片对话框） */
  const [imagePickResult, setImagePickResult] = useState<{ ts: number; files: UploadedFile[] } | null>(null);
  /** 画布节点选取结果（ts 驱动注入商品卡） */
  const [productPickResult, setProductPickResult] = useState<{ ts: number; productId: string; image: { id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string } } | null>(null);
  /** 画布节点选取结果（ts 驱动注入资产卡） */
  const [assetPickResult, setAssetPickResult] = useState<{ ts: number; assetId: string; ref: CanvasGalleryRef } | null>(null);
  /** 画布音频节点选取结果（ts 驱动注入音频对话框参考音频） */
  const [audioPickResult, setAudioPickResult] = useState<{ ts: number; item: AudioRefItem } | null>(null);
  const [audioAssetPickResult, setAudioAssetPickResult] = useState<{ ts: number; items: AudioRefItem[] } | null>(null);
  const [audioAssetPickTarget, setAudioAssetPickTarget] = useState<{ nodeId: string | null; seed: number | undefined } | null>(null);
  /** AI 音乐面板 @ 选中结果（ts 驱动注入 MusicDialog 参考音频，IKFCKS） */
  const [musicPickResult, setMusicPickResult] = useState<{ ts: number; item: AudioRefItem } | null>(null);
  /** 角色库弹窗状态 */
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  /** 角色库发起目标（决定选中结果注入哪个对话框）；IKFE8U 起视频面板无发起入口 */
  const [characterLibraryTarget, setCharacterLibraryTarget] = useState<'image' | 'asset' | null>(null);
  const [showAudioDialog, setShowAudioDialog] = useState(false);
  const [showMusicDialog, setShowMusicDialog] = useState(false);
  /** 高清放大面板（IKGM9O）：绑定高清卡（草稿或成品卡）的轻量参数面板 */
  const [showEnhanceDialog, setShowEnhanceDialog] = useState(false);
  const [enhanceDraftId, setEnhanceDraftId] = useState<string | null>(null);
  /** 面板种子（打开时快照）：源图尺寸供预检、lastParams 供回填；ts 变化驱动面板重挂载重置 */
  const [enhanceSeed, setEnhanceSeed] = useState<{ ts: number; sourceDims: { width?: number; height?: number }; initialParams: ImageEnhancePanelParams | null } | null>(null);
  /** 高清面板隐藏豁免（口径同 imagePanelHiddenRef）：刚关闭面板后的选中变化不回弹重开 */
  const enhancePanelHiddenRef = useRef(false);
  /** 擦除编辑态（IKGOT7 开关 / IKGOTB 完整交互）：处于擦除编辑的源图卡 node id，null=未进入。
   *  编辑态的其余状态（工具/笔刷/遮罩 ops/活笔/发送中）提升在本页——源图卡内的
   *  EraseMaskLayer 与浮出的工具条/发送条共享同一份；未发送退出（X/Esc/点其他卡/点空白）全部丢弃。 */
  const [eraseTargetNodeId, setEraseTargetNodeId] = useState<string | null>(null);
  const [eraseTool, setEraseTool] = useState<EraseTool>('brush');
  const [eraseBrushRadius, setEraseBrushRadius] = useState(20);
  const [eraseMaskState, setEraseMaskState] = useState<MaskEditState>(EMPTY_MASK_EDIT);
  /** 拖拽进行中的活笔（显示坐标，pointerup 才经 applyMaskOp 固化；null=无拖拽） */
  const [eraseLiveOp, setEraseLiveOp] = useState<MaskOp | null>(null);
  /** 活笔最新值（pointerup 回调读，避免闭包陈旧） */
  const eraseLiveOpRef = useRef<MaskOp | null>(null);
  /** 拖拽收集的折线点（画笔/橡皮共用） */
  const eraseStrokePointsRef = useRef<MaskPoint[]>([]);
  /** 擦除发送中（遮罩上传+创建请求期间，工具条/发送条只读防重复提交） */
  const [eraseSubmitting, setEraseSubmitting] = useState(false);
  /** 裁切编辑态（IKGW1H 模式进出骨架）：处于裁切编辑的源图卡 node id，null=未进入。
   *  单值 state 即单目标约束（同一时刻仅一张卡处于裁切模式）；裁切框与比例（IKGW1N）
   *  状态提升在本页（cropRect/cropPreset，同擦除编辑态口径），确认建卡（IKGW1S）经
   *  exitCropMode/onCropConfirm 接入。 */
  const [cropTargetNodeId, setCropTargetNodeId] = useState<string | null>(null);
  /** 裁切比例模式（IKGW1N）：free=自由；预设=锁比例（边手柄禁用、角手柄等比缩放） */
  const [cropPreset, setCropPreset] = useState<CropPresetKey>('free');
  /** 当前裁切框（IKGW1N，flow 坐标、与内容区 bounds 同系）：null=未在编辑；
   *  进入默认自由比例全幅（fullCropRect），确认时 IKGW1S 读取本框换算自然分辨率裁切 */
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  /** 裁切执行中（IKGW1S：编码+上传期间）：重复点确认直接忽略（面板无 submitting 只读态，
   *  本页侧防双卡；成功即退出模式，失败复位留在模式） */
  const cropSubmittingRef = useRef(false);
  /* ---------- 扩图模式会话（IKGOQX）：管理模式参考持续选取会话 ----------
   * 会话 = 源图卡 id + 四方向扩展量；纯界面交互态不持久化（刷新即退出，无残留）。
   * 四种退出（面板 X / Esc / 点其他卡 / 点画布空白）共用统一退出函数，均不留痕迹
   * （不建卡、不连线、不产生任务）；再次进入从零开始（框与原图重合、默认原图比例）。 */
  const [outpaintNodeId, setOutpaintNodeId] = useState<string | null>(null);
  /** 四方向扩展量（画布 flow 单位）：扩图面板与扩展框共享的唯一状态源 */
  const [outpaintExpands, setOutpaintExpands] = useState<ExpandSides>(ZERO_EXPANDS);
  /** 扩图模式进行中（派生布尔，会话身份单点收敛） */
  const outpaintSessionActive = outpaintNodeId != null;
  /** 结束扩图模式：清会话与扩展量（不留痕迹；再次进入从零开始） */
  const endOutpaintSession = useCallback(() => {
    setOutpaintNodeId(null);
    setOutpaintExpands(ZERO_EXPANDS);
  }, []);
  const [showEdges, setShowEdges] = useState(true);
  /** 对齐吸附开关（IKGGCT T3）：全局持久化（不分画布文档），初始读 localStorage，默认开 */
  const [snapAlignmentOn, setSnapAlignmentOn] = useState(readSnapAlignmentEnabled);
  /** 连线（受控持有：水合恢复、自动保存签名、目标节点附件推导共用，IKDLQF） */
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  /** 连线最新值（避免闭包陈旧：提交前落盘与附件推导用） */
  const referencePlanRef = useRef<(source: string, target: string, syncBindings?: PromptBinding[]) => Promise<void>>(async () => {});
  const edgesRef = useRef<Edge[]>([]);
  edgesRef.current = edges;
  /** 撤销/重做栈（IKD0JT A2）：在节点 refs 就绪后实例化并回填；
   *  此前的消费方（addCanvasEdge 等）经该 ref 惰性调用 */
  const historyRef = useRef<CanvasHistoryApi | null>(null);
  /** 成组（IKD0JT A3）：组 = 节点 ID 名单；底框由 Canvas 按成员包围盒派生。
   *  持久化走伪节点（type: 'groupFrame' 混入 nodes JSON），水合剥离还原 */
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const groupsRef = useRef<CanvasGroup[]>([]);
  groupsRef.current = groups;
  /** 待确认删除的组（列明组内节点数量后再执行删除） */
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<{ id: string; count: number } | null>(null);
  const [submittingNodeId, setSubmittingNodeId] = useState<string | null>(null);
  /** 生成中节点判定（IKDMQQ）：执行期间目标参数与输入连线只读 */
  const isGeneratingNode = (id: string) =>
    id === submittingNodeId || mediaNodesRef.current.some(
      (n) => n.id === id && (n.data as Record<string, unknown> | undefined)?.genStatus === 'generating',
    );
  /** 建立连线（受控去重 + custom 流光渲染形态；与服务端保存校验同口径拒绝重复 (source,target)）。
   *  refRole（IKDMQS）写入 edge.data.refRole 随连线持久化：first 首帧 / last 尾帧，缺省普通参考。
   *  连线进撤销栈（IKD0JT）：id 由 (source,target) 确定性生成，撤销/重做往返保持稳定 */
  /** 新增画布连线。`marker` 用于给连线打语义标记（如提取产物的来源边，IKFS5W）——
   *  参考推导会跳过带标记的来源边，避免把「来源」误当「参考输入」。 */
  const addCanvasEdge = (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => {
    const existing = edgesRef.current.find(e => e.target === target && (e.source === source || (
      e.data?.inputSources && readAssetId((findCanvasNode(e.source)?.data ?? {}) as Record<string, unknown>) === readAssetId((findCanvasNode(source)?.data ?? {}) as Record<string, unknown>)
    )));
    if (existing) {
      const sources = existing.data?.inputSources as { manual: boolean; planNodeIds: string[] } | undefined;
      const markManual = !!(sources && !sources.manual);
      const currentRole = (existing.data as Record<string, unknown> | undefined)?.refRole;
      const nextRole = refRole && refRole !== 'reference' ? refRole : undefined;
      const roleChanged = refRole === 'reference'
        ? currentRole === 'first' || currentRole === 'last'
        : Boolean(nextRole) && currentRole !== nextRole;
      if (!markManual && !roleChanged) return;
      const next = edgesRef.current.map((e) => {
        if (e.id !== existing.id) return e;
        const data: Record<string, unknown> = { ...(e.data ?? {}) };
        if (markManual && sources) data.inputSources = { ...sources, manual: true };
        if (refRole === 'reference') delete data.refRole;
        else if (nextRole) data.refRole = nextRole;
        return { ...e, data };
      });
      historyRef.current?.pushReplaceEdges(edgesRef.current, next);
      edgesRef.current = next;
      setEdges(next);
      return;
    }
    const edgeData: Record<string, unknown> = {
      ...(refRole && refRole !== 'reference' ? { refRole } : {}),
      ...(marker ?? {}),
    };
    const edge: Edge = {
      id: `e-${source}-${target}`,
      source,
      target,
      sourceHandle: null,
      targetHandle: null,
      type: 'custom',
      style: { stroke: '#444' },
      ...(Object.keys(edgeData).length > 0 ? { data: edgeData } : {}),
    };
    historyRef.current?.pushAddEdges([edge]);
    // 同步写入 ref，发送前落盘才能读到本轮新建的连线
    const next = [...edgesRef.current, edge];
    edgesRef.current = next;
    setEdges(next);
  };

  /** 生成卡连到草稿：只建「生成卡 → 产物」，把方案 bindings 写在这条边上，避免走后端 referencePrompt 再给被引用图连产物。 */
  const connectPlanToDraft = (planNodeId: string, targetId: string) => {
    const node = textNodesRef.current.find((n) => n.id === planNodeId);
    const mentions = promptMentionSchema.array().safeParse(node?.data.promptMentions ?? []);
    const marker = node && mentions.success && validPromptMentions(extractTextNodeText(node.data), mentions.data)
      ? { promptReference: { bindings: promptBindingList(mentions.data) } }
      : undefined;
    addCanvasEdge(planNodeId, targetId, undefined, marker);
    if (!marker) return;
    const next = edgesRef.current.map((edge) => (
      edge.source === planNodeId && edge.target === targetId
        ? { ...edge, data: { ...edge.data, ...marker } }
        : edge
    ));
    edgesRef.current = next;
    setEdges(next);
  };
  /** 图片草稿参考连线校验（IKDMQR）：仅当目标是图片草稿且来源是媒体节点时介入——
   *  仅有效图片媒体结果可连入；重复素材（按 assetId 归一，兼容三形态）与超上限明确拒绝，不静默丢弃输入。
   *  文本/商品/资产卡等来源与非草稿目标沿用既有语义（文本附件/未来切片），本函数放行。 */
  const validateImageRefConnect = (sourceId: string, targetId: string): boolean => {
    const target = mediaNodesRef.current.find((n) => n.id === targetId);
    if (!isImageDraftNode(target)) return true;
    const source = mediaNodesRef.current.find((n) => n.id === sourceId);
    if (!source) return true;
    const err = imageRefSourceError(source);
    if (err) {
      showToast('warn', err);
      return false;
    }
    const refs = imageMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current);
    const assetId = readAssetId((source.data ?? {}) as Record<string, unknown>)!;
    if (refs.some((r) => r.assetId === assetId)) {
      const planEdge = edgesRef.current.find(e => e.target === targetId && readAssetId((findCanvasNode(e.source)?.data ?? {}) as Record<string, unknown>) === assetId);
      if ((planEdge?.data?.inputSources as { manual?: boolean } | undefined)?.manual === false) return true;
      showToast('warn', '该素材已连入当前草稿');
      return false;
    }
    if (refs.length >= 10) {
      showToast('warn', refOverflowToast(['image'], { image: 10 }));
      return false;
    }
    return true;
  };
  /** 视频草稿参考连线校验（IKDMQS）：仅当目标是视频草稿且来源是媒体节点时介入——
   *  连线默认普通参考角色（首帧/尾帧在 Dock 显式指定，不按连入顺序猜测）；
   *  仅有效媒体结果可连入；重复素材（按 assetId 归一）与超上限明确拒绝，不静默丢弃输入。
   *  文本/商品/资产卡等来源与非草稿目标沿用既有语义，本函数放行。 */
  const validateVideoRefConnect = (sourceId: string, targetId: string, role: VideoRefRole = 'reference'): boolean => {
    const target = mediaNodesRef.current.find((n) => n.id === targetId);
    if (!isVideoDraftNode(target)) return true;
    const source = mediaNodesRef.current.find((n) => n.id === sourceId);
    if (!source) return true;
    const err = videoRefSourceError(source, role);
    if (err) {
      showToast('warn', err);
      return false;
    }
    const refs = mergedVideoMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current);
    const sourceData = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(sourceData);
    const mediaType = sourceData.mediaType as 'image' | 'video' | 'audio';
    const materialId = typeof sourceData.materialId === 'string' && sourceData.materialId
      ? sourceData.materialId
      : undefined;
    const msg = checkAddVideoRef(role, mediaType, assetId, refs, undefined, [materialId]);
    if (msg) {
      showToast('warn', msg);
      return false;
    }
    return true;
  };
  /** 音频草稿参考连线校验（IKFDFZ）：仅当目标是音频草稿且来源是媒体节点时介入——
   *  仅有效音频媒体结果可连入（服务端契约允许单图片参考，但音频面板不提供图片入口）；
   *  重复素材（按 assetId 归一）与超上限明确拒绝，不静默丢弃输入。
   *  文本卡等来源与非草稿目标沿用既有语义（文本附件），本函数放行。 */
  const validateAudioRefConnect = (sourceId: string, targetId: string): boolean => {
    const target = mediaNodesRef.current.find((n) => n.id === targetId);
    if (!isAudioDraftNode(target)) return true;
    if (isGeneratingNode(targetId)) {
      showToast('warn', '生成中，输入连线只读');
      return false;
    }
    const source = mediaNodesRef.current.find((n) => n.id === sourceId);
    if (!source) return true;
    const err = audioRefSourceError(source);
    if (err) {
      showToast('warn', err);
      return false;
    }
    const refs = audioMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current).refs;
    const assetId = readAssetId((source.data ?? {}) as Record<string, unknown>);
    const msg = checkAddAudioRef(assetId, refs);
    if (msg) {
      showToast('warn', msg);
      return false;
    }
    return true;
  };
/** 单条连线：可接到已有节点（含成品图）；目标若是生成节点则再做能力与参考校验 */
  const findCanvasNode = (id: string): Node | undefined =>
    mediaNodesRef.current.find((n) => n.id === id)
    ?? textNodesRef.current.find((n) => n.id === id)
    ?? productNodesRef.current.find((n) => n.id === id)
    ?? assetNodesRef.current.find((n) => n.id === id);

  /** 视频草稿连线角色：Dock 显式槽位优先；首尾帧模式拖线/@ 按空槽自动占首帧再占尾帧。 */
  const videoEdgeRoleFor = (targetId: string, requested?: VideoRefRole | null): VideoRefRole => {
    if (requested === 'first' || requested === 'last') return requested;
    const target = mediaNodesRef.current.find((n) => n.id === targetId);
    const mode = (target?.data as Record<string, unknown> | undefined)?.draftMode;
    if (mode !== 'keyframe') return 'reference';
    const refs = mergedVideoMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current);
    if (!refs.first) return 'first';
    if (!refs.last) return 'last';
    return 'reference';
  };

  const connectPair = (source: string, target: string): boolean => {
    if (applyingRef.current || !source || !target || source === target) return false;
    if (isGeneratingNode(target)) {
      showToast('warn', '生成中，输入连线只读');
      return false;
    }
    const sourceNode = findCanvasNode(source);
    const targetNode = findCanvasNode(target);
    if (!sourceNode || !targetNode) return false;
    const sourceData = sourceNode.data as Record<string, unknown> | undefined;
    const targetData = targetNode.data as Record<string, unknown> | undefined;
    if (sourceData?.emptyShell || targetData?.emptyShell) return false;
    const imageRefOk = genKindOf(targetNode) === 'image' && sourceNode.type === 'mediaNode'
      && imageRefSourceError(sourceNode) === null;
    if (!imageRefOk && !isConnectableSource(sourceNode)) return false;
    if (wouldCreateCycle(source, target, edgesRef.current)) return false;
    // IKFM3Q 契约 §4：媒体→文本卡的关系线只由正文 @ 索引建立；手工拖线拒绝，不出现无索引的线
    if (sourceNode.type === 'mediaNode' && targetNode.type === 'textNode') {
      showToast('warn', '媒体到文本卡的关系线由正文 @ 索引建立');
      return false;
    }
    const targetKind = genKindOf(targetNode);
    const videoRole = targetKind === 'video' && sourceNode.type === 'mediaNode'
      ? videoEdgeRoleFor(target)
      : undefined;
    if (targetKind) {
      if (!imageRefOk && !canConnectSourcesToGen([sourceNode], targetKind)) return false;
      if (sourceNode?.type === 'textNode' && sourceData?.promptSource && (targetKind === 'image' || targetKind === 'video')) {
        connectPlanToDraft(source, target);
        return true;
      }
      if (!validateImageRefConnect(source, target)) return false;
      if (targetKind === 'video' && videoRole === 'reference' && targetData?.draftMode === 'keyframe') {
        const refs = mergedVideoMediaRefsOf(target, edgesRef.current, mediaNodesRef.current);
        if (refs.first || refs.last) {
          showToast('warn', '首帧和尾帧已指定，请先移除现有帧');
          return false;
        }
      }
      if (!validateVideoRefConnect(source, target, videoRole ?? 'reference')) return false;
      if (!validateAudioRefConnect(source, target)) return false;
    }
    addCanvasEdge(source, target, videoRole);
    return true;
  };
  /** 建立连线：拒绝自环（生成中节点的输入连线只读 IKDMQQ：向目标新建连线被拦截）；
 *  图片草稿目标的来源校验见 validateImageRefConnect */
  const handleConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      connectPair(params.source, params.target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, submittingNodeId],
  );
  /** 组→目标（兼容旧回调）：组拖线现已统一走 handleConnectGroupDrop 弹可选菜单，不再接到已有节点。 */
  const handleConnectGroupToTarget = useCallback(
    (memberIds: string[], targetId: string) => {
      if (memberIds.length === 0 || !targetId) return;
      memberIds.forEach((m) => connectPair(m, targetId));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, submittingNodeId],
  );
  /** 源→组：外部节点拖到组左侧「+」，为该源到组内每个成员各建一条边（每个成员都引用该源输出）。 */
  const handleConnectSourceToGroup = useCallback(
    (sourceId: string, memberIds: string[]) => {
      if (!sourceId || memberIds.length === 0) return;
      memberIds.forEach((m) => connectPair(sourceId, m));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, submittingNodeId],
  );
  const removeTargetInputs = (edgeIds: string[]) => {
    if (applyingRef.current) return;
    const before = edgesRef.current;
    const after = releaseRemovedPromptSources(before, before.filter(edge => !edgeIds.includes(edge.id)));
    historyRef.current?.pushReplaceEdges(before, after);
    // IKFR4Y：同步 ref——首尾帧槽位替换在同一次点击里先移除旧槽位边再建新边，
    // 下游 addCanvasEdge 读 edgesRef.current 必须已见移除结果（与 addCanvasEdge 自身同步口径一致）
    edgesRef.current = after;
    setEdges(after);
  };
  /** 正文媒体索引关系线（IKFM3Q 契约 §4）：事件驱动建删——TextNode 显式插入/重绑定建线、
   *  最后标签删除线；不做全量派生同步，被手动删除的线不得在此自动补回。 */
  const syncTextIndexEdges = (textId: string, delta: { added: string[]; removed: string[] }) => {
    if (applyingRef.current) return;
    const removeIds = delta.removed.map(source => `e-${source}-${textId}`).filter(id => edgesRef.current.some(edge => edge.id === id));
    if (removeIds.length > 0) removeTargetInputs(removeIds);
    const additions = delta.added.filter(source => !edgesRef.current.some(edge => edge.source === source && edge.target === textId));
    if (additions.length === 0) return;
    const newEdges: Edge[] = additions.map(source => ({
      id: `e-${source}-${textId}`,
      source,
      target: textId,
      sourceHandle: null,
      targetHandle: null,
      type: 'custom',
      style: { stroke: '#444' },
      data: { textIndex: true },
    }));
    historyRef.current?.pushAddEdges(newEdges);
    const next = [...edgesRef.current, ...newEdges];
    edgesRef.current = next;
    setEdges(next);
  };
  /** 文本卡 media 索引变更：区间与展示快照写入节点 data，关系线按 delta 建删（契约 §4） */
  const handleMediaIndexChange = (id: string, mediaMentions: MediaMention[], mediaRefs: MediaRef[], delta: { added: string[]; removed: string[] }) => {
    setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, mediaMentions, mediaRefs } } : n));
    syncTextIndexEdges(id, delta);
  };
  const removePlanAttachment = (targetId: string | undefined, planNodeId: string) => {
    if (!targetId || isGeneratingNode(targetId)) return;
    removeTargetInputs(edgesRef.current.filter(edge => edge.source === planNodeId && edge.target === targetId).map(edge => edge.id));
  };
  /** 图片/视频面板移除文本附件（IKFCKN/IKFCXC）：× 仅断开当前目标连线（保留画布原文本卡与其他目标关系，
   *  走既有 removePlanAttachment 断边链路，与画布断线同一结果），并同步自由模式的附件快照
   *  （快照渲染自 seed，断边不会自动反映到面板）。
   *  生成中守卫与断边链路对齐：守卫命中时边保留，快照也保持一致（防面板与画布脱节）。
   *  setSeed 由调用方在 JSX 回调中传入——声明处先于 useState 定义，直接引用 setter 会撞 TDZ。 */
  const removeTextAttachment = <S extends { attachments?: ImageTextAttachment[] }>(
    setSeed: (updater: (s: S | null) => S | null) => void,
    targetId: string | undefined,
    nodeId: string,
  ) => {
    if (targetId && isGeneratingNode(targetId)) return;
    removePlanAttachment(targetId, nodeId);
    setSeed((s) => (s ? { ...s, attachments: s.attachments?.filter((a) => a.nodeId !== nodeId) } : s));
  };
  /** 连线变更守卫（IKDMQQ）：生成中节点的入边删除变更被拦截（剪刀等 remove 路径统一收口）；
   *  放行的删边进撤销栈（IKD0JT），撤销可加回 */
  const guardEdgesChange: typeof onEdgesChange = (changes) => {
    const allowed = changes.filter((c) => {
      if (c.type !== 'remove') return true;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      return edge ? !isGeneratingNode(edge.target) : true;
    });
    if (allowed.length < changes.length) showToast('warn', '生成中，输入连线只读');
    // 删边登记撤销（放行部分）
    const removedEdges: Edge[] = [];
    for (const c of allowed) {
      if (c.type !== 'remove') continue;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      if (edge) removedEdges.push(edge);
    }
    if (removedEdges.length > 0) removeTargetInputs(removedEdges.map(edge => edge.id));
    const otherChanges = allowed.filter(change => change.type !== 'remove');
    if (otherChanges.length > 0) onEdgesChange(otherChanges);
  };
  const [uploadedNodes] = useState<Node[]>([]);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warn'; msg: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  /** 显示 toast 提示 */
  const showToast = useCallback((type: 'success' | 'error' | 'warn', msg: string) => {
    setToast({ type, msg });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);
  const [textNodes, setTextNodes] = useState<Node[]>([]);
  const [mediaNodes, setMediaNodes] = useState<Node[]>([]);
  const [productNodes, setProductNodes] = useState<Node[]>([]);
  const [assetNodes, setAssetNodes] = useState<Node[]>([]);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  /** 工具栏加号 →「资产库选择」弹窗开关 */
  const [showAssetsPicker, setShowAssetsPicker] = useState(false);
  /** 资产选择弹窗的打开来源（决定 mediaTypes 过滤与确认后的去向）：
   *  toolbar 画布工具栏（全类型落画布）/ videoDraft 视频草稿面板（落画布+按槽位连线）/ imageDialog 图片 dock / agentPanel Agent 面板 */
  const [assetsPickerTarget, setAssetsPickerTarget] = useState<'toolbar' | 'videoDraft' | 'imageDialog' | 'audioDialog' | 'agentPanel'>('toolbar');
  /** 打开资产选择弹窗（记录来源入口，确认时按来源路由） */
  const openAssetsPicker = (target: typeof assetsPickerTarget) => {
    setAssetsPickerTarget(target);
    setShowAssetsPicker(true);
  };
  /** 视频草稿面板「从资产中选择」的目标槽位角色：first/last 仅图片，reference 按模式过滤 */
  const [videoAssetPickRole, setVideoAssetPickRole] = useState<VideoRefRole>('reference');
  /** 同一入口的槽位类型边界（IKFE8U）：'video' 全能参考（图/视频/音频）、'image' 仅图片
   *  （首尾帧槽 / 图生视频普通参考）——资产弹窗 mediaTypes 过滤与确认接纳共用 */
  const [videoAssetPickKind, setVideoAssetPickKind] = useState<'image' | 'video'>('video');
  /** 资产库选择 → Agent 面板待发附件（ts 驱动注入，画布侧已落节点） */
  const [agentAssetPicks, setAgentAssetPicks] = useState<{ ts: number; blocks: SessionContentBlock[] } | null>(null);
  const [assetsModalDefaultTab, setAssetsModalDefaultTab] = useState<string | undefined>(undefined);
  const [assetsModalDefaultFilter, setAssetsModalDefaultFilter] = useState<string | undefined>(undefined);
  const [assetDetailTarget, setAssetDetailTarget] = useState<AssetRecord | null>(null);
  const [assetDetailLoading, setAssetDetailLoading] = useState(false);
  const assetDetailRequestIdRef = useRef(0);
  /** label 有值时是生成卡引用（侧边栏渲染成胶囊）；无 label 是普通 @ 文本预填；mediaBlocks 携带媒体元数据 */
  const [agentContext, setAgentContext] = useState<{
    text: string;
    label?: string;
    skillId?: string;
    skillName?: string;
    ts: number;
    mediaBlocks?: SessionContentBlock[];
  } | null>(null);

  /** 首页发送框携带草稿跳转：打开 Agent 弹框并注入输入框，随后清除导航状态避免刷新重复注入。
   *  智能体附件（首页 + 上传的图/视频）经模块变量 handoff 带入：此处上传得 assetId 构造
   *  asset_ref 媒体块挂进 agentContext.mediaBlocks，复用 AgentPanel 既有的注入链路。 */
  useEffect(() => {
    const state = location.state as { agentText?: string; skillId?: string; skillName?: string } | null;
    if (!state?.agentText && !state?.skillId) return;
    const attachments = takeAgentHandoff();
    const inject = async () => {
      let mediaBlocks: SessionContentBlock[] | undefined;
      if (attachments && attachments.length > 0) {
        const blocks: SessionContentBlock[] = [];
        for (const item of attachments) {
          if (item.assetId != null) {
            // 资产库选择项：已有 assetId，直接复用（不重复上传），preview 即永久 URL
            rememberAssetUrl(String(item.assetId), item.preview);
            blocks.push({
              type: 'asset_ref',
              url: item.preview,
              name: item.name,
              media_type: item.kind,
              display_label: item.name,
              asset_id: String(item.assetId),
            });
          } else if (item.file) {
            const uploaded = await uploadFileToAsset(item.file, item.kind);
            if (uploaded) {
              // 用 complete 返回的永久 URL（不是会被 revoke 的 objectURL），
              // 并登记进 MessageAssetPreview 的缓存：发送后乐观气泡立刻能显示缩略图
              rememberAssetUrl(uploaded.asset_id, uploaded.url);
              blocks.push({
                type: 'asset_ref',
                url: uploaded.url,
                name: item.name,
                media_type: item.kind,
                display_label: item.name,
                asset_id: uploaded.asset_id,
              });
            } else {
              console.warn('首页附件上传失败，已跳过:', item.name);
            }
            URL.revokeObjectURL(item.preview);
          } else {
            console.warn('首页附件缺少 file/assetId，已跳过:', item.name);
          }
        }
        mediaBlocks = blocks.length > 0 ? blocks : undefined;
      }
      setAgentContext({
        text: state.agentText ?? '',
        skillId: state.skillId ?? '',
        skillName: state.skillName ?? '',
        ts: Date.now(),
        mediaBlocks,
      });
      setShowAgent(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
    };
    void inject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, location.search, navigate]);
  /** 节点工具条带入图片对话框的初始值（ts 作为 key 强制重挂载以注入初始值）；
   *  params 是首页 AI图片 带入的生成参数（选中首页所选模型/清晰度/宽高比）；
   *  targetNodeId/attachments 仅图片媒体节点面板发起时存在（IKDLQF）：提交携带 target_node_id，
   *  附件在打开当下按连线快照，面板只读展示 */
  const [imageSeed, setImageSeed] = useState<{ ts: number; text: string; files: UploadedFile[]; params?: ImageGenSeedParams; targetNodeId?: string; attachments?: ImageTextAttachment[]; promptDoc?: PromptDoc | null } | null>(null);
  /** 面板当前绑定的图片草稿节点 id（IKDMQQ）：仅草稿入口（侧栏新建/点击草稿卡）设置；
   *  草稿被删除/取消或成功转成品卡时由清理 effect 结束绑定并关闭面板 */
  const [imageDraftId, setImageDraftId] = useState<string | null>(null);
  const imagePanelHiddenRef = useRef(false);
  const videoPanelHiddenRef = useRef(false);
  const audioPanelHiddenRef = useRef(false);
  const editingTargetRef = useRef<string | null>(null);
  /** 面板当前绑定的视频草稿节点 id（IKDMQS）：仅草稿入口（侧栏新建/点击草稿卡）设置；
   *  生命周期与图片草稿绑定一致 */
  const [videoDraftId, setVideoDraftId] = useState<string | null>(null);
  /** 工具栏自由模式（无草稿卡）的视频参考：本地暂存首帧/尾帧/普通参考，
   *  发送时随任务一次性提交，关闭面板即丢弃（不落画布不连线） */
  const [videoFreeRefs, setVideoFreeRefs] = useState<VideoMediaRefs>({ reference: [] });
  /** 节点工具条/首页带入视频对话框的种子；
   *  params 是首页 AI视频 带入的生成参数（选中首页所选模型/比例/清晰度/时长/模式） */
  const [videoSeed, setVideoSeed] = useState<{ ts: number; text?: string; doc?: PromptDoc | null; params?: VideoGenSeedParams; targetNodeId?: string; attachments?: ImageTextAttachment[] } | null>(null);
  /** 音频对话框的重挂载 key；草稿入口（IKDMQT）同时携带文字描述/模型/目标节点 */
  const [audioSeed, setAudioSeed] = useState<{ ts: number; text?: string; modelId?: string; targetNodeId?: string; doc?: PromptDoc | null; refs?: AudioRefItem[] } | null>(null);
  /** 面板当前绑定的音频草稿节点 id（IKDMQT）：仅草稿入口（侧栏新建/点击草稿卡）设置；
   *  生命周期与图片/视频草稿绑定一致 */
  const [audioDraftId, setAudioDraftId] = useState<string | null>(null);
  /** 侧栏新建草稿的显式选中请求（IKDMQV）：新卡自动选中并取消其余。
   *  经 Canvas 内部 setNodes 应用——直接经 nodes selected 字段传播会因 React Flow
   *  selection store 的时序差报双选中，把自动打开的绑定面板当多选误关 */
  const [selectRequest, setSelectRequest] = useState<{ id: string; ts: number } | null>(null);
  /** 粘贴自动多选请求（IKGBPA）：机制同 selectRequest，一次选中整组新副本 */
  const [selectManyRequest, setSelectManyRequest] = useState<{ ids: string[]; ts: number } | null>(null);
  /** 首页 AI视频/AI图片 生成交接：消费后置入此 ref，待项目就绪触发创建任务 */
  const pendingGenRef = useRef<GenHandoff | null>(null);
  /** 首页 AI视频 带入的草稿参数种子：待项目与文档就绪后新建视频草稿卡并打开绑定面板 */
  const pendingVideoDraftSeedRef = useRef<VideoGenSeedParams | null>(null);
  /** 首页 AI视频/AI图片 发送带入：新建视频草稿卡+绑定面板（参数写入草稿 data，任务由 firePendingGen 直接创建） */
  useEffect(() => {
    const state = location.state as { genKind?: 'video' | 'image' } | null;
    if (!state?.genKind) return;
    const handoff = takeGenHandoff();
    if (!handoff) {
      // 刷新/直开页面：交接数据已失效，仅清导航状态
      navigate(location.pathname + location.search, { replace: true, state: null });
      return;
    }
    if (handoff.kind === 'video') {
      // 统一草稿绑定：存参数种子，待项目就绪由 firePendingVideoDraft 新建草稿卡并开面板；
      // 任务仍由 firePendingGen 直接创建（生成卡落画布）
      pendingVideoDraftSeedRef.current = {
        modelId: handoff.modelId,
        aspectRatio: handoff.aspectRatio,
        resolution: handoff.resolution,
        duration: handoff.duration,
        mode: handoff.mode,
        // IKG0LP：音频选择随种子带入面板
        generateAudio: handoff.generateAudio,
      };
    } else {
      setImageSeed({
        ts: Date.now(),
        text: '',
        files: [],
        params: { modelId: handoff.modelId, ratio: handoff.ratio, size: handoff.size },
      });
      // IKFYH6：自由面板打开路径同样重置隐藏标记，否则选中变化关闭对该面板失效
      imagePanelHiddenRef.current = false;
      setShowImageDialog(true);
      setShowBottomDialog(false);
      setShowAudioDialog(false);
      setShowMusicDialog(false);
    }
    pendingGenRef.current = handoff;
    // 项目已就绪则立即创建生成节点与草稿卡；未就绪由 currentId/doc 变化后的 effect 重试
    actionsRef.current.firePendingGen?.();
    actionsRef.current.firePendingVideoDraft?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, location.search, navigate]);
  /** 当前视口（拖拽/缩放结束更新），自动保存时序列化提交 */
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1.1 });
  useEffect(() => { setLiveViewport(viewport); }, [viewport]);
  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    const update = () => setWrapperSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    // jsdom 无 ResizeObserver，测试环境仅取首帧尺寸，不做后续观察
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  /** 输入 dock 等覆盖层不在 .react-flow 内：Ctrl/Cmd+滚轮会走浏览器整页缩放，
   *  表现为 dock 跟着放大、缩小却不回（画布缩放与页面缩放脱节）。捕获阶段拦截。 */
  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.react-flow')) return;
      event.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, true);
  }, []);
  /** FlowCanvas 注册的屏幕点→flow 坐标转换（无参默认取视口中心），注册前回退原点附近 */
  const spawnPosRef = useRef<(screenPt?: { x: number; y: number }) => { x: number; y: number }>(
    () => ({ x: 300, y: 200 }),
  );
  const registerSpawnPosition = useCallback(
    (fn: (screenPt?: { x: number; y: number }) => { x: number; y: number }) => {
      spawnPosRef.current = fn;
    },
    [],
  );
  /** 新节点出生位：以视口中心为原点在小范围内随机错乱堆叠。
   *  不避碰、不外扩，新节点都落在中心 ±80px 的方形区域内，自然堆叠。 */
  const spawnPosition = () => {
    const c = spawnPosRef.current();
    return {
      x: Math.round(c.x + (Math.random() * 160 - 80)),
      y: Math.round(c.y + (Math.random() * 160 - 80)),
    };
  };
  /** 落在屏幕点附近并避开已有节点 */
  const spawnNearScreen = (screenPt: { x: number; y: number }) => {
    const center = spawnPosRef.current(screenPt);
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    return nextDraftPosition({ center, dockTop: center.y + 2000, nodes: nodes.map(nodeBoxOf) });
  };
  /** 底部 Dock 预留高度（屏幕像素）：草稿出生点纵向避开即将打开的面板区域（IKDMQQ） */
  const DOCK_RESERVE_PX = 300;
  /** 既有节点的占位盒（flow 坐标）：媒体节点按内容区规则估算并加标题余量，其余按默认尺寸 */
  const nodeBoxOf = (n: Node): SpawnBox => {
    const d = (n.data ?? {}) as Record<string, unknown>;
    if (n.type === 'mediaNode') {
      const box = mediaContentBox({
        mediaType: d.mediaType as 'image' | 'video' | 'audio' | undefined,
        width: typeof d.width === 'number' ? d.width : undefined,
        height: typeof d.height === 'number' ? d.height : undefined,
        ratio: d.targetRatio as string | undefined,
      });
      return { x: n.position.x, y: n.position.y, width: box.width, height: box.height + 44 };
    }
    return { x: n.position.x, y: n.position.y, width: 320, height: 340 };
  };
  const followTargetId = showEnhanceDialog && enhanceDraftId
    ? enhanceDraftId
    : showImageDialog && imageDraftId
    ? imageDraftId
    : showBottomDialog && videoDraftId
      ? videoDraftId
      : showAudioDialog && audioDraftId
        ? audioDraftId
        : showTextGenDialog && textGenDraftId
          ? textGenDraftId
          : null;
  const followNode = followTargetId
    ? mediaNodes.find((n) => n.id === followTargetId) ?? textNodes.find((n) => n.id === followTargetId) ?? null
    : null;
  const followAnchor = followNode && wrapperSize.width > 0
    ? computeFollowAnchor({
        nodeX: followNode.position.x,
        nodeY: followNode.position.y,
        nodeWidth: nodeBoxOf(followNode).width,
        nodeHeight: nodeBoxOf(followNode).height,
        viewport: liveViewport,
        containerWidth: wrapperSize.width,
        containerHeight: wrapperSize.height,
      })
    : null;
  /** 高清面板跟随锚（IKGM9O）：轻量面板宽 320，与 740 宽的通用锚分开计算 */
  const enhanceFollowAnchor = followNode && showEnhanceDialog && enhanceDraftId && wrapperSize.width > 0
    ? computeFollowAnchor({
        nodeX: followNode.position.x,
        nodeY: followNode.position.y,
        nodeWidth: nodeBoxOf(followNode).width,
        nodeHeight: nodeBoxOf(followNode).height,
        viewport: liveViewport,
        containerWidth: wrapperSize.width,
        containerHeight: wrapperSize.height,
        dialogWidth: 320,
      })
    : null;
  /** 擦除编辑态跟随锚（IKGOTB）：源图卡上方工具条 / 下方发送条。发送条复用 computeFollowAnchor
   *  （恒锚节点下方）；工具条在节点上方，手动换算（工具条高约 42 + 间距 10）。 */
  const eraseSourceNode = eraseTargetNodeId
    ? mediaNodes.find((n) => n.id === eraseTargetNodeId) ?? null
    : null;
  const eraseToolbarAnchor = (() => {
    if (!eraseSourceNode || wrapperSize.width <= 0) return null;
    const box = nodeBoxOf(eraseSourceNode);
    const zoom = liveViewport.zoom || 1;
    const screenLeft = eraseSourceNode.position.x * zoom + liveViewport.x;
    const screenTop = eraseSourceNode.position.y * zoom + liveViewport.y;
    const center = Math.round(screenLeft + (box.width * zoom) / 2);
    return {
      left: Math.max(60, Math.min(center, wrapperSize.width - 60)),
      top: Math.round(Math.max(8, screenTop - 52)),
    };
  })();
  const eraseSendBarAnchor = eraseSourceNode && wrapperSize.width > 0
    ? computeFollowAnchor({
        nodeX: eraseSourceNode.position.x,
        nodeY: eraseSourceNode.position.y,
        nodeWidth: nodeBoxOf(eraseSourceNode).width,
        nodeHeight: nodeBoxOf(eraseSourceNode).height,
        viewport: liveViewport,
        containerWidth: wrapperSize.width,
        containerHeight: wrapperSize.height,
        dialogWidth: 240,
      })
    : null;
  /** 擦除遮罩坐标空间（显示尺寸 × 源图自然分辨率）：显示尺寸与 MediaNode 内容区同源
   *  （mediaContentBox 保持源图宽高比）；自然分辨率缺失（存量图未实测）时为 null，涂抹发送禁用。 */
  const eraseDisplayBox = (() => {
    if (!eraseSourceNode) return null;
    const d = (eraseSourceNode.data ?? {}) as Record<string, unknown>;
    return mediaContentBox({
      mediaType: 'image',
      width: typeof d.width === 'number' ? d.width : undefined,
      height: typeof d.height === 'number' ? d.height : undefined,
    });
  })();
  const eraseMaskSpace = (() => {
    if (!eraseSourceNode || !eraseDisplayBox) return null;
    const d = (eraseSourceNode.data ?? {}) as Record<string, unknown>;
    if (typeof d.width !== 'number' || typeof d.height !== 'number') return null;
    return {
      displayWidth: eraseDisplayBox.width,
      displayHeight: eraseDisplayBox.height,
      naturalWidth: d.width,
      naturalHeight: d.height,
    } satisfies MaskCoordinateSpace;
  })();
  /** 存在有效涂区（最终并集非空：涂了又被橡皮全擦掉不算）：涂抹发送门 */
  const eraseHasPaint = eraseDisplayBox
    ? maskHasPaintArea(eraseMaskState.ops, eraseDisplayBox.width, eraseDisplayBox.height)
    : eraseMaskState.ops.some((op) => !op.erase);
  /** 裁切编辑态派生量（IKGW1N）：源图卡 / 内容区矩形（flow 坐标，标题偏移 22.5px）/
   *  坐标空间（64 像素下限换算用；源图自然分辨率缺失时为 null → 无下限兜底，确认门由 IKGW1S 处理） */
  const cropSourceNode = cropTargetNodeId
    ? mediaNodes.find((n) => n.id === cropTargetNodeId) ?? null
    : null;
  const cropBounds = cropSourceNode ? cropBoundsOf(cropSourceNode) : null;
  const cropSpace = cropSourceNode && cropBounds ? cropSpaceOf(cropSourceNode, cropBounds) : null;
  /** 64 自然像素下限换算到显示坐标系（分辨率缺失时 0=无下限） */
  const cropMinSide = cropSpace ? minCropSideDisplay(cropSpace) : 0;
  /** 裁切面板跟随锚（IKGW1N）：源图卡下方（computeFollowAnchor 恒锚节点下方） */
  const cropPanelAnchor = cropSourceNode && wrapperSize.width > 0
    ? computeFollowAnchor({
        nodeX: cropSourceNode.position.x,
        nodeY: cropSourceNode.position.y,
        nodeWidth: nodeBoxOf(cropSourceNode).width,
        nodeHeight: nodeBoxOf(cropSourceNode).height,
        viewport: liveViewport,
        containerWidth: wrapperSize.width,
        containerHeight: wrapperSize.height,
        dialogWidth: 380,
      })
    : null;
  /* ---------- 扩图模式派生量（IKGOQX） ---------- */
  /** 源图卡与内容区矩形（扩展框与面板的锚定基准；内容区 = 节点左上角 + 标题偏移 + 内容盒） */
  const outpaintSourceNode = outpaintSessionActive
    ? mediaNodes.find((n) => n.id === outpaintNodeId) ?? null
    : null;
  const outpaintContentBox = outpaintSourceNode
    ? mediaContentBox({
        mediaType: ((outpaintSourceNode.data ?? {}) as Record<string, unknown>).mediaType as 'image' | undefined,
        width: typeof ((outpaintSourceNode.data ?? {}) as Record<string, unknown>).width === 'number'
          ? ((outpaintSourceNode.data ?? {}) as Record<string, unknown>).width as number
          : undefined,
        height: typeof ((outpaintSourceNode.data ?? {}) as Record<string, unknown>).height === 'number'
          ? ((outpaintSourceNode.data ?? {}) as Record<string, unknown>).height as number
          : undefined,
      })
    : null;
  const outpaintRect: SourceRect | null = outpaintSourceNode && outpaintContentBox
    ? {
        x: outpaintSourceNode.position.x,
        y: outpaintSourceNode.position.y + MEDIA_CONTENT_TOP_OFFSET,
        width: outpaintContentBox.width,
        height: outpaintContentBox.height,
      }
    : null;
  /** 扩图工具栏跟随锚：横条自适应内容宽，定位走「中心点」语义（组件内 translateX(-50%)
   *  真居中，不受估宽误差影响）；估半宽只用于视口钳制。跟随扩展框中心与其下方（外扩让位）。 */
  const OUTPAINT_TOOLBAR_HALF_WIDTH = 180;
  const outpaintFollowAnchor = outpaintSourceNode && outpaintRect && wrapperSize.width > 0
    ? (() => {
        const zoom = liveViewport.zoom || 1;
        const frameLeft = outpaintRect.x - outpaintExpands.left;
        const frameWidth = outpaintRect.width + outpaintExpands.left + outpaintExpands.right;
        const centerX = frameLeft * zoom + liveViewport.x + (frameWidth * zoom) / 2;
        const left = Math.max(
          FOLLOW_PAD + OUTPAINT_TOOLBAR_HALF_WIDTH,
          Math.min(centerX, wrapperSize.width - FOLLOW_PAD - OUTPAINT_TOOLBAR_HALF_WIDTH),
        );
        const top = (outpaintSourceNode.position.y + outpaintRect.height + MEDIA_CONTENT_TOP_OFFSET + outpaintExpands.bottom) * zoom
          + liveViewport.y + FOLLOW_GAP;
        return { left: Math.round(left), top: Math.round(top) };
      })()
    : null;
  /** 点比例预设：以原图中心为锚外扩到该比例最小包含框（不可达预设已在面板置灰，此处防御返回） */
  const handleOutpaintPresetSelect = useCallback(
    (key: OutpaintPresetKey) => {
      if (!outpaintRect) return;
      const next = presetExpands(outpaintRect, key, maxExpandPerSide(outpaintRect));
      if (!next) return;
      setOutpaintExpands(next);
    },
    [outpaintRect],
  );
  /** 草稿卡出生位（IKDMQQ）：视口中心附近空位，避开底部 Dock 预留区与既有节点 */
  const spawnDraftPosition = () => {
    const center = spawnPosRef.current();
    const dockTop = spawnPosRef.current({ x: window.innerWidth / 2, y: window.innerHeight - DOCK_RESERVE_PX }).y;
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    return nextDraftPosition({ center, dockTop, nodes: nodes.map(nodeBoxOf) });
  };
  /** 画布保存状态：idle 未保存 / saving 保存中 / saved 已保存 / error 保存失败 */
  const draftErrorsRef = useRef(new Map<string, string>());
  const handleDraftError = (id: string, error: string) => {
    if (error) draftErrorsRef.current.set(id, error);
    else draftErrorsRef.current.delete(id);
    setSaveStatus(error ? 'error' : 'idle');
    setSaveEpoch(value => value + 1);
  };
  const blockInvalidDraft = (ids: string[]) => {
    const id = ids.find(id => draftErrorsRef.current.has(id));
    if (!id) return false;
    showToast('warn', `文本节点 ${id}：${draftErrorsRef.current.get(id)}，请修正后继续`);
    return true;
  };
  const quoteMutation = useMutation({ mutationFn: createConversationQuote });
  const applyMutation = useMutation({ mutationFn: applyPromptPreview });
  const referencePlanMutation = useMutation({ mutationFn: (input: Parameters<typeof referencePromptPlan>[0]) => referencePromptPlan(input) });
  const applyingRef = useRef(false);
  const [applying, setApplying] = useState(false);
  const [saveEpoch, setSaveEpoch] = useState(0);
  const savePromiseRef = useRef<Promise<unknown> | null>(null);
  const activeProjectRef = useRef(currentId);
  activeProjectRef.current = currentId;
  const [focusViewport, setFocusViewport] = useState<Viewport>();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveBlocked, setSaveBlocked] = useState(false);
  /** 最近一次保存成功时间（HH:mm） */
  const [savedAt, setSavedAt] = useState('');
  /** 画布乐观锁版本号（来自快照；null 表示从未保存，If-Match 传 missing） */
  const versionRef = useRef<number | null>(null);
  /** 最近一次加载/保存成功的内容签名，避免重复保存 */
  const lastSavedRef = useRef('');
  /** 尚未被服务端确认保存的新增节点 ID——「添加失败」回滚用。
   *  自动保存发起时对当前集合做快照：成功清快照、失败只回滚快照，
   *  请求飞行中新增的节点留给下一轮保存处理，不会被误判为添加失败。 */
  const pendingNodeIdsRef = useRef<Set<string>>(new Set());
  /** 回滚未保存成功的新增节点：从画布移除并释放 blob URL */
  const rollbackPendingNodes = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    [...mediaNodesRef.current, ...textNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current].forEach((n) => {
      if (ids.has(n.id)) {
        const src = n.data?.src as string | undefined;
        if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
      }
    });
    setTextNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    setMediaNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    setProductNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    setAssetNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    ids.forEach((id) => pendingNodeIdsRef.current.delete(id));
  }, []);
  const updateUser = useAuthStore((s) => s.updateUser);
  const setQuota = useAuthStore((s) => s.setQuota);
  /** 新建商品节点序号（商品 1、商品 2…） */
  const productSeq = useRef(0);

  // 画布页面加载时获取当前登录用户信息（鉴权判断 + 身份展示，失败静默降级）
  useEffect(() => {
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, [updateUser]);

  // IKBN0G：画布顶栏不再挂 UserDropdown，配额改由本页拉取，供生成前余额拦截
  useEffect(() => {
    let alive = true;
    fetchQuota()
      .then((d) => {
        if (alive) setQuota(d.quota);
      })
      .catch(() => {
        if (alive) setQuota(null);
      });
    return () => {
      alive = false;
    };
  }, [setQuota]);

  // 加载项目列表；?project= 不在列表中时回退首项；无项目自动创建
  useEffect(() => {
    let alive = true;
    fetchProjects()
      .then(async (list) => {
        if (!alive) return;
        let mapped = list.map((p) => ({ id: String(p.id), name: p.name }));
        if (mapped.length === 0) {
          try {
            const created = await createProject('未命名项目');
            if (!alive) return;
            mapped = [{ id: String(created.id), name: created.name }];
          } catch {
            /* 创建失败静默降级：空项目列表 */
          }
        }
        setProjects(mapped);
        setCurrentId((prev) => pickCanvasIdAfterLoad(prev, mapped.map((m) => m.id)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /** 地址栏改 query（含后退）时切回对应画布 */
  useEffect(() => {
    const fromQuery = readCanvasIdFromSearch(new URLSearchParams(location.search));
    if (fromQuery) setCurrentId(fromQuery);
  }, [location.search]);

  /** 当前画布写入 ?project=，刷新后回到同一张画布；保留其它 query 与 location.state */
  useEffect(() => {
    if (!currentId) return;
    const currentSearch = new URLSearchParams(location.search);
    if (readCanvasIdFromSearch(currentSearch) === currentId) return;
    navigate(
      {
        pathname: location.pathname,
        search: canvasLocationSearch(currentSearch, currentId),
      },
      { replace: true, state: location.state },
    );
    // 只在选中画布变化时回写，避免地址栏输入被旧 currentId 覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  /** 切换 Project 即切换画布与对话历史：面板随之收起（IKDLD4），展开状态不跨项目携带。
   *  覆盖点选 / 新建 / 删除后自动切换 / 地址栏前进后退等全部 currentId 迁移路径。
   *  空串 → 首项目 是初始水合（含首页交接降级路径），不是用户切换，不关面板。 */
  const prevProjectIdRef = useRef(currentId);
  /** 画布内部剪贴板快照节点（IKGBPA）：kind + 定格坐标 + JSON 深拷贝 data（无函数回调，粘贴时重注入） */
  interface CanvasClipboardSnapshot {
    kind: 'text' | 'media';
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }
  /** 画布内部剪贴板（IKGBPA）：不持久化、不写系统剪贴板；切换项目清空（对齐撤销栈不跨项目） */
  const clipboardSnapshotRef = useRef<CanvasClipboardSnapshot[]>([]);
  /** 连续粘贴偏移计数：每次成功 V 整组右下错开一档，每次成功 C 归零 */
  const clipboardPasteOffsetRef = useRef(0);
  useEffect(() => {
    const prev = prevProjectIdRef.current;
    prevProjectIdRef.current = currentId;
    if (!prev || prev === currentId) return;
    setShowAgent(false);
    setAgentOpened(false);
    setAgentContext(null);
    setAgentAssetPicks(null);
    setAgentCandidate(null);
    setFocusViewport(undefined);
    // 撤销/重做栈不跨项目（PRD §7.2 X1：不跨会话）
    historyRef.current?.clear();
    // 画布剪贴板不跨项目（IKGBPA）
    clipboardSnapshotRef.current = [];
    clipboardPasteOffsetRef.current = 0;
  }, [currentId]);

  /** 加载当前项目快照（画布水合：节点 + 视口 + 版本号），失败静默降级为空画布 */
  const { doc, assets: snapshotAssets, refetch, acceptDoc, legacyMigration, patchAsset } = useCanvasDoc(currentId);
  const snapshotAssetsRef = useRef(snapshotAssets);
  snapshotAssetsRef.current = snapshotAssets;

  /** 旧生成卡迁移历史（IKDLQK）：水合后拉取，无历史或读取失败时入口隐藏 */
  const historyQuery = useQuery({ ...legacyCardHistoryOptions(currentId), enabled: Boolean(doc && currentId) });
  const legacyHistory = historyQuery.data?.items;
  const [showLegacyHistory, setShowLegacyHistory] = useState(false);

  /** 迁移报告提示（IKDLQK）：按报告签名去重，同一报告只提示一次；失败附标题与原因 */
  const migrationToastRef = useRef('');
  useEffect(() => {
    if (!legacyMigration) return;
    const signature = JSON.stringify(legacyMigration);
    if (migrationToastRef.current === signature) return;
    migrationToastRef.current = signature;
    const { migrated, failed } = legacyMigration;
    if (failed.length === 0) {
      if (migrated.length > 0) showToast('success', `已将 ${migrated.length} 张旧生成卡转换为普通文本节点`);
      return;
    }
    const detail = failed.slice(0, 2).map((item) => `「${item.title || item.nodeId}」${item.reason}`).join('；');
    const failedText = `${failed.length} 张旧生成卡未能迁移（${detail}${failed.length > 2 ? ' 等' : ''}），原卡片已保留`;
    showToast('warn', migrated.length > 0 ? `已转换 ${migrated.length} 张旧生成卡；${failedText}` : failedText);
  }, [legacyMigration, showToast]);

  /** 为服务端加载的节点注入交互回调（JSON 不含函数） */
  const attachCallbacks = (node: Node): Node => {
    const base: Node = { ...node, position: node.position ?? { x: 0, y: 0 }, data: { ...node.data, toolMode } };
    switch (node.type) {
      case 'textNode': {
        // IKFM3L 契约 §5：历史卡读时归一化——html 升级为 Markdown 源，text/html 并存以 text 为准；
        // 身份、标题、位置与关系不动，归一化结果随防抖保存自然落盘
        if (typeof base.data.html === 'string') {
          base.data.text = unifiedTextNodeText(base.data);
          delete base.data.html;
        }
        base.data = {
          ...base.data,
          onDelete: (id: string) => removeCanvasNodes([id]),
          onTitleChange: (id: string, title: string) => actionsRef.current.renameCard(id, title),
          onDraftError: handleDraftError,
          onTextChange: (id: string, text: string) => setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, text } } : n)),
          onPromptChange: (id: string, text: string, promptMentions: import('@lib/contracts/prompt-preview').PromptMention[], promptMaterials?: Array<import('@lib/contracts/prompt-preview').PromptMaterial & { url: string }>) => setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, text, promptMentions, ...(promptMaterials ? { promptMaterials } : {}) } } : n)),
          onMediaIndexChange: handleMediaIndexChange,
          onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
          onWriteSelf: () => {
            skipTextGenOpenRef.current = true;
            setShowTextGenDialog(false);
          },
        };
        break;
      }
      case 'mediaNode':
        base.data = {
          ...base.data,
          onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
          onRetryJob: (id: string) => actionsRef.current.retryJob(id),
          onReEdit: (id: string) => actionsRef.current.reEdit(id),
          onGenImage: (id: string) => actionsRef.current.genImage(id),
          onImg2Img: (id: string, file: File) => actionsRef.current.img2img(id, file),
          onGenVideo: (id: string) => actionsRef.current.genVideo(id),
          onGenAudio: (id: string) => actionsRef.current.genAudio(id),
          onEnhanceImage: (id: string) => actionsRef.current.enhanceImage(id),
          onOutpaintImage: (id: string) => actionsRef.current.outpaintImage(id),
          onEraseImage: (id: string) => actionsRef.current.eraseImage(id),
          onCropImage: (id: string) => actionsRef.current.cropImage(id),
          onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
          // IKFM3S §6：「输入已更新」徽标定位来源文本卡
          onLocateInputSource: (sourceNodeId: string) => locateTextSource(sourceNodeId),
        };
        break;
      case 'productNode':
        base.data = {
          ...base.data,
          // 节点内上传素材携带当前项目（运行期注入，不持久化）
          projectId: currentId,
          onDelete: (id: string) => {
            removeCanvasNodes([id]);
          },
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onSaveToAssets: (id: string) => handleSaveGoodsToAssets(id),
          onProductChange: (id: string, patch: { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string }) => handleProductChange(id, patch),
          onPickFromCanvas: (id: string) => {
            setPickMode('product');
            setPickTarget('product');
            setPickProductId(id);
          },
        };
        break;
      case 'assetNode':
        base.data = {
          ...base.data,
          // 节点内上传素材携带当前项目（运行期注入，不持久化）
          projectId: currentId,
          onDelete: (id: string) => {
            setAssetNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onGenerateImage: () => actionsRef.current.openImageDialog(),
          onSaveToAssets: (id: string) => handleSaveCardToAssets(id),
          onCardChange: (id: string, patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null }) => handleCardChange(id, patch),
          onPickFromCanvas: (id: string) => {
            setPickMode('asset');
            setPickTarget('asset');
            setPickAssetId(id);
          },
        };
        break;
      default:
        break;
    }
    return base;
  };

  /** 解析后端节点引用的资产（data/顶层的 asset_id、reference_asset_ids）。
   *  素材 URL 以 snapshot 资产字典为唯一来源：查不到一律返回 null（调用方标「素材已被删除」），不再回退内嵌 url */
  const resolveAssetRef = (node: Node): { url: string; type: string; assetId?: string } | null => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const raw = node as unknown as Record<string, unknown>;
    const candidates: unknown[] = [
      data.asset_id,
      raw.asset_id,
      data.assetId,
      raw.assetId,
      data.assetID,
      raw.assetID,
      data.sourceAssetId,
      raw.sourceAssetId,
      Array.isArray(data.reference_asset_ids) ? data.reference_asset_ids[0] : undefined,
      Array.isArray(raw.reference_asset_ids) ? raw.reference_asset_ids[0] : undefined,
    ];
    for (const c of candidates) {
      if (c == null || c === '') continue;
      const asset = snapshotAssets[String(c)];
      if (asset?.access_url) return { url: asset.access_url, type: asset.type, assetId: String(c) };
    }
    return null;
  };

  /** 解析 references 数组元素 → 资产 ID（兼容 assetId 数字/字符串与 o.id 历史形态）。
   *  素材 URL 以 snapshot 资产字典为唯一来源，无 assetId 的条目一律按「素材已被删除」处理 */
  const readRefLookupId = (r: unknown): string | undefined => {
    if (typeof r === 'number' || typeof r === 'string') return r === '' ? undefined : String(r);
    if (r != null && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const aid = o.asset_id ?? o.assetId ?? o.id;
      if (aid != null && aid !== '') return String(aid);
    }
    return undefined;
  };

  /** 解析 references 数组元素 → 媒体类型（image/video） */
  const resolveRefType = (r: unknown): 'image' | 'video' => {
    if (r != null && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const t = (o.type ?? o.media_type) as string | undefined;
      if (t === 'video') return 'video';
      // 检查 MIME 类型
      const mime = o.mime as string | undefined;
      if (mime?.startsWith('video/')) return 'video';
    }
    return 'image';
  };

  /** 后端节点类型映射为本地节点：reference 参考卡→资产卡，text→文本节点，其余按资产引用试解为媒体节点 */
  const mapBackendNode = (node: Node): Node | null => {
    const raw = node as unknown as Record<string, unknown>;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const position = node.position ?? { x: 0, y: 0 };

    // 参考卡（Agent 计划产物）：cardType 对应资产卡五种类型
    if (node.type === 'reference') {
      const cardType = typeof raw.cardType === 'string' ? raw.cardType : 'custom';
      const kind: AssetCardKind = (
        ['style', 'character', 'object', 'environment', 'custom'] as AssetCardKind[]
      ).includes(cardType as AssetCardKind)
        ? (cardType as AssetCardKind)
        : 'custom';
      const refsRaw = Array.isArray(raw.references) ? raw.references : [];
      // 参考图有效性以 snapshot 资产字典为唯一来源：命中→access_url；查不到→保留条目并标 missing（渲染占位），不再静默丢弃
      const initialRefs = refsRaw.map((r, i) => {
        const type = resolveRefType(r);
        const lookupAid = readRefLookupId(r);
        const url = lookupAid != null ? snapshotAssets[lookupAid]?.access_url : undefined;
        const base = { id: `ref-hydra-${node.id}-${i}`, type };
        return url
          ? { ...base, src: url, assetId: lookupAid }
          : { ...base, src: '', missing: true, ...(lookupAid ? { assetId: lookupAid } : {}) };
      });
      const desc = (data.content ?? data.desc ?? raw.content) as unknown;
      return {
        id: node.id,
        type: 'assetNode',
        position,
        data: {
          kind,
          initialRefs,
          initialDesc: typeof desc === 'string' ? desc : '',
        },
      };
    }

    // 文本节点
    if (node.type === 'text') {
      const html = (data.html ?? data.content ?? data.text ?? raw.content ?? raw.text ?? '') as unknown;
      return {
        id: node.id,
        type: 'textNode',
        position,
        data: { html: typeof html === 'string' ? html : '' },
      };
    }

    // 其余未知类型：按资产引用尽力还原为媒体节点；素材查不到时保留节点并标「素材已被删除」（不再静默丢弃）
    const ref = resolveAssetRef(node);
    const prompt = (data.prompt ?? raw.prompt) as unknown;
    if (!ref) {
      return {
        id: node.id,
        type: 'mediaNode',
        position,
        data: {
          src: '',
          mediaType: 'image',
          fileName: `参考 ${node.id}`,
          prompt: typeof prompt === 'string' ? prompt : undefined,
          assetMissing: true,
        },
      };
    }
    return {
      id: node.id,
      type: 'mediaNode',
      position,
      data: {
        src: ref.url,
        mediaType: ref.type === 'video' ? 'video' : 'image',
        fileName: `参考 ${node.id}`,
        prompt: typeof prompt === 'string' ? prompt : undefined,
        assetId: ref.assetId,
      },
    };
  };

  /** 图片/视频：身份只认快照 assets[assetId].material_id；合规角标只认 material_status === Active（音频不参与） */
  const characterLibraryVerifiedPatch = (
    data: Record<string, unknown>,
    snapshotMaterialId?: string | null,
    snapshotMaterialStatus?: string | null,
  ): Record<string, unknown> => {
    if (data.mediaType === 'audio') return {};
    const verifiedId = resolveCharacterLibraryMaterialId({
      mediaType: data.mediaType,
      snapshotMaterialId,
    });
    const patch: Record<string, unknown> = {};
    if (verifiedId) {
      if (data.materialId !== verifiedId) patch.materialId = verifiedId;
    } else if (data.materialId) {
      patch.materialId = undefined;
    }
    if (snapshotMaterialStatus !== undefined) {
      const passed = snapshotMaterialStatus === 'Active';
      const failed = snapshotMaterialStatus === 'Failed';
      if (data.compliancePassed !== passed) patch.compliancePassed = passed;
      if (data.complianceFailed !== failed) patch.complianceFailed = failed;
    }
    return patch;
  };

  /** 水合期素材解析：所有素材一律用 assetId 匹配 snapshot 资产字典取 access_url，不走节点内嵌 src。
   *  - 命中 → src 替换为 access_url；material_status === Active 视为已通过合规校验
   *  - 无 assetId 或字典查不到 → 标缺失（媒体节点 assetMissing / 商品图与参考图 missing），渲染「素材已被删除」
   *  - 无旧素材的生成占位与 blob: 上传预览跳过；重新生成中的旧素材仍需刷新地址。 */
  const resolveNodeAssets = (node: Node): Node => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (node.type === 'mediaNode') {
      if (data.genStatus && readAssetId(data) === undefined) return node;
      if (typeof data.src === 'string' && (data.src as string).startsWith('blob:')) return node;
      const aid = (data.assetId ?? data.asset_id ?? data.assetID) as string | number | undefined;
      // 真实人像库等素材库条目不在本地资产字典：保留已持久化的 src，不按 snapshot 标缺失
      if (isMaterialLibraryId(aid == null ? undefined : String(aid))) {
        const src = typeof data.src === 'string' ? data.src : '';
        if (src && !src.startsWith('blob:')) {
          const patch: Record<string, unknown> = {};
          if (data.assetMissing) patch.assetMissing = undefined;
          return Object.keys(patch).length === 0 ? node : { ...node, data: { ...data, ...patch } };
        }
      }
      const asset = aid != null && aid !== '' ? snapshotAssets[String(aid)] : undefined;
      const url = asset?.access_url;
      if (url) {
        // 水合即回填资产字典里的真实尺寸：前端数据足够时不再经历 方形→实测 跳变与多余自动保存
        const fill: Record<string, number> = {};
        if (typeof data.width !== 'number' && typeof asset?.width === 'number') fill.width = asset.width;
        if (typeof data.height !== 'number' && typeof asset?.height === 'number') fill.height = asset.height;
        const verified = characterLibraryVerifiedPatch(data, asset.material_id, asset.material_status ?? null);
        return data.src === url && !data.assetMissing && Object.keys(fill).length === 0 && Object.keys(verified).length === 0
          ? node
          : { ...node, data: { ...data, ...fill, ...verified, src: url, assetMissing: undefined } };
      }
      return data.assetMissing ? node : { ...node, data: { ...data, assetMissing: true } };
    }
    if (node.type === 'productNode') {
      const images = data.images;
      if (!Array.isArray(images)) return node;
      let changed = false;
      const next = images.map((img) => {
        const item = (img ?? {}) as Record<string, unknown>;
        if (typeof item.src === 'string' && item.src.startsWith('blob:')) return img; // 上传中
        const aid = (item.assetId ?? item.asset_id) as string | number | undefined;
        const url = aid != null && aid !== '' ? snapshotAssets[String(aid)]?.access_url : undefined;
        if (url) {
          if (item.src === url && !item.missing) return img;
          changed = true;
          return { ...item, src: url, missing: undefined };
        }
        if (item.missing) return img;
        changed = true;
        return { ...item, src: '', missing: true };
      });
      return changed ? { ...node, data: { ...data, images: next } } : node;
    }
    if (node.type === 'assetNode') {
      const refs = data.initialRefs;
      if (!Array.isArray(refs)) return node;
      let changed = false;
      const next = refs.map((r) => {
        const ref = (r ?? {}) as Record<string, unknown>;
        if (typeof ref.src === 'string' && ref.src.startsWith('blob:')) return r; // 上传中
        const aid = (ref.assetId ?? ref.asset_id) as string | number | undefined;
        const url = aid != null && aid !== '' ? snapshotAssets[String(aid)]?.access_url : undefined;
        if (url) {
          if (ref.src === url && !ref.missing) return r;
          changed = true;
          return { ...ref, src: url, missing: undefined };
        }
        if (ref.missing) return r;
        changed = true;
        return { ...ref, src: '', missing: true };
      });
      return changed ? { ...node, data: { ...data, initialRefs: next } } : node;
    }
    return node;
  };

  /** 画布文档加载完成：按类型分发节点并注入回调；切换项目时先清空 */
  useEffect(() => {
    if (!doc) {
      setTextNodes([]);
      setMediaNodes([]);
      setProductNodes([]);
      setAssetNodes([]);
      setEdges([]);
      setGroups([]);
      versionRef.current = null;
      lastSavedRef.current = '';
      setSaveStatus('idle');
      return;
    }
    const t: Node[] = [];
    const m: Node[] = [];
    const p: Node[] = [];
    const a: Node[] = [];
    // 组伪节点剥离（IKD0JT A3）：type: 'groupFrame' 的持久化形状还原为组名单
    const { groups: hydratedGroups, contentNodes } = parseGroupsFromNodes(doc.nodes);
    contentNodes.forEach((node) => {
      if (node.type === 'textNode') t.push(attachCallbacks(node));
      else if (node.type === 'mediaNode') m.push(attachCallbacks(resolveNodeAssets(node)));
      else if (node.type === 'productNode') p.push(attachCallbacks(resolveNodeAssets(node)));
      else if (node.type === 'assetNode') a.push(attachCallbacks(resolveNodeAssets(node)));
      else {
        // 后端节点类型（reference 参考卡 / text 等）：映射为本地节点后归类（映射内部已按资产字典解析/标缺失）
        const mapped = mapBackendNode(node);
        if (mapped) {
          const attached = attachCallbacks(resolveNodeAssets(mapped));
          if (mapped.type === 'assetNode') a.push(attached);
          else if (mapped.type === 'textNode') t.push(attached);
          else m.push(attached);
        } else if (import.meta.env.DEV) {
          console.warn('[canvas] 无法映射的后端节点:', JSON.stringify(node).slice(0, 800));
        }
      }
    });
    // 商品序号从已加载节点数接续，避免新建重名
    productSeq.current = p.length;
    if (import.meta.env.DEV) {
      console.info(`[canvas] 水合节点：text ${t.length} / media ${m.length} / product ${p.length} / asset ${a.length}（version=${doc.version}）`);
    }
    setTextNodes(t);
    setMediaNodes(m);
    setProductNodes(p);
    setAssetNodes(a);
    setGroups(hydratedGroups);
    if (import.meta.env.DEV && hydratedGroups.length > 0) {
      console.info(`[canvas] 水合成组：${hydratedGroups.length} 个组`);
    }
    // 水合恢复连线：持久形状 {id, source, target, data?} 补回 custom 流光渲染属性；
    // data 承载连线关系属性（IKDMQS 视频参考角色 refRole）随连线恢复；
    // 兜底过滤悬空端点（服务端保存校验已保证引用完整，此处防御旧/坏数据渲染告警）
    const hydratedIds = new Set([...t, ...m, ...p, ...a].map((n) => n.id));
    const hydratedEdges: Edge[] = doc.edges
      .filter((e) => hydratedIds.has(e.source) && hydratedIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'custom',
        style: { stroke: '#444' },
        ...(e.data ? { data: e.data } : {}),
      }));
    setEdges(hydratedEdges);
    // 同步乐观锁版本/视口，并记录内容签名避免加载后立即重复保存
    // （签名口径与自动保存一致：含组伪节点，否则组数据会导致加载后立即误判变更）
    versionRef.current = doc.version;
    setViewport(doc.viewport);
    const hydratedAll = [...t, ...m, ...p, ...a];
    // IKFM3L：html→text 归一化使本地态与服务器形态产生差异，置空签名驱动一次自动保存把升级落盘
    const upgradedTextNodes = contentNodes.some(
      (node) => node.type === 'textNode' && typeof (node.data as Record<string, unknown> | undefined)?.html === 'string',
    );
    lastSavedRef.current = upgradedTextNodes
      ? ''
      : JSON.stringify(doc.viewport) +
        serializeNodes([...hydratedAll, ...hydratedGroups.map((g) => groupToNode(g))]) +
        serializeEdges(hydratedEdges);
    // 水合恢复：「生成中」媒体节点恢复任务轮询。
    // IK9R8X：jobId 后端返回字符串，兼容 string/number 双形态（历史画布文档已持久化字符串）。
    m
      .filter(
        (n) =>
          n.data.genStatus === 'generating' &&
          (typeof n.data.jobId === 'number' || typeof n.data.jobId === 'string') &&
          !settledExtractNodesRef.current.has(n.id),
      )
      .forEach((n) => pollJobRef.current(n.id, n.data.jobId as number | string));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, snapshotAssets]);

  /** 连线端点级联删除（IKDLQF）：仅当节点真实离开画布时清理其连线，覆盖键盘删除/工具条删除/回滚等全部删除路径。
   *  不按「当前存在的节点」反查：挂载首批 effect 的节点列表尚在水合前，会把刚恢复的连线误清。 */
  const canvasNodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(
      [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes, ...uploadedNodes].map((n) => n.id),
    );
    const prevIds = canvasNodeIdsRef.current;
    canvasNodeIdsRef.current = ids;
    if (prevIds.size === 0) return;
    const removed = new Set<string>();
    prevIds.forEach((id) => {
      if (!ids.has(id)) removed.add(id);
    });
    if (removed.size === 0) return;
    setEdges((prev) => {
      const next = prev.filter((e) => !removed.has(e.source) && !removed.has(e.target));
      return next.length === prev.length ? prev : next;
    });
  }, [textNodes, mediaNodes, productNodes, assetNodes, uploadedNodes, setEdges]);

  /** 登记在途保存：期间自动保存的 800ms 防抖会因在途守卫跳过，flush 也会排在它后面——
   *  同一时刻只有一个 PUT，不会两次请求共用同一个 If-Match（IKFS5W）。
   *  只有仍是「最新那个」时才清空，避免先完成的一方把后登记的那次抹掉。 */
  const trackCanvasSave = <T,>(promise: Promise<T>): Promise<T> => {
    savePromiseRef.current = promise;
    const release = () => {
      if (savePromiseRef.current === promise) savePromiseRef.current = null;
    };
    promise.then(release, release);
    return promise;
  };

  /** 画布变更后 800ms 防抖自动保存：PUT /api/canvases/:projectId（If-Match 乐观锁） */
  useEffect(() => {
    if (!currentId || !doc || applyingRef.current) return;
    const timer = window.setTimeout(() => {
      if (applyingRef.current || savePromiseRef.current) return;
      if (textNodesRef.current.some(node => draftErrorsRef.current.has(node.id))) return;
      const contentNodes = [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes];
      // 组伪节点随 nodes 持久化（IKD0JT A3）：水合时剥离还原
      const nodes = [...contentNodes, ...groups.map((g) => groupToNode(g))];
      const sig = JSON.stringify(viewport) + serializeNodes(nodes) + serializeEdges(edges);
      if (sig === lastSavedRef.current) return;
      if (import.meta.env.DEV) {
        console.info(`[canvas] 自动保存：${nodes.length} 个节点 / ${edges.length} 条连线（version=${versionRef.current}）`);
      }
      lastSavedRef.current = sig;
      setSaveStatus('saving');
      // 快照本次请求覆盖的未保存新增节点；飞行中再新增的留给下一轮保存
      const pendingSnapshot = new Set(pendingNodeIdsRef.current);
      trackCanvasSave(
        saveCanvasDoc(currentId, { viewport, nodes, edges }, versionRef.current)
          .then((saved) => {
            versionRef.current = saved.version;
            setSaveBlocked(false);
            pendingSnapshot.forEach((id) => pendingNodeIdsRef.current.delete(id));
            setSaveStatus(textNodesRef.current.some(node => draftErrorsRef.current.has(node.id)) ? 'error' : 'saved');
            setSaveEpoch(value => value + 1);
            setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
          })
          .catch((e) => {
            setSaveBlocked(true);
            // 释放签名，允许下次变更时重试
            lastSavedRef.current = '';
            // 本次请求里有未保存的新增节点 → 添加失败：回滚节点（画布上不保留添加失败的节点）
            const hadPendingAdds = pendingSnapshot.size > 0;
            if (isApiError(e) && e.status === 412) {
              // 版本冲突：回滚未保存节点 + toast，然后重新加载最新画布数据
              setSaveStatus('error');
              showToast('warn', '画布版本冲突，当前编辑已保留，请先复制正文再刷新复核');
            } else {
              // 网络/服务端错误：新增节点回滚，已有节点的编辑保留、左下角提示保存失败
              if (hadPendingAdds) rollbackPendingNodes(pendingSnapshot);
              setSaveStatus('error');
              showToast('error', hadPendingAdds ? '添加失败，请重试' : '保存失败，请重试');
              console.warn('画布自动保存失败:', e);
            }
          }),
      );
    }, 800);
    return () => window.clearTimeout(timer);
  }, [textNodes, mediaNodes, productNodes, assetNodes, edges, groups, viewport, currentId, doc, refetch, applying, saveEpoch]);

  /** 创建文本节点（正文为受限 Markdown 源，契约 §5 新建一律 v1 形态）；
   *  返回新节点 id（供 IKGBPB 系统剪贴板兜底粘贴后选中） */
  const handleAddTextNode = (position?: { x: number; y: number }, text?: string): string => {
    const newNode: Node = {
      id: newNodeId('text'),
      type: 'textNode',
      position: position ?? spawnPosition(),
      data: {
        text: text ?? '',
        onDraftError: handleDraftError,
        toolMode,
        onDelete: (id: string) => removeCanvasNodes([id]),
        onTextChange: (id: string, text: string) => {
          setTextNodes((prev) =>
            prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
          );
        },
        onMediaIndexChange: handleMediaIndexChange,
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
        onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(newNode.id);
    historyRef.current?.pushAddNodes([newNode.id]);
    setTextNodes((prev) => [...prev, newNode]);
    return newNode.id;
  };

  /** 复制节点到旁边（副本进撤销栈，IKD0JT：撤销移除副本） */
  const handleDuplicateNode = (id: string) => {
    const t = textNodesRef.current.find((n) => n.id === id);
    if (t) {
      const copy: Node = { ...t, id: newNodeId('text'), position: { x: t.position.x + 40, y: t.position.y + 40 }, data: { ...t.data } };
      delete copy.data.promptSource;
      delete copy.data.promptMaterials;
      delete copy.data.promptMentions;
      delete copy.data.promptOriginalTitle;
      pendingNodeIdsRef.current.add(copy.id);
      historyRef.current?.pushAddNodes([copy.id]);
      setTextNodes((prev) => [...prev, copy]);
      // IKFM3Q 契约 §4：副本随正文复制 media 索引；来源节点仍在画布的关系线同步复制（副本获得有效索引）
      const mentionedSources = [...new Set(((copy.data.mediaMentions ?? []) as MediaMention[]).map(mention => mention.nodeId))]
        .filter(source => findCanvasNode(source));
      if (mentionedSources.length > 0) syncTextIndexEdges(copy.id, { added: mentionedSources, removed: [] });
      return;
    }
    const m = mediaNodesRef.current.find((n) => n.id === id);
    if (m) {
      const copy: Node = { ...m, id: newNodeId('media'), position: { x: m.position.x + 40, y: m.position.y + 40 }, data: { ...m.data } };
      pendingNodeIdsRef.current.add(copy.id);
      historyRef.current?.pushAddNodes([copy.id]);
      setMediaNodes((prev) => [...prev, copy]);
    }
  };

  /* ============ 画布内部剪贴板（IKGBPA）：Ctrl/Cmd+C 快照 / Ctrl/Cmd+V 粘贴 ============ */

  /** 连续粘贴整组错开步长（右下逐档，对齐立即复制 +40/+40 偏移惯例） */
  const CLIPBOARD_PASTE_STAIR_PX = 40;

  /** 下一次粘贴的落位锚点（IKGBPA 快照粘贴与 IKGBPB 系统剪贴板兜底共用）：
   *  视口中心锚点 + 当前档阶梯偏移，并自增档位；档位只在粘贴确定产出内容时消耗
   *  （系统剪贴板读取失败/双空在调用前已静默返回，不进本函数）。 */
  const nextPasteAnchor = (): { x: number; y: number } => {
    const stair = CLIPBOARD_PASTE_STAIR_PX * clipboardPasteOffsetRef.current;
    clipboardPasteOffsetRef.current += 1;
    const anchor = spawnPosRef.current();
    return { x: anchor.x + stair, y: anchor.y + stair };
  };

  /** C 快照定格（IKGBPA）：深拷贝选中卡（JSON 克隆剥掉回调，粘贴时经 attachCallbacks 重注入）；
   *  原卡后续删除/改名/编辑/生成完成均不影响快照。ids 已由 Canvas 入口过滤为文本/媒体卡。 */
  const handleCopySelectedNodes = (ids: string[]) => {
    const idSet = new Set(ids);
    const picked: Node[] = [
      ...textNodesRef.current.filter((n) => idSet.has(n.id)),
      ...mediaNodesRef.current.filter((n) => idSet.has(n.id)),
    ];
    if (picked.length === 0) return;
    clipboardSnapshotRef.current = picked.map((n) => ({
      kind: n.type === 'mediaNode' ? ('media' as const) : ('text' as const),
      position: { ...n.position },
      data: JSON.parse(JSON.stringify(n.data ?? {})) as Record<string, unknown>,
    }));
    // 每次成功复制重置连续粘贴偏移
    clipboardPasteOffsetRef.current = 0;
  };

  /** V 粘贴（IKGBPA）：视口中心落位 + 多卡按快照原相对位置整体落位 + 连续粘贴整组右下递增错开；
   *  手拉连线不随贴（只产散卡）；文本卡副本按 IKFM3Q 契约 §4 重建正文 @ 引用派生索引线；
   *  撤销登记两条目（同既有立即复制 handleDuplicateNode 形态）：节点组「新增节点」一条、
   *  派生索引线「新增连线」一条，连按 Z 整体回净；悬空派生线由 IKDLQF 级联清理。
   *  IKGBPB：内部剪贴板为空时不再静默，改走系统剪贴板兜底（pasteFromSystemClipboard）。 */
  const handlePasteClipboard = () => {
    // 内部剪贴板优先：有快照完全不读系统剪贴板（连读取 API 都不触发）
    if (clipboardSnapshotRef.current.length === 0) {
      void pasteFromSystemClipboard();
      return;
    }
    const snapshot = clipboardSnapshotRef.current;
    const anchor = nextPasteAnchor();
    const minX = Math.min(...snapshot.map((s) => s.position.x));
    const minY = Math.min(...snapshot.map((s) => s.position.y));
    const textCopies: Node[] = [];
    const mediaCopies: Node[] = [];
    const newIds: string[] = [];
    snapshot.forEach((s) => {
      const position = {
        x: Math.round(anchor.x + (s.position.x - minX)),
        y: Math.round(anchor.y + (s.position.y - minY)),
      };
      const data = JSON.parse(JSON.stringify(s.data)) as Record<string, unknown>;
      if (s.kind === 'text') {
        // 会话性提示词来源字段不随副本（对齐 handleDuplicateNode 的字段清理）
        delete data.promptSource;
        delete data.promptMaterials;
        delete data.promptMentions;
        delete data.promptOriginalTitle;
        const copy = attachCallbacks({ id: newNodeId('text'), type: 'textNode', position, data });
        textCopies.push(copy);
        newIds.push(copy.id);
      } else {
        const copy = attachCallbacks({ id: newNodeId('media'), type: 'mediaNode', position, data });
        mediaCopies.push(copy);
        newIds.push(copy.id);
      }
    });
    newIds.forEach((id) => pendingNodeIdsRef.current.add(id));
    historyRef.current?.pushAddNodes(newIds);
    if (textCopies.length > 0) setTextNodes((prev) => [...prev, ...textCopies]);
    if (mediaCopies.length > 0) setMediaNodes((prev) => [...prev, ...mediaCopies]);
    // IKFM3Q 契约 §4：副本随正文复制 media 索引；来源节点仍在画布的关系线同步复制（副本获得有效索引）
    textCopies.forEach((copy) => {
      const mentionedSources = [...new Set(((copy.data.mediaMentions ?? []) as MediaMention[]).map(mention => mention.nodeId))]
        .filter(source => findCanvasNode(source));
      if (mentionedSources.length > 0) syncTextIndexEdges(copy.id, { added: mentionedSources, removed: [] });
    });
    // 新卡自动选中（整组副本）
    setSelectManyRequest({ ids: newIds, ts: Date.now() });
  };

  /** IKGBPB 系统剪贴板兜底（内部剪贴板为空时的 V 粘贴）：与卡片右键菜单「粘贴」项共用
   *  readCanvasClipboard 读取底层（图片优先、纯文本兜底）；图片走 placeFileOnCanvas 文件
   *  落卡链路（「新增节点」撤销登记、上传后补永久 URL 均为链路既有行为），文本走新建文本卡
   *  路径；视口中心 + 连续粘贴阶梯 + 新卡自动选中复用 IKGBPA 基座机制——落位在读取返回后
   *  同步结算，连续快速按 V 时各次粘贴拿到递增档位互不重叠，且双空不消耗档位；
   *  系统剪贴板为空或读取失败安静返回（双空静默，无 toast）。 */
  const pasteFromSystemClipboard = async () => {
    const payload = await readCanvasClipboard();
    if (!payload) return;
    const anchor = nextPasteAnchor();
    const position = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
    if (payload.kind === 'image') {
      // 上传失败时节点自移除并由落卡链路内既有 toast 提示；这里只吞 rejection 不额外提示
      await placeFileOnCanvas(payload.file, { position })
        .then((done) => setSelectManyRequest({ ids: [done.nodeId], ts: Date.now() }))
        .catch(() => undefined);
      return;
    }
    const nodeId = handleAddTextNode(position, payload.text);
    setSelectManyRequest({ ids: [nodeId], ts: Date.now() });
  };

  /**
   * 卡片改名（IKFA8X）：名称写入当前节点（媒体 fileName / 文本 title）并置显式自定义标记
   * customName——生成成功回填、取消/失败回退等自动命名路径据此前置跳过；
   * 只作用于当前节点 id，同素材的其他卡与素材库名称不联动。
   */
  const renameCard = (id: string, name: string) => {
    if (textNodesRef.current.some((n) => n.id === id)) {
      setTextNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, title: name, customName: true } } : n)));
      return;
    }
    if (mediaNodesRef.current.some((n) => n.id === id)) {
      setMediaNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, fileName: name, customName: true } } : n)));
    }
  };

  /**
   * 添加到对话的文本引用（IKDLQJ）：先把点击当刻正文冻结成服务端引用快照，再注入胶囊。
   * 超限或快照创建失败明确提示、不产生胶囊——节点原文与输入框既有内容都不改动。
   */
  const quoteTextIntoChat = async (input: QuoteConversationInput) => {
    if (input.text.length > QUOTE_TEXT_LIMIT) {
      showToast('warn', `正文超过 ${QUOTE_TEXT_LIMIT} 字上限，未添加到对话`);
      return;
    }
    try {
      const { quote } = await quoteMutation.mutateAsync({
        projectId: currentId,
        nodeId: input.nodeId,
        title: input.title,
        text: input.text,
        source: input.source ?? null,
      });
      const label = quoteChipLabel(input.title, input.text);
      const blocks = [textQuoteBlock({ nodeId: input.nodeId, chipId: String(input.ts), label, quote }), ...(input.extraBlocks ?? [])];
      setAgentCandidate(candidate => candidate?.some(block => block.node_id === input.nodeId) ? null : candidate);
      setAgentContext({ text: `@${label}`, label, ts: input.ts, mediaBlocks: blocks });
      setShowAgent(true);
    } catch (e) {
      showToast('error', isApiError(e) ? `添加到对话失败：${e.message}` : '添加到对话失败，请检查网络后重试');
    }
  };

  const confirmAgentCandidate = async (blocks: SessionContentBlock[]): Promise<SessionContentBlock[]> => {
    const first = blocks[0];
    if (first.type !== 'text') return blocks;
    // 确认当刻读取画布正文，不使用预览时或持久化画布的旧副本。
    const node = textNodesRef.current.find((item) => item.id === first.node_id);
    if (!node) throw new Error('源文本节点已删除，请取消后重新选择');
    const draftError = draftErrorsRef.current.get(node.id);
    if (draftError) throw new Error(draftError);
    const text = extractTextNodeText(node.data);
    if (!text) throw new Error('文本正文为空，请编辑后重试');
    if (text.length > QUOTE_TEXT_LIMIT) throw new Error(`正文超过 ${QUOTE_TEXT_LIMIT} 字上限`);
    const title = typeof node.data.title === 'string' ? node.data.title : '';
    const { quote } = await quoteMutation.mutateAsync({
      projectId: currentId, nodeId: node.id, title, text,
      source: readPromptSource(node.data.promptSource),
    });
    return [textQuoteBlock({ nodeId: node.id, chipId: first.chip_id!, label: quoteChipLabel(title, text), quote })];
  };

  /** 添加节点内容到 Agent 聊天 */
  const handleAddToChatNode = (id: string) => {
    const ts = Date.now();
    const p = productNodesRef.current.find((n) => n.id === id);
    if (p) {
      const name = (p.data?.name as string) || '商品';
      const mediaBlocks = collectMediaBlocks(p, String(ts));
      console.log('[handleAddToChatNode] productNode, mediaBlocks:', mediaBlocks.length);
      setAgentContext({
        text: `@${name}`,
        label: name,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
      return;
    }
    const t = textNodesRef.current.find((n) => n.id === id);
    if (t) {
      if (blockInvalidDraft([id])) return;
      // IKDLQJ：正文走引用快照；空正文节点没有可引用内容，维持纯 @ 标签
      const text = extractTextNodeText(t.data as Record<string, unknown> | undefined);
      if (text) {
        void quoteTextIntoChat({
          nodeId: t.id,
          title: typeof t.data?.title === 'string' ? t.data.title : '',
          text,
          source: readPromptSource(t.data?.promptSource),
          ts,
        });
      } else {
        const label = typeof t.data?.title === 'string' && t.data.title.trim() ? t.data.title : '文本节点';
        setAgentContext({ text: `@${label}`, label, ts });
        setShowAgent(true);
      }
      return;
    }
    const m = mediaNodesRef.current.find((n) => n.id === id);
    if (m) {
      if (m.data?.assetMissing) {
        showToast('warn', '素材已被删除');
        return;
      }
      const type = m.data?.mediaType === 'video' ? '视频' : '图片';
      const label = `[${type}] ${m.data?.fileName || ''}`;
      const mediaBlocks = collectMediaBlocks(m, String(ts));
      console.log('[handleAddToChatNode] mediaNode, mediaBlocks:', mediaBlocks.length);
      setAgentContext({
        text: label,
        label,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
      return;
    }
    const a = assetNodesRef.current.find((n) => n.id === id);
    if (a) {
      const gc = a.data?.generationCard as { shotTitle?: string; prompt?: string } | undefined;
      const kindTitle: Record<string, string> = {
        style: '风格卡',
        character: '角色卡',
        object: '物体卡',
        environment: '环境卡',
        custom: '自定义卡',
        generation: '生成卡',
      };
      const name = gc?.shotTitle || kindTitle[(a.data?.kind as string) ?? 'custom'] || '资产卡';
      // IKDLQJ：生成卡的当前提示词同样捕获为引用快照，不再只发旧 revision 指针；显式挂载的素材引用随行
      const prompt = typeof gc?.prompt === 'string' ? gc.prompt : '';
      if (gc && prompt.trim()) {
        void quoteTextIntoChat({
          nodeId: a.id,
          title: gc.shotTitle ?? '',
          text: prompt,
          ts,
          extraBlocks: collectMediaBlocks(a, String(ts)),
        });
        return;
      }
      const mediaBlocks = collectMediaBlocks(a, String(ts));
      console.log('[handleAddToChatNode] assetNode, mediaBlocks:', mediaBlocks.length, 'refs:', (a.data?.initialRefs as unknown[] | undefined)?.length ?? 0);
      setAgentContext({
        text: `@${name}`,
        label: name,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
    }
  };

  /** 节点操作引用（避免闭包过期） */
  const actionsRef = useRef({
    duplicate: handleDuplicateNode,
    addToChat: handleAddToChatNode,
    pasteAtNode: (_id: string) => {},
    copyImage: (_id: string) => {},
    complianceCheck: (_id: string) => {},
    fillEmptyShell: (_id: string, _file: File) => {},
    openImageDialog: () => {},
    cancelJob: (_id: string) => {},
    retryJob: (_id: string) => {},
    removeMediaNode: (_id: string) => {},
    reEdit: (_id: string) => {},
    genImage: (_id: string) => {},
    genVideo: (_id: string) => {},
    genAudio: (_id: string) => {},
    enhanceImage: (_id: string) => {},
    outpaintImage: (_id: string) => {},
    eraseImage: (_id: string) => {},
    cropImage: (_id: string) => {},
    extractAudio: async (_id: string) => {},
    download: (_id: string) => {},
    showDetails: (_id: string) => {},
    firePendingGen: () => {},
    firePendingVideoDraft: () => {},
    img2img: (_id: string, _file: File) => {},
    renameCard: (_id: string, _name: string) => {},
  });
  actionsRef.current = { ...actionsRef.current, duplicate: handleDuplicateNode, addToChat: handleAddToChatNode, renameCard };

  /** 唤起底部图片对话框（工具栏图片图标 / 资产卡「生成图片」共用） */
  const handleOpenImageDialog = () => {
    imagePanelHiddenRef.current = false;
    setShowImageDialog(true);
    setShowBottomDialog(false);
    setShowAudioDialog(false);
    setShowMusicDialog(false);
    setShowEnhanceDialog(false);
  };

  /** 节点选取时读取资产 ID：兼容 assetId/asset_id/assetID 三形态（后端写入节点为下划线形态） */
  const readNodeAssetId = (data: Record<string, unknown>): string | number | undefined =>
    (data.assetId ?? data.asset_id ?? data.assetID) as string | number | undefined;

  // 隐藏与重开同一目标可放行；重试尚未成功时不能换到其它编辑目标。
  const canOpenEditor = (nodeId?: string): boolean => {
    if (submittingNodeId && nodeId !== submittingNodeId) {
      showToast('warn', '正在保存并提交，请稍候');
      return false;
    }
    if ((saveBlocked || saveStatus === 'error') && nodeId !== editingTargetRef.current) {
      showToast('warn', '保存失败，请重试');
      return false;
    }
    return true;
  };

  /** IKFR4X 图片持续选取会话点击处理：会话绑定发起时的目标（快照），命中有效来源即时并入并保持模式；
   *  拒绝（类型/失效/重复/超限）由校验函数 toast 原因，同样保持模式；目标失效防御性结束，不写向其他目标。
   *  草稿绑定会话按连线即时并入（与拖线同路径）；自由面板会话沿用面板本地参考注入与上限保护 */
  const handleImagePickSessionClick = (node: Node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (typeof imagePickSession === 'string') {
      if (!mediaNodesRef.current.some((n) => n.id === imagePickSession)) {
        endImagePickSession();
        return;
      }
      if (node.type === 'textNode') {
        // 与画布拖线同一准入路径（文本附件边）：拒绝时内部已提示，模式保持
        connectPair(node.id, imagePickSession);
        return;
      }
      if (node.type === 'mediaNode') {
        // 与拖线同一建边路径；能力层静默拒绝时仍按参考校验建线（点选不得比拖线更弱）
        if (connectPair(node.id, imagePickSession)) return;
        if (validateImageRefConnect(node.id, imagePickSession)) {
          addCanvasEdge(node.id, imagePickSession);
        }
        return;
      }
      showToast('warn', '图片参考仅支持图片素材');
      return;
    }
    // 自由面板会话（无草稿绑定）：文本参考无绑定目标，与旧单次语义同口径提示
    if (node.type === 'textNode') {
      showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    const isReadyMedia = node.type === 'mediaNode' && typeof data.src === 'string' && !data.genStatus;
    if (!isReadyMedia) {
      showToast('warn', '图片参考仅支持图片素材');
      return;
    }
    if (data.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    if ((data.src as string).startsWith('blob:')) {
      showToast('warn', '素材上传中，请稍候再选择');
      return;
    }
    const typeErr = panelCanvasRefError('image', data.mediaType);
    if (typeErr) {
      showToast('warn', typeErr);
      return;
    }
    setImagePickResult({
      ts: Date.now(),
      files: [{
        id: `node-${node.id}`,
        url: data.src as string,
        type: 'image',
        name: (data.fileName as string) || node.id,
        assetId: readNodeAssetId(data),
      }],
    });
  };

  /** IKFR4Y 首尾帧槽位替换共用前置校验（绑定/自由面板同口径）：有效性 → 幂等（同素材重复点击
   *  不新增不误删）→ 按「排除当前槽位」的参考视图调 checkAddVideoRef（槽位已占不阻断合法替换）。
   *  返回 null 表示拒绝（已 toast）或幂等跳过；否则给出可替换的当前占用者 */
  const checkVideoFrameReplace = (
    node: Node,
    refs: VideoMediaRefs,
    role: 'first' | 'last',
  ): { current: VideoMediaRef | undefined } | null => {
    const err = videoRefSourceError(node, role);
    if (err) {
      showToast('warn', err);
      return null;
    }
    const data = (node.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data);
    if (assetId == null) {
      showToast('warn', '素材不存在');
      return null;
    }
    const current = role === 'first' ? refs.first : refs.last;
    const sourceMaterialId = typeof data.materialId === 'string' && data.materialId ? data.materialId : undefined;
    if (current && incomingVideoRefOccupied({ reference: [current] }, [assetId, sourceMaterialId])) return null;
    // 已作为普通参考连入的同一素材：选尾帧/首帧时应改角色，不按「素材重复」拒绝
    const sameIncoming = (r: VideoMediaRef) => incomingVideoRefOccupied({ reference: [r] }, [assetId, sourceMaterialId]);
    const slotCleared: VideoMediaRefs = {
      ...(role === 'first' ? { ...refs, first: undefined } : { ...refs, last: undefined }),
      reference: refs.reference.filter((r) => !sameIncoming(r)),
    };
    const msg = checkAddVideoRef(role, data.mediaType as 'image', assetId, slotCleared, undefined, [sourceMaterialId]);
    if (msg) {
      showToast('warn', msg);
      return null;
    }
    return { current };
  };

  /** IKFR4Y 首尾帧槽位替换（绑定草稿会话）：以最后一次有效选择替换当前槽位，其他槽位与参考不动；
   *  旧占用者移除与 Dock 移除同口径分派（isLibraryOnlyVideoRef 才移 material 引用，画布来源断边，
   *  含合规回写 materialId 的连线占用者仍走断边），替换结果随既有连线自动保存持久化。
   *  返回是否实际落槽（IKGB7Y 自动退出判定用；拒绝/幂等返回 false） */
  const replaceVideoFrameRefFromCanvas = (node: Node, targetId: string, role: 'first' | 'last'): boolean => {
    const refs = mergedVideoMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current);
    const check = checkVideoFrameReplace(node, refs, role);
    if (!check) return false;
    if (check.current) {
      if (isLibraryOnlyVideoRef(check.current)) {
        removeDraftMaterialRef(targetId, check.current.materialId);
      } else {
        removeRefEdges(targetId, check.current.nodeId);
      }
    }
    const data = (node.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data);
    const occupiedReference = refs.reference.find((r) => r.assetId === assetId);
    if (occupiedReference && occupiedReference.nodeId !== node.id) {
      if (isLibraryOnlyVideoRef(occupiedReference)) {
        removeDraftMaterialRef(targetId, occupiedReference.materialId);
      } else {
        removeRefEdges(targetId, occupiedReference.nodeId);
      }
    }
    addCanvasEdge(node.id, targetId, role);
    return true;
  };

  /** IKFR4Y 自由面板参考项构造（画布节点 → 本地 VideoMediaRef，首尾帧替换与普通参考追加共用） */
  const videoFreeRefItemOf = (node: Node): VideoMediaRef => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    return {
      nodeId: node.id,
      url: String(data.src ?? ''),
      name: typeof data.fileName === 'string' && data.fileName ? data.fileName : node.id,
      assetId: String(readAssetId(data)),
      mediaType: asVideoRefMediaType(data.mediaType),
    };
  };

  /** IKFR4Y 首尾帧槽位替换（自由面板会话）：本地参考直接覆盖槽位，校验口径与绑定会话一致 */
  const replaceVideoFreeFrameRef = (node: Node, role: 'first' | 'last') => {
    if (!checkVideoFrameReplace(node, videoFreeRefs, role)) return;
    const item = videoFreeRefItemOf(node);
    setVideoFreeRefs((prev) => {
      const next: VideoMediaRefs = {
        ...prev,
        reference: prev.reference.filter((r) => r.assetId !== item.assetId && r.nodeId !== item.nodeId),
      };
      if (role === 'first') next.first = item;
      else next.last = item;
      return next;
    });
  };

  /** IKFR4Y 视频持续选取会话点击处理：会话绑定发起时的目标（快照），命中有效来源即时并入/替换并保持
   *  模式；拒绝（类型/失效/重复/超限）toast 原因后同样保持模式；目标失效防御性结束，不写向其他目标。
   *  普通参考会话按连线即时并入（与拖线同路径）、文本走 connectPair 建附件边；
   *  首尾帧会话以最后一次有效选择替换当前槽位，文本与非图片媒体不得绕过仅图片限制 */
  const handleVideoPickSessionClick = (node: Node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const role = pickRefRole ?? 'reference';
    const isFrameSession = role === 'first' || role === 'last';
    if (typeof videoPickSession === 'string') {
      if (!mediaNodesRef.current.some((n) => n.id === videoPickSession)) {
        endVideoPickSession();
        return;
      }
      if (node.type === 'textNode') {
        if (isFrameSession) {
          showToast('warn', '首尾帧仅支持图片素材');
          return;
        }
        // 与画布拖线同一准入路径（文本附件边）：拒绝时内部已提示，模式保持
        connectPair(node.id, videoPickSession);
        return;
      }
      if (node.type === 'mediaNode') {
        if (isFrameSession) {
          // IKGB7Y：本次点击有效落槽后两槽均满 → 自动退出选取模式并提示「首尾帧已就绪」
          // （拒绝/幂等未落槽不退出；edgesRef 同步口径保证此处读到本次连线结果）
          if (replaceVideoFrameRefFromCanvas(node, videoPickSession, role)) {
            const filledRefs = mergedVideoMediaRefsOf(videoPickSession, edgesRef.current, mediaNodesRef.current);
            if (filledRefs.first && filledRefs.last) {
              endVideoPickSession();
              showToast('success', '首尾帧已就绪');
            }
          }
          return;
        }
        // 图生视频普通参考入口仅收图片（与既有单次选取同口径文案）
        if (pickMode === 'image' && data.mediaType !== 'image') {
          showToast('warn', PANEL_REF_MEDIA_TYPES.videoText2Video.canvasRefError);
          return;
        }
        // 拒绝（类型/失效/重复/超限）已在 validate 内 toast 明确原因；addCanvasEdge 幂等去重
        if (validateVideoRefConnect(node.id, videoPickSession, 'reference')) {
          addCanvasEdge(node.id, videoPickSession, 'reference');
        }
        return;
      }
      showToast('warn', '视频参考仅支持图片、视频或音频素材');
      return;
    }
    // 自由面板会话（无草稿绑定；web 端视频面板当前恒绑定草稿卡，此分支随三态结构完整性
    // 保留，与 IKFR4X 图片版对称）：文本参考无绑定目标，与旧单次语义同口径提示
    if (node.type === 'textNode') {
      showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (node.type !== 'mediaNode') {
      showToast('warn', '视频参考仅支持图片、视频或音频素材');
      return;
    }
    if (isFrameSession) {
      replaceVideoFreeFrameRef(node, role);
      return;
    }
    if (pickMode === 'image' && data.mediaType !== 'image') {
      showToast('warn', PANEL_REF_MEDIA_TYPES.videoText2Video.canvasRefError);
      return;
    }
    const err = videoRefSourceError(node, 'reference');
    if (err) {
      showToast('warn', err);
      return;
    }
    if (readAssetId(data) == null) return;
    appendVideoFreeRef(videoFreeRefItemOf(node), 'reference');
  };

  /** IKFR4Z 音频持续选取会话点击处理：会话绑定发起时的目标（快照），命中有效来源即时并入并保持模式；
   *  拒绝（类型/失效/重复/超限）由校验函数 toast 原因，同样保持模式；目标失效防御性结束，不写向其他目标。
   *  草稿绑定会话按连线即时并入（与拖线同路径）、文本走 addCanvasEdge 建附件边（IKFCXE 音频目标
   *  不经 referencePlanRef）；自由面板会话沿用面板本地参考注入通道与上限保护（无持久化承诺） */
  const handleAudioPickSessionClick = (node: Node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (typeof audioPickSession === 'string') {
      if (!mediaNodesRef.current.some((n) => n.id === audioPickSession)) {
        endAudioPickSession();
        return;
      }
      if (node.type === 'textNode') {
        // 与旧单次选取同一准入路径（普通文本/方案卡均可建附件边），addCanvasEdge 幂等去重
        addCanvasEdge(node.id, audioPickSession);
        return;
      }
      if (node.type === 'mediaNode') {
        // 拒绝（类型/失效/重复/超限）已在 validate 内 toast 明确原因；addCanvasEdge 幂等去重
        if (validateAudioRefConnect(node.id, audioPickSession)) {
          addCanvasEdge(node.id, audioPickSession);
        }
        return;
      }
      showToast('warn', '音频参考仅支持音频素材');
      return;
    }
    // 自由面板会话（无草稿绑定）：文本参考无绑定目标，与旧单次语义同口径提示
    if (node.type === 'textNode') {
      showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (node.type !== 'mediaNode') {
      showToast('warn', '音频参考仅支持音频素材');
      return;
    }
    // 自由面板注入沿用 externalPick 通道，面板 addRef 内统一去重与上限提示
    const err = audioRefSourceError(node);
    if (err) {
      showToast('warn', err);
      return;
    }
    setAudioPickResult({
      ts: Date.now(),
      item: {
        id: node.id,
        kind: 'audio',
        name: (data.fileName as string) || node.id,
        src: data.src as string,
        source: 'canvas',
        assetId: readAssetId(data),
      },
    });
  };

  /** 画布节点单击：选取模式下点击对应类型节点带入对话框，其他节点取消选取；
   *  非选取模式点击草稿身份卡（IKDMQQ 图片 / IKDMQS 视频 / IKDMQT 音频）：打开绑定面板继续编辑（待生成/生成中查看/失败修改） */
  const handleCanvasNodeClick = (node: Node) => {
    // IKGOQX 扩图模式优先拦截：点其他卡退出模式并选中那张卡；点源图卡本身保持模式
    if (outpaintSessionActive) {
      if (node.id !== outpaintNodeId) {
        endOutpaintSession();
        setSelectRequest({ id: node.id, ts: Date.now() });
      }
      return;
    }
    if (showAgent && node.type === 'textNode') {
      const text = extractTextNodeText(node.data);
      if (text) setAgentCandidate([{
        type: 'text', node_id: node.id, chip_id: `canvas:${node.id}`,
        display_label: quoteChipLabel(typeof node.data.title === 'string' ? node.data.title : '', text),
      }]);
    }
    if (showAgent && node.type === 'mediaNode') {
      const data = node.data ?? {};
      const blocks = collectMediaBlocks(node, `canvas:${node.id}`);
      if (
        !data.assetMissing &&
        !['draft', 'generating', 'failed', 'cancelled'].includes(String(data.genStatus)) &&
        blocks.length === 1 && blocks[0].asset_id &&
        ['image', 'video', 'audio'].includes(blocks[0].type) &&
        blocks[0].url && !blocks[0].url.startsWith('blob:')
      ) setAgentCandidate(blocks);
    }
    // IKFR4X 图片持续选取会话优先拦截：会话期间点击一律服务选取（含切换编辑目标隔离），
    // 不落入下方普通选中/面板打开分支；视频/音频/商品/资产入口的单次选取语义不受影响
    if (imagePickSessionActive) {
      handleImagePickSessionClick(node);
      return;
    }
    // IKFR4Y 视频持续选取会话同款拦截：会话期间点击一律服务选取（普通参考连续并入、
    // 首尾帧槽位连续替换），其余入口的单次选取语义不受影响
    if (videoPickSessionActive) {
      handleVideoPickSessionClick(node);
      return;
    }
    // IKFR4Z 音频持续选取会话同款拦截：会话期间点击一律服务选取（合法来源连续并入），
    // 其余入口的单次选取语义不受影响
    if (audioPickSessionActive) {
      handleAudioPickSessionClick(node);
      return;
    }
    if (!pickMode || !pickTarget) {
      const data = (node.data ?? {}) as Record<string, unknown>;
      // IKDMQU Q10：保存失败时暂停切换编辑目标，提示重试（发送路径由 flushCanvasSave 单独拦截）；
      // 重开当前绑定目标不算切换，放行——面板恢复后编辑写回同节点可继续触发保存重试
      if (
        node.type === 'mediaNode' &&
        isInPlaceRegenTarget(node) &&
        (saveBlocked || saveStatus === 'error') &&
        node.id !== editingTargetRef.current
      ) {
        showToast('warn', '保存失败，请重试');
        return;
      }
      if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'image') {
        // 高清草稿卡（IKGM9O）：点卡开高清放大面板（不再落生成图片面板）
        if (data.imageEnhance) openEnhanceDraftDialog(node.id);
        else openImageDraftDialog(node.id);
      }
      if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'video') {
        openVideoDraftDialog(node.id);
      }
      if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'audio') {
        openAudioDraftDialog(node.id);
      }
      if (node.type === 'textNode' && data.textGen === true) {
        if (skipTextGenOpenRef.current) {
          skipTextGenOpenRef.current = false;
          return;
        }
        openTextGenDialog(node.id);
      }
      // IKDMQU P1：单选有生成记录的成品卡自动打开对应生成面板（编辑写回原卡，发送后原卡重新生成）；
      // 上传素材卡无生成记录，不自动打开（Q4）；重新生成中/失败态的卡 jobId 仍在，可打开查看或调整重发
      if (node.type === 'mediaNode' && hasGenerationRecord(node)) {
        openMediaDraftDialog(node.id, data.mediaType);
      }
      return;
    }
    const data = (node.data ?? {}) as Record<string, unknown>;
    // IKDMQR：草稿绑定面板的「到节点选择」建立来源→草稿连线（与画布连线同一关系）；
    // 非法来源明确提示原因，不注入面板本地列表
    // 槽位限制先于文本引用路由，避免方案文本绕过首尾帧的仅图片约束。
    if (pickTarget === 'video' && (pickRefRole === 'first' || pickRefRole === 'last')
      && (node.type !== 'mediaNode' || data.mediaType !== 'image')) {
      showToast('warn', '首尾帧仅支持图片素材');
      return;
    }
    // IKFR4X：图片面板文本参考改经持续会话分支（connectPair 同路径），此处仅剩视频面板的文本选取
    if (node.type === 'textNode' && pickTarget === 'video') {
      if (!videoDraftId) {
        showToast('warn', '文本参考需要绑定生成节点');
        return;
      }
      // 与画布拖线同一准入路径：普通文本建附件边，方案文本保留方案引用语义。
      if (!connectPair(node.id, videoDraftId)) return;
      videoPanelHiddenRef.current = true;
      setPickMode(null);
      setPickTarget(null);
      setPickRefRole(null);
      return;
    }
    // IKFCXE 音频面板文本参考与媒体参考选取已并入 IKFR4Z 持续会话分支（addCanvasEdge 同路径），
    // 此处仅剩视频面板的文本选取与商品/资产入口
    // IKDMQS：视频草稿绑定面板的「从节点添加素材」建立来源→草稿连线，角色由发起入口显式指定
    // （首帧/尾帧/普通参考）；首尾帧与图生视频普通参考仅接受图片（IKFE8U 统一入口类型边界），
    // 全能参考普通参考经 videoRefSourceError 收图/视频/音频。
    // 自由模式（工具栏入口无草稿卡）：来源存本地参考，不落画布不连线
    if (pickTarget === 'video' && (pickMode === 'image' || pickMode === 'video')) {
      const isFrameSlot = pickRefRole === 'first' || pickRefRole === 'last';
      // 仅图片槽（首尾帧 / 图生视频普通参考）：点到非图片媒体时提示并保持选取，避免误带入视频节点
      if ((isFrameSlot || pickMode === 'image') && (node.type !== 'mediaNode' || data.mediaType !== 'image')) {
        if (node.type === 'mediaNode') {
          showToast('warn', isFrameSlot ? '首尾帧仅支持图片素材' : PANEL_REF_MEDIA_TYPES.videoText2Video.canvasRefError);
          return;
        }
      } else if (videoDraftId) {
        if (node.type === 'mediaNode' && validateVideoRefConnect(node.id, videoDraftId, pickRefRole ?? undefined)) {
          // IKFDFW：有效参考接纳后立即建立来源→草稿连线（角色随发起入口）并进入既有自动保存，
          // 不再经待提交暂存等发送——关闭/切换/刷新均按连线恢复
          addCanvasEdge(node.id, videoDraftId, pickRefRole ?? 'reference');
        }
      } else if (node.type === 'mediaNode') {
        const role = pickRefRole ?? 'reference';
        const err = videoRefSourceError(node, role);
        if (err) {
          showToast('warn', err);
        } else {
          const d = (node.data ?? {}) as Record<string, unknown>;
          const assetId = readAssetId(d);
          if (assetId != null) {
            appendVideoFreeRef(
              {
                nodeId: node.id,
                url: String(d.src ?? ''),
                name: typeof d.fileName === 'string' && d.fileName ? d.fileName : node.id,
                assetId: String(assetId),
                mediaType: asVideoRefMediaType(d.mediaType),
              },
              role,
            );
          }
        }
      }
      setPickMode(null);
      setPickTarget(null);
      setPickRefRole(null);
      setPickProductId(null);
      setPickAssetId(null);
      videoPanelHiddenRef.current = true; // 到节点选择命中节点后，避免紧随的 selection 变化把视频面板当作「切换到其他卡」关闭
      return;
    }
    const isReadyMedia =
      node.type === 'mediaNode' &&
      typeof data.src === 'string' &&
      !data.genStatus;
    // 素材失效（已被删除/查不到）：阻断选取
    if (isReadyMedia && data.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    // 上传中的节点（blob 预览、无 assetId）：暂不可选取，否则发送时素材会被静默丢弃
    if (isReadyMedia && (data.src as string).startsWith('blob:')) {
      showToast('warn', '素材上传中，请稍候再选择');
      return;
    }
    // 图片面板选取（含自由面板注入）已并入 IKFR4X 持续会话分支，此处仅剩商品/资产/音频入口
    if (pickMode === 'product' && isReadyMedia && data.mediaType === 'image') {
      // 商品卡发起的图片节点选取 → ts 驱动注入目标商品卡（仅图片，商品卡不支持视频）
      const targetId = pickProductId;
      if (targetId) {
        const newImage = {
          id: `node-${node.id}-${Date.now()}`,
          src: data.src as string,
          enabled: true,
          type: 'image' as const,
          ...(readNodeAssetId(data) ? { assetId: String(readNodeAssetId(data)!) } : {}),
        };
        setProductPickResult({ ts: Date.now(), productId: targetId, image: newImage });
      }
    } else if (pickMode === 'asset' && isReadyMedia && data.mediaType !== 'audio') {
      // 资产卡发起的图片/视频节点选取 → ts 驱动注入目标资产卡
      const targetId = pickAssetId;
      if (targetId) {
        const mediaType: 'image' | 'video' = data.mediaType === 'video' ? 'video' : 'image';
        const newRef = {
          id: `node-${node.id}-${Date.now()}`,
          src: data.src as string,
          type: mediaType,
          ...(readNodeAssetId(data) ? { assetId: String(readNodeAssetId(data)!) } : {}),
        };
        setAssetPickResult({ ts: Date.now(), assetId: targetId, ref: newRef });
      }
    }
    // 音频面板选取（含自由面板注入）已并入 IKFR4Z 持续会话分支，此处仅剩商品/资产入口
    setPickMode(null);
    setPickTarget(null);
    setPickProductId(null);
    setPickAssetId(null);
  };

  /** IKFYH6 五面板统一关闭路径：与各面板右上角 X 完全等价（关闭=隐藏不丢内容，重开恢复）。
   *  X 按钮 onClose 同样改调这一组函数，保证空白点击/画布外 UI/Esc 与 X 语义一致。 */
  const resetPickState = () => {
    setPickMode(null);
    setPickTarget(null);
    setPickProductId(null);
    setPickAssetId(null);
  };
  const closeVideoDialog = () => {
    videoPanelHiddenRef.current = true;
    setShowBottomDialog(false);
    setVideoFreeRefs({ reference: [] });
    setPickMode(null);
    setPickTarget(null);
    setPickRefRole(null);
    setVideoPickSession(undefined);
    setVideoAssetPickRole('reference');
    setVideoAssetPickKind('video');
  };
  const closeImageDialog = () => {
    imagePanelHiddenRef.current = true;
    setShowImageDialog(false);
    endImagePickSession();
    setImagePickResult(null);
  };
  const closeAudioDialog = () => {
    audioPanelHiddenRef.current = true;
    setShowAudioDialog(false);
    endAudioPickSession();
  };
  const closeTextGenDialog = () => setShowTextGenDialog(false);
  const closeMusicDialog = () => setShowMusicDialog(false);
  /** 高清面板关闭（IKGM9O）：置隐藏豁免标记，紧随的选中变化不回弹重开（口径同图片面板） */
  const closeEnhanceDialog = () => {
    enhancePanelHiddenRef.current = true;
    setShowEnhanceDialog(false);
  };
  const dismissAllGenPanels = () => {
    closeVideoDialog();
    closeImageDialog();
    closeAudioDialog();
    closeTextGenDialog();
    closeMusicDialog();
    closeEnhanceDialog();
  };

  /** 画布空白处单击（React Flow PaneClick，拖拽平移后天然不触发——任何拖拽平移都不会误关）：
   *  IKFYH6 拍板 4——持续选取会话/单次选取进行中点空白只退选取，面板保留（再点一次空白才关）；
   *  否则五面板统一关闭（推翻视频面板「点空白不关」旧设计；面板编辑实时写回节点 data，隐藏不丢内容）。
   *  onSelectionChange 的空选中可能是「取消旧选中→选中新卡」的过渡事件，不能作为关闭依据（IKDMQV）。 */
  const handleCanvasPaneClick = () => {
    cancelAgentCandidate();
    // 擦除编辑态（IKGOTB 四退出之一）：点画布空白退出并丢弃未发送遮罩
    if (eraseTargetNodeId) {
      exitEraseEditing();
      return;
    }
    // 裁切编辑态（IKGW1H 四退出之一）：点画布空白/框外暗区退出并丢弃
    if (cropTargetNodeId) {
      exitCropMode();
      return;
    }
    // IKGOQX 扩图模式：点画布空白退出（不留痕迹）
    if (outpaintSessionActive) {
      endOutpaintSession();
      return;
    }
    if (imagePickSessionActive) { endImagePickSession(); return; }
    if (videoPickSessionActive) { endVideoPickSession(); return; }
    if (audioPickSessionActive) { endAudioPickSession(); return; }
    if (pickMode || pickTarget) {
      resetPickState();
      return;
    }
    dismissAllGenPanels();
  };

  /** 选中变化（IKDMQU P1/Q9，IKDMQV 修订）：多选或单选切换到非绑定目标时隐藏面板；
   *  单选命中绑定目标时保持/恢复面板可见。
   *  空选中（nodes=[]）不在此处理——真空白点击由 onPaneClick 关闭（Q9 本义），
   *  节点删除由面板绑定清理 effect 关闭。
   *  仅隐藏不清绑定 id——保留「最近编辑目标」供 Q10 保存失败时放行重开原节点。
   *  选取参考模式进行中不关闭——用户正在为面板挑参考（pickMode 在 onNodeClick 尾部才清空，
   *  selection 变化先到达，此时 pickMode 仍活跃）。 */
  const handleSelectionChange = ({ nodes }: OnSelectionChangeParams) => {
    if (pickMode || pickTarget) return;
    // IKGOQX 扩图模式期间冻结面板联动：模式内点其他卡的选中变化已由 onNodeClick 拦截处置，
    // 程序化选中（selectRequest）触发的变化不应误关其他状态
    if (outpaintSessionActive) return;
    // 事件参数在程序化改选中时会滞后误报（React Flow 内部 selection store 与受控 nodes
    // 的同步窗口：侧栏新建草稿 deselect 旧卡 + select 新卡，事件可能报旧卡+新卡双选中，
    // 把刚打开的面板当多选误关）——以受控 state 为准：state 明确 selected:false 的排除
    const candidates = nodes.filter((n) => {
      const m = mediaNodesRef.current.find((x) => x.id === n.id);
      return !m || m.selected !== false;
    });
    const soloId = candidates.length === 1 ? candidates[0]!.id : null;
    // 擦除编辑态（IKGOTB 四退出之一）：单选其他卡或多选时退出并丢弃未发送遮罩
    //（空选中不在此处理——真空白点击由 onPaneClick 承担）
    if (eraseTargetNodeId && ((soloId && soloId !== eraseTargetNodeId) || candidates.length > 1)) {
      exitEraseEditing();
    }
    // 裁切编辑态（IKGW1H 四退出之一）：点其他卡等同点外退出——单选非目标或多选时丢弃
    //（空选中不在此处理——真空白点击由 onPaneClick 承担）
    if (cropTargetNodeId && ((soloId && soloId !== cropTargetNodeId) || candidates.length > 1)) {
      exitCropMode();
    }
    const syncPanelVisible = (
      boundId: string | null,
      setShow: (visible: boolean) => void,
    ) => {
      if (!boundId) return;
      if (submittingNodeId && boundId !== submittingNodeId) return;
      if (soloId && soloId === boundId) {
        setShow(true); // 命中绑定目标：保持/恢复（修复程序化选中误报把面板当多选误关）
        return;
      }
      if (soloId || candidates.length > 1) setShow(false); // 单选其他卡或多选：隐藏
      // 空选中：不动作（真空白点击由 onPaneClick 处理，节点删除由绑定清理 effect 处理）
    };
    if (!imagePanelHiddenRef.current) syncPanelVisible(imageDraftId, setShowImageDialog);
    if (!videoPanelHiddenRef.current) syncPanelVisible(videoDraftId, setShowBottomDialog);
    if (!audioPanelHiddenRef.current) syncPanelVisible(audioDraftId, setShowAudioDialog);
    // 高清面板（IKGM9O）同口径：单选命中绑定高清卡保持/恢复，单选其他卡或多选隐藏
    if (!enhancePanelHiddenRef.current) syncPanelVisible(enhanceDraftId, setShowEnhanceDialog);
    // IKFYH6：自由面板（无绑定草稿）与文本/音乐面板纳入同一关闭口径——单选其他卡或多选即关（只关不开，
    // 不做「命中恢复」）。hiddenRef 豁免沿用：到节点选择命中、@ 菜单选中素材后紧随的 selection 变化不误关
    //（openVideoDraftDialog 文本选取、视频自由/绑定选取、handleImageAtMention 等既有保护分支）。
    const hideFreePanel = (
      hiddenRef: { current: boolean },
      shown: boolean,
      setShow: (visible: boolean) => void,
    ) => {
      if (hiddenRef.current || !shown) return;
      if (soloId || candidates.length > 1) setShow(false);
    };
    if (!imageDraftId) hideFreePanel(imagePanelHiddenRef, showImageDialog, setShowImageDialog);
    if (!videoDraftId) hideFreePanel(videoPanelHiddenRef, showBottomDialog, setShowBottomDialog);
    if (!audioDraftId) hideFreePanel(audioPanelHiddenRef, showAudioDialog, setShowAudioDialog);
    // 文本生成面板恒绑定文生文卡：命中绑定卡保持，其余单选/多选关闭（无 hiddenRef 语义，重开只经点卡）
    if (showTextGenDialog && textGenDraftId && ((soloId && soloId !== textGenDraftId) || candidates.length > 1)) {
      setShowTextGenDialog(false);
    }
    // 音乐面板无绑定目标：任何单选/多选即关
    if (showMusicDialog && (soloId || candidates.length > 1)) setShowMusicDialog(false);
  };

  /** IKFYH6 画布外 UI 点击关闭：document 捕获阶段 click——捕获先于 React 事件处理器执行，
   *  同一次点击先到此（面板尚未因该点击打开），「刚打开的面板」不会被误关。
   *  豁免：「面板领土」（五面板根 + @菜单/资产弹窗等 portal 浮层，data-gen-panel-territory 标记）、
   *  画布区域（.react-flow，空白归 PaneClick、节点归 selection sync）；右键/中键不关（button!==0）。
   *  用 click 不用 mousedown，并校验按下与抬起位移：拖拽平移/框选拖出画布边缘产生的 click 不算原地点击。 */
  const anyGenPanelOpen =
    showBottomDialog || showImageDialog || showAudioDialog || showTextGenDialog || showMusicDialog || showEnhanceDialog;
  useEffect(() => {
    if (!anyGenPanelOpen) return;
    /** 原地点击与拖拽的分界：按下与抬起的像素位移超过该值即视为拖拽（平移/框选拖出画布边缘） */
    const CLICK_DRAG_SLOP_PX = 4;
    let downAt: { x: number; y: number } | null = null;
    const onMouseDown = (event: MouseEvent) => {
      downAt = { x: event.clientX, y: event.clientY };
    };
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-gen-panel-territory]')) return;
      if (target.closest('.react-flow')) return;
      if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > CLICK_DRAG_SLOP_PX) return;
      dismissAllGenPanels();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('click', onClick, true);
    };
    // dismissAllGenPanels 仅引用稳定的 setState/useCallback，不随渲染变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyGenPanelOpen]);

  /** IKFYH6 Esc 优先级链：@ 菜单开着先关菜单（菜单自行处理，IKFXOR）→ 持续选取会话先退选取
   *  （既有 session handler，与本监听同级）→ 单次选取取消选取 → 光标在输入框内不动
   *  （复用 isEditableKeyboardTarget）→ 擦除编辑态退出（IKGOTB，未发送丢弃遮罩）→ 其余情况关闭五面板。 */
  useEffect(() => {
    if (!anyGenPanelOpen && !eraseTargetNodeId && !cropTargetNodeId) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-canvas-keyboard-scope="mention"]')) return;
      if (isEditableKeyboardTarget(event.target)) return;
      // IKGOQX 扩图模式有自己的 Esc handler（先于本链处置）
      if (outpaintSessionActive) return;
      if (imagePickSessionActive || videoPickSessionActive || audioPickSessionActive) return;
      if (pickMode || pickTarget) {
        resetPickState();
        return;
      }
      if (eraseTargetNodeId) {
        exitEraseEditing();
        return;
      }
      if (cropTargetNodeId) {
        exitCropMode();
        return;
      }
      dismissAllGenPanels();
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyGenPanelOpen, eraseTargetNodeId, cropTargetNodeId, imagePickSessionActive, videoPickSessionActive, audioPickSessionActive, pickMode, pickTarget]);

  /** 节点拖拽结束：同步本次全部拖动节点的新坐标到父组件 state，触发自动保存。
   *  多选整组拖拽时 React Flow 第三参含同组全部节点；只回写被抓取节点会让父层坐标过期，
   *  下一次媒体合并 effect 用过期坐标覆盖画布内部状态，导致同组节点跳变（IKDKII 验收缺陷） */
  const handleNodeDragStop = (_node: Node, draggedNodes: Node[]) => {
    const positions = new Map(draggedNodes.map((n) => [n.id, n.position]));
    // 撤销登记（IKD0JT）：refs 此刻仍是拖拽前坐标，仅登记实际移动过的节点
    const before = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const oldPositions = before
      .filter((n) => {
        const next = positions.get(n.id);
        return next && (n.position.x !== next.x || n.position.y !== next.y);
      })
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    historyRef.current?.pushMove(oldPositions);
    const applyDraggedPositions = (prev: Node[]) =>
      prev.map((n) => {
        const position = positions.get(n.id);
        return position ? { ...n, position } : n;
      });
    setTextNodes(applyDraggedPositions);
    setMediaNodes(applyDraggedPositions);
    setProductNodes(applyDraggedPositions);
    setAssetNodes(applyDraggedPositions);
    // 节点拖入/拖出组：只加入最上层命中组，其余重叠组写入排除。
    // 扩组仅当「非本组原成员」压住组边线；组内成员移动不扩组。
    if (groupsRef.current.length > 0) {
      const expandByGroup = new Map<string, { x: number; y: number; x2: number; y2: number }>();
      const ownerByNode = new Map<string, string>();
      const beforeById = new Map(before.map((n) => [n.id, n]));
      draggedNodes.forEach((n) => {
        const w = n.measured?.width ?? 200;
        const h = n.measured?.height ?? 120;
        const nx = n.position.x, ny = n.position.y;
        const startNode = beforeById.get(n.id) ?? n;
        for (let i = groupsRef.current.length - 1; i >= 0; i--) {
          const g = groupsRef.current[i];
          const wasMember = isGroupMember(startNode, g);
          if (wasMember) {
            // 组内原成员移动不扩组；中心仍在组内则留在本组，已拖出则继续看其他组
            if (nodeInsideGroupBox(n, g.box)) {
              ownerByNode.set(n.id, g.id);
              break;
            }
            continue;
          }
          const intersects =
            nx <= g.box.x + g.box.w && nx + w >= g.box.x && ny <= g.box.y + g.box.h && ny + h >= g.box.y;
          if (!intersects) continue;
          if (nodePressesGroupEdge(n, g.box)) {
            const cur = expandByGroup.get(g.id);
            const x = Math.min(nx, cur?.x ?? g.box.x);
            const y = Math.min(ny, cur?.y ?? g.box.y);
            const x2 = Math.max(nx + w, cur?.x2 ?? g.box.x + g.box.w);
            const y2 = Math.max(ny + h, cur?.y2 ?? g.box.y + g.box.h);
            expandByGroup.set(g.id, { x, y, x2, y2 });
            ownerByNode.set(n.id, g.id);
            break;
          }
          if (nodeInsideGroupBox(n, g.box) && !g.excludedIds.includes(n.id)) {
            ownerByNode.set(n.id, g.id);
            break;
          }
        }
      });
      const pad = GROUP_FRAME_PADDING;
      const allAfter = before.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, position: p } : n;
      });
      setGroups((prev) => {
        const boxes = new Map(
          prev.map((g) => {
            const e = expandByGroup.get(g.id);
            if (!e) return [g.id, g.box] as const;
            return [
              g.id,
              {
                x: e.x - pad,
                y: e.y - pad,
                w: e.x2 - e.x + pad * 2,
                h: e.y2 - e.y + pad * 2,
              },
            ] as const;
          }),
        );
        const nextMeta = prev.map((g) => ({ ...g, box: boxes.get(g.id) ?? g.box }));
        return nextMeta.map((g) => {
          const excluded = new Set(g.excludedIds);
          draggedNodes.forEach((n) => {
            const owner = ownerByNode.get(n.id);
            const inside = nodeInsideGroupBox(n, g.box);
            if (!inside) excluded.delete(n.id);
            else if (owner === g.id) excluded.delete(n.id);
            else excluded.add(n.id);
          });
          if (expandByGroup.has(g.id)) {
            allAfter.forEach((n) => {
              if (positions.has(n.id)) return;
              if (nodeInsideGroupBox(n, g.box) && isForeignGroupMember(n, g.id, nextMeta)) {
                excluded.add(n.id);
              }
            });
          }
          const e = expandByGroup.get(g.id);
          const boxChanged = !!e;
          const excludedChanged =
            excluded.size !== g.excludedIds.length || [...excluded].some((id) => !g.excludedIds.includes(id));
          if (!boxChanged && !excludedChanged) return g;
          return { ...g, box: g.box, excludedIds: [...excluded] };
        });
      });
    }
  };

  // 资产卡等非节点入口：清空旧 seed，保证打开的是空白对话框
  actionsRef.current.openImageDialog = () => {
    if (!canOpenEditor()) return;
    setImageSeed(null);
    // 空白新会话不携带上一轮选取事件（IKF5KE）
    setImagePickResult(null);
    handleOpenImageDialog();
  };

  /** 绑定面板打开时的失效参考提示（IKDMQU Q3）：连线仍在但来源已失效（被推导过滤，不展示也不消费），
   *  明确告知避免静默丢弃；仅统计媒体来源连线，文本附件不受影响 */
  const warnStaleMediaRefs = (targetNodeId: string, kind: 'image' | 'video') => {
    const byId = new Map(mediaNodesRef.current.map((n) => [n.id, n]));
    const stale = edgesRef.current.some((e) => {
      if (e.target !== targetNodeId) return false;
      const source = byId.get(e.source);
      if (!source || source.type !== 'mediaNode') return false;
      return kind === 'image'
        ? imageRefSourceError(source) !== null
        : videoRefSourceError(source, readRefRole(e)) !== null;
    });
    if (stale) showToast('warn', '部分参考素材已失效，请恢复素材或移除引用后发送');
  };

  /** 按媒体类型打开对应绑定面板（IKDMQU）：图片/视频/音频统一派发，编辑实时写回本卡；
   *  高清卡（imageEnhance 标记）分流到高清放大面板并回填 lastParams（IKGM9O，规格故事 32） */
  const openMediaDraftDialog = (nodeId: string, mediaType: unknown) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (mediaType !== 'video' && mediaType !== 'audio' && d.imageEnhance) {
      openEnhanceDraftDialog(nodeId);
      return;
    }
    if (mediaType === 'video') openVideoDraftDialog(nodeId);
    else if (mediaType === 'audio') openAudioDraftDialog(nodeId);
    else openImageDraftDialog(nodeId);
  };

  /** 打开绑定高清卡的高清放大面板（IKGM9O）：源图尺寸预检快照 + lastParams 回填种子；
   *  生成中重开为只读查看（generating 由挂载处按节点状态传入） */
  const openEnhanceDraftDialog = (nodeId: string) => {
    if (!canOpenEditor(nodeId)) return;
    enhancePanelHiddenRef.current = false;
    editingTargetRef.current = nodeId;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    const identity = d.imageEnhance as ImageEnhanceIdentity | undefined;
    // 源图尺寸快照：按 sourceAssetId 在画布上找同素材卡读实测尺寸（无匹配/无尺寸都不拦，服务端同口径）
    const sourceAssetId = identity?.sourceAssetId;
    const source = sourceAssetId
      ? mediaNodesRef.current.find((n) => readAssetId((n.data ?? {}) as Record<string, unknown>) === sourceAssetId)
      : undefined;
    const sd = (source?.data ?? {}) as Record<string, unknown>;
    setEnhanceDraftId(nodeId);
    setEnhanceSeed({
      ts: Date.now(),
      sourceDims: {
        width: typeof sd.width === 'number' ? sd.width : undefined,
        height: typeof sd.height === 'number' ? sd.height : undefined,
      },
      initialParams: identity?.lastParams ? restoreImageEnhanceParams(identity.lastParams) : null,
    });
    setShowBottomDialog(false);
    setShowImageDialog(false);
    setShowAudioDialog(false);
    setShowMusicDialog(false);
    setShowTextGenDialog(false);
    setShowEnhanceDialog(true);
  };

  /** 打开绑定指定草稿的图片面板（IKDMQQ）：带入草稿已保存的参数与当前连线文本附件；
   *  IKFR4X：重开/切换面板即结束残留的持续选取会话（重开为普通模式，不恢复选取） */
  const openImageDraftDialog = (nodeId: string) => {
    if (!canOpenEditor(nodeId)) return;
    endImagePickSession();
    editingTargetRef.current = nodeId;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    setImageDraftId(nodeId);
    setImageSeed({
      ts: Date.now(),
      text: typeof d.prompt === 'string' ? d.prompt : '',
      // IKFA1M：结构化正文与拍平镜像一致才恢复标签；旧客户端改写过则按纯文本恢复，不猜造标签
      promptDoc: restorePromptDoc(d.promptDoc, d.prompt),
      files: [],
      params: {
        modelId: typeof d.draftModelId === 'string' ? d.draftModelId : undefined,
        ratio: typeof d.draftRatio === 'string' ? d.draftRatio : undefined,
        size: typeof d.draftSize === 'string' ? d.draftSize : undefined,
      },
      targetNodeId: nodeId,
      attachments: textAttachmentsOf(nodeId),
    });
    setShowTextGenDialog(false);
    handleOpenImageDialog();
  };

  /** 面板编辑实时写回草稿节点（IKDMQQ）：参数随节点 data 进入自动保存，刷新后恢复 */
  const handleImageDraftParamsChange = (
    nodeId: string,
    patch: { prompt?: string; promptDoc?: StoredPromptDoc; modelId?: string; size?: string; ratio?: string },
  ) => {
    const data: Record<string, unknown> = {};
    if (patch.prompt !== undefined) data.prompt = patch.prompt;
    if (patch.promptDoc !== undefined) data.promptDoc = patch.promptDoc;
    if (patch.modelId !== undefined) data.draftModelId = patch.modelId;
    if (patch.size !== undefined) data.draftSize = patch.size;
    if (patch.ratio !== undefined) {
      data.draftRatio = patch.ratio;
      // 卡片占位形状跟随所选比例（沿用 targetRatio 语义）
      data.targetRatio = patch.ratio;
    }
    if (Object.keys(data).length === 0) return;
    patchMediaNode(nodeId, data);
  };

  /** 面板绑定清理（IKDMQQ；IKDMQU 扩展到成品卡）：绑定被其它入口取代、节点被删除/取消、
   *  或草稿身份结束且无生成记录时结束绑定并关闭面板；有生成记录的成品卡持续可绑定（重新生成中 jobId 仍在） */
  useEffect(() => {
    if (!imageDraftId) return;
    if (imageSeed?.targetNodeId !== imageDraftId) {
      setImageDraftId(null);
      return;
    }
    const node = mediaNodes.find((n) => n.id === imageDraftId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (!node || (d.draft !== true && !hasGenerationRecord(node))) {
      setImageDraftId(null);
      setShowImageDialog(false);
    }
  }, [imageDraftId, imageSeed, mediaNodes]);

  /** IKFR4X 会话随面板结束：图片面板不可见（关闭 Dock / 切换其他面板 / 目标删除清理）即结束持续选取会话；
   *  已建参考与连线保留，重开面板为普通模式（不恢复会话，刷新/切换画布同理不恢复） */
  useEffect(() => {
    if (imagePickSession === undefined) return;
    if (!showImageDialog) endImagePickSession();
  }, [showImageDialog, imagePickSession, endImagePickSession]);

  /** 高清面板绑定清理（IKGM9O）：绑定目标被删除、或草稿身份结束且无生成记录（异常态）时结束绑定并关闭面板；
   *  成品高清卡持续可绑定（重新编辑/重新生成，jobId 保留） */
  useEffect(() => {
    if (!enhanceDraftId) return;
    const node = mediaNodes.find((n) => n.id === enhanceDraftId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (!node || (d.draft !== true && !hasGenerationRecord(node)) || !d.imageEnhance) {
      setEnhanceDraftId(null);
      setShowEnhanceDialog(false);
    }
  }, [enhanceDraftId, mediaNodes]);

  /** 擦除编辑态绑定清理（IKGOT7/IKGOTB）：目标源图卡被删除时退出编辑态并丢弃遮罩，防工具条悬挂 */
  useEffect(() => {
    if (!eraseTargetNodeId) return;
    if (!mediaNodes.some((n) => n.id === eraseTargetNodeId)) exitEraseEditing();
    // exitEraseEditing 仅引用稳定的 setState，不随渲染变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eraseTargetNodeId, mediaNodes]);

  /** 裁切编辑态绑定清理（IKGW1H）：目标源图卡被删除时退出裁切模式，防状态悬挂 */
  useEffect(() => {
    if (!cropTargetNodeId) return;
    if (!mediaNodes.some((n) => n.id === cropTargetNodeId)) exitCropMode();
    // exitCropMode 仅引用稳定的 setState，不随渲染变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropTargetNodeId, mediaNodes]);

  /** 裁切框随内容区钳制（IKGW1N，规格故事 14）：源图卡被移动/缩放（撤销等旁路改坐标）时
   *  框保持完整落在内容区内（正常路径由纯函数钳制保证，本 effect 只兜底旁路变更）。
   *  cropBounds/cropRect 每次渲染都是新对象，仅在数值变化时才 setState，无循环。 */
  useEffect(() => {
    if (!cropBounds || !cropRect) return;
    const next = clampCropRect(cropRect, cropBounds, cropMinSide);
    if (
      next.x !== cropRect.x || next.y !== cropRect.y ||
      next.width !== cropRect.width || next.height !== cropRect.height
    ) {
      setCropRect(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropBounds?.x, cropBounds?.y, cropBounds?.width, cropBounds?.height, cropRect, cropMinSide]);

  /** IKFR4X：Esc 结束图片持续选取会话（输入框/编辑器内的 Esc 保持原语义，如卡片名称编辑） */
  useEffect(() => {
    if (imagePickSession === undefined) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      endImagePickSession();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [imagePickSession, endImagePickSession]);

  /** IKFR4Y 会话随面板结束：视频面板不可见（关闭 Dock / 目标删除清理 / 切换其他面板）即结束持续
   *  选取会话；已建参考与连线保留，重开面板为普通模式（不恢复会话，刷新/切换画布同理不恢复） */
  useEffect(() => {
    if (videoPickSession === undefined) return;
    if (!showBottomDialog) endVideoPickSession();
  }, [showBottomDialog, videoPickSession, endVideoPickSession]);

  /** IKFR4Y：Esc 结束视频持续选取会话（输入框/编辑器内的 Esc 保持原语义，如卡片名称编辑） */
  useEffect(() => {
    if (videoPickSession === undefined) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      endVideoPickSession();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [videoPickSession, endVideoPickSession]);

  /** IKFR4Z 会话随面板结束：音频面板不可见（关闭 Dock / 空白隐藏 / 目标删除清理 / 切换其他面板）
   *  即结束持续选取会话；已建参考与连线保留，重开面板为普通模式（不恢复会话，刷新/切换画布同理不恢复） */
  useEffect(() => {
    if (audioPickSession === undefined) return;
    if (!showAudioDialog) endAudioPickSession();
  }, [showAudioDialog, audioPickSession, endAudioPickSession]);

  /** IKFR4Z：Esc 结束音频持续选取会话（输入框/编辑器内的 Esc 保持原语义，如卡片名称编辑） */
  useEffect(() => {
    if (audioPickSession === undefined) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      endAudioPickSession();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [audioPickSession, endAudioPickSession]);

  /** IKGOQX：Esc 退出扩图模式（输入框/编辑器内的 Esc 保持原语义；与其他面板关闭习惯一致） */
  useEffect(() => {
    if (!outpaintSessionActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      endOutpaintSession();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [outpaintSessionActive, endOutpaintSession]);

  /** IKGOQX 扩图会话绑定清理：源图卡被删除时结束会话（其余退出路径见统一退出函数） */
  useEffect(() => {
    if (!outpaintNodeId) return;
    if (!mediaNodes.some((n) => n.id === outpaintNodeId)) endOutpaintSession();
  }, [outpaintNodeId, mediaNodes, endOutpaintSession]);

  useEffect(() => {
    if (!textGenDraftId) return;
    const node = textNodes.find((n) => n.id === textGenDraftId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (!node || d.textGen !== true) {
      setTextGenDraftId(null);
      setShowTextGenDialog(false);
    }
  }, [textGenDraftId, textNodes]);

  /** 打开绑定指定草稿的视频面板（IKDMQS）：带入草稿已保存的参数与当前连线文本附件；
   *  preset 覆盖节点 data 读出的参数——新建草稿后 mediaNodesRef 尚未更新，种子参数经 preset 兜底；
   *  IKFR4Y：重开/切换面板即结束残留的持续选取会话（重开为普通模式，不恢复选取） */
  const openVideoDraftDialog = (nodeId: string, preset?: VideoGenSeedParams) => {
    if (!canOpenEditor(nodeId)) return;
    endVideoPickSession();
    videoPanelHiddenRef.current = false;
    editingTargetRef.current = nodeId;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    setVideoDraftId(nodeId);
    setVideoSeed({
      ts: Date.now(),
      text: typeof d.prompt === 'string' ? d.prompt : '',
      doc: restorePromptDoc(d.promptDoc, d.prompt),
      params: {
        modelId: preset?.modelId ?? (typeof d.draftModelId === 'string' ? d.draftModelId : undefined),
        aspectRatio: preset?.aspectRatio ?? (typeof d.draftRatio === 'string' ? d.draftRatio : undefined),
        resolution: preset?.resolution ?? (typeof d.draftSize === 'string' ? d.draftSize : undefined),
        duration: preset?.duration ?? (typeof d.draftDuration === 'number' ? d.draftDuration : undefined),
        mode: preset?.mode ?? (typeof d.draftMode === 'string' ? d.draftMode : undefined),
        // IKG0LP：音频选择持久化在草稿 data，重开时恢复
        generateAudio: preset?.generateAudio ?? (typeof d.draftGenerateAudio === 'boolean' ? d.draftGenerateAudio : undefined),
      },
      targetNodeId: nodeId,
      attachments: textAttachmentsOf(nodeId),
    });
    warnStaleMediaRefs(nodeId, 'video');
    setShowBottomDialog(true);
    setShowImageDialog(false);
    setShowAudioDialog(false);
    setShowMusicDialog(false);
    setShowTextGenDialog(false);
    setShowEnhanceDialog(false);
  };

  /** 新建视频草稿卡（IKDMQS 统一入口共用）：seed 字段写入草稿 data 持久化键并自动选中，返回节点 id；
   *  草稿不进 pendingNodeIds 回滚集合——保存失败时草稿与当前编辑保留，随下次保存重试 */
  const createVideoDraftCard = (seed?: {
    modelId?: string;
    ratio?: string;
    size?: string;
    duration?: number;
    mode?: string;
    /** IKG0LP：是否带音频（随草稿 data 持久化） */
    generateAudio?: boolean;
  }, position?: { x: number; y: number }): string => {
    const nodeId = newNodeId('media-draft');
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: position ?? spawnDraftPosition(),
      selected: true,
      data: {
        src: '',
        mediaType: 'video',
        fileName: '视频草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        toolMode,
        ...(seed?.modelId != null ? { draftModelId: seed.modelId } : {}),
        ...(seed?.ratio != null ? { draftRatio: seed.ratio, targetRatio: seed.ratio } : {}),
        ...(seed?.size != null ? { draftSize: seed.size } : {}),
        ...(seed?.duration != null ? { draftDuration: seed.duration } : {}),
        ...(seed?.mode != null ? { draftMode: seed.mode } : {}),
        ...(seed?.generateAudio != null ? { draftGenerateAudio: seed.generateAudio } : {}),
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onReEdit: (id: string) => actionsRef.current.reEdit(id),
        onGenImage: (id: string) => actionsRef.current.genImage(id),
        onImg2Img: (id: string, file: File) => actionsRef.current.img2img(id, file),
        onGenVideo: (id: string) => actionsRef.current.genVideo(id),
        onGenAudio: (id: string) => actionsRef.current.genAudio(id),
        onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setTextNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    const nextMedia = [...deselect(mediaNodesRef.current), node];
    mediaNodesRef.current = nextMedia;
    setMediaNodes(nextMedia);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    return nodeId;
  };

  /** 音频生成草稿卡，落在指定点 */
  const createAudioDraftCard = (position?: { x: number; y: number }): string => {
    const nodeId = newNodeId('media-draft');
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: position ?? spawnDraftPosition(),
      selected: true,
      data: {
        src: '',
        mediaType: 'audio',
        fileName: '音频草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        toolMode,
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onReEdit: (id: string) => actionsRef.current.reEdit(id),
        onGenImage: (id: string) => actionsRef.current.genImage(id),
        onImg2Img: (id: string, file: File) => actionsRef.current.img2img(id, file),
        onGenVideo: (id: string) => actionsRef.current.genVideo(id),
        onGenAudio: (id: string) => actionsRef.current.genAudio(id),
        onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setTextNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    const nextMedia = [...deselect(mediaNodesRef.current), node];
    mediaNodesRef.current = nextMedia;
    setMediaNodes(nextMedia);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    return nodeId;
  };

  /** 图片生成草稿卡，落在指定点。overrides（IKGM9F 高清放大复用同一骨架）：
   *  fileName 覆盖初始标题，data 附加节点身份字段（如高清标记），nodeId 指定节点 id
   *  （IKGOTB 擦除结果卡：node id 即任务冻结的 target_node_id，发送前生成），回调不可覆盖；
   *  skipSelect（IKGW1S 裁切成品卡）= 不抢选中：新卡 selected 为 false、不取消其他卡选中、
   *  不发 selectRequest（默认 false，既有调用点行为不变）。 */
  const createImageDraftCard = (
    position?: { x: number; y: number },
    overrides?: { fileName?: string; data?: Record<string, unknown>; nodeId?: string; skipSelect?: boolean },
  ): string => {
    const nodeId = overrides?.nodeId ?? newNodeId('media-draft');
    const skipSelect = overrides?.skipSelect === true;
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: position ?? spawnDraftPosition(),
      selected: !skipSelect,
      data: {
        src: '',
        mediaType: 'image',
        fileName: overrides?.fileName ?? '图片草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        ...(overrides?.data ?? {}),
        toolMode,
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onReEdit: (id: string) => actionsRef.current.reEdit(id),
        onGenImage: (id: string) => actionsRef.current.genImage(id),
        onImg2Img: (id: string, file: File) => actionsRef.current.img2img(id, file),
        onGenVideo: (id: string) => actionsRef.current.genVideo(id),
        onGenAudio: (id: string) => actionsRef.current.genAudio(id),
        onEnhanceImage: (id: string) => actionsRef.current.enhanceImage(id),
        onOutpaintImage: (id: string) => actionsRef.current.outpaintImage(id),
        onEraseImage: (id: string) => actionsRef.current.eraseImage(id),
        onCropImage: (id: string) => actionsRef.current.cropImage(id),
        onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    if (skipSelect) {
      // 不抢选中：其他卡选中态原样保留，也不发程序化选中请求（规格故事 25：新卡不抢选中、源卡保持选中）
      const nextMedia = [...mediaNodesRef.current, node];
      mediaNodesRef.current = nextMedia;
      setMediaNodes(nextMedia);
      return nodeId;
    }
    setTextNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    const nextMedia = [...deselect(mediaNodesRef.current), node];
    mediaNodesRef.current = nextMedia;
    setMediaNodes(nextMedia);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    return nodeId;
  };

  /** 文本生成节点：身份保持可被连入，写了正文后也可作上游 */
  const createTextGenDraft = (position?: { x: number; y: number }): string => {
    const nodeId = newNodeId('text');
    const node: Node = {
      id: nodeId,
      type: 'textNode',
      position: position ?? spawnDraftPosition(),
      selected: true,
      data: {
        text: '',
        title: '文本生成',
        textGen: true,
        onDraftError: handleDraftError,
        toolMode,
        onDelete: (id: string) => removeCanvasNodes([id]),
        onTextChange: (id: string, text: string) => {
          setTextNodes((prev) =>
            prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n)),
          );
        },
        onMediaIndexChange: handleMediaIndexChange,
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
        onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
        onWriteSelf: () => {
          skipTextGenOpenRef.current = true;
          setShowTextGenDialog(false);
        },
      },
    };
    pendingNodeIdsRef.current.add(nodeId);
    historyRef.current?.pushAddNodes([nodeId]);
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setMediaNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    setTextNodes((prev) => [...deselect(prev), node]);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    return nodeId;
  };

  const openTextGenDialog = (nodeId: string) => {
    skipTextGenOpenRef.current = false;
    setTextGenDraftId(nodeId);
    setShowTextGenDialog(true);
    setShowImageDialog(false);
    setShowBottomDialog(false);
    setShowAudioDialog(false);
    setShowMusicDialog(false);
    setShowEnhanceDialog(false);
  };

  const handleTextGenSend = (text: string, modelId: string) => {
    if (!textGenDraftId) return;
    const nodeId = textGenDraftId;
    const attachments = textAttachmentsOf(nodeId);
    const body = [attachments.map((item) => item.text).filter(Boolean).join('\n\n'), text]
      .filter(Boolean)
      .join('\n\n');
    setTextNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, text: body, prompt: text, draftModelId: modelId } }
          : n,
      ),
    );
    setShowTextGenDialog(false);
  };

  const openConnectTypeMenu = (sourceIds: string[], clientX: number, clientY: number) => {
    const sources = sourceIds.map(findCanvasNode).filter((n): n is Node => isConnectableSource(n));
    if (sources.length === 0) return;
    if (availableGenKinds(sources).size === 0) return;
    setConnectMenu({ sourceIds: sources.map((n) => n.id), x: clientX, y: clientY });
  };

  /** 类型菜单建草稿后自动连上游：媒体来源按各生成类型做参考校验；
   *  文本卡是创作上下文，不能走媒体参考校验，否则视频生成会被误拦、连不上线。 */
  const connectMenuSourcesToDraft = (sourceIds: string[], targetId: string, kind: ConnectGenKind) => {
    sourceIds.forEach((id) => {
      const source = findCanvasNode(id);
      if (!source || !isConnectableSource(source)) return;
      if (source.type === 'mediaNode') {
        if (kind === 'video' && videoRefSourceError(source, 'reference')) return;
        if (kind === 'image' && imageRefSourceError(source)) return;
        if (kind === 'audio' && audioRefSourceError(source)) return;
        addCanvasEdge(id, targetId, kind === 'video' ? 'reference' : undefined);
        return;
      }
      // 生成卡连入草稿：只拉「生成卡 → 产物」，不把被引用图再连到产物
      const sourceData = source.data as Record<string, unknown> | undefined;
      if (source.type === 'textNode' && sourceData?.promptSource && (kind === 'image' || kind === 'video')) {
        connectPlanToDraft(id, targetId);
        return;
      }
      addCanvasEdge(id, targetId);
    });
  };

  const applyConnectType = (kind: ConnectGenKind) => {
    if (!connectMenu) return;
    const sourceIds = connectMenu.sourceIds;
    const position = spawnNearScreen({ x: connectMenu.x, y: connectMenu.y });
    setConnectMenu(null);
    let targetId = '';
    if (kind === 'video') {
      targetId = createVideoDraftCard(undefined, position);
      connectMenuSourcesToDraft(sourceIds, targetId, 'video');
      openVideoDraftDialog(targetId);
      return;
    }
    if (kind === 'image') {
      targetId = createImageDraftCard(position);
      connectMenuSourcesToDraft(sourceIds, targetId, 'image');
      openImageDraftDialog(targetId);
      return;
    }
    if (kind === 'audio') {
      targetId = createAudioDraftCard(position);
      connectMenuSourcesToDraft(sourceIds, targetId, 'audio');
      openAudioDraftDialog(targetId);
      return;
    }
    targetId = createTextGenDraft(position);
    sourceIds.forEach((id) => addCanvasEdge(id, targetId));
    openTextGenDialog(targetId);
  };

  /** 屏幕点下的画布内容节点 id。加号在节点盒外，连线预览也会盖住把手，需穿透叠层查找。 */
  const canvasNodeIdAtScreen = (clientX: number, clientY: number): string | null => {
    const stacked = document.elementsFromPoint(clientX, clientY);
    for (const el of stacked) {
      if (!(el instanceof Element)) continue;
      const handleEl = el.closest('.react-flow__handle') as HTMLElement | null;
      if (handleEl) {
        const handleNodeId = handleEl.getAttribute('data-nodeid') || handleEl.getAttribute('data-node-id');
        if (handleNodeId && findCanvasNode(handleNodeId)) return handleNodeId;
      }
      const nodeEl = el.closest('.react-flow__node') as HTMLElement | null;
      if (!nodeEl) continue;
      const id = nodeEl.getAttribute('data-id');
      if (id && findCanvasNode(id)) return id;
    }
    return null;
  };

  const handleConnectEnd = (
    event: MouseEvent | TouchEvent,
    state?: {
      fromNode?: Node | null;
      toNode?: Node | null;
      isValid?: boolean | null;
      toHandle?: { nodeId?: string | null } | null;
    },
  ) => {
    const fromId = state?.fromNode?.id ?? connectingSourceRef.current;
    connectingSourceRef.current = null;
    const from = fromId ? findCanvasNode(fromId) ?? state?.fromNode ?? undefined : undefined;
    if (!from) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const handleNodeId = state?.toHandle?.nodeId ?? null;
    const droppedId =
      (handleNodeId && handleNodeId !== from.id && findCanvasNode(handleNodeId) ? handleNodeId : null)
      ?? (state?.toNode && state.toNode.id !== from.id && findCanvasNode(state.toNode.id) ? state.toNode.id : null)
      ?? canvasNodeIdAtScreen(point.clientX, point.clientY);
    // 落到其他节点或加号：视为连线，不弹可选菜单
    if (droppedId && droppedId !== from.id) {
      connectPair(from.id, droppedId);
      return;
    }
    if (!isConnectableSource(from)) return;
    // 库已建成有效连线但没命中检测时，也不弹菜单
    if (state?.isValid) return;
    // 未连到其他节点：松手展示可选菜单
    openConnectTypeMenu([from.id], point.clientX, point.clientY);
  };

  const handleConnectGroupDrop = (
    memberIds: string[],
    _targetId: string | null,
    client: { x: number; y: number },
  ) => {
    const sources = memberIds.filter((id) => isConnectableSource(findCanvasNode(id)));
    if (sources.length === 0) return;
    // 组连线只能弹可选菜单，不能接到已有节点
    openConnectTypeMenu(sources, client.x, client.y);
  };

  const isValidCanvasConnection = (connection: { source: string | null; target: string | null }) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const sourceNode = findCanvasNode(connection.source);
    const targetNode = findCanvasNode(connection.target);
    if (!sourceNode || !targetNode) return false;
    const sourceData = sourceNode.data as Record<string, unknown> | undefined;
    const targetData = targetNode.data as Record<string, unknown> | undefined;
    if (sourceData?.emptyShell || targetData?.emptyShell) return false;
    if (wouldCreateCycle(connection.source, connection.target, edgesRef.current)) return false;
    const kind = genKindOf(targetNode);
    // 图片草稿：以参考校验为准，避免能力集把合法图片素材预览成「无法连接」
    if (kind === 'image' && sourceNode.type === 'mediaNode') {
      return imageRefSourceError(sourceNode) === null;
    }
    if (!isConnectableSource(sourceNode)) return false;
    if (kind && !canConnectSourcesToGen([sourceNode], kind)) return false;
    return true;
  };

  /** 面板编辑实时写回视频草稿节点（IKDMQS）：参数随节点 data 进入自动保存，刷新后恢复 */
  const handleVideoDraftParamsChange = (
    nodeId: string,
    patch: { prompt?: string; promptDoc?: StoredPromptDoc; modelId?: string; size?: string; ratio?: string; duration?: number; mode?: string; generateAudio?: boolean },
  ) => {
    const data: Record<string, unknown> = {};
    if (patch.prompt !== undefined) data.prompt = patch.prompt;
    if (patch.promptDoc !== undefined) data.promptDoc = patch.promptDoc;
    if (patch.modelId !== undefined) data.draftModelId = patch.modelId;
    if (patch.size !== undefined) data.draftSize = patch.size;
    if (patch.duration !== undefined) data.draftDuration = patch.duration;
    if (patch.mode !== undefined) data.draftMode = patch.mode;
    // IKG0LP：是否带音频随草稿持久化，重开面板时恢复用户上次的选择
    if (patch.generateAudio !== undefined) data.draftGenerateAudio = patch.generateAudio;
    if (patch.ratio !== undefined) {
      data.draftRatio = patch.ratio;
      data.targetRatio = patch.ratio;
    }
    if (Object.keys(data).length === 0) return;
    patchMediaNode(nodeId, data);
  };

  /** 面板绑定清理（IKDMQS；IKDMQU 扩展到成品卡，同图片） */
  useEffect(() => {
    if (!videoDraftId) return;
    if (videoSeed?.targetNodeId !== videoDraftId) {
      setVideoDraftId(null);
      return;
    }
    const node = mediaNodes.find((n) => n.id === videoDraftId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (!node || (d.draft !== true && !hasGenerationRecord(node))) {
      setVideoDraftId(null);
      setShowBottomDialog(false);
    }
  }, [videoDraftId, videoSeed, mediaNodes]);

  /** 打开绑定指定草稿的音频面板（IKDMQT）：带入草稿已保存的文字描述与模型。
   *  IKFDFZ：媒体参考改为「来源→草稿」连线持久化；存量 data.audioRefs 的画布项
   *  首次打开时迁移为连线（按节点 id 找回来源），迁移后清空旧字段——画布项不再经 seed 恢复；
   *  IKFR4Z：重开/切换面板即结束残留的持续选取会话（重开为普通模式，不恢复选取） */
  const openAudioDraftDialog = (nodeId: string) => {
    if (!canOpenEditor(nodeId)) return;
    endAudioPickSession();
    audioPanelHiddenRef.current = false;
    editingTargetRef.current = nodeId;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    setAudioDraftId(nodeId);
    setAudioPickResult(null);
    const legacyRefs = Array.isArray(d.audioRefs) ? d.audioRefs as AudioRefItem[] : [];
    if (legacyRefs.length > 0) {
      // 迁移是「表达形式转换」而非添加入口（数据在旧机制下已被接纳），不走 checkAddAudioRef——
      // 失效/重复来源按连线模型落到 invalid/去重兜底，不静默丢弃存量数据
      for (const item of legacyRefs) {
        if (item.source !== 'canvas') continue;
        if (!mediaNodesRef.current.some((n) => n.id === item.id)) continue;
        addCanvasEdge(item.id, nodeId);
      }
      patchMediaNode(nodeId, { audioRefs: [] });
    }
    setAudioSeed({
      ts: Date.now(),
      text: typeof d.prompt === 'string' ? d.prompt : '',
      modelId: typeof d.draftModelId === 'string' ? d.draftModelId : undefined,
      targetNodeId: nodeId,
      doc: restorePromptDoc(d.promptDoc, d.prompt),
      refs: [],
    });
    setShowAudioDialog(true);
    setShowBottomDialog(false);
    setShowImageDialog(false);
    setShowMusicDialog(false);
    setShowEnhanceDialog(false);
  };

  /** 面板编辑实时写回音频草稿节点（IKDMQT）：参数随节点 data 进入自动保存，刷新后恢复。
   *  媒体参考不经此链路（IKFDFZ 起走连线，随画布自动保存） */
  const handleAudioDraftParamsChange = (
    nodeId: string,
    patch: { prompt?: string; modelId?: string; promptDoc?: PromptDoc | null },
  ) => {
    const data: Record<string, unknown> = {};
    if (patch.prompt !== undefined) data.prompt = patch.prompt;
    if (patch.promptDoc !== undefined) data.promptDoc = patch.promptDoc ? { ...patch.promptDoc, flat: patch.prompt ?? '' } : null;
    if (patch.modelId !== undefined) data.draftModelId = patch.modelId;
    if (Object.keys(data).length === 0) return;
    patchMediaNode(nodeId, data);
  };

  /** 面板绑定清理（IKDMQT；IKDMQU 扩展到成品卡，同图片） */
  useEffect(() => {
    if (!audioDraftId) return;
    if (audioSeed?.targetNodeId !== audioDraftId) {
      setAudioDraftId(null);
      return;
    }
    const node = mediaNodes.find((n) => n.id === audioDraftId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (!node || (d.draft !== true && !hasGenerationRecord(node))) {
      setAudioDraftId(null);
      setShowAudioDialog(false);
    }
  }, [audioDraftId, audioSeed, mediaNodes]);

  /** 同步 toolMode 到所有文本节点和媒体节点 */
  useEffect(() => {
    setTextNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
    setMediaNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
    setProductNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
    setAssetNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
  }, [toolMode]);

  /** 项目切换/新建前的落盘闸门（IKDMQQ Q19）：先把未防抖编辑落盘；保存失败停留当前项目并提示重试。
   *  顺带修复「带未保存编辑切换项目丢失修改」的旧缺口。 */
  const ensureSavedBeforeProjectSwitch = async (): Promise<boolean> => {
    if (submittingNodeId) {
      showToast('warn', '正在保存并提交，请稍候');
      return false;
    }
    if (saveBlocked) {
      showToast('warn', '保存失败，请重试');
      return false;
    }
    if (!currentId || !doc) return true;
    const projectId = currentId;
    applyingRef.current = true;
    try {
      return await flushCanvasSave(projectId);
    } catch (e) {
      showToast('error', '保存失败，请重试');
      console.warn('项目切换前画布落盘失败:', e);
      return false;
    } finally {
      applyingRef.current = false;
    }
  };

  /** 选择项目 */
  const handleSelect = async (id: string) => {
    if (!id || id === currentId) return;
    if (!(await ensureSavedBeforeProjectSwitch())) return;
    setCurrentId(id);
  };

  /** 重命名项目：PUT /api/projects/:id，成功后更新列表项 */
  const handleRename = (id: string, newName: string) => {
    renameProject(id, newName)
      .then((updated) => {
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, name: updated.name } : p)),
        );
      })
      .catch(() => undefined);
  };

  /** 删除当前画布后回到项目列表；删除其他项目时留在当前画布。 */
  const handleDelete = (id: string) => {
    deleteProject(id)
      .then(() => {
        const remaining = projects.filter((p) => p.id !== id);
        setProjects(remaining);
        // 项目卡片页缓存含已删除项目；返回前清除，确保挂载后重新请求最新列表。
        queryClient.removeQueries({ queryKey: projectKeys.all });
        if (shouldReturnToProjectsAfterDelete(currentId, id)) {
          navigate('/projects');
          return;
        }
      })
      .catch(() => undefined);
  };

  /** 新建项目：POST /api/projects 并切换选中（撞名由后端自动追加 (2)(3)）；先过落盘闸门（IKDMQQ） */
  const handleNewProject = async () => {
    if (!(await ensureSavedBeforeProjectSwitch())) return;
    try {
      const created = await createProject(defaultProjectName());
      const item: CanvasProject = { id: String(created.id), name: created.name };
      setProjects((prev) => [item, ...prev]);
      setCurrentId(item.id);
    } catch {
      /* 创建失败不影响画布操作 */
    }
  };

  /**
   * 单文件落到画布：本地预览立即可见，后台三步上传成功后换永久 URL。
   * 工具栏多选和 Agent 侧边栏「+」（IKBA6C）共用这一条，避免会话附件与画布各传一次。
   */
  const placeFileOnCanvas = (
    file: File,
    opts?: { position?: { x: number; y: number }; replaceNodeId?: string },
  ): Promise<{ asset_id: string; url: string; nodeId: string }> => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    if (!isImage && !isVideo && !isAudio) {
      return Promise.reject(new Error('只支持图片、视频或音频'));
    }
    const limit = UPLOAD_SIZE_LIMIT[isImage ? 'image' : isVideo ? 'video' : 'audio'];
    if (file.size > limit) {
      return Promise.reject(new Error(`文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限`));
    }
    const nodeId = opts?.replaceNodeId ?? newNodeId('media');
    const localSrc = URL.createObjectURL(file);
    pendingNodeIdsRef.current.add(nodeId);
    const mediaType = isVideo ? 'video' : isAudio ? 'audio' : 'image';
    const mediaCallbacks = {
      onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
      onDuplicate: (id: string) => actionsRef.current.duplicate(id),
      onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
      onAddToChat: (id: string) => actionsRef.current.addToChat(id),
      onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
      onCopyImage: (id: string) => actionsRef.current.copyImage(id),
      onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
      onFillEmptyShell: (id: string, next: File) => actionsRef.current.fillEmptyShell(id, next),
      onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
      onRetryJob: (id: string) => actionsRef.current.retryJob(id),
      onReEdit: (id: string) => actionsRef.current.reEdit(id),
      onGenImage: (id: string) => actionsRef.current.genImage(id),
      onImg2Img: (id: string, file: File) => actionsRef.current.img2img(id, file),
      onGenVideo: (id: string) => actionsRef.current.genVideo(id),
      onGenAudio: (id: string) => actionsRef.current.genAudio(id),
      onEnhanceImage: (id: string) => actionsRef.current.enhanceImage(id),
      onOutpaintImage: (id: string) => actionsRef.current.outpaintImage(id),
      onEraseImage: (id: string) => actionsRef.current.eraseImage(id),
      onCropImage: (id: string) => actionsRef.current.cropImage(id),
      onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
      onDownload: (id: string) => actionsRef.current.download(id),
      onShowDetails: (id: string) => actionsRef.current.showDetails(id),
      onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
      onMediaDims: handleMediaDims,
    };
    if (opts?.replaceNodeId) {
      setMediaNodes((prev) =>
        prev.map((n) =>
          n.id !== nodeId
            ? n
            : {
                ...n,
                data: {
                  ...n.data,
                  ...mediaCallbacks,
                  emptyShell: false,
                  src: localSrc,
                  // 已自定义名称的空壳卡填充后不覆盖（IKFA8X）
                  ...(hasCustomName(n) ? {} : { fileName: file.name }),
                  mediaType,
                  toolMode,
                },
              },
        ),
      );
    } else {
    setMediaNodes((prev) => [
      ...prev,
      {
        id: nodeId,
        type: 'mediaNode',
        position: opts?.position ?? spawnPosition(),
        data: {
          src: localSrc,
          fileName: file.name,
          mediaType,
          toolMode,
          ...mediaCallbacks,
        },
      },
    ]);
    historyRef.current?.pushAddNodes([nodeId]);
    }
    return uploadAssetFile(file, { projectId: currentId || undefined })
      .then((done) => {
        setMediaNodes((prev) =>
          prev.map((n) => {
            if (n.id !== nodeId) return n;
            URL.revokeObjectURL(localSrc);
            return {
              ...n,
              data: {
                ...n.data,
                src: done.url || localSrc,
                assetId: done.asset_id,
                emptyShell: false,
                mime: done.mime,
                width: done.width,
                height: done.height,
                duration: done.duration ?? undefined,
                size: done.size,
              },
            };
          }),
        );
        return { asset_id: done.asset_id, url: done.url, nodeId };
      })
      .catch((err) => {
        // 上传登记失败 = 添加失败：节点不留在画布，移除并释放 blob URL
        console.warn(`画布上传登记失败（${file.name}）：`, err);
        URL.revokeObjectURL(localSrc);
        pendingNodeIdsRef.current.delete(nodeId);
        if (opts?.replaceNodeId) {
          setMediaNodes((prev) =>
            prev.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, emptyShell: true, src: undefined } } : n,
            ),
          );
        } else {
          setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
        }
        // 「请重试」只对网络那一类成立。文件本身不行时那句话是错的建议——把已经写好的
        // 那句原样端出去（IKE53Z）。
        showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
        throw err instanceof Error ? err : new Error('上传失败');
      });
  };

  /** 上传文件生成媒体节点：本地预览立即上画布，后台三步上传登记，成功后换永久 URL；
   *  上传失败时 placeFileOnCanvas 内部已移除节点并 toast「添加失败，请重试」 */
  const handleUploadFile = (files: File[]) => {
    files.forEach((file) => {
      void placeFileOnCanvas(file).catch((err) => {
        showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
      });
    });
  };

  const applyClipboardAtFlow = async (position: { x: number; y: number }) => {
    const payload = await readCanvasClipboard();
    if (!payload) {
      showToast('warn', '剪贴板无可粘贴内容');
      return;
    }
    if (payload.kind === 'image') {
      try {
        await placeFileOnCanvas(payload.file, { position });
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : '粘贴失败');
      }
      return;
    }
    handleAddTextNode(position, payload.text);
  };

  const handleCopyImage = async (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    const src = node?.data?.src as string | undefined;
    if (!src || (node?.data as { mediaType?: string })?.mediaType !== 'image') {
      showToast('warn', '当前节点没有可复制的图片');
      return;
    }
    try {
      await copyImageToClipboard(src);
      showToast('success', '已复制图片');
    } catch {
      showToast('error', '复制图片失败');
    }
  };

  const patchNodeCompliance = (id: string, patch: Record<string, unknown>) => {
    setMediaNodes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
      mediaNodesRef.current = next;
      return next;
    });
  };

  const startNodeCompliance = (id: string) => {
    patchNodeCompliance(id, {
      complianceBusy: true,
      compliancePassed: false,
      complianceFailed: false,
    });
  };

  const toastComplianceError = (err: unknown) => {
    if (isApiError(err)) return;
    showToast(
      'error',
      isComplianceFailedError(err)
        ? COMPLIANCE_FAILED_TOAST
        : err instanceof Error
          ? err.message
          : '校验失败，请重试',
    );
  };

  const failNodeCompliance = (id: string, err: unknown) => {
    patchNodeCompliance(id, {
      complianceBusy: false,
      compliancePassed: false,
      complianceFailed: isComplianceFailedError(err),
    });
    toastComplianceError(err);
  };

  /** 图片/视频合规入库；成功后节点展示 success.png 通过图标 */
  const ensureMediaNodeCompliance = async (
    id: string,
    opts?: { toastSuccess?: boolean },
  ): Promise<string | undefined> => {
    const toastSuccess = opts?.toastSuccess !== false;
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node) return undefined;
    const d = (node.data ?? {}) as Record<string, unknown>;
    if (d.assetMissing === true) return undefined;
    const assetId = d.assetId != null ? String(d.assetId) : '';
    const url = typeof d.src === 'string' ? d.src : '';
    const mediaType = d.mediaType === 'video' || d.mediaType === 'audio' ? d.mediaType : 'image';
    const verifiedId = resolveCharacterLibraryMaterialId({
      mediaType,
      snapshotMaterialId: snapshotAssetsRef.current[assetId]?.material_id,
    });
    if (verifiedId) {
      startNodeCompliance(id);
      try {
        await waitComplianceAssetReady(verifiedId);
        if (toastSuccess) showToast('success', COMPLIANCE_SUCCESS_TOAST);
        if (assetId) {
          const current = snapshotAssetsRef.current[assetId];
          if (current) {
            snapshotAssetsRef.current = {
              ...snapshotAssetsRef.current,
              [assetId]: { ...current, material_id: verifiedId, material_status: 'Active' },
            };
          }
          patchAsset?.(assetId, { material_id: verifiedId, material_status: 'Active' });
        }
        patchNodeCompliance(id, {
          complianceBusy: false,
          compliancePassed: true,
          complianceFailed: false,
          materialId: verifiedId,
        });
        return verifiedId;
      } catch (err) {
        failNodeCompliance(id, err);
        return undefined;
      }
    }
    if (!url || url.startsWith('blob:')) {
      showToast('warn', '素材尚未上传完成，请稍后重试');
      return undefined;
    }
    startNodeCompliance(id);
    try {
      const result = await depositCanvasAssetToCharacterLibrary({
        sourceAssetId: assetId,
        url,
        name: typeof d.fileName === 'string' ? d.fileName : '素材',
        mediaType,
      });
      if (!result.materialId) {
        patchNodeCompliance(id, { complianceBusy: false, compliancePassed: false, complianceFailed: false });
        showToast('error', '校验失败，请重试');
        return undefined;
      }
      if (toastSuccess) showToast('success', COMPLIANCE_SUCCESS_TOAST);
      if (assetId && result.materialId) {
        const current = snapshotAssetsRef.current[assetId];
        if (current) {
          snapshotAssetsRef.current = {
            ...snapshotAssetsRef.current,
            [assetId]: { ...current, material_id: result.materialId, material_status: 'Active' },
          };
        }
        patchAsset?.(assetId, { material_id: result.materialId, material_status: 'Active' });
      }
      patchNodeCompliance(id, {
        complianceBusy: false,
        compliancePassed: true,
        complianceFailed: false,
        materialId: result.materialId,
      });
      return result.materialId;
    } catch (err) {
      failNodeCompliance(id, err);
      return undefined;
    }
  };

  const handleComplianceCheck = async (id: string) => {
    await ensureMediaNodeCompliance(id, { toastSuccess: true });
  };

  const handleFillEmptyShell = (id: string, file: File) => {
    void placeFileOnCanvas(file, { replaceNodeId: id }).catch((err) => {
      showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
    });
  };

  /** 图片生成节点「图生图」：本地图落入画布、自动连线、进入参考清单 */
  const handleImg2Img = (draftId: string, file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('warn', '图生图仅支持图片');
      return;
    }
    const draft = mediaNodesRef.current.find((n) => n.id === draftId);
    const center = draft
      ? { x: draft.position.x - 360, y: draft.position.y }
      : spawnDraftPosition();
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    const position = nextDraftPosition({
      center,
      dockTop: center.y + 2000,
      nodes: nodes.map(nodeBoxOf),
    });
    void placeFileOnCanvas(file, { position }).then((done) => {
      addCanvasEdge(done.nodeId, draftId);
      void actionsRef.current.complianceCheck(done.nodeId);
      openImageDraftDialog(draftId);
    }).catch((err) => {
      showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
    });
  };

  actionsRef.current = {
    ...actionsRef.current,
    duplicate: handleDuplicateNode,
    addToChat: handleAddToChatNode,
    pasteAtNode: (id) => {
      const node =
        textNodesRef.current.find((n) => n.id === id) ?? mediaNodesRef.current.find((n) => n.id === id);
      const position = node
        ? { x: node.position.x + 40, y: node.position.y + 40 }
        : spawnPosition();
      void applyClipboardAtFlow(position);
    },
    copyImage: (id) => { void handleCopyImage(id); },
    complianceCheck: (id) => { void handleComplianceCheck(id); },
    fillEmptyShell: handleFillEmptyShell,
    img2img: handleImg2Img,
  };

  /** 从资产 URL 提取展示名（无元数据字段时的兜底命名） */
  const assetDisplayName = (asset: AssetRecord): string => {
    try {
      const last = new URL(asset.url).pathname.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : `资产-${asset.id}`;
    } catch {
      return `资产-${asset.id}`;
    }
  };

  /** 资产库选择弹窗 → 确认选中的已有资产批量落到画布（多选）：
   *  直接以 /api/assets 返回的 id 作为 assetId 建媒体节点，不走 TOS 上传；
   *  后台补 link 关联，确保素材进入当前项目 snapshot 字典（刷新后不判缺失）。
   *  reuseExisting（IKFDG2 参考接纳路径）：画布已有同 assetId 的同类型有效媒体节点时复用该来源卡片，
   *  不重复建卡——按持久身份精确匹配，不按名称/外观/位置猜测。
   *  返回接纳节点 id 列表（含复用节点；项目未就绪时 null，由调用方决定是否提示）。 */
  const placeAssetsOnCanvas = (
    selectedAssets: AssetRecord[],
    opts?: { reuseExisting?: boolean },
  ): string[] | null => {
    if (!currentId) return null;

    const adoptedIds: string[] = [];
    const nodes: Node[] = [];
    const reusedCompliance: Array<{ id: string; patch: Record<string, unknown> }> = [];
    // 资产库 Active（成功角标）或素材库 Asset- 条目：落入画布即视为已通过合规
    const complianceFromAsset = (asset: AssetRecord): Record<string, unknown> => {
      if (asset.type === 'audio') return {};
      const id = String(asset.id);
      const fromLibrary = isMaterialLibraryId(id);
      const materialId = fromLibrary
        ? id
        : (typeof asset.material_id === 'string' && asset.material_id ? asset.material_id : undefined);
      if (asset.material_status !== 'Active' && !fromLibrary) return {};
      return {
        ...(materialId ? { materialId } : {}),
        compliancePassed: true,
        complianceFailed: false,
      };
    };
    for (const asset of selectedAssets) {
      const assetId = String(asset.id);
      const mediaType = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image';
      if (opts?.reuseExisting) {
        const libraryId = typeof asset.material_id === 'string' && asset.material_id ? asset.material_id : undefined;
        const existing = mediaNodesRef.current.find(
          (n) => {
            if (n.type !== 'mediaNode') return false;
            const data = (n.data ?? {}) as Record<string, unknown>;
            if (data.mediaType !== mediaType || baseSourceError(n) !== null) return false;
            const nodeAssetId = readAssetId(data);
            if (nodeAssetId === assetId) return true;
            if (libraryId && (data.materialId === libraryId || nodeAssetId === libraryId)) return true;
            return false;
          },
        );
        if (existing) {
          const patch = complianceFromAsset(asset);
          if (Object.keys(patch).length > 0) reusedCompliance.push({ id: existing.id, patch });
          adoptedIds.push(existing.id);
          continue;
        }
      }
      const fileNameFromUrl = assetDisplayName(asset);
      const nodeId = newNodeId('media');
      nodes.push({
        id: nodeId,
        type: 'mediaNode' as const,
        // 多节点在视口中心 ±80px 范围内自然错乱堆叠，与单节点添加行为一致
        position: spawnPosition(),
        data: {
          src: asset.url,
          fileName: fileNameFromUrl,
          mediaType,
          assetId,
          ...complianceFromAsset(asset),
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          duration: asset.duration ?? undefined,
          size: asset.size ?? undefined,
          toolMode,
          onDelete: (id: string) => {
            setMediaNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onReEdit: (id: string) => actionsRef.current.reEdit(id),
          onGenImage: (id: string) => actionsRef.current.genImage(id),
          onImg2Img: (id: string, file: File) => actionsRef.current.img2img(id, file),
          onGenVideo: (id: string) => actionsRef.current.genVideo(id),
          onGenAudio: (id: string) => actionsRef.current.genAudio(id),
          onEnhanceImage: (id: string) => actionsRef.current.enhanceImage(id),
          onOutpaintImage: (id: string) => actionsRef.current.outpaintImage(id),
          onEraseImage: (id: string) => actionsRef.current.eraseImage(id),
          onCropImage: (id: string) => actionsRef.current.cropImage(id),
          onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
        },
      });
    }

    nodes.forEach((node) => pendingNodeIdsRef.current.add(node.id));
    setMediaNodes((prev) => {
      const patched = reusedCompliance.length === 0
        ? prev
        : prev.map((node) => {
            const hit = reusedCompliance.find((item) => item.id === node.id);
            return hit ? { ...node, data: { ...node.data, ...hit.patch } } : node;
          });
      return [...patched, ...nodes];
    });

    // 幂等补关联：素材已属当前项目也无副作用；失败仅提示，不影响节点展示。
    // 真实人像库条目是素材库 Asset- 前缀 ID，不能当本地 assets 表 id 去 link。
    selectedAssets.forEach((asset) => {
      if (isMaterialLibraryId(String(asset.id))) return;
      linkAssetToProject(currentId, asset.id).catch((err) => {
        console.warn('资产关联项目失败：', err);
        showToast('warn', '资产关联项目失败，请稍后重试');
      });
    });
    return [...adoptedIds, ...nodes.map((n) => n.id)];
  };

  /** 资产选择弹窗统一确认路由（IKC3RY 模块D 八入口）：
   *  按打开来源分发——画布工具栏/Agent 面板落画布节点（Agent 面板额外挂会话附件），
   *  dock 对话框注入参考素材（带 assetId，发送时免重复上传）。
   *  选择行为与该入口现有上传一致：数量上限/超限提示由各消费方既有链路兜底。 */
  const handleAssetsPickerSelect = async (selectedAssets: AssetRecord[]) => {
    const target = assetsPickerTarget;
    setShowAssetsPicker(false);
    if (selectedAssets.length === 0) return;
    if (!currentId) {
      showToast('error', '项目未就绪，请稍后重试');
      return;
    }
    if (selectedAssets.some(isPendingLivenessLibraryAsset)) {
      showToast('warn', '正在导入真人人像库素材…');
    }
    const assets = await importLivenessLibraryAssets(selectedAssets, currentId, (name, message) => {
      showToast('error', `「${name}」${message}`);
    });
    if (assets.length === 0) return;

    if (target === 'videoDraft') {
      // 视频草稿面板「从资产中选择」（IKDMQS 来源补齐）：素材落画布节点并按槽位角色连线，
      // 节点可复用可持久化；首/尾帧槽仅图片，IKGB7Y 起多选按选择顺序填充空槽（目标槽优先、
      // 其后另一空槽），超出剩余空槽只取前 N 张并提示；普通参考按图9/视频3/音频3联算上限并查重
      // （IKFE8U 全能参考扩展音频；列表过滤见 AssetsPickerModal mediaTypes，此处为接纳防线）。
      // 自由模式（工具栏入口无草稿卡）：资产存本地参考，不落画布不连线
      const role = videoAssetPickRole;
      const refs = videoDraftId
        ? mergedVideoMediaRefsOf(videoDraftId, edgesRef.current, mediaNodesRef.current)
        : videoFreeRefs;
      let accepted = assets.filter((a) => a.type === 'image' || a.type === 'video' || a.type === 'audio');
      if (role === 'first' || role === 'last') {
        if (refs[role]) {
          showToast('warn', role === 'first' ? '首帧已指定，请先移除现有首帧' : '尾帧已指定，请先移除现有尾帧');
          return;
        }
        accepted = accepted.filter((a) => a.type === 'image');
        if (accepted.length === 0) return;
        // IKGB7Y 顺序填充与溢出截断：填充顺序 = 目标槽（操作条发起=首空槽，首帧优先、其后尾帧；
        // 具名槽位入口=本槽精确指定）→ 另一空槽；N = 剩余空槽数，多选超出按选择顺序只取前 N 张
        // 并 toast 提示，不静默丢失、不报错中断
        const otherRole: VideoRefRole = role === 'first' ? 'last' : 'first';
        const frameRoles: VideoRefRole[] = refs[otherRole] ? [role] : [role, otherRole];
        if (accepted.length > frameRoles.length) {
          showToast('warn', frameRoles.length > 1
            ? '首尾帧最多两张图片，已按选择顺序取前两张'
            : '首尾帧仅支持一张图片，已取首张');
        }
        accepted = accepted.slice(0, frameRoles.length);
        if (!videoDraftId) {
          accepted.forEach((a, i) =>
            appendVideoFreeRef(
              {
                nodeId: `asset-${a.id}`,
                url: a.url,
                name: assetDisplayName(a),
                assetId: String(a.id),
                mediaType: asVideoRefMediaType(a.type),
                materialId: typeof a.material_id === 'string' && a.material_id
                  ? a.material_id
                  : (isMaterialLibraryId(String(a.id)) ? String(a.id) : undefined),
              },
              frameRoles[i] ?? role,
            ),
          );
          return;
        }
        // 逐条落画布保持选择顺序（批量放置混合「复用既有节点 + 新建」时返回序不按选择序）
        for (let i = 0; i < accepted.length; i += 1) {
          const nodeIds = placeAssetsOnCanvas([accepted[i]!], { reuseExisting: true });
          if (!nodeIds) {
            showToast('error', '项目未就绪，请稍后重试');
            return;
          }
          addCanvasEdge(nodeIds[0]!, videoDraftId, frameRoles[i] ?? role);
        }
        return;
      }
      // 普通参考：图/视频/音频分类上限与连线+material 合并联算（ADR-0086：读能力行，
      // 缺省回落旧 9/3/3）；assetId / materialId 互通查重（TC_DG_205）
      const known = occupiedVideoRefIds(refs);
      let imgSlots = 9 - refs.reference.filter((r) => r.mediaType === 'image').length;
      let vidSlots = 3 - refs.reference.filter((r) => r.mediaType === 'video').length;
      let audSlots = 3 - refs.reference.filter((r) => r.mediaType === 'audio').length;
      const overflowKinds: Array<'image' | 'video' | 'audio'> = [];
      let skippedDup = false;
      const filtered: AssetRecord[] = [];
      for (const a of accepted) {
        const materialId = typeof a.material_id === 'string' && a.material_id ? a.material_id : undefined;
        if (known.has(String(a.id)) || (materialId && known.has(materialId))) {
          skippedDup = true;
          continue;
        }
        const isImage = a.type === 'image';
        const isVideo = a.type === 'video';
        if ((isImage && imgSlots <= 0) || (isVideo && vidSlots <= 0) || (!isImage && !isVideo && audSlots <= 0)) {
          overflowKinds.push(a.type as 'image' | 'video' | 'audio');
          continue;
        }
        if (isImage) imgSlots -= 1;
        else if (isVideo) vidSlots -= 1;
        else audSlots -= 1;
        known.add(String(a.id));
        if (materialId) known.add(materialId);
        filtered.push(a);
      }
      accepted = filtered;
      if (skippedDup) showToast('warn', '重复的素材已跳过');
      if (overflowKinds.length > 0) showToast('warn', refOverflowToast(overflowKinds, { image: 9, video: 3, audio: 3 }));
      if (accepted.length === 0) return;
      if (!videoDraftId) {
        accepted.forEach((a) =>
          appendVideoFreeRef(
            {
              nodeId: `asset-${a.id}`,
              url: a.url,
              name: assetDisplayName(a),
              assetId: String(a.id),
              mediaType: asVideoRefMediaType(a.type),
              materialId: typeof a.material_id === 'string' && a.material_id
                ? a.material_id
                : (isMaterialLibraryId(String(a.id)) ? String(a.id) : undefined),
            },
            role,
          ),
        );
        return;
      }
      const nodeIds = placeAssetsOnCanvas(accepted, { reuseExisting: true });
      if (!nodeIds) {
        showToast('error', '项目未就绪，请稍后重试');
        return;
      }
      nodeIds.forEach((nid) => addCanvasEdge(nid, videoDraftId, role));
      return;
    }
    if (target === 'audioDialog') {
      // 弹窗确认只能接纳到打开时的面板，切换/关闭/生成中均不创建来源或连线。
      if (!showAudioDialog || !audioAssetPickTarget || audioAssetPickTarget.nodeId !== audioDraftId
        || audioAssetPickTarget.seed !== audioSeed?.ts || (audioDraftId && isGeneratingNode(audioDraftId))) return;
      const audios = assets.filter(a => a.type === 'audio');
      if (!audioDraftId) {
        setAudioAssetPickResult({ ts: Date.now(), items: audios.map(a => ({
          id: `asset-${a.id}`, kind: 'audio', name: assetDisplayName(a), src: a.url,
          source: 'canvas', assetId: a.id,
        })) });
        return;
      }
      const current = [...audioMediaRefsOf(audioDraftId, edgesRef.current, mediaNodesRef.current).refs];
      const accepted: AssetRecord[] = [];
      for (const asset of audios) {
        const id = String(asset.id);
        const error = checkAddAudioRef(id, current);
        if (error) { showToast('warn', error); continue; }
        current.push({ nodeId: `asset-${id}`, assetId: id, url: asset.url, name: assetDisplayName(asset), mediaType: 'audio' });
        accepted.push(asset);
      }
      if (!accepted.length) return;
      const nodeIds = placeAssetsOnCanvas(accepted, { reuseExisting: true });
      if (!nodeIds) { showToast('error', '项目未就绪，请稍后重试'); return; }
      nodeIds.forEach(id => addCanvasEdge(id, audioDraftId));
      return;
    }
    if (target === 'imageDialog') {
      const images = assets.filter((a) => a.type === 'image');
      if (images.length === 0) return;
      // IKFA1M：草稿绑定模式下「从资产中选择」落画布节点并建立连线（与视频草稿同源；
      //  此前该入口在绑定模式经 externalPick 被忽略，@ 菜单「添加新参考」依赖本路径生效）。
      //  查重与上限与 validateImageRefConnect 同口径；拒绝项不进入参考集合。
      if (imageDraftId) {
        const current = imageMediaRefsOf(imageDraftId, edgesRef.current, mediaNodesRef.current);
        const known = new Set(current.map((r) => r.assetId));
        const accepted: AssetRecord[] = [];
        let skippedDup = false;
        let overflow = false;
        for (const a of images) {
          const id = String(a.id);
          if (known.has(id)) { skippedDup = true; continue; }
          if (known.size >= 10) { overflow = true; break; }
          known.add(id);
          accepted.push(a);
        }
        if (skippedDup) showToast('warn', '重复的素材已跳过');
        if (overflow) showToast('warn', refOverflowToast(['image']));
        if (accepted.length === 0) return;
        const nodeIds = placeAssetsOnCanvas(accepted, { reuseExisting: true });
        if (!nodeIds) {
          showToast('error', '项目未就绪，请稍后重试');
          return;
        }
        nodeIds.forEach((nid) => addCanvasEdge(nid, imageDraftId));
        return;
      }
      // 图片 dock：注入 ImageDialog 参考图（externalPick 既有上限保护与去重）
      const files: UploadedFile[] = images
        .map((a) => ({ id: `asset-${a.id}`, url: a.url, type: 'image' as const, name: assetDisplayName(a), assetId: a.id }));
      setImagePickResult({ ts: Date.now(), files });
      return;
    }
    if (target === 'agentPanel') {
      // Agent 面板：与上传一致落画布节点（IKBA6C），并挂 ready 会话附件
      if (!placeAssetsOnCanvas(assets)) {
        showToast('error', '项目未就绪，请稍后重试');
        return;
      }
      const blocks: SessionContentBlock[] = assets
        .filter((a) => a.type === 'image' || a.type === 'video')
        .map((a) => ({
          type: 'asset_ref',
          url: a.url,
          name: assetDisplayName(a),
          media_type: (a.type === 'video' ? 'video' : 'image') as 'image' | 'video',
          display_label: assetDisplayName(a),
          asset_id: String(a.id),
        }));
      if (blocks.length > 0) setAgentAssetPicks({ ts: Date.now(), blocks });
      return;
    }
    // 默认（画布工具栏）：全类型批量落画布
    if (!placeAssetsOnCanvas(assets)) {
      showToast('error', '项目未就绪，请稍后重试');
    }
  };

  /* ============ 生成任务编排：创建 → 占位节点 → 轮询 → 产物挂载 ============ */

  /** 媒体节点最新列表（轮询中判断节点是否仍存在） */
  const mediaNodesRef = useRef<Node[]>([]);
  mediaNodesRef.current = mediaNodes;
  /** 文本节点最新列表（避免闭包陈旧） */
  const textNodesRef = useRef<Node[]>([]);
  textNodesRef.current = textNodes;
  /** 资产卡节点最新列表（避免闭包陈旧） */
  const assetNodesRef = useRef<Node[]>([]);
  assetNodesRef.current = assetNodes;
  /** 商品节点最新列表（避免闭包陈旧） */
  const productNodesRef = useRef<Node[]>([]);
  productNodesRef.current = productNodes;
  /** 撤销/重做栈（IKD0JT A2）：覆盖移动/删除/复制/连线/删边；生成类操作不登记（PRD §7.2） */
  const canvasHistory = useCanvasHistory({
    getTextNodes: () => textNodesRef.current,
    getMediaNodes: () => mediaNodesRef.current,
    getProductNodes: () => productNodesRef.current,
    getAssetNodes: () => assetNodesRef.current,
    getEdges: () => edgesRef.current,
    getGroups: () => groupsRef.current,
    setTextNodes: (updater) => setTextNodes(updater),
    setMediaNodes: (updater) => setMediaNodes(updater),
    setProductNodes: (updater) => setProductNodes(updater),
    setAssetNodes: (updater) => setAssetNodes(updater),
    setEdges: (updater) => setEdges(updater),
    setGroups: (updater) => setGroups(updater),
    /** 撤销移除副本时同步清未保存登记，避免回滚引用幽灵节点 */
    onNodesRemoved: (ids) => ids.forEach((id) => pendingNodeIdsRef.current.delete(id)),
  });
  historyRef.current = canvasHistory;
  /** 撤销/重做快捷键（IKD0JT A2）：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做；
   *  输入框/编辑器内不拦截（文字编辑不进画布撤销栈，PRD §7.2 R1）；
   *  @ 菜单打开期间键盘归菜单处理（IKGBPC 补齐，Esc 链同款检测）。
   *  按键判定收口在 canvasUndoKeyAction 纯函数，本监听只留副作用。 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (applyingRef.current) return;
      const action = canvasUndoKeyAction({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        target: e.target,
        mentionMenuOpen: isMentionMenuOpen(),
      });
      if (action === 'ignore') return;
      e.preventDefault();
      e.stopPropagation();
      if (action === 'redo') canvasHistory.redo();
      else canvasHistory.undo();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
    // undo/redo 为 hook 内稳定 useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasHistory.undo, canvasHistory.redo]);
  /** 生成节点轮询定时器（节点 id → timer） */
  const jobTimersRef = useRef<Map<string, number>>(new Map<string, number>());
  /** 取消接口已确认成功的节点：忽略仍在飞行中的旧轮询响应。 */
  const locallyRemovedGenerationNodesRef = useRef<Set<string>>(new Set());
  /** 已本地收敛的提取节点：快照若仍停留在 generating，水合不得再开轮询。 */
  const settledExtractNodesRef = useRef<Set<string>>(new Set());
  /** 节点当前活跃任务登记（IKDMQV）：轮询启动即同步写入，响应到达时核对——
   *  迟到旧任务响应（创建/重试后仍在飞行的旧 promise）直接丢弃，不覆盖当前任务状态或结果。
   *  用同步 ref 而非节点 data：patch jobId 经 React 提交有延迟，首个响应可能先于提交到达。 */
  const activeJobByNodeRef = useRef<Map<string, string>>(new Map());

  // 卸载时清理全部轮询
  useEffect(() => {
    const timers = jobTimersRef.current;
    const activeJobs = activeJobByNodeRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
      activeJobs.clear();
    };
  }, []);

  /** 更新媒体节点 data 局部字段 */
  const patchMediaNode = (nodeId: string, patch: Record<string, unknown>) => {
    setMediaNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  };

  /** 浏览器实测媒体尺寸回填：仅写缺失/不一致字段，避免触发无谓自动保存 */
  const handleMediaDims = (nodeId: string, dims: MediaDims) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (data.width !== dims.width) patch.width = dims.width;
    if (data.height !== dims.height) patch.height = dims.height;
    if (typeof dims.duration === 'number' && typeof data.duration !== 'number') patch.duration = dims.duration;
    if (Object.keys(patch).length === 0) return;
    patchMediaNode(nodeId, patch);
  };

  /** 迟到响应防线（IKDMQW）：节点已被本地删除（防复活）、已离开画布、或活跃任务已被新任务
   *  接管（IKDMQV 登记）时，迟到的取消响应/权威核对/轮询响应一律丢弃，不得覆盖新状态。 */
  const jobResponseGuarded = (nodeId: string, jobId: number | string): boolean =>
    !locallyRemovedGenerationNodesRef.current.has(nodeId) &&
    mediaNodesRef.current.some((n) => n.id === nodeId) &&
    activeJobByNodeRef.current.get(nodeId) === String(jobId);

  /** 任务终态收敛（IKDMQW）：按任务权威状态落卡片终态，轮询 tick、普通取消与删除流程共用。
   *  返回 'terminal' 表示已终态（轮询应停），'processing' 表示未终态（调用方决定续链）。
   *  调用方需先过 jobResponseGuarded 防线。
   *  pendingDelete（删除流程登记的删除意图）在终态处接管：cancelled/failed → 移除；
   *  succeeded → 挂载作品并提示（停止删除，用户需要时再操作一次）。 */
  const applyJobTerminal = (
    nodeId: string,
    jobId: number | string,
    detail: Awaited<ReturnType<typeof fetchJobStatus>>,
  ): 'terminal' | 'processing' => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return 'terminal'; // 节点已删除：不续链
    const removeWithPendingDelete = () => {
      pendingDeleteJobNodesRef.current.delete(nodeId);
      locallyRemovedGenerationNodesRef.current.add(nodeId);
      stopJobPolling(nodeId, jobTimersRef.current);
      setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
    };
    if (isMediaExtractNodeId(nodeId)) {
      const extractPatch = mediaExtractTerminalPatch(
        detail,
        typeof node.data?.fileName === 'string' ? node.data.fileName : undefined,
      );
      if (extractPatch) {
        stopJobPolling(nodeId, jobTimersRef.current);
        settledExtractNodesRef.current.add(nodeId);
        patchMediaNode(nodeId, extractPatch);
        return 'terminal';
      }
    }
    if (detail.status === 'succeeded') {
      stopJobPolling(nodeId, jobTimersRef.current);
      const originalType = node.data?.mediaType;
      const assetType = detail.asset?.type;
      patchMediaNode(nodeId, {
        genStatus: undefined,
        progress: 100,
        errorText: undefined,
        src: detail.asset?.url ?? '',
        mediaType: (assetType === 'audio' || assetType === 'video' || assetType === 'image')
          ? assetType
          : (originalType ?? 'image'),
        // 已自定义名称的卡不被自动命名覆盖（IKFA8X）
        ...(hasCustomName(node) ? {} : { fileName: `生成-${jobId}` }),
        assetId: detail.asset?.id,
        width: detail.asset?.width ?? undefined,
        height: detail.asset?.height ?? undefined,
        duration: detail.asset?.duration ?? undefined,
        // 原位草稿成功（IKDMQQ）：草稿身份结束转为普通成品卡；
        // draftModelId/draftSize/draftRatio 保留为该卡的生成参数记录（再次编辑复制切片复用）
        draft: undefined,
      });
      // IKFM3S §4：成功任务把快照冻结的文本输入签名回写目标（刷新持久、提示按签名派生清除）；
      // 乱序保护（nextUsedInputState）：仅更新的 jobId 覆盖——旧任务成功不清除更晚编辑的提示。
      const nextUsed = nextUsedInputState((node.data ?? {}) as Record<string, unknown>, detail.text_input_signature, jobId);
      if (nextUsed) patchMediaNode(nodeId, nextUsed);
      if (pendingDeleteJobNodesRef.current.has(nodeId)) {
        // 删除等待终态期间任务抢先成功：停止删除保留作品，用户需要时再操作一次
        pendingDeleteJobNodesRef.current.delete(nodeId);
        showToast('warn', '任务已完成，已停止删除；如需删除请再次操作');
      }
      return 'terminal';
    }
    if (detail.status === 'failed') {
      stopJobPolling(nodeId, jobTimersRef.current);
      if (pendingDeleteJobNodesRef.current.has(nodeId)) {
        removeWithPendingDelete();
        return 'terminal';
      }
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        errorText: readJobFailText(detail.error),
      });
      return 'terminal';
    }
    if (detail.status === 'cancelled') {
      stopJobPolling(nodeId, jobTimersRef.current);
      settleCancelledNode(nodeId);
      return 'terminal';
    }
    return 'processing';
  };

  /** 取消终态可见收敛（IKDMQW）：草稿卡回待生成（保留参数与连线）、有旧素材的成品卡
   *  恢复成品态（IKDMQU Q5）、无内容可保留的占位卡移除并防迟到响应复活。
   *  删除流程登记的删除意图优先：cancelled 时直接移除。 */
  const settleCancelledNode = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    if (pendingDeleteJobNodesRef.current.has(nodeId)) {
      pendingDeleteJobNodesRef.current.delete(nodeId);
      locallyRemovedGenerationNodesRef.current.add(nodeId);
      removeCancelledGenerationNode(
        nodeId,
        jobTimersRef.current,
        (id) => setMediaNodes((prev) => prev.filter((n) => n.id !== id)),
      );
      return;
    }
    const action = cancelledTerminalAction(node);
    if (action === 'to-draft') {
      patchMediaNode(nodeId, {
        genStatus: 'draft',
        progress: undefined,
        errorText: undefined,
        // 已自定义名称的草稿卡回退时保留名称（IKFA8X）
        ...(hasCustomName(node) ? {} : { fileName: draftFileNameOf(node.data?.mediaType) }),
      });
      return;
    }
    if (action === 'restore') {
      patchMediaNode(nodeId, { genStatus: undefined, progress: undefined, errorText: undefined });
      return;
    }
    locallyRemovedGenerationNodesRef.current.add(nodeId);
    removeCancelledGenerationNode(
      nodeId,
      jobTimersRef.current,
      (id) => setMediaNodes((prev) => prev.filter((n) => n.id !== id)),
    );
  };

  /** 轮询函数引用（供水合恢复调用，避免声明顺序依赖） */
  const pollJobRef = useRef<(nodeId: string, jobId: number | string) => void>(() => {});

  /** 轮询任务状态直至终态：succeeded 挂载产物 / failed 展示错误 / cancelled 收敛。
   *  启动即登记本任务为节点活跃任务（IKDMQV）：后启动的轮询覆盖登记，
   *  旧任务迟到的飞行中响应因登记不匹配被丢弃，不得覆盖当前任务。 */
  const pollJob = (nodeId: string, jobId: number | string) => {
    const existing = jobTimersRef.current.get(nodeId);
    if (existing) window.clearTimeout(existing);
    activeJobByNodeRef.current.set(nodeId, String(jobId));
    const tick = () => {
      fetchJobStatus(jobId)
        .then((detail) => {
          if (!mediaNodesRef.current.find((n) => n.id === nodeId)) return; // 节点已删除
          if (activeJobByNodeRef.current.get(nodeId) !== String(jobId)) return; // 迟到旧任务响应——节点已承接新任务，丢弃且不续链
          if (locallyRemovedGenerationNodesRef.current.has(nodeId)) {
            jobTimersRef.current.delete(nodeId);
            return;
          }
          const outcome = applyJobTerminal(nodeId, jobId, detail);
          if (outcome === 'terminal') return;
          patchMediaNode(nodeId, { progress: detail.progress });
          jobTimersRef.current.set(nodeId, window.setTimeout(tick, 2500));
        })
        .catch((e) => {
          console.warn('任务轮询失败，稍后重试:', e);
          jobTimersRef.current.set(nodeId, window.setTimeout(tick, 5000));
        });
    };
    tick();
  };

  /** 创建生成任务：立即上画布「生成中」占位节点，创建成功后启动轮询。
   *  mediaRefs 仅 image/video/audio：单数组 references（保序），与 input_asset_ids 等旧参考字段互斥。
   *  视频可含首尾帧角色；图片/音频 role 恒 reference。素材库引用（Asset- 前缀）走 material_id。
   *  targetNodeId 仅图片/视频（IKDLQF/IKDLQG）：从对应媒体节点面板发起时携带，服务端按最新画布推导连线文本附件。
   *  目标是草稿身份节点时（IKDMQQ）：不再新建占位卡，草稿原地转生成中，结果回填同一张卡。
   *  返回 true 表示创建请求已发出（IKFXZD：面板据此判定发送成功并自动隐藏）；
   *  false = 未发出（无项目/无效草稿/配额不足/同步异常）。HTTP 层异步失败不回滚面板，由卡片失败态呈现 */
  const startGenerationJob = (
    type: 'image' | 'video' | 'audio',
    parameters: ImageJobParameters | VideoJobParameters | AudioJobParameters,
    inputAssetIds?: string[],
    videoRefs?: {
      references?: GenerationRefItem[];
      firstFrameAssetId?: string;
      lastFrameAssetId?: string;
      referenceAssetIds?: string[];
      firstFrameMaterialId?: string;
      lastFrameMaterialId?: string;
      referenceMaterials?: Array<{ id: string; type: 'image' | 'video' }>;
    },
    targetNodeId?: string,
    initialDraft?: {
      mode?: string;
      references: Array<{
        assetId: string;
        url: string;
        name: string;
        mediaType: 'image' | 'video';
        role: VideoRefRole;
        materialId?: string;
      }>;
    },
    /** IKFA1M/IKFA1O：结构化正文（image/video 含素材标签时携带）；服务端编译并冻结 */
    promptDoc?: PromptDoc | null,
  ): boolean => {
    if (!currentId) {
      console.warn('未选中项目，无法创建生成任务');
      return false;
    }
    if (targetNodeId && blockInvalidDraft(edgesRef.current.filter(e => e.target === targetNodeId).map(e => e.source))) return false;
    if (blockIfQuotaInsufficient()) return false;
    // 原位模式（IKDMQQ 草稿 + IKDMQU 成品卡原卡重新生成）：目标节点原地承接任务，身份/位置/连线保持不变
    const inPlaceNode = targetNodeId
      ? mediaNodesRef.current.find((n) => n.id === targetNodeId && isInPlaceRegenTarget(n))
      : undefined;
    const inPlaceNodeId = inPlaceNode?.id;
    if (inPlaceNodeId) {
      const isDraftTarget =
        ((inPlaceNode!.data ?? {}) as Record<string, unknown>).draft === true;
      const customNamed = hasCustomName(inPlaceNode);
      patchMediaNode(inPlaceNodeId, {
        genStatus: 'generating',
        progress: 0,
        errorText: undefined,
        // 草稿无素材可显示，改名提示生成内容（IKDMQQ）；已自定义名称的草稿不覆盖（IKFA8X）；
        // 成品卡保留原文件名——旧素材继续显示，生成中由状态角标标记（IKDMQU Q5）
        ...(isDraftTarget && !customNamed
          ? {
              fileName:
                type === 'video' ? '视频生成中' : type === 'audio' ? '音频生成中' : '图片生成中',
            }
          : {}),
        prompt: parameters.prompt,
        targetRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
      });
    }
    const nodeId = inPlaceNodeId ?? newNodeId('media-gen');
    if (!inPlaceNodeId) {
    const referenceNodes: Node[] = [];
    for (const ref of initialDraft?.references ?? []) {
      let source = [...mediaNodesRef.current, ...referenceNodes].find(n =>
        readAssetId(n.data) === ref.assetId && videoRefSourceError(n, ref.role) === null);
      if (!source) {
        source = attachCallbacks({
          id: newNodeId('media'), type: 'mediaNode', position: spawnPosition(),
          data: {
            src: ref.url,
            fileName: ref.name,
            mediaType: ref.mediaType,
            assetId: ref.assetId,
            ...(ref.materialId ? { materialId: ref.materialId, compliancePassed: true } : {}),
          },
        });
        referenceNodes.push(source);
      } else if (ref.materialId) {
        patchMediaNode(source.id, { materialId: ref.materialId, compliancePassed: true });
      } else if (ref.materialId) {
        patchMediaNode(source.id, { materialId: ref.materialId, compliancePassed: true });
      }
      addCanvasEdge(source.id, nodeId, ref.role);
    }
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: spawnPosition(),
      data: {
        genStatus: 'generating',
        progress: 0,
        mediaType: type,
        fileName: type === 'video' ? '视频生成中' : type === 'audio' ? '音频生成中' : '图片生成中',
        prompt: parameters.prompt,
        draftModelId: parameters.model_id,
        draftRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        draftSize: 'size' in parameters ? parameters.size : 'resolution' in parameters ? parameters.resolution : undefined,
        draftDuration: 'duration' in parameters ? parameters.duration : undefined,
        draftMode: initialDraft?.mode,
        targetRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        toolMode,
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onReEdit: (id: string) => actionsRef.current.reEdit(id),
        onGenImage: (id: string) => actionsRef.current.genImage(id),
        onImg2Img: (id: string, file: File) => actionsRef.current.img2img(id, file),
        onGenVideo: (id: string) => actionsRef.current.genVideo(id),
        onGenAudio: (id: string) => actionsRef.current.genAudio(id),
        onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    setMediaNodes((prev) => [...prev, ...referenceNodes, node]);
    }
    // 提交立即接管节点，防止 create 返回前旧取消/轮询响应解除本次生成状态。
    const activeAtCreate = newNodeId('pending-generation');
    activeJobByNodeRef.current.set(nodeId, activeAtCreate);
    stopJobPolling(nodeId, jobTimersRef.current);
    const jobRefs = videoRefs?.references;
    const sendPrompt = promptDoc ? flattenPromptDocForSend(promptDoc) : parameters.prompt;
    const sendAttachments = targetNodeId ? textAttachmentsForSend(targetNodeId) : undefined;
    const jobPrompt = composeImageSendPrompt(sendAttachments, sendPrompt, promptDoc);
    try {
      createGenerationJob(currentId, {
        type,
        expected_output_count: 1,
        parameters: {
          ...parameters,
          prompt: jobPrompt,
        },
        ...(inputAssetIds?.length ? { input_asset_ids: inputAssetIds } : {}),
        ...(jobRefs && jobRefs.length > 0
          ? { references: jobRefs }
          : type === 'image' || type === 'audio'
            ? {}
            : {
                first_frame_asset_id: videoRefs?.firstFrameAssetId,
                last_frame_asset_id: videoRefs?.lastFrameAssetId,
                reference_asset_ids: videoRefs?.referenceAssetIds?.length
                  ? videoRefs.referenceAssetIds
                  : undefined,
                first_frame_material_id: videoRefs?.firstFrameMaterialId,
                last_frame_material_id: videoRefs?.lastFrameMaterialId,
                reference_materials: videoRefs?.referenceMaterials?.length
                  ? videoRefs.referenceMaterials
                  : undefined,
              }),
        ...(targetNodeId ? { target_node_id: targetNodeId } : {}),
      })
        .then((created) => {
          if (activeJobByNodeRef.current.get(nodeId) !== activeAtCreate) return;
          patchMediaNode(nodeId, { jobId: created.generation_job_id });
          pollJob(nodeId, created.generation_job_id);
        })
        .catch((e) => {
          /** 原位目标回退：草稿回待生成保留参数（IKDMQQ/IKDMQS/IKDMQT）；
           *  成品卡恢复成品态保留旧素材与最新编辑（IKDMQU Q5，同取消恢复） */
          const rollbackInPlace = () => {
            const node = mediaNodesRef.current.find((n) => n.id === nodeId);
            if (!node) return;
            if (((node.data ?? {}) as Record<string, unknown>).draft === true) {
              patchMediaNode(nodeId, {
                genStatus: 'draft',
                progress: undefined,
                // 已自定义名称的草稿回退时保留名称（IKFA8X）
                ...(hasCustomName(node) ? {} : { fileName: draftFileNameOf(type) }),
              });
            } else {
              patchMediaNode(nodeId, { genStatus: undefined, progress: undefined, errorText: undefined });
            }
          };
          const takenOver = () => activeJobByNodeRef.current.get(nodeId) !== activeAtCreate;
          if (openRechargeForQuotaError(e)) {
            if (takenOver()) return; // 已被其他提交接管：回退不得覆盖新任务状态
            if (inPlaceNodeId) rollbackInPlace();
            else {
              setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
              setEdges(prev => prev.filter(edge => edge.target !== nodeId));
            }
            return;
          }
          if (isApiError(e) && e.status === 401) {
            if (!takenOver()) {
              if (inPlaceNodeId) rollbackInPlace();
              else {
                setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
                setEdges(prev => prev.filter(edge => edge.target !== nodeId));
              }
            }
            useAuthPromptStore.getState().addResume(() => {
              startGenerationJob(type, parameters, inputAssetIds, videoRefs, targetNodeId, initialDraft);
            });
            return;
          }
          if (takenOver()) return; // 已被接管：失败态不得覆盖新任务的执行状态
          patchMediaNode(nodeId, {
            genStatus: 'failed',
            errorText: isApiError(e) ? e.message : '创建任务失败',
          });
        });
      return true; // 创建请求已发出（IKFXZD 面板关闭判定点）；HTTP 层异步失败由上方 catch 收敛到卡片
    } catch (e: unknown) {
      // 同步异常兜底（如 crypto.randomUUID 在 HTTP 下不可用）
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        errorText: isApiError(e) ? e.message : '创建任务失败',
      });
      return false;
    }
  };

  /** 创建高清放大任务（IKGM9O）：高清卡原地承接（草稿转生成中 / 成品卡原卡重新生成，不新建卡）。
   *  冻结六键经契约 zod schema 提交前校验；lastParams 随提交立即写入节点（重试/重新编辑回填同源）。
   *  免费口径（规格）：不渲染积分预估、不走余额拦截门。返回 true 表示创建请求已发出（面板据此自动关闭）；
   *  HTTP 层异步失败由 catch 收敛到卡片失败态（同 startGenerationJob 口径，面板不回滚）。 */
  const startImageEnhanceJob = (
    nodeId: string,
    params: ImageEnhancePanelParams,
  ): boolean => {
    if (!currentId) {
      showToast('warn', '未选中项目，无法发起高清放大');
      return false;
    }
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).imageEnhance as ImageEnhanceIdentity | undefined;
    const sourceAssetId = identity?.sourceAssetId;
    if (!sourceAssetId) {
      showToast('warn', '源素材身份缺失，无法发起高清放大');
      return false;
    }
    const input = buildImageEnhanceInput(sourceAssetId, nodeId, params);
    if (!input) {
      showToast('warn', '高清放大参数不合法，请调整后重试');
      return false;
    }
    const isDraftTarget = ((node?.data ?? {}) as Record<string, unknown>).draft === true;
    patchMediaNode(nodeId, {
      genStatus: 'generating',
      progress: 0,
      errorText: undefined,
      ...(isDraftTarget && !hasCustomName(node) ? { fileName: '高清生成中' } : {}),
      // 提交即写 lastParams（契约六键形态）：失败重试原样重发、重新编辑回填共用
      imageEnhance: { ...identity, lastParams: input },
    });
    // 提交立即接管节点，防止 create 返回前旧取消/轮询响应解除本次生成状态（同 startGenerationJob）
    const activeAtCreate = newNodeId('pending-generation');
    activeJobByNodeRef.current.set(nodeId, activeAtCreate);
    stopJobPolling(nodeId, jobTimersRef.current);
    createImageEnhancement(currentId, input)
      .then((created) => {
        if (activeJobByNodeRef.current.get(nodeId) !== activeAtCreate) return;
        patchMediaNode(nodeId, { jobId: created.job_id });
        pollJob(nodeId, created.job_id);
      })
      .catch((e: unknown) => {
        if (activeJobByNodeRef.current.get(nodeId) !== activeAtCreate) return;
        patchMediaNode(nodeId, {
          genStatus: 'failed',
          errorText: isApiError(e) ? e.message : '创建任务失败',
        });
      });
    return true;
  };

  /** 高清放大面板发送（IKGM9O）：面板只交付冻结四键，身份六键在此组装；
   *  创建请求发出即关面板（置隐藏标记避免紧随的选中事件回弹重开，口径同图片面板 IKFXZD） */
  const handleEnhanceDialogSend = (params: ImageEnhancePanelParams): boolean => {
    const nodeId = enhanceDraftId;
    if (!nodeId) return false;
    const issued = startImageEnhanceJob(nodeId, params);
    if (issued) {
      enhancePanelHiddenRef.current = true;
      setShowEnhanceDialog(false);
    }
    return issued;
  };

  /** 创建智能扩图任务（IKGOR6）：扩图结果卡原地承接（草稿转生成中 / 失败卡重试重新生成，不新建卡）。
   *  六键 input 已由发送侧组好并过契约 zod 校验（buildImageOutpaintInput）；lastParams 随提交
   *  立即写入节点（失败重试原样重发共用）。免费口径（规格）：不走余额拦截门。
   *  返回 true 表示创建请求已发出；HTTP 层异步失败由 catch 收敛到卡片失败态（同 startImageEnhanceJob）。 */
  const startImageOutpaintJob = (nodeId: string, input: ImageOutpaintInput): boolean => {
    if (!currentId) {
      showToast('warn', '未选中项目，无法发起扩图');
      return false;
    }
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).imageOutpaint as ImageOutpaintIdentity | undefined;
    const isDraftTarget = ((node?.data ?? {}) as Record<string, unknown>).draft === true;
    patchMediaNode(nodeId, {
      genStatus: 'generating',
      progress: 0,
      errorText: undefined,
      ...(isDraftTarget && !hasCustomName(node) ? { fileName: '扩图生成中' } : {}),
      // 提交即写 lastParams（契约六键形态）：失败重试原样重发共用
      imageOutpaint: { ...identity, lastParams: input },
    });
    // 提交立即接管节点，防止 create 返回前旧取消/轮询响应解除本次生成状态（同 startImageEnhanceJob）
    const activeAtCreate = newNodeId('pending-generation');
    activeJobByNodeRef.current.set(nodeId, activeAtCreate);
    stopJobPolling(nodeId, jobTimersRef.current);
    createImageOutpaint(currentId, input)
      .then((created) => {
        if (activeJobByNodeRef.current.get(nodeId) !== activeAtCreate) return;
        patchMediaNode(nodeId, { jobId: created.job_id });
        pollJob(nodeId, created.job_id);
      })
      .catch((e: unknown) => {
        if (activeJobByNodeRef.current.get(nodeId) !== activeAtCreate) return;
        patchMediaNode(nodeId, {
          genStatus: 'failed',
          errorText: isApiError(e) ? e.message : '创建任务失败',
        });
      });
    return true;
  };

  /** 扩图面板发送（IKGOR6 发送闭环）：点发送才建结果卡（进入模式不建卡不连线，规格故事 24）——
   *  源卡右侧建「扩图」草稿卡 + 纯视觉来源线（origin 标记，不占参考位、不参与 @ 编号）；
   *  四个扩展比例取自扩展框换算（相对原图短边，提交参数唯一来源），过契约 zod 校验后调创建入口；
   *  创建请求发出即退出扩图模式（规格故事 39），源卡全程不动（规格故事 41）。
   *  防御：契约校验不过撤卡撤线留在模式内提示（如源素材非数字资产 id）。 */
  const handleOutpaintDialogSend = (): boolean => {
    const sourceNode = outpaintSourceNode;
    const rect = outpaintRect;
    if (!sourceNode || !rect) return false;
    // 零扩展（框与原图重合）不发送：发送钮已置灰，守卫兜底（契约 refine 同口径）
    if (
      outpaintExpands.top <= 0 && outpaintExpands.right <= 0 &&
      outpaintExpands.bottom <= 0 && outpaintExpands.left <= 0
    ) {
      return false;
    }
    const sourceData = (sourceNode.data ?? {}) as Record<string, unknown>;
    const sourceAssetId = readAssetId(sourceData);
    if (!sourceAssetId) {
      showToast('warn', '源素材身份缺失，无法发起扩图');
      return false;
    }
    const ratios = expandRatiosOf(outpaintExpands, rect);
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(sourceNode), {
      fileName: '扩图',
      data: { imageOutpaint: { sourceAssetId } },
    });
    addCanvasEdge(sourceNode.id, draftId, undefined, { origin: IMAGE_OUTPAINT_EDGE_ORIGIN });
    const input = buildImageOutpaintInput(sourceAssetId, draftId, ratios);
    if (!input) {
      removeCanvasNodes([draftId]);
      showToast('warn', '扩图参数不合法，请调整后重试');
      return false;
    }
    const issued = startImageOutpaintJob(draftId, input);
    if (issued) endOutpaintSession();
    return issued;
  };


  /* ===== 擦除发送链路（IKGOTB）：发送时才建结果卡 + 纯视觉来源线 + 终态回填 ===== */

  /** 擦除任务发送核心：组装好的契约 input 直接 POST image-erasures；创建成功后
   *  在源卡右侧建擦除结果卡（node id = input.target_node_id，发送前已生成冻结进任务）、
   *  拉纯视觉来源线（origin=image-erase，参考推导跳过）、启动轮询（applyJobTerminal 回填成品/失败）。
   *  创建失败（门槛拒/网络）不建卡不退出编辑态；入队失败创建响应仍 200，任务经轮询呈现 enqueue_failed。
   *  免费口径同 image_enhance：无幂等头、无积分预估、不走余额拦截门。 */
  const startImageEraseJob = async (
    sourceNodeId: string,
    input: ImageEraseInput,
  ): Promise<boolean> => {
    if (!currentId) {
      showToast('warn', '未选中项目，无法发起图片擦除');
      return false;
    }
    const node = mediaNodesRef.current.find((n) => n.id === sourceNodeId);
    if (!node) {
      showToast('warn', '源图卡不存在，无法发起图片擦除');
      return false;
    }
    const targetNodeId = input.target_node_id;
    try {
      const created = await createImageErase(currentId, input);
      // 发送即退出编辑态（先退再建卡：建卡的程序化选中不触发编辑态的「点其他卡退出」误判）
      exitEraseEditing();
      const draftId = createImageDraftCard(imageEnhanceDraftPosition(node), {
        fileName: '擦除',
        nodeId: targetNodeId,
        data: {
          imageErase: { sourceAssetId: input.source_asset_id, lastInput: input },
          genStatus: 'generating',
          progress: 0,
        },
      });
      addCanvasEdge(sourceNodeId, draftId, undefined, { origin: IMAGE_ERASE_EDGE_ORIGIN });
      // 提交即接管节点（防创建返回前旧响应解除本次生成状态，口径同 startImageEnhanceJob）
      const activeAtCreate = newNodeId('pending-generation');
      activeJobByNodeRef.current.set(draftId, activeAtCreate);
      patchMediaNode(draftId, { jobId: created.job_id });
      pollJob(draftId, created.job_id);
      return true;
    } catch (e: unknown) {
      showToast('error', isApiError(e) ? e.message : '创建擦除任务失败，请重试');
      return false;
    }
  };

  /** 涂抹发送（工具条发送钮）：遮罩 PNG 已在组件内栅格化，此处上传（source=mask_erase，
   *  中间素材不进用户资产列表可见内容）→ 组装 selected_area_erase 四键 → 发任务。 */
  const handleEraseDialogSendMask = async (file: File | null): Promise<boolean> => {
    const nodeId = eraseTargetNodeId;
    if (!nodeId) return false;
    if (!file) {
      showToast('error', '遮罩生成失败，请重试');
      return false;
    }
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const sourceAssetId = readAssetId((node?.data ?? {}) as Record<string, unknown>);
    if (!node || !sourceAssetId) {
      showToast('warn', '源素材身份缺失，无法发起图片擦除');
      return false;
    }
    setEraseSubmitting(true);
    try {
      const uploaded = await uploadAssetFile(file, {
        projectId: currentId ?? undefined,
        assetSource: 'mask_erase',
      });
      const input: ImageEraseInput = {
        source_asset_id: sourceAssetId,
        target_node_id: newNodeId('media-draft'),
        erase_scene: 'selected_area_erase',
        mask_asset_id: uploaded.asset_id,
      };
      return await startImageEraseJob(nodeId, input);
    } catch (e: unknown) {
      showToast('error', isApiError(e) ? e.message : '遮罩上传失败，请重试');
      return false;
    } finally {
      setEraseSubmitting(false);
    }
  };

  /** 清除文字一键直发（不经遮罩）：full_screen_text_erase 三键直接发任务，
   *  与涂抹发送共用同一条结果链路（规格故事 20）；请求发出即返回 true（编辑态随之退出）。 */
  const handleEraseDialogSendText = (): boolean => {
    const nodeId = eraseTargetNodeId;
    if (!nodeId) return false;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const sourceAssetId = readAssetId((node?.data ?? {}) as Record<string, unknown>);
    if (!node || !sourceAssetId) {
      showToast('warn', '源素材身份缺失，无法发起图片擦除');
      return false;
    }
    const input: ImageEraseInput = {
      source_asset_id: sourceAssetId,
      target_node_id: newNodeId('media-draft'),
      erase_scene: 'full_screen_text_erase',
    };
    setEraseSubmitting(true);
    void startImageEraseJob(nodeId, input).finally(() => setEraseSubmitting(false));
    return true;
  };

  /** 取消接口仅登记意图；权威终态确认前保留生成中状态及轮询，避免编辑/删除绕过在途保护。 */
  const handleCancelJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | string | undefined;
    if (!currentId || jobId == null) return;
    void cancelGenerationJob(currentId, jobId)
      .then(() => fetchJobStatus(jobId).catch(() => null))
      .then((detail) => {
        if (!jobResponseGuarded(nodeId, jobId)) return; // 迟到响应：已删除/已被新任务接管
        if (detail && (detail.status === 'succeeded' || detail.status === 'failed')) {
          // 权威终态优先于取消确认：抢先成功挂载作品，失败展示原因
          applyJobTerminal(nodeId, jobId, detail);
          return;
        }
        if (detail?.status === 'cancelled') {
          stopJobPolling(nodeId, jobTimersRef.current);
          settleCancelledNode(nodeId);
          return;
        }
        showToast('warn', '取消已请求，正在等待任务停止');
      })
      .catch((e) => {
        console.warn('取消生成失败:', e);
        showToast('error', isApiError(e) ? `取消失败：${e.message}` : '取消失败，请稍后重试');
      });
  };

  /** 删除在途登记：同一卡片的删除流程在取消确认往返期间只发起一次 */
  const deletingJobNodesRef = useRef<Set<string>>(new Set());

  /** 删除意图登记（IKDMQW）：取消已登记但任务未终态（worker 未停）时，删除流程不移除卡片、
   *  只记录意图；轮询拿到权威终态后由 applyJobTerminal 接管——cancelled/failed 移除，
   *  succeeded 挂载作品并提示（worker 竞态完成的作品不得失去入口）。 */
  const pendingDeleteJobNodesRef = useRef<Set<string>>(new Set());

  /** 立即移除媒体节点（非生成中路径）：仅释放 blob 预览 URL（http 素材 URL 无需 revoke） */
  const removeMediaNodeNow = (nodeId: string) => {
    setMediaNodes((prev) => {
      const target = prev.find((n) => n.id === nodeId);
      const src = target?.data?.src;
      if (typeof src === 'string' && src.startsWith('blob:')) URL.revokeObjectURL(src);
      return prev.filter((n) => n.id !== nodeId);
    });
  };

  /** 删除生成中卡片（IKDMQW）：先请求取消；任务权威终态非 succeeded 才移除——
   *  cancelled/failed 终态确认后立即移除；仍 processing（软取消已登记、worker 未停）时不
   *  抢先移除，登记删除意图由轮询终态驱动（succeeded 竞态保留作品并提示「任务已完成」）。
   *  取消失败：保留卡片提示原因（任务仍可查看/轮询收敛），用户需要时再操作一次。 */
  const deleteGeneratingNode = async (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | string | undefined;
    if (!currentId || jobId == null) {
      // 无任务可取消（异常态）：退回直接移除，避免删除入口卡死
      removeMediaNodeNow(nodeId);
      return;
    }
    if (deletingJobNodesRef.current.has(nodeId)) return;
    deletingJobNodesRef.current.add(nodeId);
    const finish = () => { deletingJobNodesRef.current.delete(nodeId); };
    const stopWithCompleted = (detail: Awaited<ReturnType<typeof fetchJobStatus>>) => {
      // 任务抢先成功：停止自动删除，挂载作品并提示；如需删除用户再操作一次
      applyJobTerminal(nodeId, jobId, detail);
      showToast('warn', '任务已完成，已停止删除；如需删除请再次操作');
      finish();
    };
    try {
      await cancelGenerationJob(currentId, jobId);
    } catch (e) {
      // 取消失败（多为任务已终态 100301）：核对权威状态，succeeded 视为抢先成功
      const detail = await fetchJobStatus(jobId).catch(() => null);
      if (detail?.status === 'succeeded' && jobResponseGuarded(nodeId, jobId)) {
        stopWithCompleted(detail);
        return;
      }
      console.warn('删除生成中卡片：取消任务失败:', e);
      showToast('error', isApiError(e) ? `取消失败，卡片已保留：${e.message}` : '取消失败，卡片已保留，请稍后重试');
      finish();
      return;
    }
    // 取消登记成功 ≠ 任务已停：核对权威状态，succeeded 竞态保护（worker 抢先完成）
    const detail = await fetchJobStatus(jobId).catch(() => null);
    if (!jobResponseGuarded(nodeId, jobId)) { // 防御：往返期间被新任务接管/已删除则放弃
      finish();
      return;
    }
    if (detail?.status === 'succeeded') {
      stopWithCompleted(detail);
      return;
    }
    if (detail?.status === 'cancelled' || detail?.status === 'failed') {
      // 任务已终态：确认移除，登记防迟到响应复活
      locallyRemovedGenerationNodesRef.current.add(nodeId);
      removeCancelledGenerationNode(
        nodeId,
        jobTimersRef.current,
        (id) => setMediaNodes((prev) => prev.filter((n) => n.id !== id)),
      );
      finish();
      return;
    }
    // 仍 queued/processing（软取消已登记）或状态不可得：不抢先移除（worker 竞态完成的作品
    // 不得失去入口）——登记删除意图，轮询终态驱动移除/挂载
    pendingDeleteJobNodesRef.current.add(nodeId);
    finish();
  };

  /** 画布删除统一入口（IKD0JT 撤销接入）：右键/键盘/节点回调删除收口——
   *  撤销栈登记 + 悬空边清理 + blob 释放；生成中媒体卡片转取消任务流程（不可回退，PRD §7.2 R2）。 */
  const removeCanvasNodes = (ids: string[]) => {
    if (ids.length === 0) return;
    // 生成中媒体卡片：先取消任务，终态驱动移除（不进撤销栈）
    const generating = ids.filter((id) => mediaNodesRef.current.some((n) => n.id === id) && isGeneratingNode(id));
    generating.forEach((id) => void deleteGeneratingNode(id));
    const idSet = new Set(ids.filter((id) => !generating.includes(id)));
    if (idSet.size === 0) return;

    const allNodes = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const removedNodes = allNodes.filter((n) => idSet.has(n.id));
    const removedEdges = edgesRef.current.filter((e) => idSet.has(e.source) || idSet.has(e.target));
    const remainingEdges = releaseRemovedPromptSources(edgesRef.current, edgesRef.current.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)));

    // blob 预览释放（http 素材 URL 无需 revoke）
    removedNodes.forEach((n) => {
      const src = (n.data as Record<string, unknown> | undefined)?.src;
      if (typeof src === 'string' && src.startsWith('blob:')) URL.revokeObjectURL(src);
    });

    // 撤销登记：blob 节点（上传中）预览已释放、撤销无法恢复，跳过其登记；
    // 连线两端撤销后都能回来（本批可撤销或未被删）才随删除登记
    const undoableNodes = removedNodes.filter((n) => {
      const src = (n.data as Record<string, unknown> | undefined)?.src;
      return !(typeof src === 'string' && src.startsWith('blob:'));
    });
    const undoableIds = new Set(undoableNodes.map((n) => n.id));
    const survivingIds = new Set(allNodes.map((n) => n.id).filter((id) => !idSet.has(id)));
    const undoableEdges = removedEdges.filter(
      (e) =>
        (undoableIds.has(e.source) || survivingIds.has(e.source)) &&
        (undoableIds.has(e.target) || survivingIds.has(e.target)),
    );
    // 动态成员模型：组矩形固定，删除节点不裁剪组（删掉的成员下次按坐标判定自然脱离）
    if (undoableNodes.length > 0) {
      historyRef.current?.pushDelete(undoableNodes, undoableEdges, undefined, {
        before: edgesRef.current.filter(e =>
          (undoableIds.has(e.source) || survivingIds.has(e.source)) &&
          (undoableIds.has(e.target) || survivingIds.has(e.target))),
        after: remainingEdges,
      });
    }

    // 移除节点 + 清 pending 登记（未保存新增的删除一并清理）
    idSet.forEach((id) => pendingNodeIdsRef.current.delete(id));
    const filter = (prev: Node[]) => prev.filter((n) => !idSet.has(n.id));
    setTextNodes(filter);
    setMediaNodes(filter);
    setProductNodes(filter);
    setAssetNodes(filter);
    // 立即清理悬空边（不等定时器）
    if (removedEdges.length > 0) {
      setEdges(remainingEdges);
    }
  };

  /* ============ 成组交互（IKD0JT A3/A4） ============ */

  /** 成组：≥2 节点划定格组矩形（选中成员包围盒+留白），之后矩形固定、成员按坐标动态判定。
   *  新组与已有组互斥：选中节点从其他组排除，框内非选中节点写入新组排除名单。
   *  入参为画布内部节点对象（含 measured 实际尺寸），保证矩形真实框住全部选中节点。 */
  const handleCreateGroup = (selectedNodes: Node[]) => {
    const members = selectedNodes.filter((n) => !(n.data as { emptyShell?: boolean } | undefined)?.emptyShell);
    if (members.length < MIN_GROUP_MEMBERS) return;
    if (selectionHasUngroupableCards(members)) {
      showToast('warn', '风格卡、角色卡、物体卡、环境卡、商品卡无法成组');
      return;
    }
    if (selectionHasUngroupableGenNodes(members)) {
      showToast('warn', '待生成草稿、生成中节点无法成组');
      return;
    }
    const box = groupFrameBBox(members);
    if (!box) return;
    const memberIds = new Set(members.map((n) => n.id));
    const all = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const group: CanvasGroup = { id: newNodeId('group'), box, excludedIds: [] };
    const before = groupsRef.current;
    const after = isolateNewGroupMembers(before, all, group, memberIds);
    setGroups(after);
    historyRef.current?.pushCreateGroup(after[after.length - 1] ?? group, before, after);
  };

  /** 整组拖动结束：落盘矩形与本组独立成员位移，并同步其他组排除名单（叠住不吸收）。 */
  const handleGroupFrameDragStop = useCallback(
    (res: GroupFrameDragResult) => {
      const posNew = new Map(res.nodeNew.map((p) => [p.id, { x: p.x, y: p.y }]));
      const nodesAfter = [
        ...textNodesRef.current,
        ...mediaNodesRef.current,
        ...productNodesRef.current,
        ...assetNodesRef.current,
      ].map((n) => {
        const p = posNew.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      });
      const { groups: nextGroups, peerExclusions } = applyIndependentGroupDrag(
        groupsRef.current,
        nodesAfter,
        res,
      );
      setGroups(nextGroups);
      const recorded: GroupFrameDragResult = { ...res, peerExclusions };
      if (res.nodeNew.length === 0) {
        historyRef.current?.pushGroupMove(recorded);
        return;
      }
      const applyPos = (prev: Node[]) =>
        prev.map((n) => {
          const p = posNew.get(n.id);
          return p ? { ...n, position: { x: p.x, y: p.y } } : n;
        });
      setTextNodes(applyPos);
      setMediaNodes(applyPos);
      setProductNodes(applyPos);
      setAssetNodes(applyPos);
      historyRef.current?.pushGroupMove(recorded);
    },
    [setTextNodes, setMediaNodes, setProductNodes, setAssetNodes, setGroups],
  );

  const handleBringGroupToFront = (groupId: string) => {
    setGroups((prev) => bringGroupToFront(prev, groupId));
  };

  /** 解组：仅移除组矩形，成员节点保留原位（成员本为按坐标动态判定） */
  const handleUngroup = (groupId: string) => {
    const group = groupsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    historyRef.current?.pushUngroup(group);
  };

  /** 删除组：先弹出合并确认（列明数量），确认后再删组内节点 */
  const handleDeleteGroup = (groupId: string) => {
    const group = groupsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    const all = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const count = exclusiveMembersInGroup(all, group, groupsRef.current).length;
    setPendingDeleteGroup({ id: groupId, count });
  };

  /** 确认删除组 = 删除当前落在组矩形内的全部节点（走统一删除入口：撤销/悬空边清理/生成中取消全复用） */
  const confirmDeleteGroup = () => {
    const pending = pendingDeleteGroup;
    setPendingDeleteGroup(null);
    if (!pending) return;
    const group = groupsRef.current.find((g) => g.id === pending.id);
    if (!group) return;
    const all = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const inside = exclusiveMembersInGroup(all, group, groupsRef.current).map((n) => n.id);
    if (inside.length > 0) removeCanvasNodes(inside);
    setGroups((prev) => prev.filter((g) => g.id !== pending.id));
    historyRef.current?.pushDeleteGroup(group, all.filter((n) => inside.includes(n.id)), []);
  };

  /** 媒体节点删除统一入口（IKDMQW）：右键菜单/键盘删除/节点回调全部收口——
   *  生成中且带任务的卡片先取消再移除；其余直接移除。 */
  const handleRemoveMediaNode = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const data = node?.data as Record<string, unknown> | undefined;
    if (data?.genStatus === 'generating' && data.jobId != null) {
      void deleteGeneratingNode(nodeId);
      return;
    }
    removeCanvasNodes([nodeId]);
  };

  /** 重试失败任务：retry 接口创建新任务（沿用失败任务冻结快照），节点回到生成中。
   *  与「修改后新生成」（面板发送 → createGenerationJob 新任务新快照）是两条独立路径：
   *  重试不改输入也不落盘画布——历史失败任务输入保持不变（IKDMQV）。
   *  高清放大卡分流（IKGM9O）：契约无 retry 端点，重试 = lastParams 原样重发创建接口。
   *  扩图结果卡分流（IKGOR6）同款：lastParams 六键原样重发创建接口。 */
  const handleRetryJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | string | undefined;
    const enhanceIdentity = ((node?.data ?? {}) as Record<string, unknown>).imageEnhance as
      | ImageEnhanceIdentity
      | undefined;
    if (enhanceIdentity?.lastParams) {
      // 防重入：生成中不重复发起（口径同通用重试）
      if ((node?.data as Record<string, unknown> | undefined)?.genStatus === 'generating') return;
      startImageEnhanceJob(nodeId, restoreImageEnhanceParams(enhanceIdentity.lastParams));
      return;
    }
    const eraseIdentity = ((node?.data ?? {}) as Record<string, unknown>).imageErase as
      | ImageEraseIdentity
      | undefined;
    if (eraseIdentity?.lastInput) {
      // 擦除卡分流（IKGOTB）：契约无 retry 端点，重试 = 冻结 input 原样重发创建接口
      //（遮罩资产未删除，selected_area_erase 的 mask_asset_id 仍可被创建入口与 worker 解析）。
      if (!currentId) {
        showToast('warn', '未选中项目，无法发起图片擦除');
        return;
      }
      // 防重入：生成中不重复发起（口径同高清分流）
      if ((node?.data as Record<string, unknown> | undefined)?.genStatus === 'generating') return;
      patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '' });
      const activeAtCreate = newNodeId('pending-generation');
      activeJobByNodeRef.current.set(nodeId, activeAtCreate);
      stopJobPolling(nodeId, jobTimersRef.current);
      createImageErase(currentId, eraseIdentity.lastInput)
        .then((created) => {
          if (activeJobByNodeRef.current.get(nodeId) !== activeAtCreate) return;
          patchMediaNode(nodeId, { jobId: created.job_id });
          pollJob(nodeId, created.job_id);
        })
        .catch((e: unknown) => {
          if (activeJobByNodeRef.current.get(nodeId) !== activeAtCreate) return;
          patchMediaNode(nodeId, {
            genStatus: 'failed',
            errorText: isApiError(e) ? e.message : '重试失败',
          });
        });
      return;
    }
    const outpaintIdentity = ((node?.data ?? {}) as Record<string, unknown>).imageOutpaint as
      | ImageOutpaintIdentity
      | undefined;
    if (outpaintIdentity?.lastParams) {
      // 防重入：生成中不重复发起（口径同通用重试）
      if ((node?.data as Record<string, unknown> | undefined)?.genStatus === 'generating') return;
      startImageOutpaintJob(nodeId, outpaintIdentity.lastParams);
      return;
    }
    if (!currentId || !jobId) return;
    // 防重入：首次点击已置 generating（重试按钮随失败占位消失，此处拦截双击与迟到回调交错）
    if ((node?.data as Record<string, unknown> | undefined)?.genStatus === 'generating') return;
    if (blockIfQuotaInsufficient()) return;
    patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '' });
    // 登记发起重试时的任务为核对基准：retry 返回前若被新任务接管（面板重新提交），放弃本次结果不覆盖
    activeJobByNodeRef.current.set(nodeId, String(jobId));
    try {
      retryGenerationJob(currentId, jobId)
        .then((created) => {
          if (activeJobByNodeRef.current.get(nodeId) !== String(jobId)) return;
          patchMediaNode(nodeId, { jobId: created.generation_job_id });
          pollJob(nodeId, created.generation_job_id);
        })
        .catch((e) => {
          if (activeJobByNodeRef.current.get(nodeId) !== String(jobId)) return;
          if (openRechargeForQuotaError(e)) {
            patchMediaNode(nodeId, {
              genStatus: 'failed',
              errorText: isApiError(e) ? e.message : '余额不足',
            });
            return;
          }
          if (isApiError(e) && e.status === 401) {
            patchMediaNode(nodeId, { genStatus: 'failed', errorText: '' });
            useAuthPromptStore.getState().addResume(() => {
              handleRetryJob(nodeId);
            });
            return;
          }
          patchMediaNode(nodeId, {
            genStatus: 'failed',
            errorText: isApiError(e) ? e.message : '重试失败',
          });
        });
    } catch (e: unknown) {
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        errorText: isApiError(e) ? e.message : '重试失败',
      });
    }
  };
  actionsRef.current.cancelJob = handleCancelJob;
  actionsRef.current.retryJob = handleRetryJob;
  actionsRef.current.removeMediaNode = handleRemoveMediaNode;
  pollJobRef.current = pollJob;

  /* ============ 节点工具条：重新编辑/生成图片/生成视频/生成音频/下载 ============ */

  /** 被点节点 → 对话框参考素材描述（素材已被删除的节点不可作为参考/下载来源） */
  const nodeRefOf = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (node?.data?.assetMissing) {
      showToast('warn', '素材已被删除');
      return null;
    }
    const src = node?.data?.src as string | undefined;
    if (!src) return null;
    const type: 'image' | 'video' = node?.data?.mediaType === 'video' ? 'video' : 'image';
    const name = (node?.data?.fileName as string) || id;
    const prompt = typeof node?.data?.prompt === 'string' ? (node.data.prompt as string) : '';
    const assetId = readNodeAssetId((node?.data ?? {}) as Record<string, unknown>);
    return { src, type, name, prompt, assetId };
  };

  /** 目标节点的文本附件（IKDLQF）：连线 target 为该节点、source 为 textNode 且 data.text 为 string；
   *  顺序即 edges 数组顺序（连入顺序），面板打开当下取快照 */
  const textAttachmentsOf = (targetNodeId: string): ImageTextAttachment[] =>
    edgesRef.current
      .filter((e) => e.target === targetNodeId)
      .map((e) => textNodesRef.current.find((n) => n.id === e.source))
      .filter((n): n is Node => n?.type === 'textNode')
      .map((n) => ({
        nodeId: n.id,
        isPromptPlan: Boolean(n.data.promptSource),
        title: typeof n.data.title === 'string' && n.data.title ? (n.data.title as string) : '文本节点',
        text: extractTextNodeText(n.data),
      }));

  /** 提交用附件正文：图片 @ 写成 &素材id&，面板展示仍用编号 */
  const textAttachmentsForSend = (targetNodeId: string): ImageTextAttachment[] =>
    textAttachmentsOf(targetNodeId).map((att) => {
      const node = textNodesRef.current.find((n) => n.id === att.nodeId);
      const mentions = Array.isArray(node?.data.mediaMentions) ? (node.data.mediaMentions as MediaMention[]) : [];
      const refs = Array.isArray(node?.data.mediaRefs) ? (node.data.mediaRefs as MediaRef[]) : [];
      const imageNodeIds = new Set(refs.filter((ref) => ref.mediaType === 'image').map((ref) => ref.nodeId));
      // Agent 方案卡应用的文本节点正文里的 @图1（promptMentions）也纳入替换：图片 → &素材id&
      const promptMentions = Array.isArray(node?.data.promptMentions) ? (node.data.promptMentions as Array<{ start: number; end: number; assetId: string }>) : [];
      const promptMaterials = Array.isArray(node?.data.promptMaterials) ? (node.data.promptMaterials as Array<{ assetId: string; mediaType: 'image' | 'video' | 'audio' }>) : [];
      const promptImageAssetIds = new Set(promptMaterials.filter((m) => m.mediaType === 'image').map((m) => m.assetId));
      const promptMentionsAdapted: MediaMention[] = promptMentions.map((m) => ({ start: m.start, end: m.end, nodeId: m.assetId, assetId: m.assetId }));
      const allMentions = [...mentions, ...promptMentionsAdapted];
      const isImage = (mention: MediaMention) => imageNodeIds.has(mention.nodeId) || promptImageAssetIds.has(mention.assetId);
      return {
        ...att,
        text: replaceImageMentionsWithAssetTokens(att.text, allMentions, isImage),
      };
    });

  /** 目标连入边子序列重排（IKFCKT 从 IKDLQH 泛化）：orderedSources 是 target 连入边 source 的
   *  子集（文本边 / 媒体边 / 混合），按新顺序回填这些边占据的原槽位（其余边相对位置不变，各目标独立） */
  const reorderTargetEdges = (targetNodeId: string, orderedSources: string[]) => {
    setEdges((prev) => {
      const slots = prev
        .map((e, i) => (e.target === targetNodeId && orderedSources.includes(e.source) ? i : -1))
        .filter((i) => i >= 0);
      if (slots.length !== orderedSources.length) return prev;
      const edgeBySource = new Map(slots.map((i) => [prev[i]!.source, prev[i]!]));
      const next = [...prev];
      slots.forEach((slot, k) => {
        next[slot] = edgeBySource.get(orderedSources[k]!)!;
      });
      return next;
    });
  };

  /** Cross-kind presentation order is saved on this target's existing canvas node data. */
  const refStripOrderOf = (targetId: string | null | undefined): string[] | undefined => {
    const value = mediaNodes.find(node => node.id === targetId)?.data.referenceStripOrder;
    if (Array.isArray(value) && value.every(key => typeof key === 'string')) return value;
    if (!targetId) return undefined;
    // Existing connected targets already have a durable mixed input order in their incoming edges.
    return edges.filter(edge => edge.target === targetId).map(edge =>
      textNodes.some(node => node.id === edge.source) ? `text:${edge.source}` : `media:node:${edge.source}`,
    );
  };
  const handleRefStripOrderChange = (targetId: string, orderedKeys: string[]) => {
    if (isGeneratingNode(targetId)) return;
    patchMediaNode(targetId, { referenceStripOrder: orderedKeys });
    const sources = orderedKeys.flatMap(key => {
      const source = key.startsWith('text:') ? key.slice(5)
        : key.startsWith('media:node:') ? key.slice(11)
        : key.startsWith('media:canvas:') ? key.slice(13) : undefined;
      return source && edgesRef.current.some(edge => edge.target === targetId && edge.source === source) ? [source] : [];
    });
    if (sources.length) reorderTargetEdges(targetId, sources);
  };

  /** 目标面板文本附件重排（IKDLQH；IKFCKT 起由参考栏拖拽换位消费）：经 reorderTargetEdges
   *  重排文本边序，并同步面板 seed 的附件快照顺序（保持 ts 不重挂载面板）。重排随自动保存持久化。
   *  面板快照与当前连线不一致（如打开期间来源被断开）时不重排。 */
  const handleReorderAttachments = (targetNodeId: string, orderedNodeIds: string[]) => {
    const liveIds = textAttachmentsOf(targetNodeId).map((a) => a.nodeId);
    if (
      liveIds.length !== orderedNodeIds.length ||
      !orderedNodeIds.every((id) => liveIds.includes(id))
    )
      return;
    reorderTargetEdges(targetNodeId, orderedNodeIds);
    const syncAttachments = (atts: ImageTextAttachment[] | undefined) => {
      if (!atts) return atts;
      const byId = new Map(atts.map((a) => [a.nodeId, a]));
      return orderedNodeIds.map((id) => byId.get(id)!);
    };
    setImageSeed((s) =>
      s?.targetNodeId === targetNodeId ? { ...s, attachments: syncAttachments(s.attachments) } : s,
    );
    setVideoSeed((s) =>
      s?.targetNodeId === targetNodeId ? { ...s, attachments: syncAttachments(s.attachments) } : s,
    );
  };

  /** 视频面板普通参考拖拽换位（IKFCKT）：key 序列按子源拆分——连线项重排连入媒体边序、
   *  material 项重排草稿 draftMaterialRefs 数组序；与面板显示序列不一致时不重排 */
  const handleReorderVideoMediaRefs = (draftId: string, orderedKeys: string[]) => {
    const current = mergedVideoMediaRefsOf(draftId, edgesRef.current, mediaNodesRef.current);
    const currentKeys = current.reference.map((r) => r.materialId ?? r.nodeId);
    if (currentKeys.length !== orderedKeys.length || !orderedKeys.every((k) => currentKeys.includes(k))) return;
    const materialIds = new Set(current.reference.filter((r) => r.materialId != null).map((r) => r.materialId!));
    const edgeIds = orderedKeys.filter((k) => !materialIds.has(k));
    const materialOrdered = orderedKeys.filter((k) => materialIds.has(k));
    if (edgeIds.length) reorderTargetEdges(draftId, edgeIds);
    if (materialOrdered.length) {
      const node = mediaNodesRef.current.find((n) => n.id === draftId);
      const existing = readDraftMaterialRefs(node);
      const existingIds = existing.map((m) => m.materialId);
      if (existingIds.length === materialOrdered.length && materialOrdered.every((id) => existingIds.includes(id))) {
        const byId = new Map(existing.map((m) => [m.materialId, m]));
        patchMediaNode(draftId, { draftMaterialRefs: materialOrdered.map((id) => byId.get(id)!) });
      }
    }
  };

  /** 视频面板自由模式参考拖拽换位（IKFCKT）：暂存参考数组整体重排（首尾帧槽不在此序列） */
  const reorderVideoFreeRefs = (orderedKeys: string[]) => {
    setVideoFreeRefs((prev) => {
      if (orderedKeys.length !== prev.reference.length) return prev;
      const byKey = new Map(prev.reference.map((r) => [r.materialId ?? r.nodeId, r]));
      if (!orderedKeys.every((k) => byKey.has(k))) return prev;
      return { ...prev, reference: orderedKeys.map((k) => byKey.get(k)!) };
    });
  };

  /** 草稿绑定时面板文本附件实时跟随画布连线（IKDMQQ）；非草稿绑定沿用打开当下快照。
   *  IKDLQH 的连线重排直接改变 edges 顺序，草稿绑定面板因此天然跟随，无需额外同步。 */
  const imageDraftAttachments = useMemo(
    () => (imageDraftId ? textAttachmentsOf(imageDraftId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageDraftId, edges, textNodes],
  );

  const planReferenceErrors = useMemo(() => {
    const forTarget = (targetId: string | undefined, availableIds: string[]) => {
      if (!targetId) return undefined;
      for (const edge of edges.filter(e => e.target === targetId)) {
        const plan = textNodes.find(n => n.id === edge.source && n.data.promptSource);
        if (!plan || (plan.data.promptMentions === undefined && edge.data?.promptReference === undefined)) continue;
        const text = extractTextNodeText(plan.data);
        const mentions = promptMentionSchema.array().safeParse(plan.data.promptMentions ?? []);
        if (!mentions.success || !validPromptMentions(text, mentions.data)) return '方案正文素材索引无效，请修正方案';
        const bindings = promptBindingList(mentions.data);
        const confirmed = promptBindingsSchema.safeParse((edge.data?.promptReference as { bindings?: unknown } | undefined)?.bindings ?? (bindings.length === 0 ? [] : undefined));
        const label = (confirmed.success ? confirmed.data : bindings).map(b => `#${b.index}`).join('、');
        if (!confirmed.success || JSON.stringify(confirmed.data) !== JSON.stringify(bindings)) return `方案索引 ${label} 素材待同步，请先同步素材到目标`;
        const missing = bindings.filter(b => !availableIds.includes(b.assetId));
        if (missing.length) return `方案索引 ${missing.map(b => `#${b.index}`).join('、')} 素材缺失，请恢复连线或修正方案`;
      }
      return undefined;
    };
    const videoRefs = videoSeed?.targetNodeId ? mergedVideoMediaRefsOf(videoSeed.targetNodeId, edges, mediaNodes) : { reference: [] };
    return {
      image: forTarget(imageSeed?.targetNodeId, imageSeed?.targetNodeId ? imageMediaRefsOf(imageSeed.targetNodeId, edges, mediaNodes).map(ref => ref.assetId) : []),
      videoIndices: edges.filter(e => e.target === videoSeed?.targetNodeId).flatMap(e => {
        const plan = textNodes.find(n => n.id === e.source && n.data.promptSource);
        const mentions = promptMentionSchema.array().safeParse(plan?.data.promptMentions ?? []);
        return mentions.success ? promptBindingList(mentions.data).map(m => `#${m.index}`) : [];
      }).join('、'),
      video: forTarget(videoSeed?.targetNodeId, [...videoRefs.reference, ...(videoRefs.first ? [videoRefs.first] : []), ...(videoRefs.last ? [videoRefs.last] : [])].map(ref => ref.assetId)),
    };
  }, [imageSeed?.targetNodeId, videoSeed?.targetNodeId, edges, mediaNodes, textNodes]);

  const pendingPlanSyncs = (targetId: string | undefined) => edges.filter(edge => edge.target === targetId).flatMap(edge => {
    const node = textNodes.find(node => node.id === edge.source && node.data.promptSource);
    if (!node) return [];
    const mentions = promptMentionSchema.array().safeParse(node.data.promptMentions ?? []);
    if (!mentions.success || !validPromptMentions(extractTextNodeText(node.data), mentions.data)) return [];
    const bindings = promptBindingList(mentions.data);
    const confirmed = promptBindingsSchema.safeParse((edge.data?.promptReference as { bindings?: unknown } | undefined)?.bindings ?? (bindings.length ? undefined : []));
    return confirmed.success && JSON.stringify(confirmed.data) === JSON.stringify(bindings) ? [] : [{ nodeId: node.id, title: String(node.data.title || '方案'), bindings }];
  });
  const syncPlanToTarget = (planNodeId: string, targetId: string | undefined) => {
    const pending = pendingPlanSyncs(targetId).find(plan => plan.nodeId === planNodeId);
    if (pending && targetId) connectPlanToDraft(planNodeId, targetId);
  };

  /** 视频草稿绑定面板的文本附件实时跟随画布连线（IKDMQS，同图片草稿） */
  const videoDraftAttachments = useMemo(
    () => (videoDraftId ? textAttachmentsOf(videoDraftId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoDraftId, edges, textNodes],
  );

  /** 音频草稿绑定面板的文本附件实时跟随画布连线（IKFCKS：画布文本卡连线 → FileText 缩略图进参考栏） */
  const audioDraftAttachments = useMemo(
    () => (audioDraftId ? textAttachmentsOf(audioDraftId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audioDraftId, edges, textNodes],
  );

  /** IKFR4X 会话勾选标识：图片持续选取会话进行中，已并入原目标的媒体来源节点集合（连线推导，与 Dock 参考同源；
   *  文本附件来源无素材勾选语义，不计入）。仅会话活跃时计算——普通模式不标记，勾选只表达当前目标与选择上下文 */
  const imagePickMarkedIds = useMemo(() => {
    if (!imagePickSessionActive || typeof imagePickSession !== 'string') return [] as string[];
    const textIds = new Set(textNodes.map((n) => n.id));
    return edges.filter((e) => e.target === imagePickSession && !textIds.has(e.source)).map((e) => e.source);
  }, [imagePickSessionActive, imagePickSession, edges, textNodes]);

  /** IKFR4Y 会话勾选标识：视频持续选取会话进行中，已并入当前目标且与发起槽位同角色的来源节点集合
   *  （连线推导，与 Dock 参考同源）。首尾帧会话只标当前槽位占用者，普通参考会话只标普通参考来源，
   *  不混入其他槽位/目标的参考；文本附件来源无素材勾选语义，不计入。仅会话活跃时计算 */
  const videoPickMarkedIds = useMemo(() => {
    if (!videoPickSessionActive || typeof videoPickSession !== 'string') return [] as string[];
    const textIds = new Set(textNodes.map((n) => n.id));
    const role = pickRefRole ?? 'reference';
    return edges
      .filter((e) => e.target === videoPickSession && !textIds.has(e.source) && readRefRole(e) === role)
      .map((e) => e.source);
  }, [videoPickSessionActive, videoPickSession, pickRefRole, edges, textNodes]);

  /** 视频选取会话：合规未通过的素材置灰不可选 */
  const videoPickBlockedIds = useMemo(
    () => mediaNodes.filter((n) => ((n.data ?? {}) as Record<string, unknown>).complianceFailed === true).map((n) => n.id),
    [mediaNodes],
  );

  /** IKFR4Z 会话勾选标识：音频持续选取会话进行中，已并入原目标的媒体来源节点集合（连线推导，
   *  与 Dock 参考同源；音频参考无角色槽，全部连线来源计入）。文本附件来源无素材勾选语义，不计入。
   *  仅会话活跃时计算——普通模式不标记，勾选只表达当前目标与选择上下文 */
  const audioPickMarkedIds = useMemo(() => {
    if (!audioPickSessionActive || typeof audioPickSession !== 'string') return [] as string[];
    const textIds = new Set(textNodes.map((n) => n.id));
    return edges.filter((e) => e.target === audioPickSession && !textIds.has(e.source)).map((e) => e.source);
  }, [audioPickSessionActive, audioPickSession, edges, textNodes]);

  /** 草稿绑定面板的图片媒体参考（IKDMQR 按连线推导 + IKFM3S §2 文本带入参考追加）：
 *  直接参考在前、文本索引素材在后（同 assetId 去重保首见），Dock 显示即提交输入（同源）。
 *  连线持久化后刷新/重开项目同样经此推导恢复展示；名称随来源卡片改名即时同步（IKFA8Y）。 */
  const imageDraftMediaRefs = useMemo(
    () => {
      if (!imageDraftId) return undefined;
      return mergedImageRefsOf(imageDraftId, edges, [...mediaNodes, ...textNodes]);
    },
    [imageDraftId, edges, mediaNodes, textNodes],
  );
  /** IKFM3S §3：文本索引发送校验（失效/类型/超限，与业务 API 同口径）——面板持续显示并阻止发送 */
  const imageDraftTextIndexError = useMemo(
    () => (imageDraftId ? imageTextIndexSendError(imageDraftId, edges, [...mediaNodes, ...textNodes], DEFAULT_IMAGE_REFERENCE_LIMIT) : undefined),
    [imageDraftId, edges, mediaNodes, textNodes],
  );
  /** IKFM3S §6：定位来源文本卡（平移居中 + 选中高亮） */
  const locateTextSource = useCallback((nodeId: string) => {
    const target = findCanvasNode(nodeId);
    if (!target) return;
    const width = (target as Node & { measured?: { width?: number } }).measured?.width ?? 360;
    const height = (target as Node & { measured?: { height?: number } }).measured?.height ?? 270;
    setFocusViewport({ x: window.innerWidth / 2 - (target.position.x + width / 2), y: window.innerHeight / 2 - (target.position.y + height / 2), zoom: 1 });
    setSelectRequest({ id: nodeId, ts: Date.now() });
  }, []);
  const invalidImageMediaRefs = useMemo(() => {
    if (!imageDraftId) return [];
    return edges.filter(edge => edge.target === imageDraftId).flatMap(edge => {
      const source = mediaNodes.find(node => node.id === edge.source);
      return source && imageRefSourceError(source)
        ? [{ nodeId: source.id, name: String(source.data.fileName || source.id) }]
        : [];
    });
  }, [imageDraftId, edges, mediaNodes]);

  /** 面板/Dock 移除媒体参考（图片 IKDMQR / 视频 IKDMQS / 音频 IKFDFZ 共用）：断开对应连线——
   *  仅改变关系，不删除来源素材卡，也不影响其他目标对同一来源的引用（按 (source,target) 精确匹配）。 */
  const removeRefEdges = (draftId: string, sourceNodeId: string) => {
    if (isGeneratingNode(draftId)) return;
    removeTargetInputs(edgesRef.current.filter(edge => edge.source === sourceNodeId && edge.target === draftId).map(edge => edge.id));
  };

  /** 草稿绑定面板的视频媒体参考（IKDMQS 按连线角色分组 + IKFM3W §10 文本带入参考追加）：
   *  直接参考在前、文本索引素材追加为普通参考尾部（同 assetId 去重），Dock 显示即提交输入（同源）。
   *  角色随连线持久化，刷新/重开项目后经同一推导恢复展示；名称随来源卡片改名即时同步（IKFA8Y）。 */
  const videoDraftMediaRefs = useMemo(
    () => {
      if (!videoDraftId) return undefined;
      return mergedVideoRefsWithTextIndex(videoDraftId, edges, mediaNodes, textNodes);
    },
    [videoDraftId, edges, mediaNodes, textNodes],
  );
  /** IKFM3W §10：视频目标文本索引发送校验（失效/帧互斥与业务 API 同口径）——面板持续显示并阻止发送 */
  const videoDraftTextIndexError = useMemo(
    () => (videoDraftId ? videoTextIndexSendError(videoDraftId, edges, mediaNodes, textNodes) : undefined),
    [videoDraftId, edges, mediaNodes, textNodes],
  );

  /** 草稿绑定面板的音频媒体参考（IKFDFZ 按连线推导 + IKFM41 §11 文本带入参考追加）：
   *  直接参考在前、文本索引素材追加尾部（同 assetId 去重保首见），面板显示即提交
   *  references 输入（同源）；连线随画布自动保存持久化，刷新/重开经同一推导恢复展示；
   *  失效来源保留原因提示并阻止发送，名称随来源卡片改名即时同步。 */
  const audioDraftMediaRefs = useMemo(
    () => {
      if (!audioDraftId) return undefined;
      return mergedAudioRefsWithTextIndex(audioDraftId, edges, mediaNodes, textNodes);
    },
    [audioDraftId, edges, mediaNodes, textNodes],
  );
  /** IKFM41 §11：音频目标文本索引发送校验（失效/不支持类型与业务 API 同口径）——面板持续显示并阻止发送 */
  const audioDraftTextIndexError = useMemo(
    () => (audioDraftId ? audioTextIndexSendError(audioDraftId, edges, mediaNodes, textNodes) : undefined),
    [audioDraftId, edges, mediaNodes, textNodes],
  );

  /** 音频草稿参考的 AudioRefItem 形态（面板展示/提交共用；文本带入项携带锁定来源与实际类型） */
  const audioDraftRefItems: AudioRefItem[] | undefined = audioDraftMediaRefs
    ? audioDraftMediaRefs.refs.map((r) => ({
      id: r.nodeId,
      kind: 'audio' as const,
      name: r.name,
      src: r.url,
      source: 'canvas' as const,
      assetId: r.assetId,
      ...(r.textNodeId != null ? { textNodeId: r.textNodeId, mediaType: r.mediaType } : {}),
    }))
    : undefined;

  /** 面板「从画布选择」列表添加参考（IKFDFZ）：与画布选取/@ 同一校验与建线语义 */
  const handleAddAudioCanvasRef = (nodeId: string) => {
    if (!audioDraftId) return;
    if (!validateAudioRefConnect(nodeId, audioDraftId)) return;
    addCanvasEdge(nodeId, audioDraftId);
  };

  /** 视频跟随输入框模式门控（IKFC1T）：按「实际成为当前目标参考」的媒体集合判定（连线 +
   *  角色库 material，与面板显示/提交输入同源）；文本附件不属于媒体参考，
   *  不参与判定。存在任一媒体参考时文生视频不可选；移除全部参考后恢复可选但不自动切回。 */
  const videoFollowModes: VideoFollowMode[] | undefined = videoDraftId && showBottomDialog && videoDraftMediaRefs
    ? enabledVideoFollowModes(videoDraftMediaRefs)
    : undefined;

  /** 移除角色库 material 参考（IKDMQS 来源补齐）：从草稿 data.draftMaterialRefs 过滤对应项。
   *  IKFCKT：改角色分支随死 wiring 处置下线（角色由模式+目标槽决定），收窄为纯移除 */
  const removeDraftMaterialRef = (draftId: string, materialId: string) => {
    const existing = readDraftMaterialRefs(mediaNodesRef.current.find((n) => n.id === draftId));
    patchMediaNode(draftId, {
      draftMaterialRefs: existing.filter((m) => m.materialId !== materialId),
    });
  };

  /** IKFJJT：把视频草稿的参考批量改角色（模式切换自动转换用）。
   *  普通参考⇄首尾帧互转：切首尾帧时图片转 first/last 槽（第 1 张 first、第 2 张 last）；
   *  切回全能参考/图生视频时首尾帧转回普通参考（role='reference'）。
   *  边参考改 edge.data.refRole（随连线持久化；reference 删该字段，与 addCanvasEdge 写入口径一致），
   *  素材库参考改草稿 data.draftMaterialRefs[].role（随草稿持久化）。 */
  const assignVideoRefRoles = (
    draftId: string,
    assignments: Array<{ nodeId: string; role: VideoRefRole }>,
  ) => {
    if (assignments.length === 0) return;
    const roleByKey = new Map(assignments.map((a) => [a.nodeId, a.role]));

    // 1) 边参考：改 (source → draft) 的 data.refRole（沿用 addCanvasEdge 的 history 模式持久化）
    const prevEdges = edgesRef.current;
    let edgesChanged = false;
    const nextEdges = prevEdges.map((e) => {
      if (e.target !== draftId) return e;
      const role = roleByKey.get(e.source);
      if (!role) return e;
      const currentRole = (e.data as Record<string, unknown> | undefined)?.refRole;
      // reference = 缺省角色（不写 data.refRole），与 addCanvasEdge 一致；其余显式写入。
      if (role === 'reference') {
        if (currentRole === undefined) return e;
        edgesChanged = true;
        const { refRole: _drop, ...restData } = (e.data ?? {}) as Record<string, unknown>;
        return { ...e, data: restData };
      }
      if (currentRole === role) return e;
      edgesChanged = true;
      return { ...e, data: { ...e.data, refRole: role } };
    });
    if (edgesChanged) {
      historyRef.current?.pushReplaceEdges(prevEdges, nextEdges);
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
    }

    // 2) 素材库参考：改草稿 draftMaterialRefs[].role
    const draftNode = mediaNodesRef.current.find((n) => n.id === draftId);
    const existing = readDraftMaterialRefs(draftNode);
    if (existing.length > 0) {
      const nextMaterials = existing.map((m) => {
        const role = roleByKey.get(m.materialId);
        return role ? { ...m, role } : m;
      });
      if (nextMaterials.some((m, i) => m.role !== existing[i]!.role)) {
        patchMediaNode(draftId, { draftMaterialRefs: nextMaterials });
      }
    }
  };

  /* ============ 视频自由模式（工具栏入口，无草稿卡）：参考本地暂存与变更 ============ */

  /** 自由模式追加参考（到节点选择/从资产中选择/角色库共用）：校验口径与草稿连线一致——
   *  槽位占用/尾帧配首帧/查重/图9视频3上限；通过后写入本地 refs，不落画布不连线 */
  const appendVideoFreeRef = (item: VideoMediaRef, role: VideoRefRole): void => {
    const refs = videoFreeRefs;
    const msg = checkAddVideoRef(role, item.mediaType, item.assetId, refs, undefined, [item.materialId]);
    if (msg) {
      showToast('warn', msg);
      return;
    }
    if (role === 'first') {
      setVideoFreeRefs((prev) => ({ ...prev, first: item }));
      return;
    }
    if (role === 'last') {
      setVideoFreeRefs((prev) => ({ ...prev, last: item }));
      return;
    }
    setVideoFreeRefs((prev) => ({ ...prev, reference: [...prev.reference, item] }));
  };

  /** 自由模式移除参考：key 对应 VideoMediaRef.nodeId（画布节点 id / 资产合成键 / materialId） */
  const removeVideoFreeRef = (key: string): void => {
    setVideoFreeRefs((prev) => {
      const next: VideoMediaRefs = { reference: prev.reference.filter((r) => r.nodeId !== key) };
      if (prev.first?.nodeId !== key) next.first = prev.first;
      if (prev.last?.nodeId !== key) next.last = prev.last;
      return next;
    });
  };

  /** IKFJJT：自由模式（无画布连线）把参考批量改角色——模式切换转换用（普通参考⇄首尾帧）。
   *  直接按 nodeId 覆写本地 refs 的角色，未命中项保持原角色。 */
  const assignVideoFreeRefRoles = (
    assignments: Array<{ nodeId: string; role: VideoRefRole }>,
  ): void => {
    if (assignments.length === 0) return;
    const roleByKey = new Map(assignments.map((a) => [a.nodeId, a.role]));
    setVideoFreeRefs((prev) => {
      const all: Array<{ item: VideoMediaRef; role: VideoRefRole }> = [
        ...prev.reference.map((item) => ({ item, role: 'reference' as const })),
        ...(prev.first ? [{ item: prev.first, role: 'first' as const }] : []),
        ...(prev.last ? [{ item: prev.last, role: 'last' as const }] : []),
      ];
      const next: VideoMediaRefs = { reference: [] };
      for (const { item, role } of all) {
        const targetRole = roleByKey.get(item.nodeId) ?? role;
        if (targetRole === 'first') next.first = item;
        else if (targetRole === 'last') next.last = item;
        else next.reference.push(item);
      }
      return next;
    });
  };

  /** 重新编辑（IKDMQU）：三类媒体卡统一走绑定面板——编辑实时写回本卡、发送后原卡重新生成（Q1）；
   *  图片/视频参数与参考连线经 openXxxDraftDialog 恢复；音频此前落入图片分支，本切片补齐绑定 */
  const handleNodeReEdit = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    openMediaDraftDialog(id, ((node.data ?? {}) as Record<string, unknown>).mediaType);
  };

  /** 生成图片：与「生成视频」同口径——新建图片草稿卡，把当前节点自动连为参考（IKDMQR 关系即连线）。
   *  不调 validateImageRefConnect（新草稿尚未进 ref，会跳过校验）；来源有效性预检后建卡建线。 */
  const handleNodeGenImage = (id: string) => {
    if (!canOpenEditor()) return;
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const err = imageRefSourceError(node);
    if (err) {
      showToast('warn', err);
      return;
    }
    const draftId = createImageDraftCard();
    addCanvasEdge(id, draftId);
    openImageDraftDialog(draftId);
  };

  /** 高清放大（IKGM9F/IKGM9O）：照搬「生成图片」建卡骨架——来源预检后在源卡右侧建「高清」草稿卡并自动选中；
   *  连线带 origin 标记为纯视觉来源边（不占参考位、不参与 @ 编号与媒体索引）。
   *  节点 data 写入高清身份标记（含源素材身份）供「重新编辑」分流与参数回填；
   *  建卡后自动弹出高清放大参数面板（规格故事 10），链式放大（高清卡上再点）同链新建卡 */
  const handleNodeEnhanceImage = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const err = imageRefSourceError(node);
    if (err) {
      showToast('warn', err);
      return;
    }
    const sourceData = (node.data ?? {}) as Record<string, unknown>;
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(node), {
      fileName: '高清',
      data: { imageEnhance: { sourceAssetId: readAssetId(sourceData) } },
    });
    addCanvasEdge(id, draftId, undefined, { origin: IMAGE_ENHANCE_EDGE_ORIGIN });
    openEnhanceDraftDialog(draftId);
  };

  /** 进入扩图模式（IKGOQX）：「高清 ▾」菜单「扩图」项——门槛预检后建立会话（不建卡不连线），
   *  扩展量从零开始；进入时关其他生成面板与残留选取态，模式期间禁用框选与他卡拖动（Canvas refPickActive） */
  const handleNodeOutpaintImage = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const d = (node.data ?? {}) as Record<string, unknown>;
    const gate = outpaintGateReason(
      typeof d.width === 'number' ? d.width : undefined,
      typeof d.height === 'number' ? d.height : undefined,
      typeof d.size === 'number' ? d.size : undefined,
    );
    if (gate) {
      showToast('warn', gate);
      return;
    }
    if (imagePickSessionActive) endImagePickSession();
    if (videoPickSessionActive) endVideoPickSession();
    if (audioPickSessionActive) endAudioPickSession();
    if (pickMode || pickTarget) {
      setPickMode(null);
      setPickTarget(null);
      setPickRefRole(null);
      setPickProductId(null);
      setPickAssetId(null);
    }
    dismissAllGenPanels();
    // 全屏编辑模式互斥：进入扩图同时退出裁切（IKGV2J 裁切整包合并后的交叉缝隙）
    exitCropMode();
    setOutpaintExpands(ZERO_EXPANDS);
    setOutpaintNodeId(id);
  };

  /** 退出擦除编辑态（IKGOTB 四退出共用）：未发送的遮罩全部丢弃（无卡、无边、无任务），
   *  工具/活笔/发送中标记一并复位。 */
  const exitEraseEditing = () => {
    setEraseTargetNodeId(null);
    setEraseMaskState(EMPTY_MASK_EDIT);
    setEraseLiveOp(null);
    eraseLiveOpRef.current = null;
    eraseStrokePointsRef.current = [];
    setEraseTool('brush');
    setEraseSubmitting(false);
  };

  /** 退出裁切模式（IKGW1H 四退出共用：面板取消/Esc/点画布空白或框外暗区/点其他卡）：
   *  丢弃不留痕——无卡、无边、无状态残留，源图卡原样保留；框与比例回默认（不记忆上次状态）。 */
  const exitCropMode = () => {
    setCropTargetNodeId(null);
    setCropRect(null);
    setCropPreset('free');
  };

  /** 擦除（IKGOT7 入口 / IKGOTB 编辑态）：把目标图片卡置为擦除编辑态并重置遮罩编辑。
   *  门槛预检（超尺寸/超大小/webp/gif）已在菜单项置灰层完成，此处只管进入；
   *  进入时关闭五个生成面板（编辑态是独立模式，规格故事 7）并退出裁切模式（编辑模式互斥）。 */
  const handleNodeEraseImage = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    dismissAllGenPanels();
    exitCropMode();
    setEraseTargetNodeId(id);
    setEraseMaskState(EMPTY_MASK_EDIT);
    setEraseLiveOp(null);
    eraseLiveOpRef.current = null;
    eraseStrokePointsRef.current = [];
    setEraseTool('brush');
  };

  /** 裁切（IKGW1H 入口 / IKGW1N 补全默认态）：把目标图片卡置为裁切编辑态。无门槛预检
   *  （菜单项恒可用）；进入时关闭五个生成面板（同擦除口径）并退出擦除编辑态（编辑模式互斥）；
   *  默认自由比例、框为全幅（fullCropRect，干净起点不记忆上次状态）；单值 cropTargetNodeId
   *  即单目标——换目标卡自然替换。 */
  const handleNodeCropImage = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    dismissAllGenPanels();
    exitEraseEditing();
    // 全屏编辑模式互斥：进入裁切同时退出扩图会话（!737 扩图整包合并后的交叉缝隙）
    endOutpaintSession();
    const bounds = cropBoundsOf(node);
    setCropPreset('free');
    setCropRect(fullCropRect(bounds));
    setCropTargetNodeId(id);
  };

  /** 裁切比例选择（IKGW1N）：预设 → 框变为内容区内最大内接该比例矩形并居中（inscribeCropRect）；
   *  自由 → 框保持不变（只是解除比例锁定）。 */
  const handleCropPresetChange = (key: CropPresetKey) => {
    setCropPreset(key);
    const ratio = cropPresetRatio(key);
    if (ratio != null && cropBounds) setCropRect(inscribeCropRect(cropBounds, ratio));
  };

  /** 裁切确认（IKGW1N 渲染在位、点击派发；IKGW1S 执行链路）：离屏 canvas 按源图自然分辨率
   *  裁出框内画面（cropRectToNatural）→ toBlob 重编码（cropOutputFormat 跟随源图：JPEG 约
   *  0.92、PNG、判不出 PNG 兜底）→ new File → 既有资产上传链路（普通上传不带 assetSource，
   *  裁切产物是用户成品）→ 源卡右侧紧邻新建「裁切」成品卡（fileName 先例同高清；无草稿、
   *  无生成中过渡，直接显示结果；skipSelect 不抢选中）+ 纯视觉来源连线
   *  （origin=IMAGE_CROP_EDGE_ORIGIN，参考推导跳过）→ exitCropMode（确认即退出）。
   *  源图自然分辨率缺失（cropSpace null，存量老图）或加载/编码/上传失败：toast 报错、
   *  留在裁切模式，不建卡不退态（无半成品；对齐擦除「上传失败留在编辑态」口径）。 */
  const handleCropConfirm = () => {
    const sourceNodeId = cropTargetNodeId;
    const node = sourceNodeId ? mediaNodesRef.current.find((n) => n.id === sourceNodeId) : undefined;
    const data = (node?.data ?? {}) as Record<string, unknown>;
    const rect = cropRect;
    const bounds = cropBounds;
    const space = cropSpace;
    if (!sourceNodeId || !node || !rect || !bounds || !space) {
      showToast('warn', '源图分辨率未知，无法裁切');
      return;
    }
    if (cropSubmittingRef.current) return;
    const src = typeof data.src === 'string' ? data.src : '';
    if (!src || src.startsWith('blob:')) {
      showToast('warn', '源图不可用，无法裁切');
      return;
    }
    cropSubmittingRef.current = true;
    const natural = cropRectToNatural(rect, bounds, space);
    const format = cropOutputFormat({
      mime: typeof data.mime === 'string' ? data.mime : undefined,
      src,
      fileName: typeof data.fileName === 'string' ? data.fileName : undefined,
    });
    void (async () => {
      try {
        const file = await cropImageToFile(src, natural, format);
        if (!file) {
          showToast('error', '裁切生成失败，请重试');
          return;
        }
        const uploaded = await uploadAssetFile(file, { projectId: currentId ?? undefined });
        // 发送即退出模式（先退再建卡，对齐擦除链路顺序；skipSelect 下无选中误判）
        exitCropMode();
        const draftId = createImageDraftCard(imageEnhanceDraftPosition(node), {
          fileName: '裁切',
          skipSelect: true,
          data: {
            src: uploaded.url,
            assetId: uploaded.asset_id,
            width: uploaded.width,
            height: uploaded.height,
            mime: uploaded.mime,
            size: uploaded.size,
            genStatus: undefined,
            draft: undefined,
          },
        });
        addCanvasEdge(sourceNodeId, draftId, undefined, { origin: IMAGE_CROP_EDGE_ORIGIN });
      } catch (e: unknown) {
        showToast('error', isApiError(e) ? e.message : '裁切上传失败，请重试');
      } finally {
        cropSubmittingRef.current = false;
      }
    })();
  };

  /* ===== 擦除遮罩指针交互（IKGOTB）：EraseMaskLayer 上抛显示坐标点，此处按当前工具落 op ===== */

  const handleEraseStrokeStart = (point: MaskPoint) => {
    if (eraseTool === 'rect') {
      const op: MaskOp = { kind: 'rect', erase: false, from: point, to: point };
      eraseLiveOpRef.current = op;
      setEraseLiveOp(op);
      return;
    }
    eraseStrokePointsRef.current = [point];
    const op: MaskOp = {
      kind: 'stroke',
      erase: eraseTool === 'eraser',
      points: [point],
      radius: eraseBrushRadius,
    };
    eraseLiveOpRef.current = op;
    setEraseLiveOp(op);
  };

  const handleEraseStrokeMove = (point: MaskPoint) => {
    const live = eraseLiveOpRef.current;
    if (!live) return;
    if (live.kind === 'rect') {
      const next: MaskOp = { ...live, to: point };
      eraseLiveOpRef.current = next;
      setEraseLiveOp(next);
      return;
    }
    eraseStrokePointsRef.current = [...eraseStrokePointsRef.current, point];
    const next: MaskOp = { ...live, points: eraseStrokePointsRef.current };
    eraseLiveOpRef.current = next;
    setEraseLiveOp(next);
  };

  const handleEraseStrokeEnd = () => {
    const live = eraseLiveOpRef.current;
    eraseLiveOpRef.current = null;
    setEraseLiveOp(null);
    eraseStrokePointsRef.current = [];
    if (!live) return;
    setEraseMaskState((state) => applyMaskOp(state, live));
  };

  const handleEraseUndo = () => setEraseMaskState((state) => undoMaskEdit(state));
  const handleEraseRedo = () => setEraseMaskState((state) => redoMaskEdit(state));

  /** 生成视频（IKDMQS 统一草稿绑定）：有生成记录的视频节点 → 绑定原卡原位重新生成（与「重新编辑」一致）；
   *  其他节点（图片/上传视频等）→ 来源有效性预检后新建视频草稿卡 + 被点节点自动连线为普通参考。
   *  不调 validateVideoRefConnect（新草稿未进 ref 会使校验被跳过），canOpenEditor 闸口保留 */
  const handleNodeGenVideo = (id: string) => {
    if (!canOpenEditor()) return;
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const d = (node.data ?? {}) as Record<string, unknown>;
    if (d.mediaType === 'video' && hasGenerationRecord(node)) {
      openVideoDraftDialog(id);
      return;
    }
    const err = videoRefSourceError(node, 'reference');
    if (err) {
      showToast('warn', err);
      return;
    }
    const draftId = createVideoDraftCard();
    addCanvasEdge(id, draftId, 'reference');
    openVideoDraftDialog(draftId);
  };

  /** 生成音频：打开音频对话框 */
  const handleNodeGenAudio = (id: string) => {
    if (!canOpenEditor()) return;
    const ref = nodeRefOf(id);
    if (!ref) return;
    setAudioSeed({ ts: Date.now() });
    // IKFYH6：自由音频面板打开路径同样重置隐藏标记，否则选中变化关闭对该面板失效
    audioPanelHiddenRef.current = false;
    setShowAudioDialog(true);
    setShowBottomDialog(false);
    setShowImageDialog(false);
    setShowMusicDialog(false);
    setShowEnhanceDialog(false);
  };

  /** 视频整段提取音频（IKFS5W）：建任务后本地插入音频占位节点（画布只由前端写），
   *  立刻落库避免刚建任务就关页丢节点，再用返回的 job_id 轮询，终态本地补丁收敛。 */
  const handleNodeExtractAudio = async (id: string) => {
    const node = mediaNodesRef.current.find((item) => item.id === id);
    const assetId = node?.data?.assetId as string | number | undefined;
    if (node?.data?.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    if (!currentId) {
      showToast('warn', '未选中项目，无法提取音频');
      return;
    }
    if (node?.data?.mediaType !== 'video' || assetId == null) {
      showToast('warn', '当前视频尚未关联资产，无法提取音频');
      return;
    }

    try {
      const created = await createMediaExtraction(currentId, {
        source_asset_id: assetId,
        output_format: 'mp3',
      });
      const nodeId = mediaExtractNodeId(created.job_id);
      const placeholder = attachCallbacks(
        buildMediaExtractPlaceholderNode({ jobId: created.job_id, source: node }) as Node,
      );
      // 先同步写 ref 再 setState：本轮 flush 落库要用它，且下方连线端点必须已在本次保存的节点里
      // （不登记 pendingNodeIdsRef：占位节点身份以任务为准，失败由终态补丁收敛，不需要添加失败回滚）
      const current = mediaNodesRef.current;
      const next = current.some((item) => item.id === nodeId) ? current : [...current, placeholder];
      mediaNodesRef.current = next;
      setMediaNodes(next);
      // 连一条视频 → 音频的**来源边**（带 origin 标记）：说明音频是从这段视频提取来的；
      // 参考推导会跳过它，避免把这个视频当成音频生成参考而卡住发送
      addCanvasEdge(id, nodeId, undefined, { origin: MEDIA_EXTRACT_EDGE_ORIGIN });
      pollJob(nodeId, created.job_id);
      // 立刻落库（best-effort）：不等 800ms 防抖，避免刚建任务就关页丢节点
      await flushCanvasSave(currentId).catch(() => {});
    } catch (error) {
      if (!isApiError(error)) showToast('error', '音频提取任务创建失败');
    }
  };

  /** 自由图片面板的文本附件按节点身份刷新标题与正文（IKFCX4）：来源改名/改文后再次预览即用当前值；
   *  草稿绑定分支（imageDraftAttachments）实时跟随连线，本视图兜底 imageDraftId 解绑后的快照窗口。 */
  const imageSeedView = useMemo(() => {
    if (!imageSeed || imageDraftId) return imageSeed;
    const byId = new Map(textNodes.map((n) => [n.id, n]));
    const attachments = imageSeed.attachments?.map((attachment) => {
      const node = byId.get(attachment.nodeId);
      if (!node) return attachment;
      const title = typeof node.data?.title === 'string' && node.data.title ? (node.data.title as string) : '文本节点';
      const text = extractTextNodeText(node.data);
      return title === attachment.title && text === attachment.text ? attachment : { ...attachment, title, text };
    });
    return { ...imageSeed, attachments };
  }, [imageSeed, imageDraftId, textNodes]);

  /** 视频自由模式参考（IKFA8Y）：参考名称按来源节点身份取当前名称 */
  const videoFreeRefsView = useMemo(
    () => freshVideoCanvasRefs(videoFreeRefs, mediaNodes),
    [videoFreeRefs, mediaNodes],
  );

  /** 触发浏览器文件下载 */
  const triggerFileDownload = (href: string, filename: string, revokeObjectUrl = false) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revokeObjectUrl) window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  /** 拉取远程素材为 blob；失败则 null（组下载不再 window.open，避免只弹出第一个）。
   *  开发模式下跨域素材走 Vite /__tos-fetch 代理，避免浏览器 CORS 拦截 fetch blob */
  const fetchAssetBlob = async (src: string): Promise<Blob | null> => {
    const fetchUrl =
      import.meta.env.DEV && /^https?:\/\//.test(src) && !src.startsWith(window.location.origin)
        ? `/__tos-fetch?url=${encodeURIComponent(src)}`
        : src;
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  };

  /** 下载单个媒体节点：成功返回 true，无素材则 false。
   *  文件名以当前卡片名称为基础，扩展名取真实文件类型（blob MIME 优先，节点 mime/素材地址兜底，IKFA8Y） */
  const downloadMediaById = async (id: string, notifyMissing: boolean): Promise<boolean> => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (node?.data?.assetMissing) {
      if (notifyMissing) showToast('warn', '素材已被删除');
      return false;
    }
    const src = node?.data?.src as string | undefined;
    if (!src) return false;
    const name = (node?.data?.fileName as string) || id;
    const mime = node?.data?.mime as string | undefined;
    const blob = await fetchAssetBlob(src);
    if (blob) {
      triggerFileDownload(URL.createObjectURL(blob), downloadFileNameOf(name, blob.type || mime, src), true);
      return true;
    }
    window.open(src, '_blank', 'noopener');
    return true;
  };

  type GroupDownloadItem = { filename: string; blob: Blob };

  /** 收集组内全部可下载素材（媒体原件 + 文本 txt），按节点顺序 */
  const collectGroupDownloadItems = async (ids: string[]): Promise<GroupDownloadItem[]> => {
    const items: GroupDownloadItem[] = [];
    const usedNames = new Set<string>();
    for (const id of ids) {
      const media = mediaNodesRef.current.find((n) => n.id === id);
      const src = media?.data?.src as string | undefined;
      if (media && !media.data?.assetMissing && src) {
        const blob = await fetchAssetBlob(src);
        if (blob) {
          const sniffed = await sniffMediaMime(blob);
          const nodeMime = media.data?.mime as string | undefined;
          const mime = sniffed || blob.type || nodeMime;
          const cardName = (media.data?.fileName as string) || id;
          items.push({
            filename: uniqueDownloadName(downloadFileNameOf(cardName, mime, src), usedNames),
            blob,
          });
        }
        continue;
      }
      const textNode = textNodesRef.current.find((n) => n.id === id);
      if (textNode) {
        const text = extractTextNodeText(textNode.data);
        if (!text.trim()) continue;
        const title =
          typeof textNode.data.title === 'string' && textNode.data.title.trim()
            ? (textNode.data.title as string)
            : '文本';
        items.push({
          filename: uniqueDownloadName(`${title}.txt`, usedNames),
          blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
        });
      }
    }
    return items;
  };

  /** 组下载：浏览器会拦截同一次点击的多次 a.click，故打成一份 zip 一次保存全部素材 */
  const handleDownloadGroupNodes = async (ids: string[]) => {
    const items = await collectGroupDownloadItems(ids);
    if (items.length === 0) {
      showToast('warn', '组内没有可下载的素材');
      return;
    }
    const zipParts = await Promise.all(
      items.map(async (item) => ({ name: item.filename, data: await blobToUint8Array(item.blob) })),
    );
    const zipBlob = await buildStoreZip(zipParts);
    triggerFileDownload(URL.createObjectURL(zipBlob), '组素材.zip', true);
  };

  /** 下载：优先 fetch blob 触发下载，跨域失败回退新标签页打开 */
  const handleNodeDownload = async (id: string) => {
    await downloadMediaById(id, true);
  };

  /** 查看媒体详情：先展示节点快照，再按 assetId 补全完整资产字段。 */
  const handleNodeShowDetails = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    const data = (node?.data ?? {}) as Record<string, unknown>;
    if (node?.data?.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    const type = data.mediaType;
    const url = data.src;
    if (!node || (type !== 'image' && type !== 'video' && type !== 'audio') || typeof url !== 'string') {
      showToast('warn', '当前媒体暂无可展示的详情');
      return;
    }

    const assetId = data.assetId ?? data.asset_id ?? data.assetID;
    const fallbackAsset: AssetRecord = {
      id: typeof assetId === 'string' || typeof assetId === 'number' ? assetId : node.id,
      type,
      url,
      width: typeof data.width === 'number' ? data.width : null,
      height: typeof data.height === 'number' ? data.height : null,
      duration: typeof data.duration === 'number' ? data.duration : null,
      size: typeof data.size === 'number' ? data.size : null,
      source: null,
      model: null,
      created_at: null,
    };

    setAssetDetailTarget(fallbackAsset);
    const requestId = ++assetDetailRequestIdRef.current;
    if (typeof assetId !== 'string' && typeof assetId !== 'number') {
      setAssetDetailLoading(false);
      return;
    }
    setAssetDetailLoading(true);

    void fetchAssetDetail(assetId)
      .then((asset) => {
        // 请求结束前用户可能关闭或切换到其他资产，避免用旧响应覆盖当前弹框。
        if (requestId !== assetDetailRequestIdRef.current) return;
        setAssetDetailTarget((current) =>
          current && String(current.id) === String(fallbackAsset.id) ? asset : current,
        );
        setAssetDetailLoading(false);
      })
      .catch(() => {
        if (requestId === assetDetailRequestIdRef.current) setAssetDetailLoading(false);
      });
  };

  const handleCloseAssetDetail = () => {
    assetDetailRequestIdRef.current += 1;
    setAssetDetailTarget(null);
    setAssetDetailLoading(false);
  };

  actionsRef.current.reEdit = handleNodeReEdit;
  actionsRef.current.genImage = handleNodeGenImage;
  actionsRef.current.genVideo = handleNodeGenVideo;
  actionsRef.current.genAudio = handleNodeGenAudio;
  actionsRef.current.enhanceImage = handleNodeEnhanceImage;
  actionsRef.current.outpaintImage = handleNodeOutpaintImage;
  actionsRef.current.eraseImage = handleNodeEraseImage;
  actionsRef.current.cropImage = handleNodeCropImage;
  actionsRef.current.extractAudio = handleNodeExtractAudio;
  actionsRef.current.download = handleNodeDownload;
  actionsRef.current.showDetails = handleNodeShowDetails;

  /** 应用事实来自已持久化的文本节点来源，删除与刷新后自然同步。 */
  const appliedCardIds = useMemo(() => new Set(textNodes.flatMap(node => {
    const source = node.data.promptSource as GenerationCardBlock['source'];
    return source ? [`${source.revisionId}#${source.shotNo}`] : [];
  })), [textNodes]);

  /** 等待在途保存完成并立即落盘当前画布编辑（IKDLQE 应用预览的保存串行化模式；IKDLQF 目标生图提交复用）。
   *  返回 false 表示等待期间项目已切换，调用方应中止后续动作。
   *  IKFS5W：自身也登记进 savePromiseRef，与 800ms 防抖自动保存互斥——同一时刻只有一个 PUT、
   *  不会两次请求共用同一个 If-Match（调用方持 applyingRef 仍是推荐做法，但不再是正确性前提）。 */
  const flushCanvasSave = (projectId: string): Promise<boolean> => {
    const runFlush = async (): Promise<boolean> => {
      if (activeProjectRef.current !== projectId) return false;
      if (blockInvalidDraft(textNodesRef.current.map(n => n.id))) return false;
      const contentNodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
      // 组伪节点随 nodes 持久化（IKD0JT A3）：与防抖自动保存同口径，否则切换项目/应用预览时组关系丢失
      const nodes = [...contentNodes, ...groupsRef.current.map((g) => groupToNode(g))];
      const signature = JSON.stringify(viewport) + serializeNodes(nodes) + serializeEdges(edgesRef.current);
      if (signature !== lastSavedRef.current) {
        try {
          const saved = await saveCanvasDoc(projectId, { viewport, nodes, edges: edgesRef.current }, versionRef.current);
          versionRef.current = saved.version;
          lastSavedRef.current = signature;
          pendingNodeIdsRef.current.clear();
        } catch (error) {
          setSaveBlocked(true);
          setSaveStatus('error');
          throw error;
        }
      }
      setSaveBlocked(false);
      setSaveStatus('saved');
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      setSaveEpoch(value => value + 1);
      return true;
    };
    const previous = savePromiseRef.current;
    const queued = previous ? previous.then(runFlush, runFlush) : runFlush();
    // 登记「吞掉错误的 settled」供后来者安全 await；调用方拿到的 queued 照旧抛错
    trackCanvasSave(queued.then(() => undefined, () => undefined));
    return queued;
  };

  const handleRetryCanvasSave = async () => {
    if (!currentId || applyingRef.current) return;
    applyingRef.current = true;
    setSaveStatus('saving');
    try {
      if (!(await flushCanvasSave(currentId))) setSaveStatus('error');
      else setSaveEpoch(value => value + 1);
    } catch {
      setSaveStatus('error');
      showToast('error', '保存失败，请重试');
    } finally {
      applyingRef.current = false;
    }
  };

  referencePlanRef.current = async (planNodeId, targetNodeId, syncBindings) => {
    const projectId = activeProjectRef.current;
    if (!projectId || applyingRef.current || isGeneratingNode(targetNodeId)) return;
    applyingRef.current = true;
    setApplying(true);
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      if (!(await flushCanvasSave(projectId)) || versionRef.current === null) return;
      const saved = await referencePlanMutation.mutateAsync({ projectId, planNodeId, targetNodeId, expectedVersion: versionRef.current, ...(syncBindings !== undefined ? { syncBindings } : {}) });
      if (activeProjectRef.current !== projectId) return;
      const next = (JSON.parse(saved.edges ?? '[]') as Edge[]).map(edge => ({
        ...edgesRef.current.find(old => old.id === edge.id), ...edge, type: 'custom',
      }));
      historyRef.current?.pushReplaceEdges(edgesRef.current, next);
      edgesRef.current = next;
      setEdges(next);
      // IKFC26：方案绑定媒体时服务端同步切换目标草稿模式（文生视频 → 全能参考），
      // 本地节点以服务端返回为准跟随，防止下一次自动保存把切换结果覆盖回旧模式
      const savedNodes = JSON.parse(saved.nodes ?? '[]') as Node[];
      const serverMode = (savedNodes.find(n => n.id === targetNodeId)?.data as Record<string, unknown> | undefined)?.draftMode;
      const localMode = (mediaNodesRef.current.find(n => n.id === targetNodeId)?.data as Record<string, unknown> | undefined)?.draftMode;
      if (typeof serverMode === 'string' && serverMode !== localMode) patchMediaNode(targetNodeId, { draftMode: serverMode });
      versionRef.current = saved.version;
      lastSavedRef.current = JSON.stringify(JSON.parse(saved.viewport ?? 'null')) + serializeNodes(savedNodes) + serializeEdges(next);
      setSaveStatus('saved');
      setSaveEpoch(value => value + 1);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '方案引用失败，请重试');
    } finally { applyingRef.current = false; setApplying(false); }
  };

  const handleAgentCardApply = async (payload: GenerationCardBlock) => {
    if (applyingRef.current || !currentId || !payload.source) return;
    const projectId = currentId;
    applyingRef.current = true;
    setApplying(true);
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      if (!(await flushCanvasSave(projectId))) return;
      const result = await applyMutation.mutateAsync({ projectId, source: payload.source, position: spawnPosition() });
      if (activeProjectRef.current !== projectId) return;
      const savedNodes = JSON.parse(result.canvas.nodes ?? '[]') as Node[];
      const savedEdges = JSON.parse(result.canvas.edges ?? '[]') as Edge[];
      const savedViewport = JSON.parse(result.canvas.viewport ?? 'null') as Viewport | null;
      const textNodeId = result.node.id;
      const extraAssetIds = (payload.assetRefItems ?? []).map((item) => item.assetId);
      const assetIds = appliedPlanAssetIds(result.node as Node, extraAssetIds);
      const oriented = dropReversedTextIndexEdges(textNodeId, savedEdges);
      const indexEdges = textIndexEdgesForAppliedPlan(textNodeId, assetIds, savedNodes, oriented);
      let nextNodes = savedNodes;
      let nextEdges = [...oriented, ...indexEdges];
      let nextVersion = result.canvas.version;
      if (indexEdges.length > 0 || oriented.length !== savedEdges.length) {
        try {
          const persisted = await saveCanvasDoc(
            projectId,
            { viewport: savedViewport ?? viewport, nodes: savedNodes, edges: nextEdges },
            result.canvas.version,
          );
          nextVersion = persisted.version;
          nextNodes = JSON.parse(persisted.nodes ?? '[]') as Node[];
          nextEdges = JSON.parse(persisted.edges ?? '[]') as Edge[];
        } catch {
          // 连线已在本地补上；落盘失败留给后续编辑触发保存
        }
      }
      acceptDoc({ id: result.canvas.id, version: nextVersion, nodes: nextNodes, edges: nextEdges, viewport: savedViewport ?? viewport });
      const target = result.node.position;
      setFocusViewport({ x: window.innerWidth / 3 - target.x, y: window.innerHeight / 2 - target.y - 135, zoom: 1 });
      setSaveStatus('saved');
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) {
      setSaveStatus('error');
      showToast('error', error instanceof Error ? error.message : '应用失败，请重试');
    } finally { applyingRef.current = false; setApplying(false); }
  };

  /** 底部对话框发送 */
  /** 视频对话发送（IKDMQS 统一草稿绑定）：参考由「画布连线 + 角色库 material」合并推导，
   *  首帧/尾帧逐槽路由 first/last_frame_asset_id 或 *_material_id（同一帧位 asset 与 material 互斥，
   *  materialId 非空即走 material）；普通参考拆 reference_asset_ids + reference_materials；
   *  与 Dock 显示逐项一致（同源推导）。
   *  携带 targetNodeId 时（IKDLQG/IKDMQS）：先等待在途保存并落盘当前画布编辑
   *  （同 IKDLQE 应用预览的保存串行化），保证服务端按连线推导附件时读到最新正文，再携带 target_node_id 提交。
   *  自由模式（工具栏入口无草稿卡）：参考读本地暂存 refs，直接创建生成卡（无 target），发送后关闭面板 */
  const handleDialogSend = async (text: string, opts: VideoGenOptions, promptDoc?: PromptDoc | null) => {
    if (applyingRef.current) return;
    const targetNodeId = videoSeed?.targetNodeId;
    const composedPrompt = composeImageSendPrompt(
      targetNodeId ? textAttachmentsOf(targetNodeId) : undefined,
      text,
      promptDoc,
    );
    if (composedPrompt.length > IMAGE_COMPOSED_PROMPT_LIMIT) {
      showToast('warn', IMAGE_COMPOSED_PROMPT_OVER_LIMIT);
      return;
    }
    if (targetNodeId && currentId) {
      const projectId = currentId;
      applyingRef.current = true;
      setSubmittingNodeId(targetNodeId);
      try {
        if (!(await flushCanvasSave(projectId))) return; // 等待期间项目已切换，中止提交
      } catch (e) {
        // 落盘失败则不提交：否则服务端读到的正文可能缺未防抖落盘的编辑
        showToast('error', '保存失败，请重试');
        console.warn('生成前画布落盘失败:', e);
        return;
      } finally {
        applyingRef.current = false;
        setSubmittingNodeId(null);
      }
    }
    const parameters: VideoJobParameters = {
      prompt: text,
      model_id: opts.modelId,
      aspect_ratio: opts.aspectRatio,
      resolution: opts.resolution,
      duration: opts.duration,
      // IKG0LP：用户选的「是否带音频」。能力位不允许时后端会忽略，不下发给上游。
      generate_audio: opts.generateAudio,
    };
    // 草稿绑定模式按连线+material+文本带入合并推导（IKFM3W §10）；自由模式（工具栏入口无草稿卡）读本地暂存参考
    const freeMode = !videoDraftId;
    const sourceDraftRefs = videoDraftId
      ? mergedVideoRefsWithTextIndex(videoDraftId, edgesRef.current, mediaNodesRef.current, textNodesRef.current)
      : videoFreeRefs;
    const savedStripOrder = videoDraftId ? mediaNodesRef.current.find(node => node.id === videoDraftId)?.data.referenceStripOrder : undefined;
    const draftRefs = {
      ...sourceDraftRefs,
      reference: orderRefStripItems(sourceDraftRefs.reference, videoRefStripKey, Array.isArray(savedStripOrder) ? savedStripOrder : []),
    };
    // 发送成功后关闭面板（IKFXZD 统一口径）；自由模式无草稿卡承载，关闭即丢弃本地暂存参考。
    // 同步置 hidden 标记：否则紧随的画布选中事件会被 handleSelectionChange 当作「命中绑定目标」回弹重开
    const finishSend = (submitted: boolean) => {
      if (!submitted) return;
      videoPanelHiddenRef.current = true;
      setShowBottomDialog(false);
      if (freeMode) setVideoFreeRefs({ reference: [] });
    };
    {
      // IKFM3W §10：文本索引发送校验（失效/帧互斥与业务 API 同口径，不能仅靠按钮禁用）——
      // 帧互斥文案对文本带入场景给出改文本/调模式的指引，优先于通用互斥提示
      if (targetNodeId) {
        const syncError = videoTextIndexSendError(
          targetNodeId,
          edgesRef.current,
          mediaNodesRef.current,
          textNodesRef.current,
        );
        if (syncError) {
          showToast('warn', syncError);
          return;
        }
      }
      // 组合校验与 Dock 同源（videoRefConflict）：能力位由面板按所选模型约束，此处提交防线
      // 传全能力位只校验互斥语义（帧↔参考混用、尾帧配首帧），能力位不支持由服务端 400 兜底
      const conflict = videoRefConflict(draftRefs, {
        firstFrame: true,
        lastFrame: true,
        firstLastFrame: true,
        referenceImage: true,
      });
      if (conflict) {
        showToast('warn', conflict);
        return;
      }
      // 视频参考仅部分模型支持（ADR-0086：读能力行 features.video_reference；旧 seedance-2 前缀特判
      // 作为缺省兜底）：提交防线与面板 UI 禁用同一判定
      if (!supportsVideoReferenceModel(opts.modelId) && draftRefs.reference.some((r) => r.mediaType !== 'image')) {
        showToast('warn', '当前模型不支持视频或音频参考，请更换模型或调整引用');
        return;
      }
      applyingRef.current = true;
      if (targetNodeId) setSubmittingNodeId(targetNodeId);
      try {
        const jobRefs = buildVideoJobReferences(draftRefs);
        const submitted = startGenerationJob(
          'video',
          parameters,
          undefined,
          jobRefs.length > 0 ? { references: jobRefs } : undefined,
          targetNodeId,
          undefined,
          promptDoc ?? undefined,
        );
        finishSend(submitted);
      } finally {
        applyingRef.current = false;
        setSubmittingNodeId(null);
      }
    }
  };

  /** 扩展工具菜单选择：资产库/商品等预留联调入口（音频按钮已改为直开对话框） */
  const handleToolMenuSelect = (menu: string, item: string) => {
    // 暂时隐藏音频菜单分支（音频改为直开对话框），注释保留后续恢复
    // if (menu === 'audio' && item === 'generate') {
    //   setAudioSeed(null);
    //   setShowAudioDialog((prev) => !prev);
    //   setShowBottomDialog(false);
    //   setShowImageDialog(false);
    //   setShowMusicDialog(false);
    //   return;
    // }
    // if (menu === 'audio' && item === 'music') {
    //   setShowMusicDialog((prev) => !prev);
    //   setShowBottomDialog(false);
    //   setShowImageDialog(false);
    //   setShowAudioDialog(false);
    //   return;
    // }
    if (menu === 'assets' && item === 'shared') {
      setAssetsModalDefaultTab(undefined);
      setAssetsModalDefaultFilter('all-assets');
      setShowAssetsModal(true);
      return;
    }
    if (menu === 'assets') {
      // 风格卡/角色卡/物体卡/环境卡/自定义卡 → 生成对应资产卡节点
      handleCreateAssetCard(item as AssetCardKind);
      return;
    }
    if (menu === 'goods' && item === 'create') {
      handleCreateProduct();
      return;
    }
    if (menu === 'goods' && item === 'import') {
      setAssetsModalDefaultTab('goods');
      setAssetsModalDefaultFilter(undefined);
      setShowAssetsModal(true);
      return;
    }
    console.log('Tool menu select:', menu, item);
  };

  /** 新建商品节点（工具栏 商品 → 新建商品） */
  const handleCreateProduct = () => {
    productSeq.current += 1;
    const node: Node = {
      id: newNodeId('product'),
      type: 'productNode',
      position: spawnPosition(),
      data: {
        name: `商品 ${productSeq.current}`,
        detail: '',
        images: [],
        toolMode,
        // 节点内上传素材携带当前项目（运行期注入，不持久化）
        projectId: currentId,
        onDelete: (id: string) => {
          setProductNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onSaveToAssets: (id: string) => handleSaveGoodsToAssets(id),
        onProductChange: (id: string, patch: { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string }) => handleProductChange(id, patch),
        onPickFromCanvas: (id: string) => {
          setPickMode('product');
          setPickTarget('product');
          setPickProductId(id);
        },
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(node.id);
    setProductNodes((prev) => [...prev, node]);
  };

  /** 新建资产卡节点（工具栏 资产库 → 风格卡/角色卡/物体卡/环境卡/自定义卡） */
  const handleCreateAssetCard = (kind: AssetCardKind) => {
    const node: Node = {
      id: newNodeId(`asset-${kind}`),
      type: 'assetNode',
      position: spawnPosition(),
      data: {
        kind,
        toolMode,
        // 节点内上传素材携带当前项目（运行期注入，不持久化）
        projectId: currentId,
        onDelete: (id: string) => {
          setAssetNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onGenerateImage: () => actionsRef.current.openImageDialog(),
        onSaveToAssets: (id: string) => handleSaveCardToAssets(id),
        onCardChange: (id: string, patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null }) => handleCardChange(id, patch),
        onPickFromCanvas: (id: string) => {
          setPickMode('asset');
          setPickTarget('asset');
          setPickAssetId(id);
        },
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(node.id);
    setAssetNodes((prev) => [...prev, node]);
  };

  /* ============ 保存到共享资产 ============ */

  /** 商品内容变更同步（组件内 images/detail 是 local state，需回写 node.data，否则右键保存读到空值） */
  const handleProductChange = (
    nodeId: string,
    patch: { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string },
  ) => {
    setProductNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.images !== undefined ? { images: patch.images } : {}),
                ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
              },
            }
          : n,
      ),
    );
  };

  /** 资产卡内容变更同步（组件内 refs/desc/voice 是 local state，需回写 node.data，否则右键保存读到空值） */
  const handleCardChange = (
    nodeId: string,
    patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null },
  ) => {
    setAssetNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.refs !== undefined ? { initialRefs: patch.refs } : {}),
                ...(patch.desc !== undefined ? { initialDesc: patch.desc } : {}),
                ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
              },
            }
          : n,
      ),
    );
  };

  /** 通用保存请求 + toast 反馈 */
  const doSaveSharedAsset = async (req: SaveSharedAssetRequest, successMsg: string) => {
    console.log('[SaveAssets] doSaveSharedAsset 请求', req);
    try {
      const result = await saveSharedAsset(req);
      console.log('[SaveAssets] 保存结果', result);
      // created:false = 后端判定已存在（幂等/去重），未写入新快照——不能提示「已保存」误导用户
      if (result.created) {
        showToast('success', successMsg);
      } else {
        showToast('warn', '该内容已在共享资产中，未重复创建；如需更新请先删除旧条目');
      }
      return result;
    } catch (e) {
      console.warn('[SaveAssets] 保存失败', e);
      if (!isApiError(e)) showToast('error', '保存失败，请重试');
      return null;
    }
  };

  /** 媒体节点保存到共享资产（画布右键 → 保存到共享资产） */
  const handleSaveMediaToAssets = async (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) {
      console.warn('[SaveAssets] 未找到媒体节点', nodeId);
      showToast('error', '节点不存在');
      return;
    }
    const nd = node.data as Record<string, unknown>;
    const mediaType = (nd.mediaType || nd.type) as 'image' | 'video' | 'audio' | undefined;
    const assetId = nd.assetId ?? nd.asset_id ?? nd.assetID;
    const fileName = (nd.fileName || nd.name) as string | undefined;
    const src = nd.src as string | undefined;
    console.log('[SaveAssets] handleSaveMediaToAssets', { nodeId, assetId, mediaType, src });
    if (!mediaType) {
      console.warn('[SaveAssets] 无 mediaType，无法保存', { nodeId, data: nd });
      showToast('error', '节点类型异常，无法保存');
      return;
    }
    let sourceAssetId = assetId ? String(assetId) : '';
    if (!sourceAssetId && src) {
      // 共享资产加回画布的节点无 assetId：按 URL 反查资产库拿源素材 ID
      try {
        const records = await fetchAllAssets(mediaType);
        const hit = records.find((r) => r.url === src);
        if (hit) sourceAssetId = String(hit.id);
      } catch (err) {
        console.warn('[SaveAssets] 按 URL 反查资产失败', err);
      }
    }
    if (!sourceAssetId) {
      console.warn('[SaveAssets] 无 assetId，无法保存', { nodeId, data: nd });
      showToast('error', '请先上传素材后再保存');
      return;
    }
    const name = fileName || `媒体-${mediaType}`;
    await doSaveSharedAsset(
      {
        assetType: 'media',
        kind: mediaType,
        sourceAssetId,
        name,
      },
      `已保存「${name}」到共享资产`,
    );
  };

  /** 文本节点保存到共享资产（正文为 Markdown 源；存量 html 资产回读时升级） */
  const handleSaveTextToAssets = async (nodeId: string) => {
    const node = textNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const text = unifiedTextNodeText(node.data ?? {});
    if (!text) {
      showToast('error', '文本内容为空，无法保存');
      return;
    }
    await doSaveSharedAsset(
      { assetType: 'text', snapshot: { text } },
      '已保存文本到共享资产',
    );
  };

  /** 资产卡节点保存到共享资产 */
  const handleSaveCardToAssets = async (nodeId: string) => {
    const node = assetNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const data = node.data as {
      kind: AssetCardKind;
      initialRefs?: Array<{ id: string; src: string }>;
      initialDesc?: string;
      voice?: { name: string; src: string };
    };
    // 仅保存可识别的卡片类型
    if (data.kind === 'generation' || !data.kind) {
      showToast('error', '生成卡暂不支持保存到共享资产');
      return;
    }
    const refs = data.initialRefs ?? [];
    const desc = data.initialDesc ?? '';
    if (refs.length === 0 && !desc) {
      showToast('error', '请先为卡片补充参考图或描述');
      return;
    }
    await doSaveSharedAsset(
      {
        assetType: 'card',
        kind: data.kind as 'style' | 'character' | 'object' | 'environment' | 'custom',
        snapshot: {
          referenceImages: refs,
          description: desc,
          ...(data.kind === 'character' && data.voice ? { voice: data.voice } : {}),
        },
      },
      `已保存「${({ style: '风格卡', character: '角色卡', object: '物体卡', environment: '环境卡', custom: '自定义卡' } as const)[data.kind]}」到共享资产`,
    );
  };

  /** 商品节点保存到共享资产 */
  const handleSaveGoodsToAssets = async (nodeId: string) => {
    const node = productNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const data = node.data as { name?: string; detail?: string; images?: Array<{ id: string; src: string; enabled: boolean }> };
    const name = data.name || '商品';
    await doSaveSharedAsset(
      {
        assetType: 'goods',
        snapshot: {
          name,
          detail: data.detail || '',
          images: (data.images || []).map((img) => ({ id: img.id, src: img.src, enabled: img.enabled })),
        },
      },
      `已保存「${name}」到共享资产`,
    );
  };

  /** 共享资产添加回画布：按 assetType 构造对应节点 */
  const handleAddSharedAsset = async (item: SharedAssetView): Promise<boolean> => {
    if (!currentId) return false;
    try {
      switch (item.assetType) {
        case 'media': {
          // 媒体：用共享资产快照 URL 创建节点。
          // 注意：item.id 是 shared_assets 表 ID，不是 assets 源素材 ID，
          // 不能写入 assetId（否则再次保存时 sourceAssetId 无效 → 后端 100202）。
          // 快照不含源素材 ID，故此处不设 assetId，保存时走「请先上传素材」提示。
          const snapshot = item.snapshot as { url: string };
          const kind = item.kind as 'image' | 'video' | 'audio';
          const mediaType = kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image';
          const node: Node = {
            id: newNodeId('media'),
            type: 'mediaNode',
            position: spawnPosition(),
            data: {
              src: snapshot.url,
              fileName: item.name || `资产-${Date.now()}`,
              mediaType,
              toolMode,
              onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
              onDuplicate: (id: string) => actionsRef.current.duplicate(id),
              onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
              onReEdit: (id: string) => actionsRef.current.reEdit(id),
              onGenImage: (id: string) => actionsRef.current.genImage(id),
              onImg2Img: (id: string, file: File) => actionsRef.current.img2img(id, file),
              onGenVideo: (id: string) => actionsRef.current.genVideo(id),
              onGenAudio: (id: string) => actionsRef.current.genAudio(id),
              onEnhanceImage: (id: string) => actionsRef.current.enhanceImage(id),
              onOutpaintImage: (id: string) => actionsRef.current.outpaintImage(id),
              onEraseImage: (id: string) => actionsRef.current.eraseImage(id),
              onCropImage: (id: string) => actionsRef.current.cropImage(id),
              onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
              onDownload: (id: string) => actionsRef.current.download(id),
              onShowDetails: (id: string) => actionsRef.current.showDetails(id),
              onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
              onMediaDims: handleMediaDims,
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setMediaNodes((prev) => [...prev, node]);
          return true;
        }
        case 'card': {
          // 卡片：构造资产卡节点
          const snapshot = item.snapshot as {
            referenceImages: Array<{ id: string; src: string }>;
            description?: string;
            voice?: { name: string; src: string };
          };
          const kind = item.kind as AssetCardKind;
          const node: Node = {
            id: newNodeId('asset'),
            type: 'assetNode',
            position: spawnPosition(),
            data: {
              kind,
              initialRefs: snapshot.referenceImages,
              initialDesc: snapshot.description,
              toolMode,
              // 节点内上传素材携带当前项目（运行期注入，不持久化）
              projectId: currentId,
              onDelete: (id: string) => {
                setAssetNodes((prev) => prev.filter((n) => n.id !== id));
              },
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
              onGenerateImage: () => actionsRef.current.openImageDialog(),
              onSaveToAssets: (id: string) => handleSaveCardToAssets(id),
              onCardChange: (id: string, patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null }) => handleCardChange(id, patch),
              onPickFromCanvas: (id: string) => {
                setPickMode('asset');
                setPickTarget('asset');
                setPickAssetId(id);
              },
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          if (snapshot.voice) {
            (node.data as Record<string, unknown>).voice = snapshot.voice;
          }
          pendingNodeIdsRef.current.add(node.id);
          setAssetNodes((prev) => [...prev, node]);
          return true;
        }
        case 'goods': {
          // 商品：构造商品节点
          const snapshot = item.snapshot as {
            name: string;
            detail?: string;
            images: Array<{ id: string; src: string; enabled?: boolean }>;
          };
          const node: Node = {
            id: newNodeId('product'),
            type: 'productNode',
            position: spawnPosition(),
            data: {
              name: snapshot.name,
              detail: snapshot.detail || '',
              images: snapshot.images.map((img) => ({ ...img, enabled: img.enabled ?? true })),
              toolMode,
              // 节点内上传素材携带当前项目（运行期注入，不持久化）
              projectId: currentId,
              onDelete: (id: string) => {
                setProductNodes((prev) => prev.filter((n) => n.id !== id));
              },
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
              onSaveToAssets: (id: string) => handleSaveGoodsToAssets(id),
              onProductChange: (id: string, patch: { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string }) => handleProductChange(id, patch),
              onPickFromCanvas: (id: string) => {
                setPickMode('product');
                setPickTarget('product');
                setPickProductId(id);
              },
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setProductNodes((prev) => [...prev, node]);
          return true;
        }
        case 'text': {
          // 文本：构造文本节点（存量 html 快照升级为 Markdown 源）
          const snapshot = item.snapshot as { html?: string; text?: string };
          const node: Node = {
            id: newNodeId('text'),
            type: 'textNode',
            position: spawnPosition(),
            data: {
              text: unifiedTextNodeText(snapshot),
              toolMode,
              onDelete: (id: string) => removeCanvasNodes([id]),
              onTextChange: (id: string, text: string) => {
                setTextNodes((prev) =>
                  prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
                );
              },
              onMediaIndexChange: handleMediaIndexChange,
              onDuplicate: (id: string) => actionsRef.current.duplicate(id),
              onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
              onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setTextNodes((prev) => [...prev, node]);
          return true;
        }
        case 'scene': {
          // 场景卡：调用 add-to-project 接口获取 sceneCardId
          showToast('warn', '场景卡需通过场景卡面板添加');
          return false;
        }
        default:
          return false;
      }
    } catch (e) {
      console.warn('添加共享资产到画布失败:', e);
      return false;
    }
  };

  /** 画布媒体节点 → 音频对话框「从画布选择」数据源 */
  const canvasMedia: CanvasPickItem[] = useMemo(
    () =>
      mediaNodes
        .filter((n) => n.data?.src)
        .map((n) => ({
          id: n.id,
          assetId: readAssetId(n.data),
          src: n.data.src as string,
          name: (n.data.fileName as string) || n.id,
          mediaType: (n.data.mediaType as 'image' | 'video' | 'audio') ?? 'image',
        })),
    [mediaNodes],
  );

  /** 底部输入框 @ 菜单：当前画布可引用的图片/视频/音频/文本节点 */
  const atMentionItems: AtMentionItem[] = useMemo(() => {
    const items: AtMentionItem[] = [];
    for (const node of mediaNodes) {
      if (!isConnectableSource(node)) continue;
      const kind = sourceKindOf(node);
      if (kind !== 'image' && kind !== 'video' && kind !== 'audio') continue;
      const data = (node.data ?? {}) as Record<string, unknown>;
      items.push({
        id: node.id,
        kind,
        name: typeof data.fileName === 'string' && data.fileName
          ? data.fileName
          : kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频',
        thumbUrl: typeof data.src === 'string' ? data.src : undefined,
        assetId: readAssetId(data),
      });
    }
    for (const node of textNodes) {
      if (!isConnectableSource(node)) continue;
      const data = (node.data ?? {}) as Record<string, unknown>;
      items.push({
        id: node.id,
        kind: 'text',
        name: typeof data.title === 'string' && data.title ? data.title : '文本节点',
      });
    }
    return items;
  }, [mediaNodes, textNodes]);

  /** 图片面板 @ 选中：图片写入参考，文本建连线成为附件 */
  const handleImageAtMention = (item: AtMentionItem) => {
    imagePanelHiddenRef.current = true;
    if (item.kind === 'text') {
      if (imageDraftId) connectPair(item.id, imageDraftId);
      else showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (item.kind !== 'image' && item.kind !== 'video') {
      showToast('warn', '图片生成不支持该类型参考');
      return;
    }
    if (imageDraftId) {
      if (item.kind !== 'image') {
        showToast('warn', '图片参考仅支持图片素材');
        return;
      }
      // IKFDFT：@ 选取与画布选取同一语义——校验通过立即建连线并自动保存
      if (!validateImageRefConnect(item.id, imageDraftId) || !item.assetId || !item.thumbUrl) return;
      addCanvasEdge(item.id, imageDraftId);
      return;
    }
    setImagePickResult({
      ts: Date.now(),
      files: [{
        id: `node-${item.id}`,
        url: item.thumbUrl ?? '',
        type: item.kind === 'video' ? 'video' : 'image',
        name: item.name,
        assetId: item.assetId,
      }],
    });
  };

  /** 视频面板 @ 选中：图/视频写入参考，文本建连线成为附件 */
  const handleVideoAtMention = (item: AtMentionItem) => {
    if (item.kind === 'text') {
      if (videoDraftId) connectPair(item.id, videoDraftId);
      else showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (item.kind === 'audio') {
      showToast('warn', '视频生成暂不支持音频参考');
      return;
    }
    if (item.kind !== 'image' && item.kind !== 'video') return;
    if (item.disabled) return;
    if (!item.assetId) return;
    const sourceNode = findCanvasNode(item.id);
    const roleCheck = videoDraftId ? videoEdgeRoleFor(videoDraftId) : 'reference';
    const blocked = videoRefSourceError(sourceNode, roleCheck);
    if (blocked) {
      showToast('warn', blocked);
      return;
    }
    const refItem: VideoMediaRef = {
      nodeId: item.id,
      url: item.thumbUrl ?? '',
      name: item.name,
      assetId: item.assetId,
      mediaType: item.kind,
    };
    if (videoDraftId) {
      const role = videoEdgeRoleFor(videoDraftId);
      const draft = mediaNodesRef.current.find((n) => n.id === videoDraftId);
      const mode = (draft?.data as Record<string, unknown> | undefined)?.draftMode;
      if (role === 'reference' && mode === 'keyframe') {
        const refs = mergedVideoMediaRefsOf(videoDraftId, edgesRef.current, mediaNodesRef.current);
        if (refs.first || refs.last) {
          showToast('warn', '首帧和尾帧已指定，请先移除现有帧');
          return;
        }
      }
      // IKFDFW：@ 选取与画布选取同一语义——校验通过立即建连线并自动保存
      if (!validateVideoRefConnect(item.id, videoDraftId, role)) return;
      addCanvasEdge(item.id, videoDraftId, role);
      return;
    }
    const freeMode = videoSeed?.params?.mode;
    const freeRole: VideoRefRole = freeMode === 'keyframe'
      ? (!videoFreeRefs.first ? 'first' : !videoFreeRefs.last ? 'last' : 'reference')
      : 'reference';
    if (freeRole === 'reference' && freeMode === 'keyframe' && (videoFreeRefs.first || videoFreeRefs.last)) {
      showToast('warn', '首帧和尾帧已指定，请先移除现有帧');
      return;
    }
    appendVideoFreeRef(refItem, freeRole);
  };

  /** 音频面板 @ 选中：音频写入参考，文本连入当前目标。 */
  const handleAudioAtMention = (item: AtMentionItem) => {
    if (item.kind === 'text') {
      if (audioDraftId) connectPair(item.id, audioDraftId);
      else showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (item.kind !== 'audio' || !item.thumbUrl) {
      showToast('warn', '音频生成仅支持引用音频素材');
      return;
    }
    // IKFDFZ：@ 选取与画布选取同一语义——草稿校验通过立即建连线并自动保存；自由模式注入面板本地列表
    if (audioDraftId) {
      if (validateAudioRefConnect(item.id, audioDraftId)) {
        addCanvasEdge(item.id, audioDraftId);
      }
      return;
    }
    setAudioPickResult({
      ts: Date.now(),
      item: {
        id: item.id,
        kind: 'audio',
        name: item.name,
        src: item.thumbUrl,
        source: 'canvas',
        assetId: item.assetId,
      },
    });
  };

  /** AI 音乐面板 @ 选中（IKFCKS）：仅音频写入参考（与音频面板同链路，注入 MusicDialog） */
  const handleMusicAtMention = (item: AtMentionItem) => {
    if (item.kind !== 'audio' || !item.thumbUrl) {
      showToast('warn', 'AI 音乐仅支持引用音频素材');
      return;
    }
    setMusicPickResult({
      ts: Date.now(),
      item: {
        id: item.id,
        kind: 'audio',
        name: item.name,
        src: item.thumbUrl,
        source: 'canvas',
        assetId: item.assetId,
      },
    });
  };

  /** 音频对话发送：冻结正文与实际参考素材，创建音频生成任务。
   *  草稿绑定模式（IKDMQT）：先等待在途保存并落盘当前画布编辑（同图片/视频草稿），
   *  再携带 target_node_id 提交；绑定以 audioDraftId 为准（seed 可能残留旧草稿值），
   *  工具条等非草稿入口沿用直接提交 */
  const handleAudioDialogSend = async (text: string, modelId: string, refs: AudioRefItem[], promptDoc?: PromptDoc | null) => {
    if (applyingRef.current || saveBlocked || saveStatus === 'error' || !currentId) return;
    const projectId = currentId;
    const targetNodeId = audioDraftId && audioSeed?.targetNodeId === audioDraftId ? audioDraftId : undefined;
    const composedPrompt = composeImageSendPrompt(
      targetNodeId ? textAttachmentsOf(targetNodeId) : undefined,
      text,
      promptDoc,
    );
    if (composedPrompt.length > IMAGE_COMPOSED_PROMPT_LIMIT) {
      showToast('warn', IMAGE_COMPOSED_PROMPT_OVER_LIMIT);
      return;
    }
    applyingRef.current = true;
    setSubmittingNodeId(targetNodeId ?? null);
    try {
      // IKFM41 §11：草稿绑定模式发送校验（失效/不支持类型与业务 API 同口径，不能仅靠按钮禁用）；
      // 容量与 audio/image 混用由后端 400 权威兜底（面板防线显示对应文案）
      if (targetNodeId) {
        const syncError = audioTextIndexSendError(
          targetNodeId,
          edgesRef.current,
          mediaNodesRef.current,
          textNodesRef.current,
        );
        if (syncError) {
          showToast('warn', syncError);
          return;
        }
      }
      const resolved: AudioRefItem[] = [];
      for (const ref of refs) {
        if (ref.assetId) { resolved.push(ref); continue; }
        const file = ref.file ?? await fetchUrlAsFile(ref.src, ref.name, 'audio/mpeg');
        const uploaded = file ? await uploadFileToAsset(file, 'audio') : null;
        if (!uploaded) { showToast('error', '参考音频上传失败，请重试'); return; }
        resolved.push({ ...ref, assetId: uploaded.asset_id, src: uploaded.url, file: undefined });
      }
      if (targetNodeId) {
        handleAudioDraftParamsChange(targetNodeId, { prompt: text, promptDoc });
        if (!(await flushCanvasSave(projectId))) return;
      }
      // IKFM41 §11：references 类型按实际媒体类型提交（文本带入可为 image；直接/本地上传恒 audio）
      const submitted = startGenerationJob('audio', { prompt: text, model_id: modelId }, undefined,
        resolved.length ? { references: resolved.map(ref => ({ role: 'reference' as const, type: ref.mediaType ?? 'audio', asset_id: String(ref.assetId) })) } : undefined,
        targetNodeId, undefined, promptDoc);
      // IKFXZD：创建请求发出即隐藏面板（绑定与自由同口径；失败分支保持打开）。
      // 置 hidden 标记避免紧随的画布选中事件回弹重开
      if (submitted) { audioPanelHiddenRef.current = true; setShowAudioDialog(false); }
    } catch (e) {
      showToast('error', '保存失败，请重试');
      console.warn('音频生成前准备失败:', e);
    } finally {
      applyingRef.current = false;
      setSubmittingNodeId(null);
    }
  };

  /** AI 音乐对话发送 */
  const handleMusicDialogSend = (
    text: string,
    model: string,
    opts: MusicGenOptions,
    refs: AudioRefItem[],
  ) => {
    console.log('Music dialog send:', text, model, opts, refs);
  };

  /** 上传单个文件到服务器，返回 assetId */
  const uploadFileToAsset = async (file: File, type: 'image' | 'video' | 'audio'): Promise<UploadCompleteData | null> => {
    try {
      const assetType: AssetType = type;
      // 与 uploadAssetFile 同一道门（IKE53Z）：这条路径没走那个封装，但用户看到的后果一样，
      // 所以校验也要一样。少了这一句，从这里传的坏文件照旧一路走到 Agent 读图才被发现。
      const rejection = await checkFileBeforeUpload(file, assetType);
      if (rejection) {
        showToast('warn', rejection);
        return null;
      }
      const presign = await fetchUploadPresign({ type: assetType, mime: file.type, size: file.size });
      await putToPresignedUrl(presign, file);
      // 探测尺寸/时长随 complete 上报（对齐主封装 uploadAssetFile）：漏报会让资产档案缺宽高，
      // 扩图等以资产宽高为权威的功能会被服务端拦下（IKGOQ0 验收修订）；探测失败不阻断上传。
      const meta = await probeMediaMeta(file, assetType).catch(() => ({}));
      const complete = await completeUpload({
        type: assetType,
        mime: file.type,
        size: file.size,
        storage_key: presign.storage_key,
        project_id: currentId || undefined,
        ...meta,
      });
      return complete;
    } catch (e) {
      console.warn('上传文件失败:', e);
      return null;
    }
  };

  /** 从 URL fetch 文件为 Blob → File（用于画布选取时没有原始 File 的场景） */
  const fetchUrlAsFile = async (url: string, name: string, _type: string): Promise<File | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      // 使用 blob 自带的 MIME 类型，而非硬编码
      const mimeType = blob.type || _type || 'image/png';
      return new File([blob], name, { type: mimeType });
    } catch {
      return null;
    }
  };

  /** 收集图片参考 assetId：绑定模式按连线推导（与 Dock 显示同源，含文本带入）；
   *  其余入口沿用面板 files——有 assetId 直用，否则上传取 ID。提交时再组装为 references。 */
  const collectImageInputAssetIds = async (
    targetNodeId: string | undefined,
    files: UploadedFile[],
    useEdgeRefs = false,
  ): Promise<string[]> => {
    if (
      targetNodeId &&
      (useEdgeRefs || textAttachmentsOf(targetNodeId).some(a => findCanvasNode(a.nodeId)?.data?.promptSource) || isImageDraftNode(mediaNodesRef.current.find((n) => n.id === targetNodeId)))
    ) {
      const ids: string[] = [];
      for (const ref of mergedImageRefsOf(
        targetNodeId,
        edgesRef.current,
        [...mediaNodesRef.current, ...textNodesRef.current],
      )) {
        if (!ids.includes(ref.assetId)) ids.push(ref.assetId);
      }
      return ids;
    }
    const ids: string[] = [];
    for (const f of files.filter((item) => item.type === 'image')) {
      // 已有 assetId 直接使用
      if (f.assetId) {
        ids.push(String(f.assetId));
        continue;
      }
      // 有原始 File 对象，直接上传；没有则从 URL 获取（如画布选取的节点）
      let fileToUpload: File | null = f.file ?? null;
      if (!fileToUpload && f.url.startsWith('http')) {
        fileToUpload = await fetchUrlAsFile(f.url, f.name, 'image/*');
      }
      if (fileToUpload) {
        const uploaded = await uploadFileToAsset(fileToUpload, 'image');
        if (uploaded) ids.push(uploaded.asset_id);
      }
    }
    return ids;
  };

  /** 图片对话发送：上传参考图 → 创建图片生成任务。
   *  从图片媒体节点面板发起时（IKDLQF）：先等待在途保存并落盘当前画布编辑
   *  （同 IKDLQE 应用预览的保存串行化），保证服务端按连线推导附件时读到最新正文，再携带 target_node_id 提交 */
  const handleImageDialogSend = async (
    text: string,
    modelId: string,
    size: string,
    ratio: string,
    files: UploadedFile[],
    promptDoc?: PromptDoc | null,
  ) => {
    if (applyingRef.current || saveBlocked) return;
    const targetNodeId = imageSeed?.targetNodeId;
    const projectId = currentId;
    if (!projectId) return;
    // IKFM3S §3：文本索引发送校验（失效/类型/超限与业务 API 同口径，不能仅靠按钮禁用）
    if (targetNodeId) {
      const syncError = imageTextIndexSendError(
        targetNodeId,
        edgesRef.current,
        [...mediaNodesRef.current, ...textNodesRef.current],
        DEFAULT_IMAGE_REFERENCE_LIMIT,
      );
      if (syncError) {
        showToast('warn', syncError);
        return;
      }
    }
    const composedPrompt = composeImageSendPrompt(
      targetNodeId ? textAttachmentsOf(targetNodeId) : undefined,
      text,
      promptDoc,
    );
    if (composedPrompt.length > IMAGE_COMPOSED_PROMPT_LIMIT) {
      showToast('warn', IMAGE_COMPOSED_PROMPT_OVER_LIMIT);
      return;
    }
    applyingRef.current = true;
    setSubmittingNodeId(targetNodeId ?? null);
    try {
      const inputAssetIds = await collectImageInputAssetIds(
        targetNodeId,
        files,
        imageDraftId != null && targetNodeId === imageDraftId,
      );
      if (targetNodeId && !(await flushCanvasSave(projectId))) return;
      if (activeProjectRef.current !== projectId) return;
      const jobRefs = buildImageJobReferences(inputAssetIds);
      const submitted = startGenerationJob('image', {
        prompt: text,
        model_id: modelId,
        aspect_ratio: ratio,
        size,
      }, undefined, jobRefs.length > 0 ? { references: jobRefs } : undefined, targetNodeId, undefined, promptDoc);
      // IKFXZD：创建请求发出即隐藏面板（绑定与自由同口径；失败分支保持打开）。
      // 置 hidden 标记避免紧随的画布选中事件回弹重开
      if (submitted) { imagePanelHiddenRef.current = true; setShowImageDialog(false); }
    } catch (e) {
      showToast('error', '保存或提交失败，请重试');
      console.warn('图片生成前准备失败:', e);
    } finally {
      applyingRef.current = false;
      setSubmittingNodeId(null);
    }
  };

  /** 触发首页生成交接：创建生成任务落节点（等于底部对话框按下发送），幂等——触发后即清 pending */
  const firePendingGen = () => {
    const handoff = pendingGenRef.current;
    if (!handoff) return;
    if (!currentId) return; // 项目未就绪：等 currentId 变化后由 effect 重试
    if (!doc) return; // 文档未加载：此刻 setMediaNodes 会被 doc 水合 effect 清空，等 doc 就绪再触发
    pendingGenRef.current = null;
    const projectId = currentId;
    (async () => {
      const items = handoff.kind === 'image'
        ? handoff.files.map(f => ({ url: f.url, name: f.name, mediaType: 'image' as const, file: f.file, assetId: f.assetId, role: 'reference' as VideoRefRole }))
        : handoff.refs.map((r, i) => ({ url: r.preview, name: r.file?.name ?? `参考${i + 1}`, mediaType: r.type, file: r.file, assetId: r.assetId,
            role: (handoff.mode === 'keyframe' ? (i === 0 ? 'first' : 'last') : 'reference') as VideoRefRole }));
      const references: Array<{
        assetId: string;
        url: string;
        name: string;
        mediaType: 'image' | 'video';
        role: VideoRefRole;
        materialId?: string;
      }> = [];
      try {
        for (const item of items) {
          let assetId = item.assetId == null ? undefined : String(item.assetId);
          let url = item.url;
          if (!assetId) {
            const file = item.file ?? await fetchUrlAsFile(url, item.name, item.mediaType);
            const uploaded = file ? await uploadFileToAsset(file, item.mediaType) : null;
            if (!uploaded) {
              showToast('error', '参考素材上传失败，请重新发送');
              return;
            }
            assetId = uploaded.asset_id;
            url = uploaded.url;
          }
          // 快照仅返回当前项目关联的素材；先关联，避免刷新后参考变成失效占位。
          await linkAssetToProject(projectId, assetId);
          references.push({ assetId, url, name: item.name, mediaType: item.mediaType, role: item.role });
        }
        if (activeProjectRef.current !== projectId) return;
        if (handoff.kind === 'image') {
          const jobRefs = buildImageJobReferences(references.map(r => r.assetId));
          startGenerationJob('image', { prompt: handoff.text, model_id: handoff.modelId, aspect_ratio: handoff.ratio, size: handoff.size },
            undefined, jobRefs.length > 0 ? { references: jobRefs } : undefined, undefined, { references });
        } else {
          startGenerationJob('video', { prompt: handoff.text, model_id: handoff.modelId, aspect_ratio: handoff.aspectRatio,
            resolution: handoff.resolution, duration: handoff.duration,
            // IKG0LP：首页选的「是否带音频」随交接带过来，不能在这里丢
            generate_audio: handoff.generateAudio }, undefined,
            { references: buildVideoJobReferencesFromList(references) },
            undefined, { references, mode: handoff.mode });
        }
      } catch (error) {
        console.warn('首页生成参考准备失败:', error);
        showToast('error', '参考素材准备失败，请重新发送');
      } finally {
        items.forEach(item => { if (item.file) URL.revokeObjectURL(item.url); });
      }
    })();
    // 触发后清导航状态（消费时不提前清，避免 location 变化重跑消费 effect 重复注入对话框）
    navigate(location.pathname + location.search, { replace: true, state: null });
  };
  actionsRef.current.firePendingGen = firePendingGen;

  /** 触发首页 AI视频草稿种子（IKDMQS 统一草稿绑定）：新建视频草稿卡（种子参数写入草稿 data）
   *  并打开绑定面板；幂等——消费后即清 ref。生成任务仍由 firePendingGen 直接创建（生成卡落画布）。 */
  const firePendingVideoDraft = () => {
    const seed = pendingVideoDraftSeedRef.current;
    if (!seed) return;
    if (!currentId) return; // 项目未就绪：等 currentId 变化后由 effect 重试
    if (!doc) return; // 文档未加载：此刻 setMediaNodes 会被 doc 水合 effect 清空，等 doc 就绪再触发
    pendingVideoDraftSeedRef.current = null;
    const nodeId = createVideoDraftCard({
      modelId: seed.modelId,
      ratio: seed.aspectRatio,
      size: seed.resolution,
      duration: seed.duration,
      mode: seed.mode,
      // IKG0LP：首页带的音频选择必须落进草稿卡，否则关掉面板重开就丢了
      generateAudio: seed.generateAudio,
    });
    openVideoDraftDialog(nodeId, seed);
  };
  actionsRef.current.firePendingVideoDraft = firePendingVideoDraft;

  /** 项目/文档就绪后触发首页生成交接（消费时已就绪则已被消费 effect 立即触发，此处幂等重试；
   *  firePendingGen 先建任务卡，firePendingVideoDraft 后建草稿卡并打开绑定面板） */
  useEffect(() => {
    actionsRef.current.firePendingGen();
    actionsRef.current.firePendingVideoDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, doc]);

  return (
    <div className={styles.canvasPage}>
      {/* 顶部工具栏 */}
      <CanvasHeader
        projects={projects}
        currentProjectId={currentId}
        onSelectProject={handleSelect}
        onRenameProject={handleRename}
        onDeleteProject={handleDelete}
        onNewProject={handleNewProject}
        onToggleAgent={() => setShowAgent(!showAgent)}
        onShowLegacyHistory={legacyHistory && legacyHistory.length > 0 ? () => setShowLegacyHistory(true) : undefined}
        hideAgentEntry={showAgent}
      />

      <AssetDetailModal
        asset={assetDetailTarget}
        loading={assetDetailLoading}
        onClose={handleCloseAssetDetail}
      />

      <ConfirmModal
        open={pendingDeleteGroup !== null}
        title="删除组"
        message={`确定要删除该组及组内 ${pendingDeleteGroup?.count ?? 0} 个节点吗？确认后组内全部内容将被删除。`}
        confirmText="确认删除"
        onCancel={() => setPendingDeleteGroup(null)}
        onConfirm={confirmDeleteGroup}
      />

      {/* 画布区域 */}
      <div ref={canvasWrapperRef} className={`${styles.canvasWrapper} ${pickMode === 'image' ? styles.pickingImage : ''}`}>
        {applying && <div role="status" style={{ position: 'fixed', inset: 0, zIndex: 10000, cursor: 'wait' }}>正在保存画布引用…</div>}
      <FlowCanvas
          showMiniMap={showMiniMap}
          toolMode={toolMode}
          extraNodes={uploadedNodes}
          textNodes={textNodes}
          mediaNodes={
            // 擦除编辑态（IKGOTB）：目标源图卡渲染期注入遮罩层 props（不进 state、不持久化，
            // 口径同 pickMarked 渲染期派生注入）——EraseMaskLayer 与工具条共享本页编辑状态
            // 裁切编辑态（IKGW1H）：目标源图卡渲染期注入裁切标记（口径同上，不持久化）；
            //  两编辑态互斥（进入时互相退出），裁切框/面板（IKGW1N）据此识别编辑目标
            // 提交中（IKGUVG）：提交窗口内 genStatus 可能仍是 draft，按 isGeneratingNode 口径
            // 给目标节点注入 submitting 标记，连线剪刀据此判定生成中、不出现
            eraseTargetNodeId || submittingNodeId || cropTargetNodeId
              ? mediaNodes.map((n) => {
                  if (n.id !== eraseTargetNodeId && n.id !== submittingNodeId && n.id !== cropTargetNodeId) return n;
                  const data: Record<string, unknown> = { ...n.data };
                  if (n.id === eraseTargetNodeId) {
                    data.eraseEditing = {
                      ops: eraseMaskState.ops,
                      liveOp: eraseLiveOp,
                      onStrokeStart: handleEraseStrokeStart,
                      onStrokeMove: handleEraseStrokeMove,
                      onStrokeEnd: handleEraseStrokeEnd,
                    };
                  }
                  if (n.id === submittingNodeId) data.submitting = true;
                  if (n.id === cropTargetNodeId) data.cropEditing = true;
                  return { ...n, data };
                })
              : mediaNodes
          }
          productNodes={productNodes}
          assetNodes={assetNodes}
          showEdges={showEdges}
          snapAlignmentEnabled={snapAlignmentOn}
          cropFrame={
            // 裁切框覆盖层（IKGW1N）：编辑态挂载，屏幕空间覆盖层随内容区渲染期换算；
            // 框/比例状态提升在本页，拖拽经 CropFrame 走 imageCrop 纯函数回写
            cropTargetNodeId && cropBounds && cropRect
              ? {
                  bounds: cropBounds,
                  rect: cropRect,
                  preset: cropPreset,
                  minSide: cropMinSide,
                  onRectChange: setCropRect,
                  onDarkAreaClick: exitCropMode,
                }
              : null
          }
          edges={edges}
          onEdgesChange={guardEdgesChange}
          onConnect={handleConnect}
          onConnectStart={(nodeId) => { connectingSourceRef.current = nodeId; }}
          onConnectEnd={handleConnectEnd}
          isValidConnection={isValidCanvasConnection}
          viewport={focusViewport ?? doc?.viewport}
          onViewportChange={setViewport}
          onViewportLive={setLiveViewport}
          registerSpawnPosition={registerSpawnPosition}
          hideZoomControl={showAgent}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={handleCanvasNodeClick}
          onPaneClick={handleCanvasPaneClick}
          onSelectionChange={handleSelectionChange}
          refPickActive={imagePickSessionActive || videoPickSessionActive || audioPickSessionActive || outpaintSessionActive}
          outpaintFrame={
            outpaintSessionActive && outpaintRect
              ? { rect: outpaintRect, expands: outpaintExpands, onExpandChange: setOutpaintExpands }
              : null
          }
          refPickMarkedIds={
            audioPickSessionActive ? audioPickMarkedIds
              : videoPickSessionActive ? videoPickMarkedIds
                : imagePickMarkedIds
          }
          refPickBlockedIds={videoPickSessionActive ? videoPickBlockedIds : undefined}
          selectRequest={selectRequest}
          selectManyRequest={selectManyRequest}
          productPickResult={productPickResult}
          assetPickResult={assetPickResult}
          onDeleteNode={(ids) => {
            // 画布删除统一入口（IKD0JT）：撤销登记 + 悬空边清理；生成中媒体卡片内部转取消流程。
            // 多选删除一次传入全部 id，避免每个节点各入一栈（IKFO73）。
            removeCanvasNodes(ids);
          }}
          onDuplicateSelected={(ids) => ids.forEach((id) => actionsRef.current.duplicate(id))}
          onCopySelected={handleCopySelectedNodes}
          onPasteClipboard={handlePasteClipboard}
          groups={groups}
          onCreateGroup={handleCreateGroup}
          onUngroupGroup={handleUngroup}
          onDeleteGroup={handleDeleteGroup}
          onDownloadGroup={handleDownloadGroupNodes}
          onGroupFrameDragStop={handleGroupFrameDragStop}
          onBringGroupToFront={handleBringGroupToFront}
          onConnectGroupToTarget={handleConnectGroupToTarget}
          onConnectGroupDrop={handleConnectGroupDrop}
          onConnectSourceToGroup={handleConnectSourceToGroup}
          onPaneContextMenu={(pt) => setPaneMenu({ x: pt.clientX, y: pt.clientY })}
        />
        {connectMenu && (
          <ConnectTypeMenu
            x={connectMenu.x}
            y={connectMenu.y}
            enabled={availableGenKinds(connectMenu.sourceIds.map(findCanvasNode).filter((n): n is Node => !!n))}
            onClose={() => setConnectMenu(null)}
            onSelect={applyConnectType}
          />
        )}
        {paneMenu && (
          <CanvasContextMenu
            x={paneMenu.x}
            y={paneMenu.y}
            items={[
              { key: 'upload', label: '上传' },
              {
                key: 'addNode',
                label: '添加节点',
                children: [
                  { key: 'add-text', label: '文本' },
                  { key: 'add-image', label: '图片' },
                  { key: 'add-video', label: '视频' },
                  { key: 'add-audio', label: '音频' },
                ],
              },
              { key: 'undo', label: '撤销', disabled: !canvasHistory.canUndo },
              { key: 'redo', label: '重做', disabled: !canvasHistory.canRedo },
            ]}
            onClose={() => setPaneMenu(null)}
            onSelect={(key) => {
              const screen = { x: paneMenu.x, y: paneMenu.y };
              const flow = spawnNearScreen(screen);
              setPaneMenu(null);
              if (key === 'upload') {
                paneUploadPosRef.current = flow;
                paneUploadRef.current?.click();
              }               else if (key === 'add-text') handleAddTextNode(flow);
              else if (key === 'add-image') {
                if (!canOpenEditor()) return;
                openImageDraftDialog(createImageDraftCard(flow));
              } else if (key === 'add-video') {
                if (!canOpenEditor()) return;
                openVideoDraftDialog(createVideoDraftCard(undefined, flow));
              } else if (key === 'add-audio') {
                if (!canOpenEditor()) return;
                openAudioDraftDialog(createAudioDraftCard(flow));
              }
              else if (key === 'undo') canvasHistory.undo();
              else if (key === 'redo') canvasHistory.redo();
            }}
          />
        )}
        <input
          ref={paneUploadRef}
          type="file"
          hidden
          multiple
          accept="image/*,video/*,audio/*"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            const pos = paneUploadPosRef.current;
            files.forEach((file, index) => {
              void placeFileOnCanvas(file, {
                position: pos ? { x: pos.x + index * 24, y: pos.y + index * 24 } : undefined,
              }).catch((err) => {
                showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
              });
            });
            e.target.value = '';
            paneUploadPosRef.current = null;
          }}
        />

        {/* 左侧工具栏 */}
        <CanvasToolbar
          mode={toolMode}
          onModeChange={setToolMode}
          onUploadFile={handleUploadFile}
          onOpenAssetsPicker={() => openAssetsPicker('toolbar')}
          onToggleVideoDialog={() => {
            // 左侧工具栏：先建视频草稿卡，再打开跟随输入框；发送在原卡生成
            if (!canOpenEditor()) return;
            setPickMode(null);
            setPickTarget(null);
            setPickRefRole(null);
            const draftId = createVideoDraftCard();
            openVideoDraftDialog(draftId);
          }}
          onToggleImageDialog={() => {
            // 左侧工具栏：先建图片草稿卡，再打开跟随输入框；发送在原卡生成
            if (!canOpenEditor()) return;
            setPickMode(null);
            setPickTarget(null);
            setImagePickResult(null);
            const draftId = createImageDraftCard();
            openImageDraftDialog(draftId);
          }}
          onToggleAudioDialog={() => {
            // 左侧工具栏：先建音频草稿卡，再打开跟随输入框；发送在原卡生成
            if (!canOpenEditor()) return;
            setPickMode(null);
            setPickTarget(null);
            const draftId = createAudioDraftCard();
            openAudioDraftDialog(draftId);
          }}
          showVideoDialog={showBottomDialog}
          showImageDialog={showImageDialog}
          showAudioDialog={showAudioDialog}
          onAddTextNode={() => handleAddTextNode()}
          onMenuSelect={handleToolMenuSelect}
        />

        {/* 左下角：返回首页 + 小地图切换 */}
        <div className={styles.bottomLeftActions}>
          <button
            className={styles.backHomeBtn}
            onClick={async () => { if (await ensureSavedBeforeProjectSwitch()) navigate('/'); }}
          >
            <ArrowLeft size={14} strokeWidth={2} />
            <span>返回首页</span>
          </button>
          <button
            className={`${styles.mapBtn} ${showMiniMap ? styles.mapBtnActive : ''}`}
            onClick={() => setShowMiniMap(!showMiniMap)}
            title={showMiniMap ? '隐藏小地图' : '显示小地图'}
          >
            <MapIcon size={14} strokeWidth={2} />
          </button>
          <button
            className={`${styles.mapBtn} ${showEdges ? styles.mapBtnActive : ''}`}
            onClick={() => setShowEdges(!showEdges)}
            title={showEdges ? '隐藏连线' : '显示连线'}
          >
            {showEdges ? <Link size={14} strokeWidth={2} /> : <Link2Off size={14} strokeWidth={2} />}
          </button>
          <button
            className={`${styles.mapBtn} ${snapAlignmentOn ? styles.mapBtnActive : ''}`}
            onClick={() => {
              // IKGGCT T3：切换吸附开关并全局持久化（Alt 临时禁用是独立通道，不受此影响）
              const next = !snapAlignmentOn;
              setSnapAlignmentOn(next);
              persistSnapAlignmentEnabled(next);
            }}
            title={snapAlignmentOn ? '关闭对齐吸附' : '开启对齐吸附'}
          >
            <Magnet size={14} strokeWidth={2} />
          </button>
          {saveStatus !== 'idle' && (
            // IKFYH6：保存状态与重试是面板编辑落盘链路的自有 UI，归「面板领土」——点重试保存不关面板
            <span
              data-gen-panel-territory
              className={`${styles.saveStatus} ${saveStatus === 'error' ? styles.saveStatusError : ''}`}
            >
              {saveStatus === 'saving' && '保存中…'}
              {saveStatus === 'saved' && `已保存 ${savedAt}`}
              {saveStatus === 'error' && <>
                保存失败，请重试 <button type="button" onClick={handleRetryCanvasSave}>重试保存</button>
              </>}
            </span>
          )}
        </div>

        {/* 底部视频对话框（IKDMQS 统一草稿绑定；工具栏入口先建草稿卡再开跟随面板） */}
        {showBottomDialog && (
          <BottomDialog
            stripOrder={refStripOrderOf(videoDraftId)}
            onStripOrderChange={videoDraftId ? keys => handleRefStripOrderChange(videoDraftId, keys) : undefined}
            onRemoveAttachment={id => removeTextAttachment(setVideoSeed, videoDraftId ?? videoSeed?.targetNodeId, id)}
            pendingPlanSyncs={pendingPlanSyncs(videoSeed?.targetNodeId)}
            onSyncPlan={id => syncPlanToTarget(id, videoSeed?.targetNodeId)}
            syncingPlan={applying}
            planReferenceError={planReferenceErrors.video}
            planIndices={planReferenceErrors.videoIndices}
            textIndexError={videoDraftTextIndexError ?? undefined}
            onLocateTextSource={locateTextSource}
            key={videoSeed?.ts ?? 0}
            initialText={videoSeed?.text}
            initialDoc={videoSeed?.doc ?? null}
            initialParams={videoSeed?.params}
            attachments={videoDraftAttachments}
            onReorderAttachments={
              videoSeed?.targetNodeId
                ? (ids) => handleReorderAttachments(videoSeed.targetNodeId!, ids)
                : undefined
            }
            onClose={closeVideoDialog}
            onSend={handleDialogSend}
            onPickFromCanvas={(kind, role) => { endImagePickSession(); setPickMode(kind); setPickTarget('video'); setPickRefRole(role ?? null); setVideoPickSession(videoDraftId ?? null); }}
            onPickFromAssets={(kind, role) => {
              setVideoAssetPickRole(role ?? 'reference');
              setVideoAssetPickKind(kind);
              openAssetsPicker('videoDraft');
            }}
            pickMode={pickTarget === 'video' && pickMode !== 'audio' && pickMode !== 'product' && pickMode !== 'asset' ? pickMode : null}
            pickLocked={videoPickSessionActive}
            videoDraftBinding={
              videoDraftId
                ? {
                    submitting: submittingNodeId === videoDraftId,
                    restoreExisting: hasGenerationRecord(mediaNodes.find(n => n.id === videoDraftId)),
                    saveFailed: saveBlocked || saveStatus === 'error',
                    status: (mediaNodes.find((n) => n.id === videoDraftId)?.data as Record<string, unknown> | undefined)
                      ?.genStatus as MediaGenStatus | undefined,
                    onParamsChange: (patch) => handleVideoDraftParamsChange(videoDraftId, patch),
                  }
                : {
                    // 自由模式：参数仅存面板本地状态，无草稿可写回
                    saveFailed: saveBlocked || saveStatus === 'error',
                    onParamsChange: () => {},
                  }
            }
            videoMediaRefs={videoDraftId ? (videoDraftMediaRefs ?? { reference: [] }) : videoFreeRefsView}
            onRemoveVideoRef={videoDraftId ? ((nodeId) => removeRefEdges(videoDraftId, nodeId)) : removeVideoFreeRef}
            onAssignRefRoles={videoDraftId ? ((assignments) => assignVideoRefRoles(videoDraftId, assignments)) : assignVideoFreeRefRoles}
            onRemoveMaterialRef={videoDraftId ? ((materialId) => removeDraftMaterialRef(videoDraftId, materialId)) : removeVideoFreeRef}
            onReorderMediaRefs={videoDraftId ? ((keys) => handleReorderVideoMediaRefs(videoDraftId, keys)) : reorderVideoFreeRefs}
            onToast={(type, msg) => showToast(type, msg)}
            mentionItems={atMentionItems.filter((item) => item.id !== videoDraftId).map((item) => {
              const node = mediaNodes.find((n) => n.id === item.id);
              const failed = ((node?.data ?? {}) as Record<string, unknown>).complianceFailed === true;
              return failed ? { ...item, disabled: true } : item;
            })}
            onMentionCanvas={handleVideoAtMention}
            followAnchor={videoDraftId ? followAnchor : null}
            enabledModes={videoFollowModes}
          />
        )}
        {/* 底部图片对话框 */}
        {showImageDialog && (
          <ImageDialog
            stripOrder={refStripOrderOf(imageDraftId)}
            onStripOrderChange={imageDraftId ? keys => handleRefStripOrderChange(imageDraftId, keys) : undefined}
            key={imageSeed?.ts ?? 0}
            initialText={imageSeed?.text}
            initialDoc={imageSeed?.promptDoc ?? null}
            initialFiles={imageSeedView?.files}
            initialParams={imageSeed?.params}
            attachments={imageDraftId ? imageDraftAttachments : imageSeedView?.attachments}
            mediaRefs={imageDraftId ? imageDraftMediaRefs : undefined}
            invalidMediaRefs={invalidImageMediaRefs}
            onRemoveAttachment={id => removeTextAttachment(setImageSeed, imageDraftId ?? imageSeed?.targetNodeId, id)}
            pendingPlanSyncs={pendingPlanSyncs(imageSeed?.targetNodeId)}
            onSyncPlan={id => syncPlanToTarget(id, imageSeed?.targetNodeId)}
            syncingPlan={applying}
            planReferenceError={planReferenceErrors.image}
            onRemoveMediaRef={
              imageDraftId ? (nodeId) => removeRefEdges(imageDraftId, nodeId) : undefined
            }
            onLocateTextSource={locateTextSource}
            textIndexError={imageDraftTextIndexError ?? undefined}
            onReorderMediaRefs={
              imageDraftId ? ((ids) => reorderTargetEdges(imageDraftId, ids)) : undefined
            }
            onReorderAttachments={
              imageSeed?.targetNodeId
                ? (ids) => handleReorderAttachments(imageSeed.targetNodeId!, ids)
                : undefined
            }
            draftBinding={
              imageDraftId
                ? {
                    submitting: submittingNodeId === imageDraftId,
                    restoreExisting: hasGenerationRecord(mediaNodes.find(n => n.id === imageDraftId)),
                    saveFailed: saveBlocked || saveStatus === 'error',
                    status: (mediaNodes.find((n) => n.id === imageDraftId)?.data as Record<string, unknown> | undefined)
                      ?.genStatus as MediaGenStatus | undefined,
                    onParamsChange: (patch) => handleImageDraftParamsChange(imageDraftId, patch),
                  }
                : undefined
            }
            onClose={closeImageDialog}
            onSend={handleImageDialogSend}
            onPickFromCanvas={() => { setPickMode('image'); setPickTarget('image'); setImagePickSession(imageDraftId); }}
            onPickFromAssets={() => openAssetsPicker('imageDialog')}
            pickMode={pickMode === 'image'}
            externalPick={imagePickResult}
            onExternalPickConsumed={() => setImagePickResult(null)}
            onOpenCharacterLibrary={() => { setCharacterLibraryTarget('image'); setShowCharacterLibrary(true); }}
            onToast={(type, msg) => showToast(type, msg)}
            mentionItems={atMentionItems.filter((item) => item.id !== imageDraftId)}
            onMentionCanvas={handleImageAtMention}
            currentNodes={mediaNodes}
            followAnchor={imageDraftId ? followAnchor : null}
          />
        )}
        {/* 高清放大参数面板（IKGM9O）：绑定高清卡，发送后自动关闭，生成中只读冻结 */}
        {showEnhanceDialog && (
          <ImageEnhanceDialog
            key={enhanceSeed?.ts ?? 0}
            onClose={closeEnhanceDialog}
            onSend={handleEnhanceDialogSend}
            sourceDims={enhanceSeed?.sourceDims ?? null}
            initialParams={enhanceSeed?.initialParams ?? null}
            generating={
              ((mediaNodes.find((n) => n.id === enhanceDraftId)?.data ?? {}) as Record<string, unknown>)
                ?.genStatus === 'generating'
            }
            submitting={submittingNodeId === enhanceDraftId}
            followAnchor={enhanceDraftId ? enhanceFollowAnchor : null}
          />
        )}
        {/* 扩图参数面板（IKGOQX 骨架 / IKGOR6 发送闭环）：绑定源图卡，发送建结果卡后退出扩图模式 */}
        {outpaintSessionActive && outpaintRect && (
          <OutpaintDialog
            onClose={endOutpaintSession}
            sourceSize={{ width: outpaintRect.width, height: outpaintRect.height }}
            expands={outpaintExpands}
            onPresetSelect={handleOutpaintPresetSelect}
            onSend={handleOutpaintDialogSend}
            followAnchor={outpaintFollowAnchor}
          />
        )}
        {showTextGenDialog && textGenDraftId && (
          <TextGenDialog
            key={textGenDraftId}
            initialText={typeof (textNodes.find((n) => n.id === textGenDraftId)?.data as Record<string, unknown> | undefined)?.prompt === 'string'
              ? String((textNodes.find((n) => n.id === textGenDraftId)?.data as Record<string, unknown>).prompt)
              : ''}
            attachments={textAttachmentsOf(textGenDraftId)}
            followAnchor={followAnchor}
            onClose={closeTextGenDialog}
            onSend={handleTextGenSend}
            onParamsChange={(patch) => {
              setTextNodes((prev) =>
                prev.map((n) =>
                  n.id === textGenDraftId
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
                          ...(patch.modelId !== undefined ? { draftModelId: patch.modelId } : {}),
                        },
                      }
                    : n,
                ),
              );
            }}
          />
        )}

        {/* 节点选取模式提示条（IKFE8U：视频面板与图片面板统一「从节点添加素材」文案；
            IKFR4X 图片持续会话：文案改为持续语义并提供「完成选取」退出入口；
            IKFR4Y 视频持续会话同款退出入口，首尾帧入口为槽位连续替换语义） */}
        {pickMode && pickTarget && (showImageDialog || showBottomDialog || showAudioDialog || pickMode === 'product' || pickMode === 'asset') && (
          imagePickSessionActive ? (
            <div className={`${styles.pickHint} ${styles.pickHintSession}`} data-gen-panel-territory>
              <span>从节点添加素材：连续点击画布中的图片节点带入参考；点击空白、按 Esc 或点「完成选取」结束选取</span>
              <button type="button" className={styles.pickHintFinish} onClick={endImagePickSession}>完成选取</button>
            </div>
          ) : videoPickSessionActive ? (
            <div className={`${styles.pickHint} ${styles.pickHintSession}`} data-gen-panel-territory>
              <span>{(pickRefRole === 'first' || pickRefRole === 'last')
                ? '从节点添加素材：连续点击画布中的图片节点替换当前首帧/尾帧槽位；点击空白、按 Esc 或点「完成选取」结束选取'
                : '从节点添加素材：连续点击画布中的图片、视频或音频节点带入参考；点击空白、按 Esc 或点「完成选取」结束选取'}</span>
              <button type="button" className={styles.pickHintFinish} onClick={endVideoPickSession}>完成选取</button>
            </div>
          ) : audioPickSessionActive ? (
            <div className={`${styles.pickHint} ${styles.pickHintSession}`} data-gen-panel-territory>
              <span>从节点添加素材：连续点击画布中的音频节点或文本卡带入参考；点击空白、按 Esc 或点「完成选取」结束选取</span>
              <button type="button" className={styles.pickHintFinish} onClick={endAudioPickSession}>完成选取</button>
            </div>
          ) : (
          <div className={styles.pickHint} data-gen-panel-territory>
            {pickMode === 'image' && ((pickRefRole === 'first' || pickRefRole === 'last')
              ? '从节点添加素材：点击画布中的图片节点带入首帧/尾帧，点击空白处取消'
              : '从节点添加素材：点击画布中的图片节点或方案节点，带入完整参考，点击空白处取消')}
            {pickMode === 'video' && '从节点添加素材：点击画布中的图片、视频或音频节点带入参考，点击空白处取消'}
            {pickMode === 'audio' && '到节点选择：点击画布中的音频节点带入参考音频，点击文本卡带入创作上下文，点击空白处取消'}
            {pickMode === 'product' && '到节点选择：点击画布中的图片节点带入商品图，点击空白处取消'}
            {pickMode === 'asset' && '到节点选择：点击画布中的图片节点或方案节点，带入完整参考，点击空白处取消'}
          </div>
          )
        )}

        {/* 擦除编辑态工具条+发送条（IKGOTB，替换 IKGOT7 占位条）：工具/笔刷/撤销重做/清除文字/发送；
            棋盘格遮罩层经 MediaNode 的 eraseEditing 注入渲染在源图卡上；四退出
            （X/Esc/点其他卡/点空白）由本页承载，未发送退出丢弃遮罩不建卡不提交 */}
        {eraseTargetNodeId && (
          <ImageEraseDialog
            onClose={exitEraseEditing}
            onSendTextErase={handleEraseDialogSendText}
            onSendMask={handleEraseDialogSendMask}
            tool={eraseTool}
            onToolChange={setEraseTool}
            brushRadius={eraseBrushRadius}
            onBrushRadiusChange={setEraseBrushRadius}
            canUndo={canUndoMaskEdit(eraseMaskState)}
            canRedo={canRedoMaskEdit(eraseMaskState)}
            onUndo={handleEraseUndo}
            onRedo={handleEraseRedo}
            hasPaint={eraseHasPaint}
            maskSpace={eraseMaskSpace}
            ops={eraseMaskState.ops}
            submitting={eraseSubmitting}
            toolbarAnchor={eraseToolbarAnchor}
            sendBarAnchor={eraseSendBarAnchor}
          />
        )}

        {/* 裁切面板（IKGW1N）：随 cropTargetNodeId 条件渲染（编辑态面板，不进 dismissAllGenPanels
            名单，根元素打 data-gen-panel-territory）；取消绑 exitCropMode（四退出之一）；
            确认绑 handleCropConfirm（IKGW1S：裁切执行→上传→建卡闭环） */}
        {cropTargetNodeId && (
          <CropDialog
            preset={cropPreset}
            onPresetChange={handleCropPresetChange}
            onConfirm={handleCropConfirm}
            onClose={exitCropMode}
            followAnchor={cropPanelAnchor}
          />
        )}

        {/* 底部音频对话框 */}
        {showAudioDialog && (
          <AudioDialog
            stripOrder={refStripOrderOf(audioDraftId)}
            onStripOrderChange={audioDraftId ? keys => handleRefStripOrderChange(audioDraftId, keys) : undefined}
            key={audioSeed?.ts ?? 0}
            initialText={audioSeed?.text}
            initialDoc={audioSeed?.doc}
            initialRefs={audioSeed?.refs}
            initialModelId={audioSeed?.modelId}
            draftBinding={
              audioDraftId
                ? {
                    saveFailed: saveBlocked || saveStatus === 'error',
                    submitting: submittingNodeId === audioDraftId,
                    restoreExisting: hasGenerationRecord(mediaNodes.find(n => n.id === audioDraftId)),
                    status: (mediaNodes.find((n) => n.id === audioDraftId)?.data as Record<string, unknown> | undefined)
                      ?.genStatus as MediaGenStatus | undefined,
                    onParamsChange: (patch) => handleAudioDraftParamsChange(audioDraftId, patch),
                  }
                : undefined
            }
            onClose={closeAudioDialog}
            onSend={handleAudioDialogSend}
            onToast={(type, msg) => showToast(type, msg)}
            canvasMedia={canvasMedia}
            onPickFromCanvas={() => { endImagePickSession(); endVideoPickSession(); setPickMode('audio'); setPickTarget('audio'); setAudioPickSession(audioDraftId ?? null); }}
            onPickFromAssets={() => {
              audioPanelHiddenRef.current = true; // 来源切换不因刚选过的素材节点而隐藏目标面板
              setPickMode(null); setPickTarget(null);
              setAudioAssetPickTarget({ nodeId: audioDraftId, seed: audioSeed?.ts });
              openAssetsPicker('audioDialog');
            }}
            externalAssetPick={audioAssetPickResult}
            onAssetPickConsumed={() => setAudioAssetPickResult(null)}
            externalPick={audioPickResult}
            pickMode={pickMode === 'audio'}
            draftRefs={audioDraftRefItems}
            draftRefInvalid={audioDraftMediaRefs?.invalid.length ? audioDraftMediaRefs.invalid : undefined}
            textIndexError={audioDraftTextIndexError ?? undefined}
            onLocateTextSource={locateTextSource}
            onRemoveDraftRef={audioDraftId ? ((nodeId) => removeRefEdges(audioDraftId, nodeId)) : undefined}
            onAddCanvasRef={audioDraftId ? handleAddAudioCanvasRef : undefined}
            mentionItems={atMentionItems.filter((item) => item.id !== audioDraftId)}
            onMentionCanvas={handleAudioAtMention}
            followAnchor={audioDraftId ? followAnchor : null}
            attachments={audioDraftAttachments}
            onRemoveAttachment={(id) => removePlanAttachment(audioDraftId ?? undefined, id)}
            onReorderAttachments={
              audioDraftId ? ((ids) => handleReorderAttachments(audioDraftId, ids)) : undefined
            }
            onSwitchToMusic={() => {
              // 切走即结束草稿绑定并重置 seed：切回音频面板是干净的非草稿状态
              setAudioSeed({ ts: Date.now() });
              setAudioDraftId(null);
              setShowAudioDialog(false);
              setShowMusicDialog(true);
            }}
          />
        )}

        {/* 底部 AI 音乐对话框 */}
        {showMusicDialog && (
          <MusicDialog
            onClose={closeMusicDialog}
            onSend={handleMusicDialogSend}
            canvasMedia={canvasMedia}
            mentionItems={atMentionItems}
            onMentionCanvas={handleMusicAtMention}
            externalPick={musicPickResult}
            onSwitchToAudio={() => {
              setShowMusicDialog(false);
              setShowAudioDialog(true);
            }}
          />
        )}
      </div>

      {/* Agent 对话框 */}
      {(showAgent || agentOpened) && (
        <AgentPanel
          key={currentId}
          open={showAgent}
          onClose={() => setShowAgent(false)}
          initialInput={agentContext?.text ?? ''}
          initialCardLabel={agentContext?.label}
          inputVersion={agentContext?.ts ?? 0}
          projectId={currentId || undefined}
          onApplyToDock={handleAgentCardApply}
          appliedCardIds={appliedCardIds}
          initialSkillId={agentContext?.skillId ?? ''}
          initialSkillName={agentContext?.skillName ?? ''}
          mediaBlocks={agentContext?.mediaBlocks}
          candidateBlocks={agentCandidate}
          onPrepareCandidate={confirmAgentCandidate}
          onCancelCandidate={cancelAgentCandidate}
          onPlaceFileOnCanvas={placeFileOnCanvas}
          onPickFromAssets={() => openAssetsPicker('agentPanel')}
          externalAssetPicks={agentAssetPicks}
        />
      )}

      {/* 资产库选择弹框（按入口来源过滤类型：工具栏/Agent 面板/dock 对话框） */}
      {showAssetsPicker && (
        <AssetsPickerModal
          onClose={() => setShowAssetsPicker(false)}
          onSelect={handleAssetsPickerSelect}
          mediaTypes={
            assetsPickerTarget === 'imageDialog'
              ? [...PANEL_REF_MEDIA_TYPES.image.types]
              : assetsPickerTarget === 'audioDialog'
                ? [...PANEL_REF_MEDIA_TYPES.audio.types]
              : assetsPickerTarget === 'videoDraft'
                ? videoAssetPickRole === 'first' || videoAssetPickRole === 'last'
                  ? ['image']
                  : videoAssetPickKind === 'image'
                    ? [...PANEL_REF_MEDIA_TYPES.videoText2Video.types]
                    : [...PANEL_REF_MEDIA_TYPES.videoAll.types]
                : assetsPickerTarget === 'agentPanel'
                  ? ['image', 'video']
                  : undefined
          }
          confirmText={assetsPickerTarget === 'toolbar' ? '插入画布' : '确定'}
          showLivenessTab={assetsPickerTarget === 'toolbar' || assetsPickerTarget === 'videoDraft'}
          showCharacterTab={assetsPickerTarget === 'videoDraft'}
        />
      )}

      {/* 共享资产弹框 */}
      {showAssetsModal && (
        <SharedAssetsModal
          onClose={() => setShowAssetsModal(false)}
          projectId={currentId}
          onAddItem={(item) => handleAddSharedAsset(item).then((ok) => {
            if (ok) setShowAssetsModal(false);
            return ok;
          })}
          onToast={showToast}
          defaultTab={assetsModalDefaultTab}
          defaultCardFilter={assetsModalDefaultFilter as any}
        />
      )}

      {/* 角色库弹框 */}
      {showCharacterLibrary && (
        <CharacterLibraryModal
          onClose={() => {
            setShowCharacterLibrary(false);
            setCharacterLibraryTarget(null);
          }}
          onSelectAssets={(assets: MaterialAsset[]) => {
            // 虚拟/真人人像库统一多选确认后注入到对应对话框
            // 素材库 asset- 前缀 ID 在发送时走 referenceMaterials（后端转 asset:// URI 引用）
            // IKFE8U：视频面板角色库入口退役（统一入口两项菜单），仅保留图片/资产卡注入路径；
            // 视频草稿存量 draftMaterialRefs 仍随草稿 data 展示、移除与提交
            const ts = Date.now();
            if (characterLibraryTarget === 'image') {
              // 图片对话框：批量注入参考图
              const images = assets
                .filter((a) => a.AssetType === 'Image')
                .map((a) => ({
                  id: `char-${ts}-${a.Id}`,
                  url: a.URL,
                  type: 'image' as const,
                  name: `角色-${a.Name}`,
                  assetId: a.Id,
                }));
              if (images.length > 0) setImagePickResult({ ts, files: images });
            } else if (characterLibraryTarget === 'asset') {
              // 资产卡添加参考图（单张注入）
              const image = assets.find((a) => a.AssetType === 'Image');
              if (image) {
                setAssetPickResult({
                  ts,
                  assetId: pickAssetId ?? '',
                  ref: {
                    id: `char-${ts}`,
                    src: image.URL,
                    type: 'image',
                    assetId: image.Id,
                  },
                });
              }
            }
          }}
        />
      )}

      {/* 旧生成卡迁移历史（IKDLQK，只读） */}
      <LegacyHistoryModal
        open={showLegacyHistory}
        items={legacyHistory ?? []}
        onClose={() => setShowLegacyHistory(false)}
      />

      {/* Toast 提示 */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 20px',
          borderRadius: '8px',
          background: toast.type === 'success' ? '#1a3a1a' : toast.type === 'error' ? '#3a1a1a' : '#3a3a1a',
          color: '#fff',
          fontSize: '14px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          border: `1px solid ${toast.type === 'success' ? '#2d7a2d' : toast.type === 'error' ? '#7a2d2d' : '#7a5a2d'}`,
          animation: 'toastIn 0.2s ease',
        }}>
          {toast.type === 'success' && <CheckCircle size={16} />}
          {toast.type === 'error' && <XCircle size={16} />}
          {toast.type === 'warn' && <AlertTriangle size={16} />}
          <span>{toast.msg}</span>
        </div>
      )}
      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      `}</style>
    </div>
  );
}

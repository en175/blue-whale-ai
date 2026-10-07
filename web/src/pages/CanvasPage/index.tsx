/* ============================================
 * CanvasPage 画布编辑页：节点/连线/工具栏编排
 * ============================================ */
import { releaseRemovedPromptSources, promptBindingList, promptBindingsSchema, type PromptBinding } from '@lib/contracts/prompt-target';
import { promptMentionSchema, validPromptMentions } from '@lib/contracts/prompt-preview';
import { unifiedTextNodeText } from '@lib/contracts/text-node-markdown';
import { replaceImageMentionsWithAssetTokens, type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { toast as globalToast } from 'sonner';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { frameInterpolationRecoveryOptions } from '@/api/frameInterpolationRecovery';
import { ArrowLeft, Map as MapIcon, Link, Link2Off, CheckCircle, XCircle, AlertTriangle, Magnet } from 'lucide-react';
import { newNodeId } from './nodeId';
import { nextDraftPosition, type SpawnBox } from './draftSpawn';
import { computeFollowAnchor, enabledVideoFollowModes, firstEnabledVideoMode } from './followDialog';
import { imageMediaRefsOf, imageRefSourceError, isImageDraftNode, isMaterialLibraryId, readAssetId, baseSourceError } from './mediaRefs';
import { appliedPlanAssetIds, dropReversedTextIndexEdges, replaceMissingPlanMediaNodes, textIndexEdgesForAppliedPlan } from './planApplyEdges';
import { mergedImageRefsOf, imageTextIndexSendError, mergedVideoRefsWithTextIndex, videoTextIndexSendError, mergedAudioRefsWithTextIndex, audioTextIndexSendError, nextUsedInputState, DEFAULT_IMAGE_REFERENCE_LIMIT } from './textIndexSync';
import { audioRefItemMediaTypeOf, audioRefMediaTypeOf, audioRefSourceError, audioMergedRefsError, checkAddAudioRef, isAudioDraftNode } from './audioMediaRefs';
import { PANEL_REF_MEDIA_TYPES, panelCanvasRefError } from './refSourceTypes';
import { cancelledTerminalAction, hasGenerationRecord, isInPlaceRegenTarget } from './mediaReEdit';
import {
  asVideoRefMediaType,
  isLibraryOnlyVideoRef,
  isVideoDraftNode,
  readRefRole,
  readDraftMaterialRefs,
  mergedVideoMediaRefsOf,
  videoRefConflict,
  videoRefSourceError,
  checkAddVideoRef,
  incomingVideoRefOccupied,
  occupiedVideoRefIds,
  videoRefIdentityIds,
  type VideoMediaRef,
  type VideoMediaRefs,
  type VideoRefCapabilities,
  type VideoRefRole,
} from './videoMediaRefs';
import { AssetImageRefLimitProvider, videoRefCapsOfModel } from './modelCaps';
import { imageReferenceMaxOf, supportsAudioReferenceOf, supportsVideoReferenceOf } from '@/lib/model-reference-limits';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { refOverflowToast } from '@/utils/ref-overflow';
import { VIDEO_REFERENCE_NOT_APPROVED_MESSAGE, compliancePatchFromMaterialStatus, isUnapprovedVideoMaterialStatus } from '@/lib/video-reference-compliance';
import { isTaskTypeParamConstraintCode } from '@/lib/video-reference-hints';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { downloadFileNameOf, resolveDownloadMime } from './components/cardName';
import type { MediaGenStatus, MediaNodeData } from './components/MediaNode';
import { sampleDeadlineExpired } from './components/MediaNode/mediaPlayback';
import MediaNodeToolbar from './components/MediaNode/Toolbar';
import NodeFollowToolbar from './components/NodeFollowToolbar';
import AssetCardToolbar from './components/AssetCardNode/Toolbar';
import { assetCardToolbarVisible } from './components/AssetCardNode/toolbarVisibility';
import { mediaCardToolbarVisible } from './components/MediaNode/toolbarVisibility';
import type { MediaDims } from './components/MediaNode/mediaContentSize';
import {
  MEDIA_EXTRACT_EDGE_ORIGIN,
  MEDIA_EXTRACT_NODE_PREFIX,
  buildMediaExtractPlaceholderNode,
  isMediaExtractNodeId,
  mediaExtractNodeId,
  mediaExtractTerminalPatch,
} from './mediaExtract';

import { createCanvasToolSessions, useCanvasToolSessionEffects, type CanvasToolHosts, type CanvasToolView } from './canvasToolSessions';
import { type ImageEnhanceSubmission, type VideoEnhanceSubmission, type FrameInterpolationSubmission } from './panelToolSessions';
import { apiErrorMessage, isSilentAuthError } from './toolSessionCapture';
import { type AudioVideoSplitSubmission } from './audioVideoSplitSession';
import {
  AUDIO_TRIM_EDGE_ORIGIN,
  AUDIO_TRIM_NODE_PREFIX,
  audioTrimNodeId,
  audioTrimTerminalPatch,
  buildAudioTrimPlaceholderNode,
  isAudioTrimNodeId,
} from './audioTrim';

import { type VocalSplitPayload, type AudioToolSubmission } from './audioToolSessions';
import {
  type AudioTrimInput,
} from '@lib/contracts/audio-trim';

import { AUDIO_MIX_EDGE_ORIGIN, audioMixTerminalPatch, buildAudioMixPlaceholderNode, findAudioMixPosition, isAudioMixNodeId } from './audioMix';

import {
  AUDIO_SPEED_EDGE_ORIGIN,
  AUDIO_SPEED_NODE_PREFIX,
  audioSpeedNodeId,
  audioSpeedTerminalPatch,
  buildAudioSpeedPlaceholderNode,
  isAudioSpeedNodeId,
} from './audioSpeed';
import type { AudioSpeedInput } from '@lib/contracts/audio-speed';

import { AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON, AUDIO_VIDEO_MUX_EDGE_ORIGIN, AUDIO_VIDEO_MUX_TITLE, audioVideoMuxErrorText, audioVideoMuxIdentityOf, audioVideoMuxResultName, audioVideoMuxVideoError, buildAudioVideoMuxIdentity, isAudioVideoMuxAudioEdge, isAudioVideoMuxBindEdge, isAudioVideoMuxDraftNode } from './audioVideoMux';


import { VOCAL_SPLIT_DEFAULT_FORMAT, VOCAL_SPLIT_EDGE_ORIGIN, VOCAL_SPLIT_NODE_PREFIX, buildVocalSplitPlaceholderNode, buildVocalSplitTrackNodes, isVocalSplitNodeId, vocalSplitSourceName, vocalSplitTerminalPatch, type VocalSplitIdentity } from './vocalSplit';
import { SCENE_SPLIT_EDGE_ORIGIN, SCENE_SPLIT_NODE_GAP, buildSceneSplitPlaceholderNode, sceneSplitErrorText, sceneSplitFanoutLayout, sceneSplitSegmentBox, sceneSplitSegmentLabel, type SceneSplitIdentity } from './sceneSplit';
import { type SceneSplitSubmission } from './sceneSplitSession';
import { SMART_MATTING_EDGE_ORIGIN, buildSmartMattingPlaceholderNode, smartMattingErrorText, type SmartMattingIdentity } from './smartMatting';
import {
  IMAGE_ENHANCE_EDGE_ORIGIN,
  imageEnhanceDraftPosition,
} from './imageEnhance';
import {
  VIDEO_ENHANCE_EDGE_ORIGIN,
  videoEnhanceDraftPosition,
  videoEnhanceErrorText,
  videoEnhanceGateReason,
  type VideoEnhanceIdentity,
} from './videoEnhance';
import type { VideoEnhanceResolution } from '@lib/contracts/video-enhance';
import {
  FRAME_INTERPOLATION_DEFAULT_FPS,
  FRAME_INTERPOLATION_EDGE_ORIGIN,
  frameInterpolationDisplayName,
  frameInterpolationDraftPosition,
  frameInterpolationErrorText,
  frameInterpolationGateReason,
  type FrameInterpolationFps,
  type FrameInterpolationIdentity,
} from './frameInterpolation';
import { IMAGE_ERASE_EDGE_ORIGIN } from './imageErase';
import { VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN } from '@lib/contracts/video-subtitle-erase';

import { IMAGE_CUTOUT_EDGE_ORIGIN } from '@lib/contracts/image-cutout';

import { IMAGE_OUTPAINT_EDGE_ORIGIN, buildImageOutpaintInput, type ImageOutpaintIdentity } from './imageOutpaint';




import { type OutpaintFrozenInput, type OutpaintTaskSubmission, type CutoutSubmission } from './imageToolSessions';
import { type SmartMattingSubmission } from './smartMattingSession';
import { type SubtitleEraseTaskSubmission, type ImageEraseTaskSubmission } from './maskToolSessions';
import { rasterizeMaskToPngFile } from './imageErase';






import { type CropHost } from './cropSession';
import { IMAGE_CROP_EDGE_ORIGIN, type ImageCropIdentity } from './imageCrop';


import { type ToolSessionDeps } from './toolSessionCoordinator';
import { persistSnapAlignmentEnabled, readSnapAlignmentEnabled } from './snapPreference';
import CanvasHeader from './components/CanvasHeader';
import AgentPanel from './components/AgentPanel';
import CanvasToolbar from './components/CanvasToolbar';
import type { VideoGenSeedParams } from './components/BottomDialog';
import { type UploadedFile, type ImageTextAttachment } from './components/ImageDialog';
import { composeImageSendPrompt } from './components/ImageDialog/composeImageSendPrompt';
import ImageGenerationDockPanel from './imageGenerationDockPanel';
import { composedPromptLimitError, promptMaxLengthOfModel } from '@/lib/prompt-max-length';
import { orderRefStripItems, videoRefStripKey } from './components/RefThumbnail/strip-dnd';
import { flattenPromptDocForSend, restorePromptDoc, type PromptDoc } from '@/lib/prompt-doc';
import { type CanvasPickItem, type AudioRefItem } from './components/AudioDialog';
import SharedAssetsModal from './components/SharedAssetsModal';
import LegacyHistoryModal from './components/LegacyHistoryModal';
import AssetsPickerModal from './components/AssetsPickerModal';
import CharacterLibraryModal from './components/CharacterLibraryModal';
import type { MaterialAsset } from '@/api/material';
import type { ImageOutpaintInput } from '@lib/contracts/image-outpaint';
import type { AssetCardKind, AssetCardNodeData } from './components/AssetCardNode';
import type { CanvasProject } from './components/ProjectSelector';
import FlowCanvas from './components/Canvas';
import { isEditableKeyboardTarget } from './components/Canvas/keyboardDelete';
import { useOverlayWheelPassthrough } from './components/Canvas/canvasWheelPassthrough';
import { canvasUndoKeyAction } from './components/Canvas/keyboardUndo';
import { isMentionMenuOpen } from './components/Canvas/canvasKeyboard';
import { draftFileNameOf, hasCustomName, planBindingsCoveredBy, readNodeAssetId, mapBackendNode, resolveNodeAssets } from './canvasNodeUtils';
import { useEdgesState, type Connection, type Edge, type Node, type Viewport, type OnSelectionChangeParams } from '@xyflow/react';
import { useAuthStore } from '@/stores/auth';
import { fetchMe, fetchCredits, toSessionUser } from '@/api/auth';
import {
  fetchProjects,
  createProject,
  renameProject,
  deleteProject,
  touchProjectLastOpened,
  pinProject,
  projectKeys,
  type SnapshotAsset,
} from '@/api/projects';
import { UPLOAD_SIZE_LIMIT, fetchUploadPresign, putToPresignedUrl, completeUpload, fetchAllAssets, fetchAssetDetail, linkAssetToProject, type AssetRecord, type AssetType, type UploadCompleteData } from '@/api/assets';
import AssetDetailModal from '@/pages/Assets/components/AssetDetailModal';
import { rememberAssetUrl } from './components/AgentPanel/assetUrlCache';
import { referencePromptPlan, applyPromptPreview, createConversationQuote, legacyCardHistoryOptions, readCanvasConflictVersion, saveCanvasDoc, serializeEdges, serializeNodes } from '@/api/canvas';
import { envelopeErrorCode, isApiError } from '@/api/http';
import { useAuthPromptStore } from '@/stores/authPrompt';
import { blockIfCreditsInsufficient, openRechargeForCreditsError } from '@/utils/creditsGate';
import type { GenerationCardBlock, SessionContentBlock } from '@/api/agentSessions';
import {
  fetchJobStatus,
  quoteVideoFinalize,
  quoteSampleRegenerate,
  readJobFailText,
  type CreateJobPayload,
  type ImageJobParameters,
  type VideoJobParameters,
  type AudioJobParameters,
  type GenerationRefItem,
 } from '@/api/jobs';
import { newIdempotencyKey } from '@/api/idempotencyKey';
import {
  saveSharedAsset,
  type SaveSharedAssetRequest,
  type SharedAssetView,
} from '@/api/sharedAssets';
import { uploadAssetFile, probeMediaMeta } from '@/utils/upload';
import ConfirmModal from '@/components/ConfirmModal';
import CanvasContextMenu from './components/CanvasContextMenu';
import { copyImageToClipboard, readCanvasClipboard } from './clipboardPaste';
import { fetchRemoteMedia } from './fetchRemoteMedia';
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
import { createGenerationRuntime, type GenerationRuntime, type GenerationRuntimeHost } from './generationRuntime/runtime';
import { normalGenerationTask } from './generationRuntime/normalGeneration';
import { storyboardTask, type StoryboardPayload } from './generationRuntime/storyboardTasks';
import { createImageToolsTask, isImageToolsCard, imageToolsRetryPayloadOf, type ImageToolsPayload } from './generationRuntime/imageTools';
import { audioMixTask, audioVideoMuxTask, staleMixSubmitError, watchMixSubmit } from './generationRuntime/mixMuxTasks';
import { sceneSplitTask, vocalSplitTask } from './generationRuntime/multiOutputTasks';
import { videoToolsTask, videoToolFrozenPayload, type VideoToolPayload } from './generationRuntime/videoTools';
import { seedTargetOfNode, seedSourcesOfNode } from './generationRuntime/seedFacts';
import type { RecoverySeedSource, RecoverySeedTarget, RuntimeNodeView } from './generationRuntime/types';
import { generationRecoveryPageOptions, putCanvasDocWithRecovery, type CanvasRecoverySaveData, type RecoveryChange } from '@/api/canvasRecovery';
import { defaultProjectName } from '@/lib/projectName';
import { useCanvasDoc } from './hooks/useCanvasDoc';
import { useCanvasHistory, type CanvasHistoryApi } from './hooks/useCanvasHistory';
import { useAssetHoverBridge } from './hooks/useAssetHoverBridge';
import { useCanvasPickers } from './hooks/useCanvasPickers';
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
  findLastOpenedProjectId,
  findLatestCreatedProjectId,
  pickCanvasIdAfterLoad,
  readCanvasIdFromSearch,
  shouldReturnToProjectsAfterDelete,
} from './canvasQuery';
import type { AtMentionItem } from './atMention';
import { createGenerationDockCoordinator } from './generationDockCoordinator';
import { createImageGenerationDock, type ImageGenerationDockHost } from './imageGenerationDock';
import { createVideoGenerationDock, type VideoGenerationDockHost } from './videoGenerationDock';
import { createAudioMusicGenerationDocks, type AudioGenerationDockHost, type MusicGenerationDockHost } from './audioMusicGenerationDock';
import AudioGenerationDockPanel from './audioGenerationDockPanel';
import MusicGenerationDockPanel from './musicGenerationDockPanel';
import { createTextGenerationDock, type TextGenerationDockHost } from './textGenerationDock';
import TextGenerationDockPanel from './textGenerationDockPanel';
import { createToolGenerationDock } from './toolGenerationDock';
import VideoGenerationDockPanel from './videoGenerationDockPanel';
import styles from './index.module.css';

type ToolMode = 'drag' | 'select';

/** 资产卡顶部操作条抬升量（IKGYYB 审查对齐）：条高约 32（addToChatBtn padding 8×2 +
 *  内容 14 + 边框 2）+ 与卡片顶边间距 10 = 42，对齐文本卡操作条 NODE_BAR_LIFT 口径 */
const ASSET_TOOLBAR_LIFT = 42;

/** IKILUE：带 confirmEmpty 的清空保存被 412 拒绝后的复核指引——另一会话已改写画布，
 *  刷新重新水合后 confirmEmpty 才会按新基线重新授予，直接重试只会用旧空文档覆盖对方成果。 */
const EMPTY_CLEAR_CONFLICT_TOAST = '画布已被其他会话更新，本次清空未保存，请刷新页面复核';

/** IKILUG：空保存被服务端 422 拒（本地空状态与服务端非空事实不一致，重试必然再拒）——
 *  防抖自动保存/项目切换强制保存/手动「重试保存」三个入口共用的刷新复核指引。 */
const EMPTY_OVERWRITE_REJECTED_TOAST = '画布内容与服务端不一致，已阻止清空保存，请刷新页面复核';

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
  const closeConnectMenu = useCallback(() => setConnectMenu(null), []);
  const connectingSourceRef = useRef<string | null>(null);
  const paneUploadRef = useRef<HTMLInputElement>(null);
  const paneUploadPosRef = useRef<{ x: number; y: number } | null>(null);
  /** IKJR9J 画布锚定浮层拖拽隐藏：Canvas 上抛的被拖卡 id 集合（null=无拖拽）。
   *  浮层锚定卡命中集合即 visibility 级隐藏（不卸载）；dragStop/组框落定同事件批
   *  清空，与坐标回写同批渲染——浮层在新锚点重现，不闪旧位置、无过渡动画。 */
  const [anchoredOverlayHiddenIds, setAnchoredOverlayHiddenIds] = useState<Set<string> | null>(null);
  /** IKJR9J 拖拽隐藏命中判定：仅浮层锚定卡在被拖集合中才隐藏（拖别的卡原地不动），
   *  与 canvasToolSessions.dragHiddenOf 同口径：显式收敛 boolean。 */
  const isAnchoredOverlayDragHidden = (id: string | null | undefined) =>
    id != null && (anchoredOverlayHiddenIds?.has(id) ?? false);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperSize, setWrapperSize] = useState({ width: 0, height: 0 });
  const [liveViewport, setLiveViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1.1 });
  /** 当前唯一选中节点 id（IKGYYD 钉屏幕悬浮工具栏的跟随目标）：onSelectionChange 顶部回写
   *  （选取/扩图等早退分支不阻断）；「唯一选中 + 无多选」的精确门在 NodeFollowToolbar
   *  容器内直读 React Flow store，本值只负责挑出该渲染哪个节点的工具条 */
  const [soloSelectedNodeId, setSoloSelectedNodeId] = useState<string | null>(null);
  /** 指针悬停中的资产卡 id（IKGYYF 悬浮顶部操作条 hover 显示）：卡上 pointerenter/leave 经
   *  data.onHoverChange 上报（等价迁移前 CSS .wrapper:hover），节点删除时卡组件卸载清理兜底。
   *  IKGYYB hover 桥接：清除延迟 ASSET_HOVER_BRIDGE_MS——鼠标穿卡-条间隙（~20px，不属于卡
   *  DOM）时不闪卸，条根 enter 取消清除、移出到卡外才真清（见 hooks/useAssetHoverBridge.ts） */
  const {
    hoveredAssetNodeId,
    handleAssetHoverChange,
    handleToolbarPointerEnter,
    handleToolbarPointerLeave,
  } = useAssetHoverBridge();
  const {
    pickMode, setPickMode,
    pickTarget, setPickTarget,
    pickRefRole, setPickRefRole,
    imagePickSession, setImagePickSession,
    endImagePickSession,
    imagePickSessionActive,
    videoPickSession, setVideoPickSession,
    endVideoPickSession,
    videoPickSessionActive,
    audioPickSession, setAudioPickSession,
    endAudioPickSession,
    audioPickSessionActive,
    pickProductId, setPickProductId,
    pickAssetId, setPickAssetId,
    imagePickResult, setImagePickResult,
    productPickResult, setProductPickResult,
    assetPickResult, setAssetPickResult,
    audioPickResult, setAudioPickResult,
    audioAssetPickResult, setAudioAssetPickResult,
    audioAssetPickTarget, setAudioAssetPickTarget,
    musicPickResult, setMusicPickResult,
    showAssetsPicker, setShowAssetsPicker,
    assetsPickerTarget,
    openAssetsPicker,
    videoAssetPickRole, setVideoAssetPickRole,
    videoAssetPickKind, setVideoAssetPickKind,
    agentAssetPicks, setAgentAssetPicks,
  } = useCanvasPickers();
  /** 角色库弹窗状态 */
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  /** 角色库发起目标（决定选中结果注入哪个对话框）；IKFE8U 起视频面板无发起入口 */
  const [characterLibraryTarget, setCharacterLibraryTarget] = useState<'image' | 'asset' | null>(null);
  /** HD 合法多请求各自结算；旧执行失效后，物理创建请求仍属于同卡在途窗口。 */
  const videoEnhanceInFlightRef = useRef(new Map<string, Set<{ projectId: string | null; loadEpoch: object }>>());
  const isVideoEnhanceCardInFlight = (nodeId: string) =>
    [...(videoEnhanceInFlightRef.current.get(nodeId) ?? [])].some((request) =>
      request.projectId === activeProjectRef.current && request.loadEpoch === docLoadEpochRef.current);
  const toolHostsRef = useRef<Partial<CanvasToolHosts>>({});
  const toolViewRef = useRef<CanvasToolView | null>(null);
  const toolDepsRef = useRef<ToolSessionDeps | null>(null);
  const [toolSessions] = useState(() => createCanvasToolSessions(
    () => toolHostsRef.current,
    () => toolViewRef.current!,
    () => toolDepsRef.current!,
  ));
  const toolRuntime = toolSessions.runtime;
  useCanvasToolSessionEffects(toolSessions);
  // 项目首帧先使旧响应失效，随后从运行时读取唯一状态。
  toolRuntime.setProject(currentId);
  const audioMixInFlightRef = useRef(false);
  /** IKIZQE 成片（finalize）链路的页面态：按样片卡 node id 记报价，按样片任务 id 记
   *  已受理尝试（会话内）；「提交中/结果不明」是渲染期派生 CTA 状态的数据源。
   *  报价 = 服务端唯一权威门（空报价双 null 即禁用），不随画布持久化——刷新后重新报价。 */
  const [finalizeQuotes, setFinalizeQuotes] = useState<
    Record<string, { phase: 'loading' } | { phase: 'ready'; credits: number; revision: string } | { phase: 'empty' }>
  >({});
  const finalizeQuoteInflightRef = useRef(new Set<string>());
  /** 提交窗口同步防重（双击/并发点击至多一次提交）；提交中视觉态由占位成片卡推导（running） */
  const finalizeInflightRef = useRef(new Set<string>());
  const [finalizeUnknownSamples, setFinalizeUnknownSamples] = useState<ReadonlySet<string>>(() => new Set());
  const finalizeAttemptedJobIdsRef = useRef(new Set<string>());
  /** IKIZQG 重新生成样片（regenerate-sample）链路的页面态：按**原样片任务 id**记报价与
   *  已受理尝试（会话内）——过期样片卡与成片失败卡两个入口指向同一样片任务时共享一份。
   *  口径同 finalize：报价 = 服务端唯一权威门（空报价双 null 即禁用），不持久化，刷新后重报价。 */
  const [sampleRegenQuotes, setSampleRegenQuotes] = useState<
    Record<string, { phase: 'loading' } | { phase: 'ready'; credits: number; revision: string } | { phase: 'empty' }>
  >({});
  const sampleRegenQuoteInflightRef = useRef(new Set<string>());
  /** 提交窗口同步防重（按样片任务 id 归并：同一样片的两个入口并发点击至多一次提交） */
  const sampleRegenInflightRef = useRef(new Set<string>());
  const [sampleRegenUnknownSamples, setSampleRegenUnknownSamples] = useState<ReadonlySet<string>>(() => new Set());
  const sampleRegenAttemptedJobIdsRef = useRef(new Set<string>());
  /** 合成提交任务在途锁（IKIHPM，同 audioMix 口径）：在途时后来的发送被守卫挡回
   *  （连点不重复建任务），finally 无条件释放。受理/幂等/轮询归生成任务运行时（IKJJR4）。 */
  const audioVideoMuxInFlightRef = useRef(false);
  /** 混合未受理提交的占位卡身份台账（IKJJR4）：同项目同载荷未受理重发沿用同一节点 id，
   *  使运行时按（节点 × 载荷签名）复用同一 submission_id——回执丢失原样重发不重复建任务；
   *  受理即作废（之后的提交是另一次意图）。 */
  const audioMixSubmitCardRef = useRef<{ projectId: string; payload: string; nodeId: string; accepted: boolean } | null>(null);
  /** 任务在途锁持续到创建与首保存结束，不随编辑会话退出或重开释放。 */
  const sceneSplitSendingRef = useRef(false);
  /** 任务在途锁独立于会话，界面退出不得释放。 */
  const smartMattingSendingRef = useRef(false);
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
  /** 同一次手势内的多次 push 聚合成一条历史（IKHR6J / IKHM3P） */
  const withHistoryBatch = (fn: () => void) => {
    historyRef.current?.beginBatch();
    try {
      fn();
    } finally {
      historyRef.current?.endBatch();
    }
  };
  /** 擦除会话内的撤回/重做：Ctrl+Z 走遮罩小栈，不误伤画布历史（IKHCVJ） */
  const eraseHistoryRef = useRef({
    active: false,
    undo: () => {},
    redo: () => {},
  });
  eraseHistoryRef.current = toolSessions.eraseHistory();
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
  /** 方案卡删标签后：当前绑定仍被边上已确认记录覆盖时，把 promptReference 收到新清单。
   *  新增/换绑不是收缩，留给「同步素材到目标」；收缩不必再点一次。 */
  const syncPlanEdgeBindingsOnShrink = (planNodeId: string, mentions: import('@lib/contracts/prompt-preview').PromptMention[]) => {
    const nextBindings = promptBindingList(mentions);
    let changed = false;
    const next = edgesRef.current.map((edge) => {
      if (edge.source !== planNodeId) return edge;
      const confirmed = promptBindingsSchema.safeParse(
        (edge.data?.promptReference as { bindings?: unknown } | undefined)?.bindings,
      );
      if (!confirmed.success) return edge;
      if (JSON.stringify(confirmed.data) === JSON.stringify(nextBindings)) return edge;
      if (!planBindingsCoveredBy(nextBindings, confirmed.data)) return edge;
      changed = true;
      return { ...edge, data: { ...edge.data, promptReference: { bindings: nextBindings } } };
    });
    if (!changed) return;
    edgesRef.current = next;
    setEdges(next);
  };
  /** 草稿卡的模型能力解析（ADR-0086）：按卡上 draftModelId 在对应能力列表里取能力行。
   *  未绑定模型或列表未加载 → undefined：消费处按缺省处理且**不阻断**（宁可服务端 400 判定，
   *  不做客户端假阴性拦截）。 */
  const draftModelOf = (nodeId: string | null | undefined, kind: 'video' | 'image'): GenerationModel | undefined => {
    const data = (mediaNodesRef.current.find((n) => n.id === nodeId)?.data ?? {}) as Record<string, unknown>;
    const modelId = typeof data.draftModelId === 'string' ? data.draftModelId : '';
    if (!modelId) return undefined;
    return (kind === 'video' ? videoModelsRef.current : imageModelsRef.current).find((m) => m.model_id === modelId);
  };
  /** 视频草稿的参考能力（模型未解析 → null：分类上限回落缺省，视频/音频参考门控放行交服务端） */
  const videoCapsOfDraft = (nodeId: string | null | undefined): VideoRefCapabilities | null =>
    videoRefCapsOfModel(draftModelOf(nodeId, 'video'));
  /** 图片草稿的参考图上限（能力行 image_reference_max；模型未解析回落缺省 10） */
  const imageRefMaxOfDraft = (nodeId: string): number =>
    imageReferenceMaxOf(draftModelOf(nodeId, 'image')?.features);
  /** 提交防线的视频/音频参考能力位判定（ADR-0086）：按提交模型的能力行逐类型判定，返回拒绝原因。
   *  模型未解析（能力列表未加载/接口失败）返回 null 不阻断——交服务端 400 判定，不做客户端假阴性。 */
  const videoRefUnsupportedByModel = (modelId: string, refs: VideoMediaRefs): string | null => {
    const model = videoModelsRef.current.find((m) => m.model_id === modelId);
    if (!model) return null;
    const f = model.features;
    const unsupported = refs.reference.some((r) =>
      r.mediaType === 'video' ? !supportsVideoReferenceOf(f)
        : r.mediaType === 'audio' ? !supportsAudioReferenceOf(f)
          : false,
    );
    return unsupported ? '当前模型不支持视频或音频参考，请更换模型或调整引用' : null;
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
    // 上限读草稿绑定模型的 image_reference_max（ADR-0086，此前写死 10）
    const imageMax = imageRefMaxOfDraft(targetId);
    if (refs.length >= imageMax) {
      showToast('warn', refOverflowToast(['image'], { image: imageMax }));
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
    // 分类上限读草稿绑定模型的能力行（ADR-0086，此前 caps 恒 undefined → 回落到写死的 9/3/3）
    const msg = checkAddVideoRef(role, mediaType, assetId, refs, videoCapsOfDraft(targetId), [materialId]);
    if (msg) {
      showToast('warn', msg);
      return false;
    }
    return true;
  };
  /** 音频草稿参考连线校验（IKFDFZ）：仅当目标是音频草稿且来源是媒体节点时介入——
   *  有效图片或音频可连入（二者不可混用，视频拒绝）；重复素材与分类上限明确拒绝。
   *  文本卡走 validateAudioTextConnect。 */
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
    const sourceData = (source.data ?? {}) as Record<string, unknown>;
    const incomingType = audioRefMediaTypeOf(sourceData) ?? 'audio';
    const refs = mergedAudioRefsWithTextIndex(
      targetId,
      edgesRef.current,
      mediaNodesRef.current,
      textNodesRef.current,
    ).refs;
    const assetId = readAssetId(sourceData);
    const msg = checkAddAudioRef(assetId, refs, 0, incomingType);
    if (msg) {
      showToast('warn', msg);
      return false;
    }
    return true;
  };
  /** 音频草稿挂文本附件：模拟并入后若图+音频混用或超分类上限则拒绝（点选/@/拖线同一道门）。 */
  const validateAudioTextConnect = (textNodeId: string, targetId: string): boolean => {
    const target = mediaNodesRef.current.find((n) => n.id === targetId);
    if (!isAudioDraftNode(target)) return true;
    if (isGeneratingNode(targetId)) {
      showToast('warn', '生成中，输入连线只读');
      return false;
    }
    const alreadyLinked = edgesRef.current.some((e) => e.source === textNodeId && e.target === targetId);
    const hypoEdges = alreadyLinked
      ? edgesRef.current
      : [...edgesRef.current, { id: `hypo-audio-text-${textNodeId}`, source: textNodeId, target: targetId }];
    const msg = audioMergedRefsError(
      mergedAudioRefsWithTextIndex(
        targetId,
        hypoEdges,
        mediaNodesRef.current,
        textNodesRef.current,
      ).refs,
    );
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
    // IKIHPK 拖线落点分流（ADR-0115）：目标是未绑定/绑定中的音视频合成草稿卡时转绑定动作
    // （写卡上视频身份 + 建 origin=audio-video-mux 绑定边），不落普通参考线；非视频源
    // 在此被明确拒绝并提示，同样不落普通线。其余落点行为完全保持现状不动。
    const toolConnection = toolSessions.connect(sourceNode, targetNode);
    if (toolConnection !== null) return toolConnection;
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
      if (sourceNode.type === 'textNode') {
        if (!validateAudioTextConnect(source, target)) return false;
      } else if (!validateAudioRefConnect(source, target)) return false;
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
      withHistoryBatch(() => {
        memberIds.forEach((m) => connectPair(m, targetId));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, submittingNodeId],
  );
  /** 源→组：外部节点拖到组左侧「+」，为该源到组内每个成员各建一条边（每个成员都引用该源输出）。 */
  const handleConnectSourceToGroup = useCallback(
    (sourceId: string, memberIds: string[]) => {
      if (!sourceId || memberIds.length === 0) return;
      withHistoryBatch(() => {
        memberIds.forEach((m) => connectPair(sourceId, m));
      });
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
  /** 连线变更守卫（IKDMQQ）：生成中节点的入边删除变更被拦截（剪刀等 remove 路径统一收口）；
   *  放行的删边进撤销栈（IKD0JT），撤销可加回 */
  const guardEdgesChange: typeof onEdgesChange = (changes) => {
    const allowed = changes.filter((c) => {
      if (c.type !== 'remove') return true;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      if (!edge) return true;
      if (isGeneratingNode(edge.target)) return false;
      // IKIHPK：合成草稿卡的固定音频输入线不可单独删（只有删除草稿卡才解除）；
      // 视频绑定线可删（删除即解绑重选，同步见下方放行处理）
      const muxDraft = mediaNodesRef.current.find((n) => n.id === edge.target);
      if (isAudioVideoMuxAudioEdge(edge, muxDraft)) return false;
      return true;
    });
    if (allowed.length < changes.length) {
      const blockedMuxAudioEdge = changes.some((c) => {
        if (c.type !== 'remove') return false;
        const edge = edgesRef.current.find((e) => e.id === c.id);
        if (!edge) return false;
        const muxDraft = mediaNodesRef.current.find((n) => n.id === edge.target);
        return isAudioVideoMuxAudioEdge(edge, muxDraft);
      });
      showToast('warn', blockedMuxAudioEdge ? AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON : '生成中，输入连线只读');
    }
    // 删边登记撤销（放行部分）
    const removedEdges: Edge[] = [];
    for (const c of allowed) {
      if (c.type !== 'remove') continue;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      if (edge) removedEdges.push(edge);
    }
    if (removedEdges.length > 0) removeTargetInputs(removedEdges.map(edge => edge.id));
    // IKIHPK：绑定线删除即解绑（清卡上视频身份，面板槽回未绑定引导，可重新绑定）
    for (const edge of removedEdges) {
      const muxDraft = mediaNodesRef.current.find((n) => n.id === edge.target);
      const identity = audioVideoMuxIdentityOf(muxDraft);
      if (!muxDraft || !identity || !isAudioVideoMuxBindEdge(edge, muxDraft)) continue;
      const nextIdentity = { ...identity };
      delete nextIdentity.video;
      patchMediaNode(muxDraft.id, { audioVideoMux: nextIdentity });
    }
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
  /** 画布层模型能力列表（ADR-0086）：连线校验、资产接纳槽位与资产卡上限按「草稿卡绑定的模型」
   *  的能力行取值，不再写死 9/3/3、10。与首页/图片/视频面板同源（fetchGenerationModels 有模块级
   *  请求缓存，重复挂载不产生重复请求）。失败保留空列表：消费处回落缺省且不阻断。 */
  const [videoModels, setVideoModels] = useState<GenerationModel[]>([]);
  const [imageModels, setImageModels] = useState<GenerationModel[]>([]);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
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

  /** 首页发送框携带草稿跳转：打开 Agent 弹框并注入输入框文本，随后清除导航状态避免刷新重复注入。
   *  智能体附件（首页 + 上传的图/视频）经模块变量 handoff 带入：此处只负责打开 AgentPanel 与注入文本，
   *  附件的落画布节点 + 挂会话引用改由下方「首页附件落画布」effect 在画布水合完成后处理——
   *  避免在水合前 setMediaNodes 被水合 effect 覆盖，同时让本地上传的图与 Agent 侧边栏上传一致落节点。 */
  useEffect(() => {
    const state = location.state as { agentText?: string; skillId?: string; skillName?: string } | null;
    if (!state?.agentText && !state?.skillId) return;
    setAgentContext({
      text: state.agentText ?? '',
      skillId: state.skillId ?? '',
      skillName: state.skillName ?? '',
      ts: Date.now(),
      mediaBlocks: undefined,
    });
    setShowAgent(true);
    navigate(location.pathname + location.search, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, location.search, navigate]);
  const imageDockHostRef = useRef<ImageGenerationDockHost | null>(null);
  const [imageDock] = useState(() => createImageGenerationDock(() => imageDockHostRef.current!));
  const videoDockHostRef = useRef<VideoGenerationDockHost | null>(null);
  const [videoDock] = useState(() => createVideoGenerationDock(() => videoDockHostRef.current!));
  const audioDockHostRef = useRef<AudioGenerationDockHost | null>(null);
  const musicDockHostRef = useRef<MusicGenerationDockHost | null>(null);
  const [audioMusicDock] = useState(() => createAudioMusicGenerationDocks(() => audioDockHostRef.current!, () => musicDockHostRef.current!));
  const textDockHostRef = useRef<TextGenerationDockHost | null>(null);
  const [textDock] = useState(() => createTextGenerationDock(() => textDockHostRef.current!));
  const [toolDocks] = useState(() => ({
    imageEnhance: createToolGenerationDock(toolSessions.entries.imageEnhance.handle, {
      createDraft: id => toolViewRef.current!.createEnhanceDraft(id),
      getDeps: () => toolDepsRef.current!,
      subscribe: toolRuntime.subscribe,
      getVersion: toolRuntime.getVersion,
      render: (): ReactNode => toolSessions.entries.imageEnhance.render({
        close: () => generationDock.close('imageEnhance'),
        submit: (value): boolean => generationDock.submit('imageEnhance', value),
      }),
    }),
    videoEnhance: createToolGenerationDock(toolSessions.entries.videoEnhance.handle, {
      createDraft: id => toolViewRef.current!.createVideoEnhanceDraft(id),
      getDeps: () => toolDepsRef.current!,
      subscribe: toolRuntime.subscribe,
      getVersion: toolRuntime.getVersion,
      updateDraft: input => toolViewRef.current!.changeVideoParams(input.nodeId, input.value),
      render: (): ReactNode => toolSessions.entries.videoEnhance.render({
        close: () => generationDock.close('videoEnhance'),
        submit: (value): boolean => generationDock.submit('videoEnhance', value),
        updateDraft: (nodeId, value) => generationDock.updateDraft('videoEnhance', { nodeId, value }),
      }),
    }),
    frameInterpolation: createToolGenerationDock(toolSessions.entries.frameInterpolation.handle, {
      createDraft: id => toolViewRef.current!.createFrameInterpolationDraft(id),
      getDeps: () => toolDepsRef.current!,
      subscribe: toolRuntime.subscribe,
      getVersion: toolRuntime.getVersion,
      updateDraft: input => toolViewRef.current!.changeFrameParams(input.nodeId, input.value),
      render: (): ReactNode => toolSessions.entries.frameInterpolation.render({
        close: () => generationDock.close('frameInterpolation'),
        submit: (value): boolean => generationDock.submit('frameInterpolation', value),
        updateDraft: (nodeId, value) => generationDock.updateDraft('frameInterpolation', { nodeId, value }),
      }),
    }),
  }));
  const [generationDock] = useState(() => createGenerationDockCoordinator({
    image: imageDock,
    video: videoDock,
    audio: audioMusicDock.audio,
    text: textDock,
    music: audioMusicDock.music,
    ...toolDocks,
  }));
  useSyncExternalStore(generationDock.subscribe, generationDock.getVersion);
  const { visible: showImageDialog, boundId: imageDraftId, seed: imageSeed } = generationDock.panel('image');
  const { visible: showBottomDialog, boundId: videoDraftId, seed: videoSeed, freeRefs: videoFreeRefs } = generationDock.panel('video');
  const dockToolCallbacks = {
    ...toolSessions.callbacks,
    onEnhanceImage: (id: string) => generationDock.open('imageEnhance', { sourceId: id }),
    onVideoEnhance: (id: string) => generationDock.open('videoEnhance', { sourceId: id }),
    onFrameInterpolation: (id: string) => generationDock.open('frameInterpolation', { sourceId: id }),
  };
  const openCoordinatedToolDraft = (node: Node, open: () => void) => {
    if (node.data.imageEnhance) generationDock.open('imageEnhance', { nodeId: node.id });
    else if (node.data.videoEnhance) generationDock.open('videoEnhance', { nodeId: node.id });
    else if (node.data.frameInterpolation) generationDock.open('frameInterpolation', { nodeId: node.id });
    else open();
  };
  const editingTargetRef = useRef<string | null>(null);
  const { visible: showAudioDialog, boundId: audioDraftId, seed: audioSeed } = generationDock.panel('audio');
  const { visible: showMusicDialog } = generationDock.panel('music');
  const { visible: showTextGenDialog, boundId: textGenDraftId } = generationDock.panel('text');
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
      generationDock.open('image', { seed: {
        ts: Date.now(), text: '', files: [],
        params: { modelId: handoff.modelId, ratio: handoff.ratio, size: handoff.size },
      } });
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
  /** 加载视频/图片能力列表（ADR-0086）：画布连线、资产接纳与资产卡上限据此取能力行；
   *  失败不阻断画布（保留空列表 → 消费处按缺省值），避免接口抖动让画布不可用。 */
  useEffect(() => {
    fetchGenerationModels('video').then(setVideoModels).catch(() => undefined);
    fetchGenerationModels('image').then(setImageModels).catch(() => undefined);
  }, []);
  /** 资产卡参考图上限（ADR-0086）：资产卡经图片面板生成图片，按图片能力默认模型取
   *  image_reference_max（无显式默认取列表首条；列表未加载回落缺省 10，与服务端一致） */
  const assetImageRefMax = imageReferenceMaxOf(
    (imageModels.find((m) => m.is_default) ?? imageModels[0])?.features,
  );
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
  /** Dock 等浮层滚轮直通画布（IKIXDB）：光标落在生成面板/工具条等非 .react-flow
   *  浮层上时 wheel 转发给 .react-flow__renderer（同 CropFrame 暗区直通），画布
   *  平移不再被浮层截断；浮层内真实滚动区滚自身，ctrl/meta 仍拦浏览器整页缩放
   *  （原行为：dock 跟着放大、缩小却不回的整页缩放）。捕获阶段监听。 */
  useOverlayWheelPassthrough(canvasWrapperRef, { ignoreInsideReactFlow: true });
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
  const followTargetId = showImageDialog && imageDraftId
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
  // 先发布本轮节点与视口，再计算工具条；宿主函数经闭包在交互发生时调用。
  toolViewRef.current = {
    nodes: mediaNodes, viewport: liveViewport, size: wrapperSize, nodeBox: nodeBoxOf,
    projectId: currentId, submittingNodeId,
    dragHiddenIds: anchoredOverlayHiddenIds,
    createEnhanceDraft: (id) => handleNodeEnhanceImage(id),
    createVideoEnhanceDraft: (id) => handleNodeVideoEnhance(id),
    createFrameInterpolationDraft: (id) => handleNodeFrameInterpolation(id),
    changeVideoParams: (id, resolution) => handleVideoEnhanceParamsChange(id, resolution),
    changeFrameParams: (id, fps) => handleFrameInterpolationParamsChange(id, fps),
  };
  /** IKGYYD 钉屏幕悬浮工具栏：唯一选中的普通成品媒体卡（数据门同迁移前 MediaNode 内判定：
   *  生成流程卡 / 素材缺失 / 空壳上传卡不显——谓词与 MediaNodeToolbar 共用，
   *  IKGYYB 审查消弱类型双实现）；「唯一选中 + 画布无多选」精确门、锚定与
   *  拖动/平移缩放实时跟随由 NodeFollowToolbar 容器承担（渲染在画布缩放层之外）。
   *  IKHFUF：高清/HD 面板已绑到一张成品卡时，操作条跟绑定卡走（不跟 RF 选中是否跟上），
   *  点高清卡时上方操作条与下方面板同时出现；草稿/生成中的高清卡仍走数据门不显条。 */
  const selectedMediaToolbarNode = soloSelectedNodeId
    ? mediaNodes.find((n) => n.id === soloSelectedNodeId) ?? null
    : null;
  const enhancePanelToolbarNode = toolSessions.toolbarNode();
  const soloMediaToolbarNode = enhancePanelToolbarNode ?? selectedMediaToolbarNode;
  const showSoloMediaToolbar = soloMediaToolbarNode != null
    && mediaCardToolbarVisible(soloMediaToolbarNode.data ?? {});
  // IKGZ5O 工具会话模态门不并入本谓词：editSessionActive 定义位置晚于此处（TDZ），
  // 且会话态属调用方数据条件，按 NodeFollowToolbar 分工直接写在渲染处 show 表达式里
  /** IKGYYF 资产卡悬浮顶部操作条：hover 的资产卡优先（等价迁移前 .wrapper:hover），
   *  否则唯一选中的资产卡；渲染条件（生成卡恒显 / HIDE_ASSET_TOP_BAR 门控纯资产卡）
   *  与内容迁至 AssetCardToolbar，「唯一选中 + hover」门在 NodeFollowToolbar 容器。
   *  hover 目标已不在画布（删除后 state 残留）时 find 落空自然不渲染 */
  const hoverAssetToolbarNode = hoveredAssetNodeId
    ? assetNodes.find((n) => n.id === hoveredAssetNodeId) ?? null
    : null;
  const soloAssetToolbarNode = soloSelectedNodeId
    ? assetNodes.find((n) => n.id === soloSelectedNodeId) ?? null
    : null;
  const assetToolbarNode = hoverAssetToolbarNode ?? soloAssetToolbarNode;
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
  /* IKJJR3：抠像/插帧/调速的创建 mutation 已随家族迁入生成任务运行时（家族定义内直接
   * 调对应 API 客户端并携带 canvas_binding；同卡防重 = 运行时 submitting 窗口）。 */
  const quoteMutation = useMutation({ mutationFn: createConversationQuote });
  const applyMutation = useMutation({ mutationFn: applyPromptPreview });
  const referencePlanMutation = useMutation({ mutationFn: (input: Parameters<typeof referencePromptPlan>[0]) => referencePromptPlan(input) });
  const linkAudioMixAssetsMutation = useMutation({
    mutationFn: (vars: { projectId: string; assetIds: string[] }) =>
      Promise.all(vars.assetIds.map((assetId) => linkAssetToProject(vars.projectId, assetId, { silent: true }))),
  });
  // IKJJR4：混合/合成的创建与专属重试请求由生成任务运行时经 mixMuxTasks 定义直连
  //（幂等键 = submission_id、canvas_binding 受理），不再经 useMutation 页面台账。

  const applyingRef = useRef(false);
  const updateGenerateRef = useRef<(nodeId: string) => void>(() => {});
  const onUpdateGenerate = useCallback((nodeId: string) => {
    updateGenerateRef.current(nodeId);
  }, []);
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
  /** 画布乐观锁版本号：打开时从快照写入，之后只跟保存接口返回的自增 version。
   *  null 表示从未保存，If-Match 传 missing。不要从过期的 doc.version 回写。 */
  const versionRef = useRef<number | null>(null);
  /** 最近一次加载/保存成功的内容签名，避免重复保存 */
  const lastSavedRef = useRef('');
  /** IKJKU8（用户故事 38）：在途恢复保存命令保留——回执丢失（断连/响应丢失）后命令身份、
   *  完整载荷与实际 If-Match 保留至结果落定；完全相同的重试（画布签名与版本未变）复用
   *  原命令重发，命中服务端幂等回读取回原回执（replayed=true），不因旧 If-Match 被迫
   *  冲突复核。IKJLTY（R6）：结果未明确前不因本地新编辑（签名/版本变化）丢弃未决命令——
   *  新保存意图到来先原样重放确认原命令结果（版本随之对齐），再以确认版本为基组新命令；
   *  旧回执只确认原保存与合法版本，不覆盖新编辑。仅结果落定（成功/受控 4xx）或跨项目才释放。 */
  const retainedRecoverySaveRef = useRef<{
    projectId: string;
    commandId: string;
    recoveryChanges: RecoveryChange[];
    payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean };
    version: number | null;
    signature: string;
  } | null>(null);
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
  const setUsage = useAuthStore((s) => s.setUsage);
  /** 新建商品节点序号（商品 1、商品 2…） */
  const productSeq = useRef(0);

  // 画布页面加载时获取当前登录用户信息（鉴权判断 + 身份展示，失败静默降级）
  useEffect(() => {
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, [updateUser]);

  // IKBN0G：画布顶栏不再挂 UserDropdown，余额改由本页拉取，供生成前余额拦截
  useEffect(() => {
    let alive = true;
    fetchCredits()
      .then((d) => {
        if (alive) setUsage(d);
      })
      .catch(() => {
        if (alive) setUsage(null);
      });
    return () => {
      alive = false;
    };
  }, [setUsage]);

  // 加载项目列表；落点三级规则（IKH1YK）：?project= 合法值 > 上次打开 > 首项；无项目自动创建
  useEffect(() => {
    let alive = true;
    fetchProjects()
      .then(async (list) => {
        if (!alive) return;
        const lastOpenedId = findLastOpenedProjectId(list);
        const latestCreatedId = findLatestCreatedProjectId(list);
        let mapped = list.map((p) => ({ id: String(p.id), name: p.name, pinned: Boolean(p.pinned_at) }));
        if (mapped.length === 0) {
          try {
            const created = await createProject('未命名项目');
            if (!alive) return;
            mapped = [{ id: String(created.id), name: created.name, pinned: false }];
          } catch {
            /* 创建失败静默降级：空项目列表 */
          }
        }
        setProjects(mapped);
        setCurrentId((prev) => pickCanvasIdAfterLoad(prev, mapped.map((m) => m.id), lastOpenedId, latestCreatedId));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /** 打开即记（IKH1YK）：进入画布那一刻向服务端记一笔 last_opened_at，失败静默。
   *  ref 去重：同一次进入（含 StrictMode 双挂载）只记一次；A→B→A 切换每次都记。 */
  const lastTouchedProjectRef = useRef('');
  useEffect(() => {
    if (!currentId || lastTouchedProjectRef.current === currentId) return;
    // projects 就绪且包含该 id 才记，防止记到无效 id
    if (!projects.some((p) => p.id === currentId)) return;
    lastTouchedProjectRef.current = currentId;
    touchProjectLastOpened(currentId).catch(() => undefined);
  }, [currentId, projects]);

  /** 地址栏改 query（含后退）时切回对应画布 */
  useEffect(() => {
    const fromQuery = readCanvasIdFromSearch(new URLSearchParams(location.search));
    if (fromQuery && audioMixInFlightRef.current && activeProjectRef.current && fromQuery !== activeProjectRef.current) {
      navigate({ pathname: location.pathname, search: canvasLocationSearch(new URLSearchParams(location.search), activeProjectRef.current) },
        { replace: true, state: location.state });
      return;
    }
    // IKIN8A：整文档待复核期间，同页路由（前进/后退/外部 navigate 改 ?project=）请求打开另一
    // Project 时中止切换并把地址恢复到当前项目——不走项目选择器落盘闸门的这条路径若放行，
    // 水合 doc 先置 null 会静默复位待复核标记，随后新项目水合再覆盖本地工作副本，
    // 等于把未保存内容当作已落盘丢弃。同项目其他 query 变化（fromQuery 相同）不受影响。
    if (fromQuery && activeProjectRef.current && fromQuery !== activeProjectRef.current && blockedByPendingCanvasReview()) {
      navigate({ pathname: location.pathname, search: canvasLocationSearch(new URLSearchParams(location.search), activeProjectRef.current) },
        { replace: true, state: location.state });
      return;
    }
    if (fromQuery) setCurrentId(fromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- blockedByPendingCanvasReview 每次渲染重建，判定仅读跨渲染稳定的 ref
  }, [location.search, location.pathname, location.state, navigate]);

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
  }, [currentId, setAgentAssetPicks]);

  /** 加载当前项目快照（画布水合：节点 + 视口 + 版本号），失败静默降级为空画布 */
  const { doc, assets: snapshotAssets, loadFailed: canvasLoadFailed, refetch, acceptDoc, legacyMigration, patchAsset, upsertAssets } = useCanvasDoc(currentId);
  // IKJJR4：混合/合成的刷新恢复归生成任务运行时（恢复扫描 B.5 + 水合即时续轮询），
  // 旧的「按任务列表补卡」专属查询骨架移除；历史在卡任务仍经水合续轮询。
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
          onPromptChange: (id: string, text: string, promptMentions: import('@lib/contracts/prompt-preview').PromptMention[], promptMaterials?: Array<import('@lib/contracts/prompt-preview').PromptMaterial & { url: string }>) => {
            setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, text, promptMentions, ...(promptMaterials ? { promptMaterials } : {}) } } : n));
            // 删标签只收缩已确认绑定：边上 promptReference 跟随，避免 Dock 误亮「同步素材到目标」
            syncPlanEdgeBindingsOnShrink(id, promptMentions);
          },
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
            generationDock.writeSelf('text');
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
          onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          ...dockToolCallbacks,
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
          onHoverChange: handleAssetHoverChange,
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

  /** 最近一次完整水合所用的 doc 引用。snapshotAssets 单独更新时不得整页重水合，
   *  否则会把 versionRef 打回打开时的旧 version，随后保存带着过期 If-Match 必 412。 */
  const hydratedDocRef = useRef<typeof doc>(null);
  const hydratedProjectRef = useRef<string | null>(null);
  /** IKIIWN/IKIMQK：本会话是否成功确认过非空画布。空保存的 confirmEmpty 授予依据有二：
   *  成功水合非空基线（用户显式删光场景），或本会话成功保存非空文档并取得新版本
   *  （IKIMQK 合法例外：空水合 → 新增 → 非空保存成功 → 再明确删除）；水合进来即为空
   *  且从未成功保存过非空文档（服务端返回空/内容丢失/新建未保存即删）的空保存不带标记，
   *  由服务端 422 拦下。 */
  const confirmedNonEmptyRef = useRef(false);
  /** IKILUE：清空命令待复核——带 confirmEmpty 的空保存被 412 拒绝（另一会话已改写画布）后置位。
   *  IKIN23 起升级为整文档待复核：生效期间本会话一切整文档 PUT 均被阻断（无论待发节点数），
   *  冲突响应带回的新 version 仅供提示，不构成重发旧工作副本的许可；
   *  仅在当前项目成功重新水合（加载失败的兜底不算）或项目卸载/切换重置时解除。 */
  const emptyClearConflictRef = useRef(false);
  /** IKILTB：空覆盖被服务端 422 拒后置位。IKIN23 起与 emptyClearConflictRef 同为整文档待复核：
   *  生效期间本会话一切整文档 PUT 均被阻断，入口统一提示刷新复核（重发必再拒且会覆盖另一
   *  会话刚保存的布局）；解除点同 emptyClearConflictRef。 */
  const emptyOverwriteRejectedRef = useRef(false);
  /** IKJJR1：新协议恢复保存冲突（412/409/428 带 reason）——同两款待复核闸门口径：
   *  生效期间阻断整文档保存（本地内容保留，不换版本重发），重新水合后解除。 */
  const recoverySaveConflictRef = useRef(false);
  /* IKJJR3：调速跨项目接续（重试补丁回放/迟到受理暂存）的原页面机制已随家族迁入
   * 生成任务运行时——迟到受理由归属检查丢弃、回原项目水合时由统一恢复按服务端关联
   * 补卡续轮询（新协议由统一恢复负责）。 */

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
      hydratedDocRef.current = null;
      hydratedProjectRef.current = null;
      confirmedNonEmptyRef.current = false;
      emptyClearConflictRef.current = false; // IKILUE：项目卸载/切换重置，清空待复核闸门一并复位
      emptyOverwriteRejectedRef.current = false; // IKILTB：422 阻断标记同步复位
      recoverySaveConflictRef.current = false; // IKJJR1：项目卸载/切换重置恢复保存冲突闸门
      setSaveStatus('idle');
      return;
    }    const docChanged = hydratedDocRef.current !== doc;
    hydratedDocRef.current = doc;
    if (!docChanged) {
      // 仅资产字典变化：刷新节点 URL / 缺失标记，保留当前编辑与保存接口已确认的 version
      const refresh = (prev: Node[]) => {
        const next = prev.map((node) => resolveNodeAssets(node, snapshotAssets));
        return next.some((node, index) => node !== prev[index]) ? next : prev;
      };
      setMediaNodes(refresh);
      setProductNodes(refresh);
      setAssetNodes(refresh);
      return;
    }
    hydratedProjectRef.current = canvasLoadFailed ? null : currentId;
    confirmedNonEmptyRef.current = doc.nodes.length > 0;
    // IKJJR1（A.8/A.9）：新文档水合 = 新加载身份。旧执行链（轮询/受理/保存确认）按身份
    // 自行消亡，运行时在途/台账/意图整体重置，由恢复扫描按服务端事实重建。
    docLoadEpochRef.current = {};
    generationRuntimeRef.current?.reset();
    // IKIN23：仅成功重新水合才解除整文档待复核——加载失败的兜底空文档不算
    //（否则一次失败的刷新会被误判为「已看到服务端最新布局」）
    if (!canvasLoadFailed) {
      emptyClearConflictRef.current = false; // IKILUE：重新水合即解除清空待复核（confirmEmpty 按新基线重新授予）
      emptyOverwriteRejectedRef.current = false; // IKILTB：重新水合解除 422 阻断（空覆盖按新基线重新判定）
      recoverySaveConflictRef.current = false; // IKJJR1：重新水合解除恢复保存冲突闸门（按新基线重新对账）
    }
    const t: Node[] = [];
    const m: Node[] = [];
    const p: Node[] = [];
    const a: Node[] = [];
    // 组伪节点剥离（IKD0JT A3）：type: 'groupFrame' 的持久化形状还原为组名单
    const { groups: hydratedGroups, contentNodes } = parseGroupsFromNodes(doc.nodes);
    contentNodes.forEach((node) => {
      if (node.type === 'textNode') t.push(attachCallbacks(node));
      else if (node.type === 'mediaNode') m.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets, true)));
      else if (node.type === 'productNode') p.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets)));
      else if (node.type === 'assetNode') a.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets)));
      else {
        // 后端节点类型（reference 参考卡 / text 等）：映射为本地节点后归类（映射内部已按资产字典解析/标缺失）
        const mapped = mapBackendNode(node, snapshotAssets);
        if (mapped) {
          const attached = attachCallbacks(resolveNodeAssets(mapped, snapshotAssets, true));
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
    // IKIZQE：checking（提交结果不明核对锁定）同样恢复轮询——核对定夺后终态照常收敛。
    // IKJJR1/IKJJR3/IKJJR7：全部生成中卡（普通生成 + 全部工具家族）归统一任务运行时——
    // claims 全覆盖「生成中 + jobId」形态，水合即时续轮询（恢复扫描随后对账防双链），
    // 页面 else 兜底浅层轮询已随旧骨架删除；插帧生成中卡例外——由下方专属 current 查询
    // 驱动（回填受理冻结输入 frozenParams 后经 resumeFromHydration 进运行时轮询，
    // 工单「插帧历史可信关联恢复保持可用」）。
    m
      .filter(
        (n) =>
          (n.data.genStatus === 'generating' || n.data.genStatus === 'checking') &&
          !((n.data ?? {}) as Record<string, unknown>).frameInterpolation &&
          (typeof n.data.jobId === 'number' || typeof n.data.jobId === 'string') &&
          !settledExtractNodesRef.current.has(n.id),
      )
      .forEach((n) => {
        generationRuntimeRef.current?.resumeFromHydration(n.id, String(n.data.jobId), (n.data ?? {}) as Record<string, unknown>);
      });
    // 插帧卡统一核对服务端当前关联（IKHSFE 可信关联恢复，IKJJR3 保留为插帧专属路径）：
    // 重发受理后关页时持久化可能仍带上一次任务的 jobId（以服务端当前关联为准），同时回填
    // 该任务的冻结输入 frozenParams（失败重试权威来源）。续轮询经 resumeFromHydration 进
    // 统一运行时（恢复扫描按在途判重，不双链——新协议由统一恢复负责对账）。
    m
      .filter(
        (n) =>
          ((n.data ?? {}) as Record<string, unknown>).frameInterpolation != null,
      )
      .forEach((n) => recoverFrameInterpolationRef.current(n.id, n.data.jobId));
    // IKJJR1：恢复扫描（B.5 分页对账）——受理回执丢失补卡、完成未落盘投影、归属版本台账。
    if (currentId && !canvasLoadFailed) void generationRuntimeRef.current?.recover(currentId);
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

  /** 首页智能体附件落画布节点（IKFPOT）：画布水合完成后消费 handoff，
   *  本地上传的 File 走 placeFileOnCanvas 立即落媒体节点（与 Agent 侧边栏「+」上传同链路），
   *  资产库选择项（已有 assetId）直接构造 asset_ref；最终经 externalAssetPicks 通道挂进 AgentPanel 输入框，
   *  不走 inputVersion 通道以避免重置用户已敲的输入文本。声明在水合 effect 之后，确保 doc 已初始化且
   *  水合 setMediaNodes 先于本 effect 的 placeFileOnCanvas 执行，新节点不会被水合覆盖。 */
  const homeHandoffDoneRef = useRef(false);
  useEffect(() => {
    if (!doc) return;
    if (homeHandoffDoneRef.current) return;
    const attachments = takeAgentHandoff();
    if (!attachments || attachments.length === 0) return;
    homeHandoffDoneRef.current = true;
    let cancelled = false;
    const inject = async () => {
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
          try {
            // placeFileOnCanvas：先以 blob 预览落媒体节点，后台三步上传，成功后换永久 URL + assetId
            const result = await placeFileOnCanvas(item.file);
            if (cancelled) return;
            rememberAssetUrl(result.asset_id, result.url);
            blocks.push({
              type: 'asset_ref',
              url: result.url,
              name: item.name,
              media_type: item.kind,
              display_label: item.name,
              asset_id: result.asset_id,
            });
          } catch {
            // placeFileOnCanvas 内部已 toast 失败并移除节点
          }
          URL.revokeObjectURL(item.preview);
        } else {
          console.warn('首页附件缺少 file/assetId，已跳过:', item.name);
        }
      }
      if (!cancelled && blocks.length > 0) {
        setAgentAssetPicks({ ts: Date.now(), blocks });
      }
    };
    void inject();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const adoptCanvasConflictVersion = (error: unknown): boolean => {
    const recovered = readCanvasConflictVersion(error);
    if (recovered === undefined) return false;
    versionRef.current = recovered;
    return true;
  };

  /** IKJJR1：新协议受控错误 reason 读取（B.8；普通 ApiError 无 reason 返回 null）。 */
  const readRecoveryErrorReason = (e: unknown): string | null => {
    if (!isApiError(e)) return null;
    const reason = (e.data as { reason?: unknown } | null | undefined)?.reason;
    return typeof reason === 'string' ? reason : null;
  };

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

  /** IKJKU8：恢复保存结果落定——成功回执或服务端明确拒绝（受控 4xx）即释放保留命令；
   *  响应丢失（网络错误/5xx，结果不明确）保留，供完全相同重试幂等重放。重发在任何结果
   *  下都安全：已保存则命中服务端幂等回读回放原回执，未保存则按原 If-Match 正常首次保存。 */
  const settleRetainedRecoverySave = (projectId: string, commandId: string, failure?: unknown): void => {
    const retained = retainedRecoverySaveRef.current;
    if (!retained || retained.projectId !== projectId || retained.commandId !== commandId) return;
    const definitiveRejection = failure !== undefined
      && isApiError(failure) && failure.status >= 400 && failure.status < 500;
    if (failure === undefined || definitiveRejection) retainedRecoverySaveRef.current = null;
  };

  /** IKJKU8：本次保存的恢复命令计划——完全相同的重试（签名与版本未变）复用保留命令的
   *  身份与完整载荷；否则组新命令并保留至结果落定。
   *  IKJLTY（R6）：同项目存在结果未明确的保留命令时，无论本次签名/版本是否已变，一律先按
   *  原 commandId/完整载荷/原 If-Match 重放确认（服务端幂等先于版本检查：已落库命中回读
   *  返回 replayed 回执与确认版本；未落库按原 If-Match 首存）——新保存意图在确认之后再处理，
   *  不得因本地新编辑直接丢弃未决命令（丢失重放入口后新命令仍携旧版本必吃受控 412）。
   *  服务端请求摘要含 expectedVersion，重放的 If-Match 必须是命令原版本（retained.version）。
   *  ifMatch/sentSignature 供调用方对齐实际落盘内容：确认笔落盘的是原载荷而非本次新编辑。 */
  const planRecoverySave = (
    projectId: string,
    signature: string,
    payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean },
  ): {
    recoveryFields: { commandId: string; recoveryChanges: RecoveryChange[] } | null;
    payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean };
    ifMatch: number | null;
    sentSignature: string;
  } => {
    const retained = retainedRecoverySaveRef.current;
    if (retained != null && retained.projectId === projectId) {
      return {
        recoveryFields: { commandId: retained.commandId, recoveryChanges: retained.recoveryChanges },
        payload: retained.payload,
        ifMatch: retained.version,
        sentSignature: retained.signature,
      };
    }
    // 跨项目保留命令就地作废（既有口径）：新项目的保存不得冒用旧项目命令身份
    if (retained != null) retainedRecoverySaveRef.current = null;
    const recoveryFields = generationRuntimeRef.current?.composeSaveFields() ?? null;
    if (recoveryFields != null) {
      retainedRecoverySaveRef.current = {
        projectId, commandId: recoveryFields.commandId, recoveryChanges: recoveryFields.recoveryChanges,
        payload, version: versionRef.current, signature,
      };
    }
    return { recoveryFields, payload, ifMatch: versionRef.current, sentSignature: signature };
  };

  /** 画布变更后 800ms 防抖自动保存：PUT /api/canvases/:projectId（If-Match 乐观锁） */
  useEffect(() => {
    if (!currentId || !doc || applyingRef.current) return;
    const timer = window.setTimeout(() => {
      if (applyingRef.current || savePromiseRef.current) return;
      // IKIIWN：未成功水合（加载失败/切换中，ref 被置 null）不得自动保存——初始空状态无权覆盖服务端事实
      if (hydratedProjectRef.current === null) return;
      if (textNodesRef.current.some(node => draftErrorsRef.current.has(node.id))) return;
      const contentNodes = [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes];
      // 组伪节点随 nodes 持久化（IKD0JT A3）：水合时剥离还原
      const nodes = [...contentNodes, ...groups.map((g) => groupToNode(g))];
      const sig = JSON.stringify(viewport) + serializeNodes(nodes) + serializeEdges(edges);
      if (sig === lastSavedRef.current) return;
      // IKIN23：整文档待复核（清空 412 / 空覆盖 422）期间阻断一切整文档保存——无论待发
      // 节点数多少，本会话旧工作副本都不得覆盖另一会话刚保存的布局；保留本地编辑等待刷新复核
      if (emptyClearConflictRef.current || emptyOverwriteRejectedRef.current || recoverySaveConflictRef.current) return;
      if (import.meta.env.DEV) {
        console.info(`[canvas] 自动保存：${nodes.length} 个节点 / ${edges.length} 条连线（version=${versionRef.current}）`);
      }
      lastSavedRef.current = sig;
      setSaveStatus('saving');
      // IKILUE：空文档保存的显式确认标记（授予口径见 shouldConfirmEmptyClear）；
      // 412 后据此区分「清空待复核」与普通版本冲突
      const confirmEmpty = shouldConfirmEmptyClear(nodes);
      // 快照本次请求覆盖的未保存新增节点；飞行中再新增的留给下一轮保存
      const pendingSnapshot = new Set(pendingNodeIdsRef.current);
      // IKJJR1：恢复保存（有显式待确认状态时）与新协议字段同笔提交；回执回填台账。
      // IKJKU8：回执丢失后的完全相同重试复用保留命令原载荷与 If-Match 重发（幂等回放）。
      // IKJLTY（R6）：有未决命令时本笔先为确认笔（原载荷/原 If-Match 重放）；sentSignature
      //  记录实际落盘内容签名——确认笔成功后新编辑签名未对齐，saveEpoch 推进触发下轮再存。
      const plan = planRecoverySave(
        currentId, sig, { viewport, nodes, edges, confirmEmpty },
      );
      const { recoveryFields, payload: recoveryPayload } = plan;
      trackCanvasSave(
        (recoveryFields
          ? putCanvasDocWithRecovery(
            currentId,
            recoveryPayload,
            plan.ifMatch,
            { recoveryProtocolVersion: 1, commandId: recoveryFields.commandId, recoveryChanges: recoveryFields.recoveryChanges },
          )
          : saveCanvasDoc(currentId, { viewport, nodes, edges, confirmEmpty }, versionRef.current)
        ).then((saved) => {
          if (recoveryFields) {
            generationRuntimeRef.current?.onSaveReceipt((saved as CanvasRecoverySaveData).recoveryReceipt);
            settleRetainedRecoverySave(currentId, recoveryFields.commandId);
          }
          return saved;
        })
          .then((saved) => {
            versionRef.current = saved.version;
            // IKIMQK / IKJLTY：成功落账三件套见 settleSavedCanvas——仅本次新编辑真正落盘
            //  （非确认笔）才核销新增节点快照，实际落盘签名对齐驱动下轮防抖补存新内容
            settleSavedCanvas(plan, sig, () => pendingSnapshot.forEach((id) => pendingNodeIdsRef.current.delete(id)));
            setSaveBlocked(false);
            setSaveStatus(textNodesRef.current.some(node => draftErrorsRef.current.has(node.id)) ? 'error' : 'saved');
            setSaveEpoch(value => value + 1);
            setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
          })
          .catch((e) => {
            // 释放签名，允许下次变更或「重试保存」用已对齐的 version 再写
            lastSavedRef.current = '';
            // IKJKU8：结果落定——明确拒绝（4xx）释放保留命令，响应丢失保留供重放
            if (recoveryFields) settleRetainedRecoverySave(currentId, recoveryFields.commandId, e);
            // IKJLTY：确认笔未携带本次新增节点——其失败不得回滚用户新编辑
            const hadPendingAdds = pendingSnapshot.size > 0 && plan.sentSignature === sig;
            // IKJJR1（验收 8）：新协议保存冲突（受控错误带 data.reason）保留本地内容并提示，
            // 不采纳服务端版本重发旧全文；登记恢复冲突闸门，直至重新水合。
            const recoveryReason = readRecoveryErrorReason(e);
            if (recoveryFields && recoveryReason === 'recovery_item_conflict') {
              // 项状态被他处推进：定向 resolve 读回服务端现状进台账（本地内容保留），下次保存重推导
              void generationRuntimeRef.current?.reconcileConflictItems(currentId);
              setSaveBlocked(true);
              setSaveStatus('error');
              showToast('warn', '任务状态已被其他操作更新，已同步最新状态，请重试保存');
              return;
            }
            if (recoveryFields && recoveryReason != null) {
              recoverySaveConflictRef.current = true;
              setSaveBlocked(true);
              setSaveStatus('error');
              showToast('warn', '画布保存冲突，当前内容已保留，请刷新后复核');
              return;
            }
            // 普通保存撞「受保护卡缺席未带变更」（428）：恢复台账可能滞后（水合后扫描未完），
            // 触发对账刷新台账后引导重试，不阻断编辑。
            if (!recoveryFields && readRecoveryErrorReason(e) === 'recovery_protocol_required') {
              void generationRuntimeRef.current?.recover(currentId);
              setSaveBlocked(true);
              setSaveStatus('error');
              showToast('warn', '画布包含任务恢复保护内容，正在同步状态，请稍后重试保存');
              return;
            }
            const aligned = adoptCanvasConflictVersion(e);
            if (aligned) {
              // IKILUE：带 confirmEmpty 的清空保存被 412 拒绝——另一会话已改写画布，重发旧空文档
              // 会覆盖对方成果。登记清空待复核闸门（保留本地编辑、阻止空文档再次自动/手动发出），
              // 直至重新水合服务端最新画布
              if (confirmEmpty) {
                emptyClearConflictRef.current = true;
                showToast('warn', EMPTY_CLEAR_CONFLICT_TOAST);
              }
              setSaveBlocked(true);
              setSaveStatus('error');
              return;
            }
            setSaveBlocked(true);
            if (isApiError(e) && e.status === 412) {
              setSaveStatus('error');
              showToast('warn', '画布版本冲突，当前编辑已保留，请先复制正文再刷新复核');
            } else if (isApiError(e) && e.status === 422) {
              // IKIIWN：空覆盖被服务端拒绝（本地空状态与服务端非空事实不一致）——重试必然再拒，引导刷新复核
              // IKILUG：文案提取为共享常量，项目切换强制保存/手动重试同口径（见 EMPTY_OVERWRITE_REJECTED_TOAST）
              // IKILTB：登记 422 阻断——saveBlocked 期间项目切换/返回首页提示刷新复核而非笼统重试
              emptyOverwriteRejectedRef.current = true;
              setSaveStatus('error');
              showToast('warn', EMPTY_OVERWRITE_REJECTED_TOAST);
            } else {
              if (hadPendingAdds) rollbackPendingNodes(pendingSnapshot);
              setSaveStatus('error');
              showToast('error', hadPendingAdds ? '添加失败，请重试' : '保存失败，请重试');
              console.warn('画布自动保存失败:', e);
            }
          }),
      );
    }, 800);
    return () => window.clearTimeout(timer);
  }, [textNodes, mediaNodes, productNodes, assetNodes, edges, groups, viewport, currentId, doc, refetch, applying, saveEpoch, rollbackPendingNodes, showToast]);

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
      // IKJJR1（B.4）：复制剥离生命周期标记——复制卡不是原任务的第二个承接目标
      delete (copy.data as Record<string, unknown>).generationRecovery;
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
      // IKJJR1（B.4）：粘贴副本剥离生命周期标记（同立即复制口径）
      delete data.generationRecovery;
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
    /** 一键修复「改为跟随视频并重试」（IKJ79D）：比例约束失败卡专用 */
    fixFollowVideo: (_id: string) => {},
    removeMediaNode: (_id: string) => {},
    download: (_id: string) => {},
    showDetails: (_id: string) => {},
    firePendingGen: () => {},
    firePendingVideoDraft: () => {},
    renameCard: (_id: string, _name: string) => {},
  });
  actionsRef.current = { ...actionsRef.current, duplicate: handleDuplicateNode, addToChat: handleAddToChatNode, renameCard };


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
    caps?: VideoRefCapabilities | null,
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
    const msg = checkAddVideoRef(role, data.mediaType as 'image', assetId, slotCleared, caps, [sourceMaterialId]);
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
    const check = checkVideoFrameReplace(node, refs, role, videoCapsOfDraft(targetId));
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
    generationDock.updateDraft('video', { freeReference: { operation: 'replace', item, role } });
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
        if (!validateAudioTextConnect(node.id, audioPickSession)) return;
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
      showToast('warn', PANEL_REF_MEDIA_TYPES.audio.canvasRefError);
      return;
    }
    // 自由面板会话（无草稿绑定）：文本参考无绑定目标，与旧单次语义同口径提示
    if (node.type === 'textNode') {
      showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if (node.type !== 'mediaNode') {
      showToast('warn', PANEL_REF_MEDIA_TYPES.audio.canvasRefError);
      return;
    }
    // 自由面板注入沿用 externalPick 通道，面板 addRef 内统一去重、混用与上限提示
    const err = audioRefSourceError(node);
    if (err) {
      showToast('warn', err);
      return;
    }
    const incomingType = audioRefMediaTypeOf(data) ?? 'audio';
    setAudioPickResult({
      ts: Date.now(),
      item: {
        id: node.id,
        kind: incomingType,
        mediaType: incomingType,
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
    // 六会话四退出之「点其他卡」（node-click 拦截，仅抠图/扩图）：点其他卡退出会话并选中
    // 那张卡、点源卡本身保持会话，两种都消费（不落入下方普通选中/开面板分支——同次点击
    // 不开普通面板）；规则集中在 toolSessionCoordinator。其余四工具不拦截，交还原流程
    if (toolRuntime.onNodeClick(node.id, buildToolSessionDeps()) === 'consumed') return;
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
      // 高清/HD 身份卡优先（IKHFUF）：不依赖 draft/jobId，点卡必开对应参数面板，
      // 并与上方操作条并存。用 else-if 避免再落入普通生成面板。
      const toolDraft = toolSessions.draft(node);
      if (toolDraft) {
        openCoordinatedToolDraft(node, toolDraft.open);
      } else if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'image') {
        openImageDraftDialog(node.id);
      } else if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'video') {
        openVideoDraftDialog(node.id);
      } else if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'audio') {
        openAudioDraftDialog(node.id);
      } else if (node.type === 'textNode' && data.textGen === true) {
        openTextGenDialog(node.id, 'nodeClick');
      } else if (node.type === 'mediaNode' && hasGenerationRecord(node)) {
        // IKDMQU P1：单选有生成记录的成品卡自动打开对应生成面板（编辑写回原卡，发送后原卡重新生成）；
        // 上传素材卡无生成记录，不自动打开（Q4）；重新生成中/失败态的卡 jobId 仍在，可打开查看或调整重发
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
      generationDock.referencePicked('video');
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
      generationDock.referencePicked('video');
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
  const closeVideoDialog = () => generationDock.close('video');
  const closeAudioDialog = () => generationDock.close('audio');
  const closeTextGenDialog = () => generationDock.close('text');
  const closeMusicDialog = () => generationDock.close('music');
  const dismissGenPanels = () => generationDock.dismissAll('ordinary');
  const dismissAllGenPanels = () => generationDock.dismissAll();

  /** 页面仅提供生成面板关闭与节点选中能力，会话状态和完整退出由运行时拥有。 */
  const buildToolSessionDeps = (): ToolSessionDeps => ({
    dismissGenPanels,
    selectNode: (nodeId) => setSelectRequest({ id: nodeId, ts: Date.now() }),
  });

  /** 编辑会话激活（IKGZ5O 派生布尔，不新增状态机）：抠图/扩图/裁切/擦除/去字幕/音视频分离/
   *  音频截取/音频调速/场景切分/音视频合成任一会话进行中——界面处于「工具状态」：Dock 六面板不可开（打开请求
   *  先退会话再放行，见 exitEditSessionForGenPanel），媒体卡悬浮工具条整条不渲染（show 门）。 */
  const editSessionActive = toolRuntime.hasEditSession();
  /** IKGZ5O 会话期打开生成面板的统一前置（IKH3ZJ 收口经协调 module）：退出全部活跃
   *  编辑会话（四路退出口径，未发送参数全部丢弃），面板随后放行打开；无会话时为幂等
   *  空操作。「哪些会话活跃、逐个怎么退」的判断只在 toolSessionCoordinator。 */
  const exitEditSessionForGenPanel = () => {
    toolRuntime.beforeGenPanel();
  };

  /** 画布空白处单击（React Flow PaneClick，拖拽平移后天然不触发——任何拖拽平移都不会误关）：
   *  IKFYH6 拍板 4——持续选取会话/单次选取进行中点空白只退选取，面板保留（再点一次空白才关）；
   *  否则五面板统一关闭（推翻视频面板「点空白不关」旧设计；面板编辑实时写回节点 data，隐藏不丢内容）。
   *  onSelectionChange 的空选中可能是「取消旧选中→选中新卡」的过渡事件，不能作为关闭依据（IKDMQV）。 */
  const handleCanvasPaneClick = () => {
    cancelAgentCandidate();
    // 六会话四退出之「点画布空白」：任一会话活跃即退出并消费本次点击（丢弃未发送参数），
    // 规则集中在 toolSessionCoordinator——不落入选取会话/选取模式/面板关闭链
    if (toolRuntime.onPaneClick() === 'consumed') return;
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
    // IKGYYD 钉屏幕工具栏跟随目标：唯一选中节点回写；放最前，早退分支不阻断。
    // 事件参数在程序化改选中时会滞后误报（React Flow 内部 selection store 与受控 nodes
    // 的同步窗口：侧栏新建草稿 deselect 旧卡 + select 新卡，事件可能报旧卡+新卡双选中，
    // 把刚打开的面板当多选误关）——以受控 state 为准：state 明确 selected:false 的排除。
    // 一次计算两用：soloId 即工具栏跟随目标（IKGYYB 审查消重复 filter）
    const candidates = nodes.filter((n) => {
      const m = mediaNodesRef.current.find((x) => x.id === n.id);
      if (!m || m.selected !== false) return true;
      // 父层 selected:false 只消化「程序化双选滞后」（同批里还有父层认选中的新卡）。
      // 用户点到一张父层仍记为未选中的卡时，报告里没有权威选中项，必须保留该卡；
      // 否则第一次点击会被当成空选中：旧对话框不关、新对话框也不开（IKFOHK）。
      return !nodes.some((other) => mediaNodesRef.current.find((x) => x.id === other.id)?.selected === true);
    });
    const soloId = candidates.length === 1 ? candidates[0]!.id : null;
    setSoloSelectedNodeId(soloId);
    if (pickMode || pickTarget) return;
    // 六会话四退出之「选中变化」（选中规范化退出，规则集中在 toolSessionCoordinator）：
    // 抠图/扩图活跃时冻结面板联动（返回 true 即 return——会话内点其他卡已由 onNodeClick
    // 拦截处置，程序化选中触发的变化不应误关其他状态）；擦除/裁切/去字幕/分离按单选其他卡
    // 或多选退出，退出后不 return 继续走下方面板联动（同轮不开面板由下方「本轮渲染的旧
    // editSessionActive」门挡住——IKFOHK 同一手势多次通知无重复副作用的既有机制）
    if (toolRuntime.onSelectionChange(
      { soloId, multiSelect: candidates.length > 1 },
    )) return;
    // IKFOHK：单选草稿/成品生成卡时原子切换到对应对话框。选中变化经 React Flow
    // useEffect 到达，可能早于或代替 onNodeClick（nodeDragThreshold=1 时轻微位移会吞掉 click）。
    // 已打开同一绑定则交给下方 syncPanelVisible 保持，避免重复 seed 导致面板重挂载。
    if (soloId && !editSessionActive) {
      const mediaNode = mediaNodesRef.current.find((n) => n.id === soloId);
      const mediaData = (mediaNode?.data ?? {}) as Record<string, unknown>;
      const toolDraft = mediaNode && toolSessions.draft(mediaNode);
      // IKIHPK：合成草稿卡不落本路径（面板由身份卡优先链与建卡入口打开，
      // 不能落到视频生成面板；会话内选中变化由上方 editSessionActive 门挡住）
      if (mediaNode && !mediaData.audioVideoMux && (
        mediaData.draft === true
        || hasGenerationRecord(mediaNode)
        || Boolean(toolDraft)
      )) {
        const mediaType = mediaData.mediaType;
        // IKFXZD/IKDMQV：面板刚被显式关闭（发送成功即隐藏、空白点击）时处于 hidden 豁免期，
        // 程序化选中不得经本路径回弹重开——口径同下方 syncPanelVisible 的 hiddenRef 拦截
        //（发送路径「置 hidden 标记避免紧随的画布选中事件回弹重开」）；手动点卡经 onNodeClick
        // 走 openXxxDraftDialog 重置豁免，照常重开。
        const panelHidden = toolDraft ? toolDraft.hidden : false;
        const alreadyOpen = toolDraft ? toolDraft.visible
          : mediaType === 'video' ? showBottomDialog && videoDraftId === soloId
          : mediaType === 'audio' ? showAudioDialog && audioDraftId === soloId : showImageDialog && imageDraftId === soloId;
        if (!alreadyOpen && !panelHidden) {
          if (openMediaDraftDialog(soloId, mediaType, 'selection') !== false) return;
        }
      }
    }
    generationDock.selection({ soloId, multiSelect: candidates.length > 1, editing: editSessionActive, submittingNodeId });
  };

  /** IKIJ60：下传 FlowCanvas 的选中处理函数同步稳定化——页面每轮渲染重建
   *  handleSelectionChange 会连带容器每轮渲染重建传给 ReactFlow 的包裹，使
   *  SelectionListener 的等值通报无限再生（草稿面板切换滚成 Maximum update depth
   *  exceeded）。ref 每轮赋值保证始终调最新闭包，处理逻辑本身不动（禁 useCallback+
   *  依赖数组重构：上方函数闭包捕获态过多，stale 闭包风险），对外只暴露空依赖稳定壳。 */
  const handleSelectionChangeRef = useRef(handleSelectionChange);
  handleSelectionChangeRef.current = handleSelectionChange;
  const handleSelectionChangeStable = useCallback(
    (params: OnSelectionChangeParams) => handleSelectionChangeRef.current(params),
    [],
  );

  /** IKFYH6 画布外 UI 点击关闭：document 捕获阶段 click——捕获先于 React 事件处理器执行，
   *  同一次点击先到此（面板尚未因该点击打开），「刚打开的面板」不会被误关。
   *  豁免：「面板领土」（五面板根 + @菜单/资产弹窗等 portal 浮层，data-gen-panel-territory 标记）、
   *  画布区域（.react-flow，空白归 PaneClick、节点归 selection sync）；右键/中键不关（button!==0）。
   *  用 click 不用 mousedown，并校验按下与抬起位移：拖拽平移/框选拖出画布边缘产生的 click 不算原地点击。 */
  const anyGenPanelOpen =
    showBottomDialog || showImageDialog || showAudioDialog || showTextGenDialog || showMusicDialog || toolSessions.hasPanel();
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
   *  （复用 isEditableKeyboardTarget）→ 抠图/扩图让位专属 handler → 擦除/去字幕/音视频分离/
   *  裁切编辑态按 module 顺序退出（未发送丢弃）→ 其余情况关闭五面板。六会话的让位与退出
   *  顺序知识集中在 toolSessionCoordinator（escDefersToToolSessionHandler / exitToolSessionOnEsc）。 */
  useEffect(() => {
    if (!anyGenPanelOpen && !toolRuntime.hasEscExitSession()) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-canvas-keyboard-scope="mention"]')) return;
      if (isEditableKeyboardTarget(event.target)) return;
      // 抠图/扩图有自己的 Esc handler（专属处置先于本链，含输入框豁免与 preventDefault）——让位
      if (toolRuntime.escDefersToToolSessionHandler()) return;
      if (imagePickSessionActive || videoPickSessionActive || audioPickSessionActive) return;
      if (pickMode || pickTarget) {
        resetPickState();
        return;
      }
      // 擦除→去字幕→音视频分离→裁切顺序退出首个活跃会话（顺序在 module）；交还则关五面板
      if (toolRuntime.onEscape()) return;
      dismissAllGenPanels();
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyGenPanelOpen, editSessionActive, imagePickSessionActive, videoPickSessionActive, audioPickSessionActive, pickMode, pickTarget]);


  /** 节点拖拽结束：同步本次全部拖动节点的新坐标到父组件 state，触发自动保存。
   *  多选整组拖拽时 React Flow 第三参含同组全部节点；只回写被抓取节点会让父层坐标过期，
   *  下一次媒体合并 effect 用过期坐标覆盖画布内部状态，导致同组节点跳变（IKDKII 验收缺陷） */
  const handleNodeDragStop = (_node: Node, draggedNodes: Node[]) => {
    // nodeDragThreshold=1 时轻微位移会吞掉 click。高清/HD 成品卡若只挪了几像素，
    // 按点卡处理：打开参数面板并露出上方操作条（IKHFUF）。
    if (draggedNodes.length === 1) {
      const dragged = draggedNodes[0]!;
      const before = mediaNodesRef.current.find((n) => n.id === dragged.id);
      const data = (dragged.data ?? {}) as Record<string, unknown>;
      if (
        before
        && Math.abs(dragged.position.x - before.position.x) <= 4
        && Math.abs(dragged.position.y - before.position.y) <= 4
        && (data.imageEnhance || data.videoEnhance)
      ) {
        handleCanvasNodeClick(dragged);
      }
    }
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

  actionsRef.current.openImageDialog = () => generationDock.open('image', {});

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
   *  高清卡（imageEnhance 标记）分流到高清放大面板并回填 lastParams（IKGM9O，规格故事 32）；
   *  HD 卡（videoEnhance 标记）分流到 HD 面板并恢复分辨率（IKH3VG，不进视频生成面板）；
   *  插帧卡（frameInterpolation 标记）分流到插帧面板并恢复帧率档（IKHLKR，同款分流） */
  const openMediaDraftDialog = (nodeId: string, mediaType: unknown, intent?: 'selection') => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const toolDraft = node && toolSessions.draft(node);
    if (toolDraft) { openCoordinatedToolDraft(node!, toolDraft.open); return; }
    if (mediaType === 'video') return generationDock.open('video', { nodeId, intent });
    if (mediaType === 'audio') return generationDock.open('audio', { nodeId, intent });
    return generationDock.open('image', { nodeId, intent });
  };

  const openImageDraftDialog = (nodeId: string) => generationDock.open('image', { nodeId });
  useEffect(() => { generationDock.reconcile(); }, [generationDock, imageDraftId, imageSeed, mediaNodes]);

  /** IKFR4X 会话随面板结束：图片面板不可见（关闭 Dock / 切换其他面板 / 目标删除清理）即结束持续选取会话；
   *  已建参考与连线保留，重开面板为普通模式（不恢复会话，刷新/切换画布同理不恢复） */
  useEffect(() => {
    if (imagePickSession === undefined) return;
    if (!showImageDialog) endImagePickSession();
  }, [showImageDialog, imagePickSession, endImagePickSession]);

  /** 擦除编辑态绑定清理（IKGOT7/IKGOTB）：目标源图卡被删除时退出编辑态并丢弃遮罩，防工具条悬挂 */


  /** 去字幕编辑态绑定清理（IKGZ83）：目标源视频卡被删除时退出编辑态并丢弃框与开关状态，
   *  防工具条/发送条悬挂（口径同擦除绑定清理） */


  useEffect(() => {
    toolRuntime.reconcileSources(new Set(mediaNodes.map((node) => node.id)));
  }, [toolRuntime, mediaNodes]);

  /** 智能抠像编辑态绑定清理（IKHK9N）：目标源视频卡被删除时退出编辑态，防浮条悬挂
   *  （口径同场景切分绑定清理） */


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


  /** IKGOQX 扩图会话绑定清理：源图卡被删除时结束会话（其余退出路径见统一退出函数） */


  useEffect(() => { generationDock.reconcile(); }, [generationDock, textGenDraftId, textNodes]);

  const openVideoDraftDialog = (nodeId: string, preset?: VideoGenSeedParams) => generationDock.open('video', { nodeId, preset });

  /** 新建视频草稿卡（IKDMQS 统一入口共用）：seed 字段写入草稿 data 持久化键并自动选中，返回节点 id；
   *  overrides（IKH3VG 视频 HD 复用同一骨架，口径同 createImageDraftCard）：fileName 覆盖初始
   *  标题，data 附加节点身份字段（如 HD 标记）；
   *  草稿不进 pendingNodeIds 回滚集合——保存失败时草稿与当前编辑保留，随下次保存重试 */
  const createVideoDraftCard = (seed?: {
    modelId?: string;
    ratio?: string;
    size?: string;
    duration?: number;
    mode?: string;
    /** IKG0LP：是否带音频（随草稿 data 持久化） */
    generateAudio?: boolean;
  }, position?: { x: number; y: number }, overrides?: { fileName?: string; data?: Record<string, unknown>; recordHistory?: boolean }): string => {
    const nodeId = newNodeId('media-draft');
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: position ?? spawnDraftPosition(),
      selected: true,
      data: {
        src: '',
        mediaType: 'video',
        fileName: overrides?.fileName ?? '视频草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        ...(overrides?.data ?? {}),
        toolMode,
        ...(seed?.modelId != null ? { draftModelId: seed.modelId } : {}),
        ...(seed?.ratio != null ? { draftRatio: seed.ratio, targetRatio: seed.ratio } : {}),
        ...(seed?.size != null ? { draftSize: seed.size } : {}),
        ...(seed?.duration != null ? { draftDuration: seed.duration } : {}),
        // IKIPSX（IKGUXU D-01）：seed 缺失时也按新建场景（参考集合恒为空）派生默认模式写入，
        // 与面板默认显示同源——否则用户全程不碰模式选择器时 draftMode 不落盘，
        // 参考集合变化后重开面板模式解释漂移，违反 IKF93U 用户故事 15。
        draftMode: seed?.mode ?? firstEnabledVideoMode(enabledVideoFollowModes({ reference: [] })),
        ...(seed?.generateAudio != null ? { draftGenerateAudio: seed.generateAudio } : {}),
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        ...dockToolCallbacks,
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
    if (overrides?.recordHistory) historyRef.current?.pushAddNodes([nodeId]);
    return nodeId;
  };

  /** 音频生成草稿卡，落在指定点 */
  const createAudioDraftCard = (
    position?: { x: number; y: number },
    opts?: { recordHistory?: boolean },
  ): string => {
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
        onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        ...dockToolCallbacks,
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
    if (opts?.recordHistory) historyRef.current?.pushAddNodes([nodeId]);
    return nodeId;
  };

  /** 图片生成草稿卡，落在指定点。overrides（IKGM9F 高清放大复用同一骨架）：
   *  fileName 覆盖初始标题，data 附加节点身份字段（如高清标记），nodeId 指定节点 id
   *  （IKGOTB 擦除结果卡：node id 即任务冻结的 target_node_id，发送前生成），回调不可覆盖；
   *  skipSelect（IKGW1S 裁切成品卡）= 不抢选中：新卡 selected 为 false、不取消其他卡选中、
   *  不发 selectRequest（默认 false，既有调用点行为不变）。 */
  const createImageDraftCard = (
    position?: { x: number; y: number },
    overrides?: { fileName?: string; data?: Record<string, unknown>; nodeId?: string; skipSelect?: boolean; recordHistory?: boolean },
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
        onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        ...dockToolCallbacks,
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
    } else {
      setTextNodes(deselect);
      setProductNodes(deselect);
      setAssetNodes(deselect);
      const nextMedia = [...deselect(mediaNodesRef.current), node];
      mediaNodesRef.current = nextMedia;
      setMediaNodes(nextMedia);
      setSelectRequest({ id: nodeId, ts: Date.now() });
    }
    if (overrides?.recordHistory) historyRef.current?.pushAddNodes([nodeId]);
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
          generationDock.writeSelf('text');
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

  const openTextGenDialog = (nodeId: string, intent?: 'nodeClick') => generationDock.open('text', { nodeId, intent });

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
    withHistoryBatch(() => {
      let targetId = '';
      if (kind === 'video') {
        targetId = createVideoDraftCard(undefined, position, { recordHistory: true });
        connectMenuSourcesToDraft(sourceIds, targetId, 'video');
        openVideoDraftDialog(targetId);
        return;
      }
      if (kind === 'image') {
        targetId = createImageDraftCard(position, { recordHistory: true });
        connectMenuSourcesToDraft(sourceIds, targetId, 'image');
        openImageDraftDialog(targetId);
        return;
      }
      if (kind === 'audio') {
        targetId = createAudioDraftCard(position, { recordHistory: true });
        connectMenuSourcesToDraft(sourceIds, targetId, 'audio');
        openAudioDraftDialog(targetId);
        return;
      }
      targetId = createTextGenDraft(position);
      sourceIds.forEach((id) => addCanvasEdge(id, targetId));
      openTextGenDialog(targetId);
    });
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
    // IKIHPK：拖线手势结束即复位面板「绑定中跟手」态（落草稿卡成绑定、落空白/其他卡回引导）
    toolSessions.wireStart(null);
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
    // IKIHPK：目标为合成草稿卡时按「视频成品卡可绑定」预览 hover 合法性
    // （不落入生成能力集/角色判定；与 connectPair 的落点分流同一识别口径）
    if (isAudioVideoMuxDraftNode(targetNode)) return audioVideoMuxVideoError(sourceNode) === null;
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
  useEffect(() => { generationDock.reconcile(); }, [generationDock, videoDraftId, videoSeed, mediaNodes]);

  /** 打开绑定指定草稿的音频面板（IKDMQT）：带入草稿已保存的文字描述与模型。
   *  IKFDFZ：媒体参考改为「来源→草稿」连线持久化；存量 data.audioRefs 的画布项
   *  首次打开时迁移为连线（按节点 id 找回来源），迁移后清空旧字段——画布项不再经 seed 恢复；
   *  IKFR4Z：重开/切换面板即结束残留的持续选取会话（重开为普通模式，不恢复选取）；
   *  IKIJ61：seed 内容等值（除 ts）时跳过写入；关闭视频/图片面板的路径同步清理其草稿绑定，
   *  不留幽灵绑定（口径同 openVideoDraftDialog 互关清绑定） */
  const openAudioDraftDialog = (nodeId: string) => generationDock.open('audio', { nodeId });
  useEffect(() => { generationDock.reconcile(); }, [generationDock, audioDraftId, audioSeed, mediaNodes]);

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
    if (submittingNodeId || audioMixInFlightRef.current) {
      showToast('warn', '正在保存并提交，请稍候');
      return false;
    }
    // IKIN23：整文档待复核（清空 412 / 空覆盖 422）期间中止切换——未保存的本地编辑不得被误认为已落盘
    if (blockedByPendingCanvasReview()) return false;
    if (saveBlocked) {
      showToast('warn', '保存失败，请重试');
      return false;
    }
    if (!currentId || !doc) return true;
    const projectId = currentId;
    applyingRef.current = true;
    try {
      const saved = await flushCanvasSave(projectId);
      if (audioMixInFlightRef.current) {
        showToast('warn', '正在保存并提交，请稍候');
        return false;
      }
      return saved;
    } catch (e) {
      // IKILTB：412 闸门/422/笼统三分叉提示统一走 helper（口径见 showCanvasSaveFailureToast）
      showCanvasSaveFailureToast(e);
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

  /** 置顶/取消置顶：成功后全量重拉列表（服务端排序直出），不动 currentId；并同步项目卡片页缓存 */
  const handleToggleProjectPin = (id: string, pinned: boolean) => {
    pinProject(id, pinned)
      .then(() => fetchProjects())
      .then((list) => {
        setProjects(list.map((p) => ({ id: String(p.id), name: p.name, pinned: Boolean(p.pinned_at) })));
        // 项目卡片页缓存需同步置顶口径；置顶失败不回滚本地，下次重拉自然校正。
        queryClient.invalidateQueries({ queryKey: projectKeys.all });
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
      onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
      onDownload: (id: string) => actionsRef.current.download(id),
      ...dockToolCallbacks,
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
        const compliancePatch = compliancePatchFromMaterialStatus(
          mediaType,
          done.material_id,
          done.material_status,
        );
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
                ...compliancePatch,
              },
            };
          }),
        );
        if (done.asset_id && done.url && typeof upsertAssets === 'function') {
          upsertAssets([{
            asset_id: Number(done.asset_id),
            type: mediaType,
            access_url: done.url,
            width: typeof done.width === 'number' ? done.width : null,
            height: typeof done.height === 'number' ? done.height : null,
            material_id: done.material_id ?? null,
            material_status: done.material_status ?? null,
          }]);
        }
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
      if (isUnapprovedVideoMaterialStatus(asset.material_status)) {
        return {
          ...(materialId ? { materialId } : {}),
          compliancePassed: false,
          complianceFailed: true,
        };
      }
      if (asset.material_status !== 'Active' && !fromLibrary) return {};
      if (fromLibrary && asset.material_status !== 'Active') {
        return materialId ? { materialId } : {};
      }
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
          onDownload: (id: string) => actionsRef.current.download(id),
          ...dockToolCallbacks,
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
      const unapproved = accepted.filter((a) => isUnapprovedVideoMaterialStatus(a.material_status));
      if (unapproved.length > 0) {
        showToast('warn', VIDEO_REFERENCE_NOT_APPROVED_MESSAGE);
        accepted = accepted.filter((a) => !isUnapprovedVideoMaterialStatus(a.material_status));
        if (accepted.length === 0) return;
      }
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
          if (validateVideoRefConnect(nodeIds[0]!, videoDraftId, frameRoles[i] ?? role)) {
            addCanvasEdge(nodeIds[0]!, videoDraftId, frameRoles[i] ?? role);
          }
        }
        return;
      }
      // 普通参考：图/视频/音频分类上限与连线+material 合并联算（ADR-0086：读草稿绑定模型的能力行，
      // 与 checkAddVideoRef 同口径；模型未解析回落缺省 9/3/3）；assetId / materialId 互通查重（TC_DG_205）
      const caps = videoCapsOfDraft(videoDraftId);
      const imageMax = caps?.imageMax ?? 9;
      const videoMax = caps?.videoReferenceMax ?? 3;
      const audioMax = caps?.audioReferenceMax ?? 3;
      const known = occupiedVideoRefIds(refs);
      let imgSlots = imageMax - refs.reference.filter((r) => r.mediaType === 'image').length;
      let vidSlots = videoMax - refs.reference.filter((r) => r.mediaType === 'video').length;
      let audSlots = audioMax - refs.reference.filter((r) => r.mediaType === 'audio').length;
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
      if (overflowKinds.length > 0) showToast('warn', refOverflowToast(overflowKinds, { image: imageMax, video: videoMax, audio: audioMax }));
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
        nodeIds.forEach((nid) => {
          if (validateVideoRefConnect(nid, videoDraftId, role)) {
            addCanvasEdge(nid, videoDraftId, role);
          }
        });
      return;
    }
    if (target === 'audioDialog') {
      // 弹窗确认只能接纳到打开时的面板，切换/关闭/生成中均不创建来源或连线。
      if (!showAudioDialog || !audioAssetPickTarget || audioAssetPickTarget.nodeId !== audioDraftId
        || audioAssetPickTarget.seed !== audioSeed?.ts || (audioDraftId && isGeneratingNode(audioDraftId))) return;
      const mediaAssets = assets.filter(a => a.type === 'audio' || a.type === 'image');
      if (!audioDraftId) {
        setAudioAssetPickResult({ ts: Date.now(), items: mediaAssets.map(a => {
          const kind = audioRefItemMediaTypeOf({ kind: a.type });
          return {
          id: `asset-${a.id}`,
          kind,
          mediaType: kind,
          name: assetDisplayName(a), src: a.url,
          source: 'canvas' as const, assetId: a.id,
        }; }) });
        return;
      }
      const current = [...mergedAudioRefsWithTextIndex(
        audioDraftId,
        edgesRef.current,
        mediaNodesRef.current,
        textNodesRef.current,
      ).refs];
      const accepted: AssetRecord[] = [];
      for (const asset of mediaAssets) {
        const id = String(asset.id);
        const incomingType = audioRefItemMediaTypeOf({ kind: asset.type });
        const error = checkAddAudioRef(id, current, 0, incomingType);
        if (error) { showToast('warn', error); continue; }
        current.push({ nodeId: `asset-${id}`, assetId: id, url: asset.url, name: assetDisplayName(asset), mediaType: incomingType });
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
        // 上限读草稿绑定模型的 image_reference_max（ADR-0086，此前写死 10）
        const imageMax = imageRefMaxOfDraft(imageDraftId);
        const accepted: AssetRecord[] = [];
        let skippedDup = false;
        let overflow = false;
        for (const a of images) {
          const id = String(a.id);
          if (known.has(id)) { skippedDup = true; continue; }
          if (known.size >= imageMax) { overflow = true; break; }
          known.add(id);
          accepted.push(a);
        }
        if (skippedDup) showToast('warn', '重复的素材已跳过');
        if (overflow) showToast('warn', refOverflowToast(['image'], { image: imageMax }));
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

  /** 模型能力列表最新值（避开 useCallback 闭包陈旧，口径同 nodes ref） */
  const videoModelsRef = useRef<GenerationModel[]>([]);
  videoModelsRef.current = videoModels;
  const imageModelsRef = useRef<GenerationModel[]>([]);
  imageModelsRef.current = imageModels;

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
  /** 撤销/重做栈（IKD0JT A2）：覆盖移动/删除/复制/连线/删边；生成任务不登记（PRD §7.2），工具栏新建草稿卡由调用方登记 */
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
      if (eraseHistoryRef.current.active) {
        if (action === 'redo') eraseHistoryRef.current.redo();
        else eraseHistoryRef.current.undo();
        return;
      }
      if (action === 'redo') canvasHistory.redo();
      else canvasHistory.undo();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
    // undo/redo 为 hook 内稳定 useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasHistory.undo, canvasHistory.redo]);
  /** 取消接口已确认成功的节点：忽略仍在飞行中的旧轮询响应。 */
  const locallyRemovedGenerationNodesRef = useRef<Set<string>>(new Set());
  /** 已本地收敛的提取节点：快照若仍停留在 generating，水合不得再开轮询。 */
  const settledExtractNodesRef = useRef<Set<string>>(new Set());
  /** 节点当前活跃任务登记（IKDMQV）：轮询启动即同步写入，响应到达时核对——
   *  迟到旧任务响应（创建/重试后仍在飞行的旧 promise）直接丢弃，不覆盖当前任务状态或结果。
   *  用同步 ref 而非节点 data：patch jobId 经 React 提交有延迟，首个响应可能先于提交到达。 */
  const activeJobByNodeRef = useRef<Map<string, string>>(new Map());
  /** 生成任务运行时（IKJJR1）：普通生成家族经其 submit/retry/cancel/remove/recover 统一处理。
   *  宿主实现每渲染重建（闭包读最新画布状态），运行时本体只建一次并经转发宿主调用。 */
  const generationRuntimeHostRef = useRef<GenerationRuntimeHost | null>(null);
  const generationRuntimeRef = useRef<GenerationRuntime | null>(null);
  /** 文档加载身份（A.8）：每次成功水合（doc 更替）推进；普通重渲染/节点移动/正常保存不变。 */
  const docLoadEpochRef = useRef<object>({});
  /** 图像工具家族受理等待（IKJJR2）：擦除/抠图的 createTask 与高清/扩图的 startTask 靠它
   *  等待受理 settle——保持会话层失败反馈（IKIXK8「创建失败由编辑界面再次发送」边界）
   *  与受理后建卡时机；受理后轮询/终态/重试/恢复归统一任务运行时。 */
  const imageToolsAcceptanceRef = useRef(new Map<string, { resolve: (jobId: string) => void; reject: (e: unknown) => void }>());
  const imageToolsTask = useMemo(() => createImageToolsTask((nodeId, settled) => {
    const pending = imageToolsAcceptanceRef.current.get(nodeId);
    if (!pending) return;
    imageToolsAcceptanceRef.current.delete(nodeId);
    if ('jobId' in settled) pending.resolve(settled.jobId);
    else pending.reject(settled.error);
    // ponytail: 连续两轮 409 归属冲突时 runtime 放弃重发、pending 不 settle（promise 泄漏，无 UI 影响）
  }), []);

  // 卸载时清理全部在途登记与运行时
  useEffect(() => {
    const activeJobs = activeJobByNodeRef.current;
    return () => {
      activeJobs.clear();
      generationRuntimeRef.current?.reset(); // IKJJR1：运行时轮询/台账/在途一并清理
    };
  }, []);

  /** 更新媒体节点 data 局部字段 */
  const patchMediaNode = (nodeId: string, patch: Record<string, unknown>) => {
    setMediaNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  };

  /** 生成产物写入快照资产字典：否则字典仍停留在打开画布时的旧快照，后续 resolveNodeAssets
   *  增量刷新会把刚成功的成品卡误标「素材已被删除」（IKFPOT 同因，生成回填此前未补字典）。 */
  const rememberGeneratedAsset = (
    asset: { id?: string; url?: string; type?: string; width?: number | null; height?: number | null } | null | undefined,
    fallbackType: 'image' | 'video' | 'audio',
  ) => {
    if (!asset?.id || !asset.url || typeof upsertAssets !== 'function') return;
    const type = asset.type === 'audio' || asset.type === 'video' || asset.type === 'image'
      ? asset.type
      : fallbackType;
    upsertAssets([{
      asset_id: Number(asset.id),
      type,
      access_url: asset.url,
      width: typeof asset.width === 'number' ? asset.width : null,
      height: typeof asset.height === 'number' ? asset.height : null,
      material_id: null,
      material_status: null,
    }]);
  };

  /** 浏览器实测媒体尺寸回填：仅写缺失/不一致字段，避免触发无谓自动保存 */
  const handleMediaDims = (nodeId: string, dims: MediaDims) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof dims.width === 'number' && dims.width > 0 && data.width !== dims.width) {
      patch.width = dims.width;
    }
    if (typeof dims.height === 'number' && dims.height > 0 && data.height !== dims.height) {
      patch.height = dims.height;
    }
    if (typeof dims.duration === 'number' && dims.duration > 0 && typeof data.duration !== 'number') {
      patch.duration = dims.duration;
    }
    if (Object.keys(patch).length === 0) return;
    patchMediaNode(nodeId, patch);
  };

  /** 迟到响应防线（IKDMQW）：节点已被本地删除（防复活）、已离开画布、或活跃任务已被新任务
   *  接管（IKDMQV 登记）时，迟到的取消响应/权威核对/轮询响应一律丢弃，不得覆盖新状态。 */
  const jobResponseGuarded = (nodeId: string, jobId: number | string): boolean =>
    !locallyRemovedGenerationNodesRef.current.has(nodeId) &&
    mediaNodesRef.current.some((n) => n.id === nodeId) &&
    activeJobByNodeRef.current.get(nodeId) === String(jobId);

  /** 人声背景分离成功扇出（IKHA30，本仓一对多扇出骨架首例——场景切分 ADR-0108 复用此形态）：
   *  移除占位卡，按任务结果 tracks 在占位卡实时位置（建卡时已按源卡实际内容宽让位）纵向扇出
   *  N 张普通音频成品卡（零样式改动：src/assetId/duration，可播放/下载/再作工具输入），各轨卡
   *  对源卡拉来源边（origin=vocal-split，参考推导跳过）。轨卡 id 确定性（vocal-track-{jobId}-
   *  {track}）+ 建卡判重：重复终态/重复水合幂等不重复建卡。tracks 缺失（契约上线前完成的
   *  旧任务）防御性保留占位卡停生成中，不扇出不丢卡。 */
  const fanOutVocalSplitTracks = (
    placeholderNodeId: string,
    detail: Awaited<ReturnType<typeof fetchJobStatus>>,
  ): void => {
    const node = mediaNodesRef.current.find((n) => n.id === placeholderNodeId);
    if (!node) return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const identity = data.vocalSplit as VocalSplitIdentity | undefined;
    const outputFormat = identity?.lastInput.output_format ?? VOCAL_SPLIT_DEFAULT_FORMAT;
    const tracks = detail.tracks ?? [];
    if (tracks.length === 0) {
      patchMediaNode(placeholderNodeId, { genStatus: undefined, progress: 100 });
      return;
    }
    // 删除等待终态期间任务抢先成功：同通用成功分支口径，停止删除保留作品（轨卡）
    if (pendingDeleteJobNodesRef.current.has(placeholderNodeId)) {
      pendingDeleteJobNodesRef.current.delete(placeholderNodeId);
      showToast('warn', '任务已完成，已停止删除；如需删除请再次操作');
    }
    // 来源边反查源卡（占位卡发送时拉的边）：扇出后各轨卡改拉 源卡→轨卡 来源边
    const sourceNodeId = edgesRef.current.find((e) => e.target === placeholderNodeId)?.source;
    const plan = buildVocalSplitTrackNodes({
      jobId: placeholderNodeId.slice(VOCAL_SPLIT_NODE_PREFIX.length),
      outputFormat,
      tracks,
      sourceName: vocalSplitSourceName(data.fileName),
      anchor: node.position,
    });
    locallyRemovedGenerationNodesRef.current.add(placeholderNodeId);
    const current = mediaNodesRef.current;
    // 幂等判重：已存在的轨卡（重复终态/重复水合）不重建；占位卡移除（其连线由级联清理收走）
    const fresh = plan.filter((item) => !current.some((n) => n.id === item.node.id));
    rememberGeneratedAsset(detail.asset, 'audio');
    for (const track of tracks) {
      rememberGeneratedAsset({ id: track.asset_id, url: track.url, type: 'audio' }, 'audio');
    }
    const next = [
      ...current.filter((n) => n.id !== placeholderNodeId),
      ...fresh.map((item) => attachCallbacks(item.node as Node)),
    ];
    // 先同步写 ref 再 setState：来源边端点与后续落库都读 ref
    mediaNodesRef.current = next;
    setMediaNodes(next);
    if (sourceNodeId) {
      fresh.forEach((item) =>
        addCanvasEdge(sourceNodeId, item.node.id, undefined, { origin: VOCAL_SPLIT_EDGE_ORIGIN }),
      );
    }
    // 立刻落库（best-effort）：占位移除 + 轨卡 + 来源边同一次保存，防刷新后占位卡复活
    if (currentId) void flushCanvasSave(currentId).catch(() => {});
  };

  /** 场景切分完成扇出（IKH8C1）：移除任务占位卡，按 result.segments 返回顺序在源卡右侧
   *  网格建 N 张普通视频段卡（「第 N 段 起止时间」标注、assetId 关联段资产——工具条门槛
   *  走 BJ 已有 gate，全量工具可用含链式再切分），逐张拉来源连线（纯视觉 origin=scene-split），
   *  立即落盘。段资产 = output_assets 里 id === segment_asset_id 项；段卡宽高随资产回填
   *  （缺失回退源卡分辨率），1 段不特判（第 1 段、全程时间轴照常出 1 张）。
   *  段卡 data 保留 jobId（家族口径同 applyJobTerminal 通用成功分支——成品卡不清 jobId）：
   *  MediaNode 以 jobId≠null 判定生成宿主渲染 target Handle，缺它则来源连线无法渲染。
   *  落位 sceneSplitFanoutLayout 纯函数自动避让画布既有节点（源卡与占位卡不参与避让
   *  ——占位卡本步移除、扇出语义就在其右侧）。占位卡登记 locallyRemoved 防迟到响应复活。 */
  const fanOutSceneSplitSegments = (
    placeholderId: string,
    jobId: number | string,
    detail: Awaited<ReturnType<typeof fetchJobStatus>>,
  ) => {
    const placeholder = mediaNodesRef.current.find((n) => n.id === placeholderId);
    if (!placeholder) return;
    const identity = ((placeholder.data ?? {}) as Record<string, unknown>).sceneSplit as
      | SceneSplitIdentity
      | undefined;
    const segments = detail.result?.segments ?? [];
    const outputAssets = detail.output_assets ?? [];
    if (segments.length === 0) {
      // 畸形 payload 防御（契约校验后 result 为 null）：成功却无段，占位卡按失败口径兜底
      patchMediaNode(placeholderId, { progress: 100, genStatus: 'failed', errorText: sceneSplitErrorText(null) });
      return;
    }
    const sourceAssetId = identity?.sourceAssetId;
    const source = sourceAssetId != null
      ? mediaNodesRef.current.find(
          (n) => readAssetId((n.data ?? {}) as Record<string, unknown>) === sourceAssetId,
        )
      : undefined;
    const sourceData = (source?.data ?? {}) as Record<string, unknown>;
    const fallbackWidth = typeof sourceData.width === 'number' ? sourceData.width : undefined;
    const fallbackHeight = typeof sourceData.height === 'number' ? sourceData.height : undefined;
    const segAssetOf = (assetId: string) =>
      outputAssets.find((a) => String(a.id) === String(assetId));
    // 落位：锚点取源卡（缺失降级占位卡），既有节点排除源卡与占位卡
    const anchor = nodeBoxOf(source ?? placeholder);
    const occupied = [
      ...mediaNodesRef.current,
      ...textNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ]
      .filter((n) => n.id !== placeholderId && n.id !== source?.id)
      .map(nodeBoxOf);
    const positions = sceneSplitFanoutLayout({
      anchor,
      count: segments.length,
      segmentSize: sceneSplitSegmentBox({ width: fallbackWidth, height: fallbackHeight }),
      occupied,
    });
    const fallbackPos = {
      x: Math.round(anchor.x + anchor.width + SCENE_SPLIT_NODE_GAP),
      y: Math.round(anchor.y),
    };
    const segmentNodes = segments.map((seg, i) => {
      const asset = segAssetOf(seg.segment_asset_id);
      const pos = positions[i] ?? fallbackPos;
      return {
        id: newNodeId('scene-segment'),
        type: 'mediaNode' as const,
        position: pos,
        data: {
          src: asset?.url ?? '',
          fileName: sceneSplitSegmentLabel(seg.segment_index, seg.start_time, seg.end_time),
          mediaType: 'video' as const,
          assetId: String(seg.segment_asset_id),
          width: asset?.width ?? fallbackWidth,
          height: asset?.height ?? fallbackHeight,
          jobId,
        },
      };
    });
    for (const asset of outputAssets) {
      rememberGeneratedAsset(asset, 'video');
    }
    // 同步写 ref 再 setState（扇出后 flush 才能读到本轮节点，口径同 startSceneSplitJob）
    const next = mediaNodesRef.current
      .filter((n) => n.id !== placeholderId)
      .concat(segmentNodes.map((n) => attachCallbacks(n as Node)));
    mediaNodesRef.current = next;
    setMediaNodes(next);
    locallyRemovedGenerationNodesRef.current.add(placeholderId);
    if (source) {
      for (const seg of segmentNodes) {
        addCanvasEdge(source.id, seg.id, undefined, { origin: SCENE_SPLIT_EDGE_ORIGIN });
      }
    }
    if (currentId) void flushCanvasSave(currentId).catch(() => {});
  };

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
      if (isAudioMixNodeId(nodeId)) {
        removeAudioMixCardNow(nodeId);
        return;
      }
      setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
    };
    if (((node.data ?? {}) as Record<string, unknown>).sceneSplit != null) {
      // 场景切分占位卡分流（IKH8BR 建卡/失败，IKH8C1 完成扇出）：按任务类型收敛终态。
      // IKJJR5：新协议任务（运行时在途且有 submission 关联）的成功扇出归运行时（规范
      // segment:<n> node_id + 网格排列 + 原子保存）；此分支仅承接历史兼容任务（无关联，
      // 旧随机 id 段卡口径不变）。
      if (detail.status === 'succeeded') {
        // 停轮询后扇出：移除占位卡、按返回顺序建 N 张段卡拉来源连线（1 段不特判）
        if (generationRuntimeRef.current?.statusOf(nodeId)?.submissionId == null) {
          fanOutSceneSplitSegments(nodeId, jobId, detail);
        }
        return 'terminal';
      }
      if (detail.status === 'failed') {
        patchMediaNode(nodeId, {
          genStatus: 'failed',
          // 失败文案走场景切分家族映射（1046 兜底「场景切分失败，请重试」）
          errorText: sceneSplitErrorText(detail.error),
        });
        return 'terminal';
      }
      // cancelled 落到下方通用分支：占位卡无成品内容，收敛为移除
    }
    if (((node.data ?? {}) as Record<string, unknown>).smartMatting != null) {
      // 智能抠像占位卡分流（IKHK9N 建、IKHKAC 完成回填）：成功即就地转普通成品视频卡
      //（src/assetId/宽高时长取产物、genStatus 清空；fileName 保持建卡时的模式展示名
      //  ——标题跟随模式）；同时按产物格式冻结透明标记 transparentOutput（WEBM 透明=true
      //  → 视频区垫棋盘格；MP4 纯色不设），并清掉 smartMatting 身份——结果卡不记抠像身份，
      //  选中开普通视频面板、可下载入库、可再发起全部视频工具（含再次抠像）。
      //  失败落失败态 + 家族可读文案（重试按 lastInput 原参数重发）。
      if (detail.status === 'succeeded') {
        const mattingIdentity = ((node.data ?? {}) as Record<string, unknown>).smartMatting as
          | SmartMattingIdentity
          | undefined;
        const transparent = mattingIdentity?.lastInput?.format === 'WEBM';
        rememberGeneratedAsset(detail.asset, 'video');
        patchMediaNode(nodeId, {
          genStatus: undefined,
          progress: 100,
          errorText: undefined,
          src: detail.asset?.url ?? '',
          mediaType: 'video',
          assetId: detail.asset?.id,
          width: detail.asset?.width ?? undefined,
          height: detail.asset?.height ?? undefined,
          duration: detail.asset?.duration ?? undefined,
          transparentOutput: transparent ? true : undefined,
          smartMatting: undefined,
        });
        return 'terminal';
      }
      if (detail.status === 'failed') {
        patchMediaNode(nodeId, {
          genStatus: 'failed',
          // 失败文案走智能抠像家族映射（1050 兜底「智能抠像失败，请重试」）
          errorText: smartMattingErrorText(detail.error),
        });
        return 'terminal';
      }
      // cancelled 落到下方通用分支：占位卡无成品内容，收敛为移除
    }
    if (isMediaExtractNodeId(nodeId)) {
      const extractPatch = mediaExtractTerminalPatch(
        detail,
        typeof node.data?.fileName === 'string' ? node.data.fileName : undefined,
      );
      if (extractPatch) {
        settledExtractNodesRef.current.add(nodeId);
        if (detail.status === 'succeeded') rememberGeneratedAsset(detail.asset, 'audio');
        patchMediaNode(nodeId, extractPatch);
        return 'terminal';
      }
    }
    if (isAudioTrimNodeId(nodeId)) {
      // 截取占位卡终态收敛（IKHB7A）：成功写 src/assetId/duration/fileName（时长以火山
      // 返回为权威值），失败转失败态（audioTrim 身份卡可按 lastInput 原参数重试）
      const trimPatch = audioTrimTerminalPatch(
        detail,
        typeof node.data?.fileName === 'string' ? node.data.fileName : undefined,
      );
      if (trimPatch) {
        settledExtractNodesRef.current.add(nodeId);
        if (detail.status === 'succeeded') rememberGeneratedAsset(detail.asset, 'audio');
        patchMediaNode(nodeId, trimPatch);
        return 'terminal';
      }
    }
    if (isAudioMixNodeId(nodeId)) {
      const mixPatch = audioMixTerminalPatch(detail);
      if (mixPatch) {
        if (pendingDeleteJobNodesRef.current.has(nodeId) || node.data.audioMixCancelPending === true) {
          if (detail.status === 'failed' || detail.status === 'cancelled') {
            removeWithPendingDelete();
            return 'terminal';
          }
          if (detail.status === 'succeeded') {
            pendingDeleteJobNodesRef.current.delete(nodeId);
            showToast('warn', '任务已完成，已停止删除；如需删除请再次操作');
          }
        }
        settledExtractNodesRef.current.add(nodeId);
        if (detail.status === 'succeeded') rememberGeneratedAsset(detail.asset, 'audio');
        patchMediaNode(nodeId, { ...mixPatch, audioMixCancelPending: undefined });
        return 'terminal';
      }
    }
    if (isAudioSpeedNodeId(nodeId)) {
      // 调速占位卡终态收敛（IKHW5S）：成功原地补丁调速成品卡（src/assetId/duration，
      // 时长以火山返回为权威值，命名保留占位名不抢选中），失败转失败态（audioSpeed
      // 身份卡可按 lastInput 原参数重试——IKJJR3 起归运行时冻结输入重发）
      const speedPatch = audioSpeedTerminalPatch(
        detail,
        typeof node.data?.fileName === 'string' ? node.data.fileName : undefined,
      );
      if (speedPatch) {
        settledExtractNodesRef.current.add(nodeId);
        patchMediaNode(nodeId, speedPatch);
        return 'terminal';
      }
    }
    // 人声背景分离占位卡（IKHA2W 建、IKHA30 收敛）：succeeded 移除占位卡按 tracks 扇出
    // 轨卡（一对多骨架首例，见 fanOutVocalSplitTracks）；failed 落失败态 + 可读文案（重试按
    // lastInput 原样重发）；cancelled 落已取消。
    // IKJJR5：新协议任务（运行时在途且有 submission 关联）的轨卡扇出归运行时（规范
    // track:<type> node_id + 纵向轨列 + 原子保存）；此分支仅承接历史兼容任务。
    if (isVocalSplitNodeId(nodeId)) {
      if (detail.status === 'succeeded') {
        if (generationRuntimeRef.current?.statusOf(nodeId)?.submissionId == null) {
          settledExtractNodesRef.current.add(nodeId);
          fanOutVocalSplitTracks(nodeId, detail);
        }
        return 'terminal';
      }
      const vocalPatch = vocalSplitTerminalPatch(detail);
      if (vocalPatch) {
        settledExtractNodesRef.current.add(nodeId);
        patchMediaNode(nodeId, vocalPatch);
        return 'terminal';
      }
    }
    if (detail.status === 'succeeded') {
      const originalType = node.data?.mediaType;
      const assetType = detail.asset?.type;
      /** 插帧草稿卡（IKHLKX）：本品成功即身份结束——清除 frameInterpolation 身份（选中进入
       *  普通视频面板，与源卡/成品 HD 卡一致；身份只在失败态承担「原 fps 冻结重试」职责）。 */
      const wasFrameInterpolation = ((node.data ?? {}) as Record<string, unknown>).frameInterpolation != null;
      /** 音视频合成身份（IKIHPM）：本品成功即身份结束——结果卡原地转普通视频成品卡，不记
       *  合成身份（插帧/智能抠像同款口径）；命名与「供应商值缺失回落源资产」用冻结的绑定
       *  视频身份（源视频卡删除后仍可回落）。 */
      const muxIdentity = audioVideoMuxIdentityOf(node);
      const mediaType = (assetType === 'audio' || assetType === 'video' || assetType === 'image')
        ? assetType
        : (originalType === 'audio' || originalType === 'video' || originalType === 'image')
          ? originalType
          : 'image';
      rememberGeneratedAsset(detail.asset, mediaType);
      patchMediaNode(nodeId, {
        genStatus: undefined,
        progress: 100,
        errorText: undefined,
        errorCode: undefined,
        src: detail.asset?.url ?? '',
        mediaType: (assetType === 'audio' || assetType === 'video' || assetType === 'image')
          ? assetType
          : (originalType ?? 'image'),
        // 已自定义名称的卡不被自动命名覆盖（IKFA8X）；合成结果卡按 worker 同款格式化命名
        // 「视频名(音视频合成).mp4」（源视频名取冻结身份）
        ...(hasCustomName(node)
          ? {}
          : { fileName: muxIdentity ? audioVideoMuxResultName(muxIdentity.video?.name) : `生成-${jobId}` }),
        assetId: detail.asset?.id,
        width: detail.asset?.width ?? muxIdentity?.video?.width ?? undefined,
        height: detail.asset?.height ?? muxIdentity?.video?.height ?? undefined,
        duration: detail.asset?.duration ?? muxIdentity?.video?.duration ?? undefined,
        // 原位草稿成功（IKDMQQ）：草稿身份结束转为普通成品卡；
        // draftModelId/draftSize/draftRatio 保留为该卡的生成参数记录（再次编辑复制切片复用）
        draft: undefined,
        ...(wasFrameInterpolation ? { frameInterpolation: undefined } : {}),
        ...(muxIdentity ? { audioVideoMux: undefined } : {}),
        // IKIZQB：阶段身份以服务端持久投影为准（父规格「投影与兼容」）——样片成功回填实际
        // 截止时间（finalize_deadline_at，缺可信时间时 null 但样片仍保留）；普通成功清样片标记。
        // IKIZQE：成片成功标 final 并按投影回填来源样片关系（本地建卡值仅兜底）；
        // 两阶段卡另回填该阶段费用状态（settled + actual_credits；IKJ7UI 起不上画面内
        // 角标，供历史记录与资产详情展示）。
        videoStage: detail.video_stage === 'sample' ? 'sample' : detail.video_stage === 'final' ? 'final' : undefined,
        finalizeDeadlineAt: detail.video_stage === 'sample' ? (detail.finalize_deadline_at ?? null) : undefined,
        ...(detail.video_stage === 'final' && detail.source_sample_job_id != null
          ? { sourceSampleJobId: detail.source_sample_job_id }
          : {}),
        chargeState: detail.charge_state ?? undefined,
        actualCredits: detail.actual_credits ?? undefined,
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
      if (pendingDeleteJobNodesRef.current.has(nodeId)) {
        removeWithPendingDelete();
        return 'terminal';
      }
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        // HD 卡失败文案走家族映射（IKH3VH）：msg 为空时按 1045 兜底「视频画质增强失败，请重试」
        //（含 SDR/超限供应商拒绝场景）；插帧卡同款家族映射（IKHLKX）：msg 为空时按 1049 /
        // video_frame_interpolation_failed 兜底「视频插帧失败，请重试」、入队失败「任务入队失败，请重试」；
        // 合成卡同款（IKIHPM）：msg 为空时按 1053 兜底「音视频合成失败，请重试」；
        // 其余卡维持 msg 透传
        errorText: ((node.data ?? {}) as Record<string, unknown>).videoEnhance
          ? videoEnhanceErrorText(detail.error)
          : ((node.data ?? {}) as Record<string, unknown>).frameInterpolation
            ? frameInterpolationErrorText(detail.error)
            : audioVideoMuxIdentityOf(node)
              ? audioVideoMuxErrorText(detail.error)
              : readJobFailText(detail.error),
        // IKIZQB：失败卡同样按服务端投影标注阶段（样片失败卡标样片；普通失败清标记）。
        // IKIZQE：成片失败卡标 final（保留失败原因与退费状态，不提供同 Draft ID 重试）；
        // 两阶段卡回填该阶段费用状态（released → 失败卡注明「预扣已退回」）。
        videoStage: detail.video_stage === 'sample' ? 'sample' : detail.video_stage === 'final' ? 'final' : undefined,
        finalizeDeadlineAt: undefined,
        ...(detail.video_stage === 'final' && detail.source_sample_job_id != null
          ? { sourceSampleJobId: detail.source_sample_job_id }
          : {}),
        chargeState: detail.charge_state ?? undefined,
        actualCredits: detail.actual_credits ?? undefined,
        // 失败码随文案同点落卡（IKJ79D）：worker 归类的比例约束失败供一键修复按码识别
        errorCode: detail.error?.code,
      });
      return 'terminal';
    }
    if (detail.status === 'checking') {
      // IKIZQD/IKIZQE：提交结果不明核对锁定——任务不重发、预扣不动，轮询继续等核对定夺
      //（明确成功恢复原任务 / 明确失败释放该阶段预扣）。卡片收敛为「状态核对中」占位，
      // 样片卡成片按钮经 final 卡在场关系同步禁点（勿重复提交）。
      patchMediaNode(nodeId, { genStatus: 'checking', progress: undefined });
      return 'processing';
    }
    if (detail.status === 'cancelled') {
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
      if (isAudioMixNodeId(nodeId)) {
        removeAudioMixCardNow(nodeId);
        return;
      }
      setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
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
    setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
  };

  /** 插帧关页恢复函数引用（IKHSFF，水合 effect 声明在前） */
  const recoverFrameInterpolationRef = useRef<(nodeId: string, savedJobId?: unknown) => void>(() => {});

  /** IKJJR7：页面级浅层轮询（pollJob + jobTimersRef 定时器链）已删除——16+ 家族全部
   *  经 GenerationTaskDefinition 接入统一运行时（runtime 内部调度轮询/归属检查/终态收敛），
   *  claims 覆盖全部「生成中 + jobId」卡形态；历史兼容任务由运行时按无 submission 关联
   *  口径追踪（不写 marker/不确认）。 */

  /** ═══ IKJJR6 成片/重生样片迁入统一任务运行时：共享提交助手 ═══
   *  两入口错误收敛同口径（IKIZQE/IKIZQG 原链路语义保持）：服务端已回答（信封错误）→
   *  撤占位卡，1014 置「状态核对中」禁点，其余 toast + 删报价 entry 触发重报价；
   *  传输结果不明（408/网络）→ 同意图（同 submission_id，运行时提交窗口）原样重发一次
   *  ——服务端重放首次结果（只建一个 job、只扣一次钱）；仍不明 → 撤卡 + 核对中禁点
   *  （刷新后以报价端点恢复一致状态；重生样片另经恢复扫描对账补卡）。
   *  提交/受理/轮询/终态的归属检查、幂等键（submission_id）与台账在运行时。 */
  const submitStoryboardTask = (
    payload: StoryboardPayload,
    target: { targetNodeId: string; seedTarget: RecoverySeedTarget },
    ui: {
      removePlaceholder: () => void;
      markUnknown: () => void;
      refreshQuote: () => void;
      unknownToast: string;
      /** 本次意图失败收敛（受理前置失败，含将重发）：释放页面同步提交窗口 */
      onFailure: () => void;
    },
  ): boolean => {
    const runtime = generationRuntimeRef.current;
    if (!runtime) return false;
    const dispatch = (retryUnknown: boolean): boolean => runtime.submit(
      storyboardTask,
      {
        payload,
        target: {
          targetNodeId: target.targetNodeId,
          seedTarget: target.seedTarget,
          seedSources: [],
          expectedBindingRevision: runtime.bindingRevisionOf(target.targetNodeId),
        },
      },
      {
        onCreateFailure: (e: unknown): boolean => {
          ui.onFailure();
          if (isApiError(e) && e.status !== 408 && e.status !== 0) {
            // 服务端已回答（信封错误）：占位卡撤回，按钮状态交还报价/截止推导
            ui.removePlaceholder();
            if (Number(e.code) === 1014) {
              // 上次提交结果不明、核对锁定期间——保持禁点（状态核对中）
              ui.markUnknown();
              showToast('warn', e.message);
              return true;
            }
            showToast('error', e.message);
            ui.refreshQuote();
            return true;
          }
          if (retryUnknown) {
            // 传输结果不明（408 超时/网络失败）：同意图原样重发一次（受理/失败各自收敛，
            // 不再递归重试）
            window.setTimeout(() => dispatch(false), 0);
            return true;
          }
          // 仍不明：占位卡撤回（无可核实任务），入口「状态核对中」禁点
          ui.removePlaceholder();
          ui.markUnknown();
          showToast('warn', ui.unknownToast);
          return true;
        },
      },
    );
    return dispatch(true);
  };

  /** ═══ IKIZQE 成片（finalize）提交链路（IKJJR6 迁入统一任务运行时） ═══
   *  唯一入口 = 样片卡标题行「生成 1080P 成片」：报价就绪（服务端门——空报价双 null 即
   *  禁用）+ 截止有效才可点；点击直接提交无二次确认。提交即在样片卡右侧 +60px 建关联
   *  成片占位卡（videoStage=final + sourceSampleJobId 两卡关系），runtime.submit 受理后
   *  回填 jobId 并接管轮询/终态（final 阶段投影由 applyJobTerminal 回填）。成片端点契约
   *  不收 canvas_binding——按历史兼容任务追踪（水合 jobId 续轮询）。
   *  并发/重复防线：inflight ref 同步挡住双击与两页并发（服务端来源唯一约束 1057 兜底）。 */
  const handleFinalizeSample = (sampleNodeId: string): boolean => {
    if (!currentId) {
      showToast('warn', '未选中项目，无法生成成片');
      return false;
    }
    const sample = mediaNodesRef.current.find((n) => n.id === sampleNodeId);
    const sampleData = (sample?.data ?? {}) as Record<string, unknown>;
    if (sample == null || sampleData.videoStage !== 'sample' || sampleData.jobId == null) return false;
    const sampleJobId = String(sampleData.jobId);
    // 提交结果不明（核对中）：禁止再次点击——服务端 1014 同口径拒再提交
    if (finalizeUnknownSamples.has(sampleNodeId)) return false;
    // 同步防重：提交窗口内双击/并发点击直接忽略（至多一次提交）
    if (finalizeInflightRef.current.has(sampleNodeId)) return false;
    if (mediaNodesRef.current.some(
      (n) =>
        ((n.data ?? {}) as Record<string, unknown>).videoStage === 'final'
        && String(((n.data ?? {}) as Record<string, unknown>).sourceSampleJobId ?? '') === sampleJobId,
    )) return false;
    const quote = finalizeQuotes[sampleNodeId];
    if (quote?.phase !== 'ready') return false;
    if (sampleData.finalizeDeadlineAt == null || sampleDeadlineExpired(sampleData.finalizeDeadlineAt as string)) {
      showToast('warn', '样片已过转成片期限或缺可信截止时间，无法生成成片');
      return false;
    }
    finalizeInflightRef.current.add(sampleNodeId);
    /** 占位成片卡：样片卡右侧 +60px（同截取/调速落位口径），宽高比沿用样片卡 */
    const box = mediaContentBox({
      mediaType: 'video',
      width: typeof sampleData.width === 'number' ? sampleData.width : undefined,
      height: typeof sampleData.height === 'number' ? sampleData.height : undefined,
      ratio: typeof sampleData.targetRatio === 'string' ? sampleData.targetRatio : undefined,
    });
    const finalNodeId = newNodeId('media-gen');
    const placeholder = attachCallbacks({
      id: finalNodeId,
      type: 'mediaNode' as const,
      position: {
        x: Math.round(sample.position.x + box.width + 60),
        y: Math.round(sample.position.y),
      },
      data: {
        src: '',
        fileName: '成片生成中',
        mediaType: 'video' as const,
        genStatus: 'generating' as MediaGenStatus,
        progress: 0,
        videoStage: 'final' as const,
        sourceSampleJobId: sampleJobId,
        targetRatio: typeof sampleData.targetRatio === 'string' ? sampleData.targetRatio : undefined,
      },
    } as Node);
    const current = mediaNodesRef.current;
    mediaNodesRef.current = [...current, placeholder];
    setMediaNodes(mediaNodesRef.current);
    if (currentId) void flushCanvasSave(currentId).catch(() => {});

    const clearSubmitting = () => {
      finalizeInflightRef.current.delete(sampleNodeId);
    };
    const removePlaceholder = () => {
      mediaNodesRef.current = mediaNodesRef.current.filter((n) => n.id !== finalNodeId);
      setMediaNodes(mediaNodesRef.current);
      if (currentId) void flushCanvasSave(currentId).catch(() => {});
    };
    const markUnknown = () => {
      setFinalizeUnknownSamples((prev) => new Set(prev).add(sampleNodeId));
    };
    /** 报价重取：删 entry 触发报价 effect 重查（1056 变价 → 新价可见后再由用户点击） */
    const refreshQuote = () => {
      setFinalizeQuotes((prev) => {
        if (!(sampleNodeId in prev)) return prev;
        const next = { ...prev };
        delete next[sampleNodeId];
        return next;
      });
    };
    const dispatched = submitStoryboardTask(
      {
        kind: 'finalize',
        sampleJobId,
        expectedCredits: quote.credits,
        quoteRevision: quote.revision,
        // 受理成功收敛（runtime 在 create resolve 内回调，先于 jobId 回填）：
        // 登记本会话已受理 + 受理后立即落盘 jobId（宏任务排在 patch 之后）+ 成功提示
        onAccepted: () => {
          finalizeAttemptedJobIdsRef.current.add(sampleJobId);
          clearSubmitting();
          window.setTimeout(() => {
            if (currentId) void flushCanvasSave(currentId).catch(() => {});
          }, 0);
          showToast('success', `已提交成片生成，预计消耗 ${quote.credits} 积分`);
        },
      },
      {
        targetNodeId: finalNodeId,
        seedTarget: {
          role: 'result-placeholder',
          x: Math.round(sample.position.x + box.width + 60),
          y: Math.round(sample.position.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          name: '成片生成中',
        },
      },
      {
        removePlaceholder,
        markUnknown,
        refreshQuote,
        unknownToast: '无法确认成片任务是否已提交，状态核对中，请勿重复提交',
        onFailure: clearSubmitting,
      },
    );
    if (!dispatched) {
      // 运行时未发出（未就绪/防重入）：撤占位卡并释放提交窗口，状态交还报价推导
      clearSubmitting();
      mediaNodesRef.current = mediaNodesRef.current.filter((n) => n.id !== finalNodeId);
      setMediaNodes(mediaNodesRef.current);
    }
    return dispatched;
  };

  /** IKIZQE：成片报价获取——成功样片卡（无成片卡在场、截止有效、未受理过）进 CTA 前先问价。
   *  空报价（双 null）= 服务端判不可提交（已有成片尝试/未转存/模型未放行/算不出价），
   *  据此禁用按钮；报价失败同样折空报价（无报价不提交，不按未知金额扣费）。 */
  useEffect(() => {
    if (!currentId) return;
    for (const n of mediaNodes) {
      const d = (n.data ?? {}) as Record<string, unknown>;
      if (d.videoStage !== 'sample' || d.jobId == null) continue;
      // 仅成功样片卡提供入口（生成中/失败/草稿无 CTA）
      if (d.genStatus != null || d.draft === true) continue;
      const jobId = String(d.jobId);
      if (finalizeAttemptedJobIdsRef.current.has(jobId)) continue;
      if (
        mediaNodes.some(
          (m) =>
            ((m.data ?? {}) as Record<string, unknown>).videoStage === 'final'
            && String(((m.data ?? {}) as Record<string, unknown>).sourceSampleJobId ?? '') === jobId,
        )
      ) continue;
      if (finalizeUnknownSamples.has(n.id)) continue;
      if (finalizeQuotes[n.id] != null || finalizeQuoteInflightRef.current.has(n.id)) continue;
      // 缺可信截止 / 已过期：客户端直接判禁用，无需问价
      if (typeof d.finalizeDeadlineAt !== 'string' || sampleDeadlineExpired(d.finalizeDeadlineAt)) continue;
      const nodeId = n.id;
      finalizeQuoteInflightRef.current.add(nodeId);
      quoteVideoFinalize(currentId, jobId, { silent: true })
        .then((q) => {
          setFinalizeQuotes((prev) => ({
            ...prev,
            [nodeId]: q.credits != null && q.quote_revision != null
              ? { phase: 'ready', credits: q.credits, revision: q.quote_revision }
              : { phase: 'empty' },
          }));
        })
        .catch(() => {
          setFinalizeQuotes((prev) => ({ ...prev, [nodeId]: { phase: 'empty' } }));
        })
        .finally(() => {
          finalizeQuoteInflightRef.current.delete(nodeId);
        });
    }
  }, [mediaNodes, currentId, finalizeQuotes, finalizeUnknownSamples]);

  /** IKIZQG：重新生成入口身份解析——返回该卡指向的原样片任务 ID（null = 无入口）。
   *  IKJ7UI（ADR-0119）起唯一入口是成片失败卡失败区（videoStage=final + failed +
   *  sourceSampleJobId 找回原样片，用户故事 21：按原输入新建样片）；过期样片卡标题行
   *  入口已随决策移除（过期信息由画面内角标表达，恢复靠重新编辑后从面板重发）。 */
  const regenEntrySampleJobIdOf = (d: Record<string, unknown>): string | null => {
    if (d.videoStage === 'final' && d.genStatus === 'failed' && d.sourceSampleJobId != null) {
      return String(d.sourceSampleJobId);
    }
    return null;
  };

  /** ═══ IKIZQG 重新生成样片（regenerate-sample）提交链路（IKJJR6 迁入统一任务运行时） ═══
   *  入口：成片失败卡失败区（IKJ7UI 起改形为同款「重试」按钮）。报价就绪（服务端门
   *  ——空报价双 null 即禁用）才可点；点击直接提交，服务端从原样片**冻结输入**派生新
   *  任务——**创建新卡不覆盖旧结果**（旧样片/失败成片/费用记录只读不写）。提交即在入口
   *  卡正下方 +60px 建样片占位卡（videoStage=sample；避开 finalize 在样片右侧 +60px 的
   *  落位），runtime.submit 以新占位卡为承接目标携 canvas_binding 受理（Idempotency-Key =
   *  submission_id），受理后回填 jobId 并接管轮询/终态（sample 阶段投影由 applyJobTerminal
   *  回填，新样片有自己的截止与成片入口）；受理回执丢失经恢复扫描对账补卡。
   *  并发/重复防线：inflight ref 按**样片任务 id** 归并。 */
  const handleRegenerateSample = (entryNodeId: string): boolean => {
    if (!currentId) {
      showToast('warn', '未选中项目，无法重新生成样片');
      return false;
    }
    const origin = mediaNodesRef.current.find((n) => n.id === entryNodeId);
    const originData = (origin?.data ?? {}) as Record<string, unknown>;
    const sampleJobId = regenEntrySampleJobIdOf(originData);
    if (origin == null || sampleJobId == null) return false;
    if (sampleRegenUnknownSamples.has(sampleJobId)) return false;
    if (sampleRegenAttemptedJobIdsRef.current.has(sampleJobId)) return false;
    if (sampleRegenInflightRef.current.has(sampleJobId)) return false;
    const quote = sampleRegenQuotes[sampleJobId];
    if (quote?.phase !== 'ready') return false;
    sampleRegenInflightRef.current.add(sampleJobId);
    /** 占位样片卡：入口卡正下方 +60px，宽高比沿入口卡 */
    const box = mediaContentBox({
      mediaType: 'video',
      width: typeof originData.width === 'number' ? originData.width : undefined,
      height: typeof originData.height === 'number' ? originData.height : undefined,
      ratio: typeof originData.targetRatio === 'string' ? originData.targetRatio : undefined,
    });
    const regenNodeId = newNodeId('media-gen');
    const placeholder = attachCallbacks({
      id: regenNodeId,
      type: 'mediaNode' as const,
      position: {
        x: Math.round(origin.position.x),
        y: Math.round(origin.position.y + box.height + 60),
      },
      data: {
        src: '',
        fileName: '样片生成中',
        mediaType: 'video' as const,
        genStatus: 'generating' as MediaGenStatus,
        progress: 0,
        videoStage: 'sample' as const,
        targetRatio: typeof originData.targetRatio === 'string' ? originData.targetRatio : undefined,
      },
    } as Node);
    mediaNodesRef.current = [...mediaNodesRef.current, placeholder];
    setMediaNodes(mediaNodesRef.current);
    if (currentId) void flushCanvasSave(currentId).catch(() => {});

    const clearSubmitting = () => {
      sampleRegenInflightRef.current.delete(sampleJobId);
    };
    const removePlaceholder = () => {
      mediaNodesRef.current = mediaNodesRef.current.filter((n) => n.id !== regenNodeId);
      setMediaNodes(mediaNodesRef.current);
      if (currentId) void flushCanvasSave(currentId).catch(() => {});
    };
    const markUnknown = () => {
      setSampleRegenUnknownSamples((prev) => new Set(prev).add(sampleJobId));
    };
    /** 报价重取：删 entry 触发报价 effect 重查（1056 变价 → 新价可见后再由用户点击；
     *  新报价 = 新签名换新 submission_id，不撞同键变价 100409） */
    const refreshQuote = () => {
      setSampleRegenQuotes((prev) => {
        if (!(sampleJobId in prev)) return prev;
        const next = { ...prev };
        delete next[sampleJobId];
        return next;
      });
    };
    const dispatched = submitStoryboardTask(
      {
        kind: 'regenerate-sample',
        sampleJobId,
        expectedCredits: quote.credits,
        quoteRevision: quote.revision,
        // 受理成功收敛（runtime 在 create resolve 内回调，先于 jobId 回填）：
        // 登记本会话已受理 + 受理后立即落盘 jobId（宏任务排在 patch 之后）+ 成功提示
        onAccepted: () => {
          sampleRegenAttemptedJobIdsRef.current.add(sampleJobId);
          clearSubmitting();
          window.setTimeout(() => {
            if (currentId) void flushCanvasSave(currentId).catch(() => {});
          }, 0);
          showToast('success', `已提交样片重新生成，预计消耗 ${quote.credits} 积分；已创建新卡，旧结果保留`);
        },
      },
      {
        targetNodeId: regenNodeId,
        seedTarget: {
          role: 'result-placeholder',
          x: Math.round(origin.position.x),
          y: Math.round(origin.position.y + box.height + 60),
          width: Math.round(box.width),
          height: Math.round(box.height),
          name: '样片生成中',
        },
      },
      {
        removePlaceholder,
        markUnknown,
        refreshQuote,
        unknownToast: '无法确认重新生成任务是否已提交，状态核对中，请勿重复提交',
        onFailure: clearSubmitting,
      },
    );
    if (!dispatched) {
      // 运行时未发出（未就绪/防重入）：撤占位卡并释放提交窗口，状态交还报价推导
      clearSubmitting();
      mediaNodesRef.current = mediaNodesRef.current.filter((n) => n.id !== regenNodeId);
      setMediaNodes(mediaNodesRef.current);
    }
    return dispatched;
  };

  /** IKIZQG：重新生成报价获取——入口卡（成片失败卡，IKJ7UI 起）进 CTA 前先问价（按
   *  样片任务归并）。空报价（双 null）= 服务端判不可提交（非样片任务/模型未放行/算不出
   *  价），据此禁用按钮；报价失败同样折空报价。 */
  useEffect(() => {
    if (!currentId) return;
    for (const n of mediaNodes) {
      const sampleJobId = regenEntrySampleJobIdOf((n.data ?? {}) as Record<string, unknown>);
      if (sampleJobId == null) continue;
      if (sampleRegenAttemptedJobIdsRef.current.has(sampleJobId)) continue;
      if (sampleRegenUnknownSamples.has(sampleJobId)) continue;
      if (sampleRegenQuotes[sampleJobId] != null || sampleRegenQuoteInflightRef.current.has(sampleJobId)) continue;
      sampleRegenQuoteInflightRef.current.add(sampleJobId);
      quoteSampleRegenerate(currentId, sampleJobId, { silent: true })
        .then((q) => {
          setSampleRegenQuotes((prev) => ({
            ...prev,
            [sampleJobId]: q.credits != null && q.quote_revision != null
              ? { phase: 'ready', credits: q.credits, revision: q.quote_revision }
              : { phase: 'empty' },
          }));
        })
        .catch(() => {
          setSampleRegenQuotes((prev) => ({ ...prev, [sampleJobId]: { phase: 'empty' } }));
        })
        .finally(() => {
          sampleRegenQuoteInflightRef.current.delete(sampleJobId);
        });
    }
  }, [mediaNodes, currentId, sampleRegenQuotes, sampleRegenUnknownSamples]);

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
      /** IKIZQB：样片提交确认两字段（契约 confirmedSubmitFields）——parameters.sample_mode=true
       *  时随请求顶层携带，服务端按报价同一规则复算，变价即拒（quote_stale）。 */
      expectedCredits?: number;
      quoteRevision?: string;
    },
    /** IKFA1M/IKFA1O：结构化正文（image/video 含素材标签时携带）；服务端编译并冻结 */
    promptDoc?: PromptDoc | null,
  ): boolean => {
    if (!currentId) {
      console.warn('未选中项目，无法创建生成任务');
      return false;
    }
    /** IKIZQB：样片任务（parameters.sample_mode=true）——卡身份与提交确认字段按此分流 */
    const isSampleJob = (parameters as VideoJobParameters).sample_mode === true;
    if (targetNodeId && blockInvalidDraft(edgesRef.current.filter(e => e.target === targetNodeId).map(e => e.source))) return false;
    if (blockIfCreditsInsufficient()) return false;
    // 原位模式（IKDMQQ 草稿 + IKDMQU 成品卡原卡重新生成）：目标节点原地承接任务，身份/位置/连线保持不变。
    // IKIZQG：两阶段卡（样片/成片）重新编辑是原位重跑规则的**明确例外**（父规格「领域身份」：
    // 用户故事 25——再次发送新建结果卡），旧卡的身份、截止与两卡关系不被覆盖。
    const targetNode = targetNodeId ? mediaNodesRef.current.find((n) => n.id === targetNodeId) : undefined;
    const targetData = (targetNode?.data ?? {}) as Record<string, unknown>;
    const targetIsTwoStage = targetData.videoStage === 'sample' || targetData.videoStage === 'final';
    const inPlaceNode = !targetIsTwoStage && targetNodeId
      ? mediaNodesRef.current.find((n) => n.id === targetNodeId && isInPlaceRegenTarget(n))
      : undefined;
    const inPlaceNodeId = inPlaceNode?.id;
    if (inPlaceNodeId) {
      const isDraftTarget =
        ((inPlaceNode!.data ?? {}) as Record<string, unknown>).draft === true;
      const customNamed = hasCustomName(inPlaceNode);
      // IKIPSX（IKGUXU D-01）：draftMode 兜底——草稿已保存模式优先；缺失（2026-09-13 前存量
      // 旧草稿或异常路径）时按当前面板选中模式（initialDraft.mode）补写，保证提交后 draftMode 落盘。
      const existingDraftMode = (inPlaceNode!.data as Record<string, unknown>).draftMode;
      const fallbackDraftMode =
        typeof existingDraftMode === 'string' ? undefined : initialDraft?.mode;
      patchMediaNode(inPlaceNodeId, {
        genStatus: 'generating',
        progress: 0,
        errorText: undefined,
        errorCode: undefined,
        // 草稿无素材可显示，改名提示生成内容（IKDMQQ）；已自定义名称的草稿不覆盖（IKFA8X）；
        // 成品卡保留原文件名——旧素材继续显示，生成中由状态角标标记（IKDMQU Q5）
        ...(isDraftTarget && !customNamed
          ? {
              fileName:
                type === 'video' ? (isSampleJob ? '样片生成中' : '视频生成中') : type === 'audio' ? '音频生成中' : '图片生成中',
            }
          : {}),
        prompt: parameters.prompt,
        targetRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        ...(fallbackDraftMode != null ? { draftMode: fallbackDraftMode } : {}),
        // IKIZQB：卡身份跟随本次提交阶段（样片卡生成中即标样片；普通提交清除旧样片标记）
        videoStage: isSampleJob ? 'sample' : undefined,
      });
    }
    const nodeId = inPlaceNodeId ?? newNodeId('media-gen');
    // IKIZQG：两阶段卡重新编辑发送的新建结果卡落在原卡正下方 +60px（旧结果与来源关系保留）
    const placeholderPosition = targetIsTwoStage && targetNode
      ? (() => {
        const box = mediaContentBox({
          mediaType: 'video',
          width: typeof targetData.width === 'number' ? targetData.width : undefined,
          height: typeof targetData.height === 'number' ? targetData.height : undefined,
          ratio: typeof targetData.targetRatio === 'string' ? targetData.targetRatio : undefined,
        });
        return { x: Math.round(targetNode.position.x), y: Math.round(targetNode.position.y + box.height + 60) };
      })()
      : spawnPosition();
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
      }
      addCanvasEdge(source.id, nodeId, ref.role);
    }
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: placeholderPosition,
      data: {
        genStatus: 'generating',
        progress: 0,
        mediaType: type,
        fileName: type === 'video' ? (isSampleJob ? '样片生成中' : '视频生成中') : type === 'audio' ? '音频生成中' : '图片生成中',
        prompt: parameters.prompt,
        draftModelId: parameters.model_id,
        draftRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        draftSize: 'size' in parameters ? parameters.size : 'resolution' in parameters ? parameters.resolution : undefined,
        draftDuration: 'duration' in parameters ? parameters.duration : undefined,
        // IKIZQB：样片任务卡身份（生成中/成功卡据此渲染「样片 480P」徽标）
        videoStage: isSampleJob ? 'sample' : undefined,
        // IKIPSX：initialDraft.mode 缺失时不得写入 undefined——JSON.stringify 会丢键，
        // 导致新建生成卡 draftMode 缺失；改成条件展开保证只在有值时落键。
        ...(initialDraft?.mode != null ? { draftMode: initialDraft.mode } : {}),
        targetRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        toolMode,
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        ...dockToolCallbacks,
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    setMediaNodes((prev) => [...prev, ...referenceNodes, node]);
    }
    // 提交立即接管节点，防止 create 返回前旧取消/轮询响应解除本次生成状态。
    // IKJJR1：普通生成家族的创建/受理/轮询/终态/保存确认统一交生成任务运行时
    //（含 canvas_binding 受理、submission_id 幂等键与恢复台账）。
    const jobRefs = videoRefs?.references;
    const sendPrompt = promptDoc ? flattenPromptDocForSend(promptDoc) : parameters.prompt;
    const sendAttachments = targetNodeId ? textAttachmentsForSend(targetNodeId) : undefined;
    const jobPrompt = composeImageSendPrompt(sendAttachments, sendPrompt, promptDoc);
    try {
      const payload: CreateJobPayload = {
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
        // IKIZQB：样片提交确认两字段（请求顶层，契约 confirmedSubmitFieldsSchema）——
        // 面板已按报价就绪门控；缺失时服务端 fail closed 拒绝（不建任务不扣费）。
        ...(isSampleJob && initialDraft?.expectedCredits != null && initialDraft?.quoteRevision
          ? { expected_credits: initialDraft.expectedCredits, quote_revision: initialDraft.quoteRevision }
          : {}),
      };
      /** IKJJR1 恢复种子（B.3）：发送时目标/来源快照。目标 = 结果承接卡（原位卡或新建占位卡，
       *  注意与业务字段 target_node_id（面板来源目标）区分）；草稿/既有素材角色由运行时先落盘再提交。 */
      let seedTarget: RecoverySeedTarget;
      if (inPlaceNode) {
        const d = (inPlaceNode.data ?? {}) as Record<string, unknown>;
        seedTarget = {
          role: d.draft === true
            ? 'draft'
            : typeof d.assetId === 'string' && d.assetId.length > 0
              ? 'existing-media'
              : 'result-placeholder',
          x: Math.round(inPlaceNode.position.x),
          y: Math.round(inPlaceNode.position.y),
          width: typeof d.width === 'number' && d.width > 0 ? d.width : 320,
          height: typeof d.height === 'number' && d.height > 0 ? d.height : 320,
          name: typeof d.fileName === 'string' ? d.fileName : '',
        };
      } else {
        const box = mediaContentBox({
          mediaType: type,
          ratio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        });
        seedTarget = {
          role: 'result-placeholder',
          x: placeholderPosition.x,
          y: placeholderPosition.y,
          width: Math.round(box.width),
          height: Math.round(box.height),
          name: type === 'video' ? (isSampleJob ? '样片生成中' : '视频生成中') : type === 'audio' ? '音频生成中' : '图片生成中',
        };
      }
      const seedSources: RecoverySeedSource[] = edgesRef.current
        .filter((edge) => edge.target === nodeId)
        .map((edge) => mediaNodesRef.current.find((n) => n.id === edge.source))
        .filter((n): n is Node => n != null)
        .map((n) => {
          const d = (n.data ?? {}) as Record<string, unknown>;
          return {
            node_id: n.id,
            x: Math.round(n.position.x),
            y: Math.round(n.position.y),
            width: typeof d.width === 'number' && d.width > 0 ? d.width : 320,
            height: typeof d.height === 'number' && d.height > 0 ? d.height : 320,
            name: typeof d.fileName === 'string' ? d.fileName : '',
          };
        });
      const runtime = generationRuntimeRef.current;
      if (!runtime) {
        console.warn('[canvas] 生成任务运行时未就绪，提交被拒绝');
        return false;
      }
      return runtime.submit(
        normalGenerationTask,
        {
          payload,
          target: {
            targetNodeId: nodeId,
            seedTarget,
            seedSources,
            expectedBindingRevision: runtime.bindingRevisionOf(nodeId),
          },
        },
        {
          onCreateFailure: (e: unknown) => {
            /** 原位目标回退：草稿回待生成保留参数（IKDMQQ/IKDMQS/IKDMQT）；
             *  成品卡恢复成品态保留旧素材与最新编辑（IKDMQU Q5，同取消恢复）。
             *  归属核对（接管保护）由运行时 owns() 先行完成，此处不再重复判。 */
            const rollbackInPlace = () => {
              const rollbackNode = mediaNodesRef.current.find((n) => n.id === nodeId);
              if (!rollbackNode) return;
              if (((rollbackNode.data ?? {}) as Record<string, unknown>).draft === true) {
                patchMediaNode(nodeId, {
                  genStatus: 'draft',
                  progress: undefined,
                  // 已自定义名称的草稿回退时保留名称（IKFA8X）
                  ...(hasCustomName(rollbackNode) ? {} : { fileName: draftFileNameOf(type) }),
                });
              } else {
                patchMediaNode(nodeId, { genStatus: undefined, progress: undefined, errorText: undefined });
              }
            };
            const removePlaceholder = () => {
              setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
              setEdges(prev => prev.filter(edge => edge.target !== nodeId));
            };
            if (openRechargeForCreditsError(e)) {
              if (inPlaceNodeId) rollbackInPlace();
              else removePlaceholder();
              return true;
            }
            if (isApiError(e) && e.status === 401) {
              if (inPlaceNodeId) rollbackInPlace();
              else removePlaceholder();
              useAuthPromptStore.getState().addResume(() => {
                startGenerationJob(type, parameters, inputAssetIds, videoRefs, targetNodeId, initialDraft);
              });
              return true;
            }
            return false; // 通用失败：运行时落失败卡（errorText/errorCode 同原口径）
          },
        },
      );
      // 创建请求已发出（IKFXZD 面板关闭判定点）；HTTP 层异步失败由运行时收敛到卡片
    } catch (e: unknown) {
      // 同步异常兜底（如 crypto.randomUUID 在 HTTP 下不可用）
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        errorText: isApiError(e) ? e.message : '创建任务失败',
        errorCode: isApiError(e) ? envelopeErrorCode(e) : undefined,
      });
      return false;
    }
  };

  /* ===== 图像工具家族运行时派发（IKJJR2）：擦除/抠图/扩图/高清统一经 runtime.submit ===== */

  /** 承接卡已在画布（高清/扩图草稿）的恢复种子：目标/来源从画布现状快照（B.3 发送时事实）。 */
  const imageToolTargetOfNode = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return null;
    const host = generationRuntimeHostRef.current;
    return {
      targetNodeId: nodeId,
      seedTarget: seedTargetOfNode(node as unknown as RuntimeNodeView),
      seedSources: host ? seedSourcesOfNode(nodeId, host) : [],
    };
  };

  /** 受理后才建卡（擦除/抠图）的恢复种子：目标 = 按源卡推导的占位几何（role=result-placeholder，
   *  B.3 允许受理后建可见卡）；来源 = 源节点快照（画布连线受理后才建，不读边）。 */
  const imageToolTargetBesideSource = (source: Node, fileName: string, targetNodeId: string) => {
    const position = imageEnhanceDraftPosition(source);
    const d = (source.data ?? {}) as Record<string, unknown>;
    const width = typeof d.width === 'number' && d.width > 0 ? Math.round(d.width) : 320;
    const height = typeof d.height === 'number' && d.height > 0 ? Math.round(d.height) : 320;
    return {
      targetNodeId,
      seedTarget: { role: 'result-placeholder' as const, x: position.x, y: position.y, width, height, name: fileName },
      seedSources: [{
        node_id: source.id,
        x: Math.round(source.position.x),
        y: Math.round(source.position.y),
        width,
        height,
        name: typeof d.fileName === 'string' ? d.fileName : '',
      }],
    };
  };

  /** 图像工具提交派发：受理 settle 才 resolve/reject（createTask/startTask 等待口径）；
   *  提交/轮询/终态/台账/恢复归运行时；失败卡按卡在场差分（高清/扩图落失败卡、
   *  擦除/抠图受理前无卡不落——与迁移前两族行为一致）。 */
  const dispatchImageToolTask = (
    payload: ImageToolsPayload,
    target: { targetNodeId: string; seedTarget: RecoverySeedTarget; seedSources: RecoverySeedSource[] },
  ): Promise<string> => {
    const runtime = generationRuntimeRef.current;
    if (!runtime) return Promise.reject(new Error('生成任务运行时未就绪'));
    return new Promise<string>((resolve, reject) => {
      imageToolsAcceptanceRef.current.set(target.targetNodeId, { resolve, reject });
      const dispatched = runtime.submit(
        imageToolsTask,
        {
          payload,
          target: { ...target, expectedBindingRevision: runtime.bindingRevisionOf(target.targetNodeId) },
        },
        {
          // 前置保存失败（_skipped）时 create 未发出、家族无 notify——这里补通知等待方
          onCreateFailure: (e: unknown) => { reject(e); return false; },
        },
      );
      if (!dispatched) {
        imageToolsAcceptanceRef.current.delete(target.targetNodeId);
        reject(new Error('任务提交中，请勿重复发送'));
      }
    });
  };

  /** 高清任务（IKJJR2 迁入运行时）：草稿卡由入口预建；lastParams（契约六键）随提交冻结写入卡，
   *  失败卡重试经 runtime 按冻结输入原样重发创建端点。受理 settle 前会话不关——创建失败
   *  由编辑界面再次发送（IKIXK8 边界）；失败卡/轮询/取消/删除/恢复归运行时。 */
  const startImageEnhanceJob = async (submission: ImageEnhanceSubmission, silent = false): Promise<void> => {
    const { nodeId, payload: input, identity } = submission; // 项目由运行时从宿主取（与画布当前项目一致）
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const isDraftTarget = ((node?.data ?? {}) as Record<string, unknown>).draft === true;
    patchMediaNode(nodeId, {
      genStatus: 'generating',
      progress: 0,
      errorText: undefined,
      ...(isDraftTarget && !hasCustomName(node) ? { fileName: '高清生成中' } : {}),
      // 提交即写 lastParams（契约六键形态）：失败重试原样重发、重新编辑回填共用
      imageEnhance: { ...identity, lastParams: input },
    });
    const target = imageToolTargetOfNode(nodeId);
    if (!target) throw new Error('高清目标卡不存在');
    try {
      await dispatchImageToolTask({ kind: 'imageEnhance', input }, target);
    } catch (error) {
      // silent=false（历史重试入口）保留 HTTP 提示口径；面板静默传输的失败只由运行时落失败卡
      if (!silent || !isSilentAuthError(error)) throw error;
    }
  };

  /** 创建智能扩图任务（IKGOR6）：扩图结果卡原地承接（草稿转生成中，不新建卡）。
   *  六键 input 已由发送侧组好并过契约 zod 校验（buildImageOutpaintInput）；lastParams 随提交
   *  立即写入节点（失败重试原样重发共用）。免费口径（规格）：不走余额拦截门。
   *  IKJJR2 迁入运行时：受理 settle 才返回（会话失败反馈保持），失败落卡/轮询/取消/删除/恢复归运行时。 */
  const startImageOutpaintJob = async (
    nodeId: string,
    input: ImageOutpaintInput,
    opts?: { projectId?: string; silent?: boolean },
  ): Promise<void> => {
    const projectId = opts?.projectId ?? currentId;
    if (!projectId) {
      showToast('warn', '未选中项目，无法发起扩图');
      return;
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
    const target = imageToolTargetOfNode(nodeId);
    if (!target) throw new Error('扩图目标卡不存在');
    try {
      await dispatchImageToolTask({ kind: 'imageOutpaint', input }, target);
    } catch (error) {
      if (!opts?.silent || !isSilentAuthError(error)) throw error;
    }
  };

  /** 扩图的预建卡、来源关系与参数校验保留在宿主，失败撤销本次草稿。 */
  const prepareOutpaintTask = (frozen: OutpaintFrozenInput): OutpaintTaskSubmission | null => {
    const { projectId, source: sourceNode, sourceAssetId, ratios } = frozen;
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(sourceNode), {
      fileName: '扩图',
      data: { imageOutpaint: { sourceAssetId } },
    });
    addCanvasEdge(sourceNode.id, draftId, undefined, { origin: IMAGE_OUTPAINT_EDGE_ORIGIN });
    const input = buildImageOutpaintInput(sourceAssetId, draftId, ratios);
    if (!input) {
      removeCanvasNodes([draftId]);
      showToast('warn', '扩图参数不合法，请调整后重试');
      return null;
    }
    return { projectId, source: sourceNode, targetNodeId: draftId, payload: input };
  };
  toolHostsRef.current.outpaint = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    clearPickState: () => {
      if (imagePickSessionActive) endImagePickSession();
      if (videoPickSessionActive) endVideoPickSession();
      if (audioPickSessionActive) endAudioPickSession();
      if (pickMode || pickTarget) {
        setPickMode(null); setPickTarget(null); setPickRefRole(null); setPickProductId(null); setPickAssetId(null);
      }
    },
    prepareTask: prepareOutpaintTask,
    startTask: ({ projectId, targetNodeId, payload }) => startImageOutpaintJob(targetNodeId, payload, { projectId, silent: true }),
    warn: (message) => showToast('warn', message),
    error: (message) => globalToast.error(message),
  };

  /* ===== 擦除发送链路（IKGOTB）：发送时才建结果卡 + 纯视觉来源线 + 终态回填 ===== */

  /** 擦除受理后的结果卡与来源边仍由画布宿主建立（建卡时机保持「受理后」）；在途锁、
   *  jobId 回填与轮询已由统一任务运行时接管（IKJJR2）。 */
  const handoffImageEraseTask = async (
    submission: ImageEraseTaskSubmission,
    created: { job_id: string },
    skipSelect: boolean,
  ): Promise<void> => {
    const { source: node, payload: input } = submission;
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(node), {
      fileName: '擦除',
      nodeId: input.target_node_id,
      skipSelect,
      data: {
        imageErase: { sourceAssetId: input.source_asset_id, lastInput: input },
        genStatus: 'generating',
        progress: 0,
        jobId: created.job_id,
      },
    });
    addCanvasEdge(node.id, draftId, undefined, { origin: IMAGE_ERASE_EDGE_ORIGIN });
  };
  toolHostsRef.current.erase = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    newTargetId: () => newNodeId('media-draft'),
    encodeMask: rasterizeMaskToPngFile,
    uploadMask: (file, projectId) => uploadAssetFile(file, { projectId, assetSource: 'mask_erase', silent: true }),
    // IKJJR2：提交经统一运行时（canvas_binding + 受理台账 + 恢复）；受理 settle 才返回——
    // 保持「创建失败由编辑界面再次发送」与受理后建卡（IKIXK8 边界）。
    createTask: ({ source, payload }) => {
      const target = imageToolTargetBesideSource(source, '擦除', payload.target_node_id);
      return dispatchImageToolTask({ kind: 'imageErase', input: payload }, target).then((job_id) => ({ job_id }));
    },
    handoff: handoffImageEraseTask,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  /* ===== 去字幕发送链路（IKGZ83 建/来源线差异保留；IKJJR3 受理与后续生命周期归运行时） ===== */

  /** IKJJR3：视频处理家族提交共用段——建卡后由运行时注入 canvas_binding 发起受理，
   *  轮询/归属检查/保存确认/恢复统一在运行时；target facts 为发送时快照。 */
  const submitVideoToolTask = (
    payload: VideoToolPayload,
    targetNodeId: string,
    options?: Parameters<GenerationRuntime['submit']>[2],
  ): boolean => {
    const runtime = generationRuntimeRef.current;
    const host = generationRuntimeHostRef.current;
    const node = mediaNodesRef.current.find((n) => n.id === targetNodeId);
    if (!runtime || !host || !node) return false;
    return runtime.submit(
      videoToolsTask,
      {
        payload,
        target: {
          targetNodeId,
          seedTarget: seedTargetOfNode(node as unknown as RuntimeNodeView),
          seedSources: seedSourcesOfNode(targetNodeId, host),
          expectedBindingRevision: runtime.bindingRevisionOf(targetNodeId),
        },
      },
      options,
    );
  };

  toolHostsRef.current.subtitleErase = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    newTargetId: () => newNodeId('media-draft'),
    // IKJJR3：先建结果卡（继承源宽高 + 身份冻结 lastInput）拉来源边，再交运行时受理。
    // 建卡差异（位置/命名/身份/来源边 origin）与 IKGZ83 先例一致；受理失败落失败卡可重试。
    startTask: (input: SubtitleEraseTaskSubmission, skipSelect: boolean): boolean => {
      const { source: node, payload } = input;
      const targetNodeId = payload.target_node_id;
      const sourceData = node.data;
      createImageDraftCard(imageEnhanceDraftPosition(node), {
        fileName: '去字幕',
        nodeId: targetNodeId,
        skipSelect,
        data: {
          mediaType: 'video',
          ...(typeof sourceData.width === 'number' ? { width: sourceData.width } : {}),
          ...(typeof sourceData.height === 'number' ? { height: sourceData.height } : {}),
          videoSubtitleErase: { sourceAssetId: payload.source_asset_id, lastInput: payload },
          genStatus: 'generating',
          progress: 0,
        },
      });
      addCanvasEdge(node.id, targetNodeId, undefined, { origin: VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN });
      return submitVideoToolTask({ kind: 'subtitleErase', input: payload }, targetNodeId);
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  /* ===== 抠图发送链路（IKGXMT，镜像擦除 IKGOTB）：发送时才建结果卡 + 纯视觉来源线 + 终态回填 ===== */

  /** 抠图受理后的建卡与来源边沿用画布宿主（建卡时机保持「受理后」）；在途锁、jobId
   *  回填与轮询已由统一任务运行时接管（IKJJR2）。 */
  const handoffCutoutTask = async (
    submission: CutoutSubmission,
    created: { job_id: string },
    skipSelect: boolean,
  ): Promise<void> => {
    const { source: node, payload: input } = submission;
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(node), {
      fileName: '抠图',
      nodeId: input.target_node_id,
      skipSelect,
      data: {
        imageCutout: { sourceAssetId: input.source_asset_id, lastInput: input },
        genStatus: 'generating',
        progress: 0,
        jobId: created.job_id,
      },
    });
    addCanvasEdge(node.id, draftId, undefined, { origin: IMAGE_CUTOUT_EDGE_ORIGIN });
  };
  toolHostsRef.current.cutout = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    newTargetId: () => newNodeId('media-draft'),
    // IKJJR2：提交经统一运行时；受理 settle 才返回（镜像擦除 host）。
    createTask: ({ source, payload }) => {
      const target = imageToolTargetBesideSource(source, '抠图', payload.target_node_id);
      return dispatchImageToolTask({ kind: 'imageCutout', input: payload }, target).then((job_id) => ({ job_id }));
    },
    handoff: handoffCutoutTask,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  /** 取消接口仅登记意图；权威终态确认前保留生成中状态及轮询，避免编辑/删除绕过在途保护。 */
  const handleCancelJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    // IKJJR7：全部生成中卡归运行时 claims 分派（权威终态收敛 + 取消保留卡 settleTarget 确认），
    // 页面无 claims 的取消-核对兜底骨架删除。
    if (node && generationRuntimeRef.current?.claims(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      generationRuntimeRef.current.cancel(nodeId);
      return;
    }
  };

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

  /** 混合占位卡确认移除时同步收走来源线，并马上保存 removed 状态。 */
  const removeAudioMixCardNow = (nodeId: string) => {
    const nextNodes = mediaNodesRef.current.filter((node) => node.id !== nodeId);
    const nextEdges = edgesRef.current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    mediaNodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setMediaNodes(nextNodes);
    setEdges(nextEdges);
    activeJobByNodeRef.current.delete(nodeId);
    if (currentId) void flushCanvasSave(currentId).catch(() => {});
  };

  /** 删除生成中卡片（IKDMQW）：先请求取消；任务权威终态非 succeeded 才移除——
   *  cancelled/failed 终态确认后立即移除；仍 processing（软取消已登记、worker 未停）时不
   *  抢先移除，登记删除意图由轮询终态驱动（succeeded 竞态保留作品并提示「任务已完成」）。
   *  取消失败：保留卡片提示原因（任务仍可查看/轮询收敛），用户需要时再操作一次。
   *  IKJJR7：全部生成中卡归运行时 claims 分派（runtime.remove 承接取消确权与 remove($target)
   *  显式确认），页面无 claims 的取消-核对-移除兜底骨架删除。 */
  const deleteGeneratingNode = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (node && generationRuntimeRef.current?.claims(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      generationRuntimeRef.current.remove(nodeId);
      return;
    }
    // 无任务身份的生成中卡（创建窗口被删等异常态）：直接移除，避免删除入口卡死
    removeMediaNodeNow(nodeId);
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
    if (Array.from(idSet).some(isAudioMixNodeId)) {
      mediaNodesRef.current = filter(mediaNodesRef.current);
      edgesRef.current = remainingEdges;
      if (currentId) void flushCanvasSave(currentId).catch(() => {});
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
    // IKJJR4：混合/合成失败卡归统一任务运行时——原有专属重试协议（POST
    // /audio-mixes/:jobId/retry、/audio-video-muxes/:jobId/retry 复用同 jobId）由
    // mixMuxTasks 定义承载；携可信关联时新 submission_id 独立提交身份隔离前端操作轮次，
    // 历史卡（无受理关联）不带绑定走原路径。防重入/同键复用/归属检查在运行时；
    // statusOf 为同步读（patchMediaNode 不落 ref，同帧双击不能依赖卡片态）。
    if (node && (isAudioMixNodeId(nodeId) || audioVideoMuxIdentityOf(node) != null)) {
      if (!currentId) {
        showToast('warn', '未选中项目，无法重试');
        return;
      }
      const inFlight = generationRuntimeRef.current?.statusOf(nodeId);
      if (inFlight && (inFlight.phase === 'submitting' || inFlight.phase === 'generating')) return;
      generationRuntimeRef.current?.retry(nodeId);
      return;
    }
    // IKJJR2：图像工具家族失败卡归统一任务运行时——冻结输入（lastInput/lastParams）原样
    // 重发创建端点（四工具契约无 retry 端点），携可信关联 canvas_binding（独立提交身份）；
    // 冻结输入缺失时保留失败卡并提示重新编辑（A.6，不补猜测默认值）。
    if (node && isImageToolsCard(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      if (jobId != null) {
        // 服务端已受理（任务失败）：runtime.retry 携可信关联重发
        generationRuntimeRef.current?.retry(nodeId);
        return;
      }
      // 首次创建即失败（无任务身份）：按可信冻结输入经 runtime.submit 重发——同载荷
      // 复用同一把 submission_id（服务端重放，不重复建任务）；失败照旧落失败卡。
      const payload = imageToolsRetryPayloadOf(nodeId, (node.data ?? {}) as Record<string, unknown>);
      if (!payload) {
        showToast('warn', '原任务输入已不可信，请重新编辑后再发送');
        return;
      }
      const target = imageToolTargetOfNode(nodeId);
      if (!target) return;
      patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '', errorCode: undefined });
      dispatchImageToolTask(payload, target).catch(() => {}); // 重试失败由运行时落失败卡（无等待方，吞 reject）
      return;
    }
    // IKJJR7：claims 分派已覆盖全部后台任务家族（普通生成/图像/视频/混合合成/多结果），
    // 场景切分/人声分离/普通生成的旧独立分支与无 claims 兜底轮询重试骨架随之删除——
    // IKJJR1 起各家族定义承载重试协议（服务端冻结输入/客户端冻结重发/专属同 jobId）。
    if (node && generationRuntimeRef.current?.claims(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      if (!currentId) {
        showToast('warn', '未选中项目，无法重试');
        return;
      }
      const hdRetry = videoToolFrozenPayload(nodeId, (node.data ?? {}) as Record<string, unknown>)?.kind === 'videoEnhance';
      if (hdRetry && (isVideoEnhanceCardInFlight(nodeId) || node.data.genStatus === 'generating' || node.data.genStatus === 'checking')) return;
      const ownsHdSession = hdRetry ? toolRuntime.captureSessionOwnership('videoEnhance') : null;
      const finishHd = hdRetry ? beginVideoEnhanceSubmission(nodeId) : null;
      generationRuntimeRef.current.retry(nodeId, {
        deferGeneratingUntilAccepted: hdRetry,
        onStale: () => finishHd?.(),
        onCreateFailure: hdRetry ? (error: unknown) => {
          finishHd?.();
          if (!isSilentAuthError(error) && ownsHdSession?.() && !isVideoEnhanceCardInFlight(nodeId)) {
            if (isApiError(error)) globalToast.error(error.message);
            showToast('error', apiErrorMessage(error, 'HD 高清任务创建失败，请重试'));
          }
          return false;
        } : undefined,
        // 受理即冻结对重试路径同样成立（IKHSFH）：重试受理后 frozenParams/lastParams 写卡
        //（旧持久化卡由此补齐权威冻结来源），面板后来的编辑只改 lastParams 不改它。
        onAccepted: () => {
          finishHd?.();
          const identityData = (mediaNodesRef.current.find((n) => n.id === nodeId)?.data ?? {}) as Record<string, unknown>;
          const frozen = videoToolFrozenPayload(nodeId, identityData);
          const frameIdentity = identityData.frameInterpolation as FrameInterpolationIdentity | undefined;
          if (frameIdentity != null && frozen?.kind === 'frameInterpolation') {
            patchMediaNode(nodeId, { frameInterpolation: { ...frameIdentity, frozenParams: { fps: frozen.input.fps } } });
            return;
          }
          const hdIdentity = identityData.videoEnhance as VideoEnhanceIdentity | undefined;
          if (hdIdentity != null && frozen?.kind === 'videoEnhance') {
            patchMediaNode(nodeId, { videoEnhance: { ...hdIdentity, lastParams: { resolution: frozen.input.resolution } } });
          }
        },
      });
    }
  };
  actionsRef.current.cancelJob = handleCancelJob;
  actionsRef.current.retryJob = handleRetryJob;
  actionsRef.current.removeMediaNode = handleRemoveMediaNode;

  /* ============ 节点动作实现：点卡片开面板/画质横排按钮/详情下载（工具条生成类
     按钮已撤，IKH3WE：派生新卡唯一路径 = 拖线落空白类型菜单，原卡重跑唯一路径 = 点卡片） ============ */

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
    generationDock.updateDraft('image', { attachments: { targetNodeId, orderedNodeIds } });
    generationDock.updateDraft('video', { attachments: { targetNodeId, orderedNodeIds } });
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

  const reorderVideoFreeRefs = (keys: string[]) => generationDock.updateDraft('video', { freeReference: { operation: 'reorder', keys } });

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
        if (!confirmed.success || !planBindingsCoveredBy(bindings, confirmed.data)) return `方案索引 ${label} 素材待同步，请先同步素材到目标`;
        const missing = bindings.filter(b => !availableIds.includes(b.assetId));
        if (missing.length) return `方案索引 ${missing.map(b => `#${b.index}`).join('、')} 素材缺失，请恢复连线或修正方案`;
      }
      return undefined;
    };
    // 与 Dock 展示 / 提交同源：直接参考 ∪ 文本索引带入（方案卡应用到画布后素材只挂在方案卡上，不直连视频草稿）
    const videoRefs = videoSeed?.targetNodeId
      ? mergedVideoRefsWithTextIndex(videoSeed.targetNodeId, edges, mediaNodes, textNodes)
      : { reference: [] };
    const videoAvailableIds = [...videoRefs.reference, ...(videoRefs.first ? [videoRefs.first] : []), ...(videoRefs.last ? [videoRefs.last] : [])]
      .flatMap((ref) => videoRefIdentityIds(ref));
    return {
      image: forTarget(
        imageSeed?.targetNodeId,
        imageSeed?.targetNodeId
          ? mergedImageRefsOf(imageSeed.targetNodeId, edges, [...mediaNodes, ...textNodes]).map((ref) => ref.assetId)
          : [],
      ),
      videoIndices: edges.filter(e => e.target === videoSeed?.targetNodeId).flatMap(e => {
        const plan = textNodes.find(n => n.id === e.source && n.data.promptSource);
        const mentions = promptMentionSchema.array().safeParse(plan?.data.promptMentions ?? []);
        return mentions.success ? promptBindingList(mentions.data).map(m => `#${m.index}`) : [];
      }).join('、'),
      video: forTarget(videoSeed?.targetNodeId, videoAvailableIds),
    };
  }, [imageSeed?.targetNodeId, videoSeed?.targetNodeId, edges, mediaNodes, textNodes]);

  const pendingPlanSyncs = (targetId: string | undefined) => edges.filter(edge => edge.target === targetId).flatMap(edge => {
    const node = textNodes.find(node => node.id === edge.source && node.data.promptSource);
    if (!node) return [];
    const mentions = promptMentionSchema.array().safeParse(node.data.promptMentions ?? []);
    if (!mentions.success || !validPromptMentions(extractTextNodeText(node.data), mentions.data)) return [];
    const bindings = promptBindingList(mentions.data);
    const confirmed = promptBindingsSchema.safeParse((edge.data?.promptReference as { bindings?: unknown } | undefined)?.bindings ?? (bindings.length ? undefined : []));
    return confirmed.success && planBindingsCoveredBy(bindings, confirmed.data) ? [] : [{ nodeId: node.id, title: String(node.data.title || '方案'), bindings }];
  });
  const syncPlanToTarget = (planNodeId: string, targetId: string | undefined) => {
    const pending = pendingPlanSyncs(targetId).find(plan => plan.nodeId === planNodeId);
    if (pending && targetId) connectPlanToDraft(planNodeId, targetId);
  };

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
  /** IKFM3S §6：定位来源文本卡（平移居中 + 选中高亮） */
  const locateTextSource = useCallback((nodeId: string) => {
    const target = findCanvasNode(nodeId);
    if (!target) return;
    const width = (target as Node & { measured?: { width?: number } }).measured?.width ?? 360;
    const height = (target as Node & { measured?: { height?: number } }).measured?.height ?? 270;
    setFocusViewport({ x: window.innerWidth / 2 - (target.position.x + width / 2), y: window.innerHeight / 2 - (target.position.y + height / 2), zoom: 1 });
    setSelectRequest({ id: nodeId, ts: Date.now() });
  }, []);
  /** 面板/Dock 移除媒体参考（图片 IKDMQR / 视频 IKDMQS / 音频 IKFDFZ 共用）：断开对应连线——
   *  仅改变关系，不删除来源素材卡，也不影响其他目标对同一来源的引用（按 (source,target) 精确匹配）。 */
  const removeRefEdges = (draftId: string, sourceNodeId: string) => {
    if (isGeneratingNode(draftId)) return;
    removeTargetInputs(edgesRef.current.filter(edge => edge.source === sourceNodeId && edge.target === draftId).map(edge => edge.id));
  };

  /** 草稿绑定面板的音频媒体参考（IKFDFZ 按连线推导 + IKFM41 §11 文本带入参考追加）：
   *  直接参考在前、文本索引素材追加尾部（同 assetId 去重保首见），面板显示即提交
   *  references 输入（同源）；连线随画布自动保存持久化，刷新/重开经同一推导恢复展示；
   *  失效来源保留原因提示并阻止发送，名称随来源卡片改名即时同步。 */
  /** 面板「从画布选择」列表添加参考（IKFDFZ）：与画布选取/@ 同一校验与建线语义 */
  const handleAddAudioCanvasRef = (nodeId: string) => {
    if (!audioDraftId) return;
    if (!validateAudioRefConnect(nodeId, audioDraftId)) return;
    addCanvasEdge(nodeId, audioDraftId);
  };

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

  const appendVideoFreeRef = (item: VideoMediaRef, role: VideoRefRole) => generationDock.updateDraft('video', { freeReference: { operation: 'add', item, role } });
  const removeVideoFreeRef = (key: string) => generationDock.updateDraft('video', { freeReference: { operation: 'remove', key } });
  const assignVideoFreeRefRoles = (assignments: Array<{ nodeId: string; role: VideoRefRole }>) => generationDock.updateDraft('video', { freeReference: { operation: 'assign', assignments } });

  /** 高清放大（IKGM9F/IKGM9O）：照搬「生成图片」建卡骨架——来源预检后在源卡右侧建「高清」草稿卡并自动选中；
   *  连线带 origin 标记为纯视觉来源边（不占参考位、不参与 @ 编号与媒体索引）。
   *  节点 data 写入高清身份标记（含源素材身份）供「重新编辑」分流与参数回填；
   *  建卡后自动弹出高清放大参数面板（规格故事 10），链式放大（高清卡上再点）同链新建卡 */
  const handleNodeEnhanceImage = (id: string): string | undefined => {
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
    return draftId;
  };

  /** 视频 HD 高清（IKH3VG）：照搬「高清放大」建卡骨架——门槛预检（置灰层已完成，此处兜底）
   *  后在源视频卡右侧建「HD」草稿卡并自动选中；连线带 origin 标记为纯视觉来源边
   *  （不占参考位、不参与 @ 编号与媒体索引）。节点 data 写入 HD 身份标记（含源素材身份）
   *  供点卡重开与「重新编辑」分流；建卡后自动弹出 HD 面板（发送任务接通归 IKH3VH） */
  const handleNodeVideoEnhance = (id: string): string | undefined => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const gate = videoEnhanceGateReason((node.data ?? {}) as Record<string, unknown>);
    if (gate) {
      showToast('warn', gate);
      return;
    }
    const sourceData = (node.data ?? {}) as Record<string, unknown>;
    const draftId = createVideoDraftCard(undefined, videoEnhanceDraftPosition(node), {
      fileName: 'HD',
      data: { videoEnhance: { sourceAssetId: readAssetId(sourceData) } },
    });
    addCanvasEdge(id, draftId, undefined, { origin: VIDEO_ENHANCE_EDGE_ORIGIN });
    return draftId;
  };

  /** HD 面板参数变更即时写卡（IKH3VG，「切换即时生效」）：resolution 随面板切换写入
   *  node.data.videoEnhance.lastParams（契约单键形态），关闭/重开/重新编辑恢复同源，
   *  随画布自动保存持久化 */
  const handleVideoEnhanceParamsChange = (nodeId: string, resolution: VideoEnhanceResolution) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).videoEnhance as VideoEnhanceIdentity | undefined;
    patchMediaNode(nodeId, {
      videoEnhance: { ...identity, lastParams: { resolution } },
    });
  };

  /** 视频插帧（IKHLKR，父单 IKHLES / ADR-0113）：「高清 ▾」下拉第二项——照搬 HD 建卡骨架：
   *  门槛预检（置灰层已完成，此处兜底）后在源视频卡右侧（源卡实际内容宽 + 60）新建独立视频
   *  草稿卡（每次点击独立建卡，不复用既有草稿），绑定源 assetId 与插帧身份（fps 默认 60）、
   *  默认名「插帧 · 60fps」；连线带 origin 标记为来源边（不参与参考推导与 @ 编号）；
   *  建卡后自动弹出插帧面板（发送任务接通归 IKHLKX，本票不建任务） */
  const handleNodeFrameInterpolation = (id: string): string | undefined => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const gate = frameInterpolationGateReason((node.data ?? {}) as Record<string, unknown>);
    if (gate) {
      showToast('warn', gate);
      return;
    }
    const sourceData = (node.data ?? {}) as Record<string, unknown>;
    const fps = FRAME_INTERPOLATION_DEFAULT_FPS;
    const draftId = createVideoDraftCard(undefined, frameInterpolationDraftPosition(node), {
      fileName: frameInterpolationDisplayName(fps),
      data: {
        frameInterpolation: {
          sourceAssetId: readAssetId(sourceData),
          lastParams: { fps },
        } satisfies FrameInterpolationIdentity,
      },
    });
    addCanvasEdge(id, draftId, undefined, { origin: FRAME_INTERPOLATION_EDGE_ORIGIN });
    return draftId;
  };

  /** 插帧面板参数变更即时写卡（IKHLKR，「切换即时生效」）：fps 随面板切档写入
   *  node.data.frameInterpolation.lastParams（契约单键形态），关闭/重开/刷新恢复同源；
   *  卡名同步改为「插帧 · {fps}fps」——仅当卡名仍是自动名（无 customName 标记，IKFA8X 口径
   *  同 applyJobTerminal）时跟随，用户改过名不被切档覆盖 */
  const handleFrameInterpolationParamsChange = (nodeId: string, fps: FrameInterpolationFps) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).frameInterpolation as FrameInterpolationIdentity | undefined;
    patchMediaNode(nodeId, {
      frameInterpolation: { ...identity, lastParams: { fps } },
      ...(hasCustomName(node) ? {} : { fileName: frameInterpolationDisplayName(fps) }),
    });
  };

  /** 插帧任务先落盘后创建（draft 角色由运行时先 flushCanvasSave 再 POST，票面 IKHSFF 验收 1）、
   *  原卡受理及 frozenParams 回填。按卡任务锁（submitting 窗口）与轮询归运行时，界面关闭
   *  不能释放它；受理失败/等待期间切项目由运行时归属检查与统一恢复接续。 */
  const startFrameInterpolationJob = async (submission: FrameInterpolationSubmission): Promise<boolean> => {
    const { nodeId, payload: input, identity } = submission;
    const fps = input.fps;
    toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    // 插帧草稿卡转生成中（受理/轮询归运行时，draft 角色由运行时先落盘再 POST）
    patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: undefined });
    // IKJJR3：受理即冻结（IKHSFH）：frozenParams = 最后受理任务的输入（失败重试原样重发的
    // 权威来源，面板主动发送新配置成功受理后才更新）；lastParams 保留面板编辑值不回写
    const sent = submitVideoToolTask({ kind: 'frameInterpolation', input }, nodeId, {
      onAccepted: () => {
        const current = (mediaNodesRef.current.find((node) => node.id === nodeId)?.data.frameInterpolation as FrameInterpolationIdentity | undefined);
        patchMediaNode(nodeId, {
          frameInterpolation: { ...identity, lastParams: current?.lastParams, frozenParams: { fps } },
        });
      },
      onCreateFailure: (e: unknown) => {
        // 受理失败：插帧草稿卡回配置态（参数保留在 lastParams），面板可重发；不落通用失败卡。
        // 保存失败（_skipped）运行时已统一提示「画布保存失败，生成任务未提交」。
        const rollback = mediaNodesRef.current.find((n) => n.id === nodeId);
        const isDraft = ((rollback?.data ?? {}) as Record<string, unknown>).draft === true;
        patchMediaNode(nodeId, { genStatus: isDraft ? 'draft' : undefined, progress: undefined, errorText: undefined });
        if (!(e as { _skipped?: boolean })._skipped) {
          showToast('error', isApiError(e) ? e.message : '插帧任务创建失败，请重试');
        }
        return true;
      },
    });
    toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    return sent;
  };

  /** 水合后核对最新关联（含已保存的旧 jobId），同时恢复该任务的冻结输入（IKHSFE 历史可信
   *  关联恢复，IKJJR3 后仅服务历史插帧卡与「受理回执未到就关页」的草稿卡——新协议卡的恢复
   *  主路径是统一运行时，本查询续轮询同样经运行时登记，恢复扫描按 active 判重防双链）。
   *  Query 按项目/节点去重，现有终态与轮询负责结果；恢复失败时保留卡片（冻结输入缺失的
   *  重试由运行时按不可信冻结输入阻止并提示重新编辑，A.6）。 */
  const recoverFrameInterpolation = (nodeId: string, savedJobId?: unknown) => {
    const projectId = activeProjectRef.current;
    if (!projectId) return;
    const activeAtStart = activeJobByNodeRef.current.get(nodeId);
    queryClient.fetchQuery(frameInterpolationRecoveryOptions(projectId, nodeId))
      .then(({ current, input }) => {
        if (activeProjectRef.current !== projectId) return;
        const node = mediaNodesRef.current.find((n) => n.id === nodeId);
        if (!node) return;
        const data = (node.data ?? {}) as Record<string, unknown>;
        // 核对水合时的身份；查询期间的新提交、取消和删除优先于恢复结果（提交窗口 =
        //  运行时 submitting 阶段）。
        if (data.jobId !== savedJobId ||
          activeJobByNodeRef.current.get(nodeId) !== activeAtStart ||
          generationRuntimeRef.current?.statusOf(nodeId)?.phase === 'submitting' ||
          locallyRemovedGenerationNodesRef.current.has(nodeId) || !data.frameInterpolation) return;
        if (!current) return;
        if (current.status === 'cancelled') {
          activeJobByNodeRef.current.delete(nodeId);
          settleCancelledNode(nodeId);
          return;
        }
        const identity = data.frameInterpolation as FrameInterpolationIdentity;
        if (input) patchMediaNode(nodeId, {
          frameInterpolation: { ...identity, sourceAssetId: input.source_asset_id, frozenParams: { fps: input.fps }, recoveryBlocked: undefined },
        });
        else if (identity.recoveryBlocked) {
          // 查询成功但无 input（旧任务无投影）：解除阻断，回落 lastParams 兼容
          patchMediaNode(nodeId, { frameInterpolation: { ...identity, recoveryBlocked: undefined } });
        }
        if (current.status === 'queued' || current.status === 'processing') {
          patchMediaNode(nodeId, {
            genStatus: 'generating',
            progress: current.progress,
            errorText: undefined,
            jobId: current.job_id,
          });
          // IKJJR3：续轮询经统一运行时登记（恢复扫描按在途判重，不双链）
          generationRuntimeRef.current?.resumeFromHydration(nodeId, String(current.job_id), (node.data ?? {}) as Record<string, unknown>);
          return;
        }
        // 终态：登记活跃任务（迟到响应防线）+ 写回 jobId（成品卡 jobId≠null 是来源连线
        // target Handle 的渲染依据，家族口径同 applyJobTerminal 通用成功分支），详情到达
        // 前不转生成中；详情仍在处理中/查询失败则回退处理中口径续轮询兜底
        activeJobByNodeRef.current.set(nodeId, String(current.job_id));
        patchMediaNode(nodeId, { jobId: current.job_id });
        void fetchJobStatus(current.job_id)
          .then((detail) => {
            if (!jobResponseGuarded(nodeId, current.job_id)) return;
            if (applyJobTerminal(nodeId, current.job_id, detail) === 'processing') {
              patchMediaNode(nodeId, {
                genStatus: 'generating',
                progress: detail.progress,
                errorText: undefined,
              });
              generationRuntimeRef.current?.resumeFromHydration(nodeId, String(current.job_id), (node.data ?? {}) as Record<string, unknown>);
            }
          })
          .catch(() => {
            if (!jobResponseGuarded(nodeId, current.job_id)) return;
            patchMediaNode(nodeId, {
              genStatus: 'generating',
              progress: current.progress,
              errorText: undefined,
            });
            generationRuntimeRef.current?.resumeFromHydration(nodeId, String(current.job_id), (node.data ?? {}) as Record<string, unknown>);
          });
      })
      .catch((e: unknown) => {
        // 保留原卡；查询失败标记 recoveryBlocked——冻结输入未回填前重试按不可信输入阻止
        //（A.6 不按面板值猜参数），刷新可重新读取，面板仍可主动发送新配置。
        console.warn('[frame-interpolation] 恢复查询失败:', e);
        const failedNode = mediaNodesRef.current.find((n) => n.id === nodeId);
        const failedData = (failedNode?.data ?? {}) as Record<string, unknown>;
        const failedIdentity = failedData.frameInterpolation as FrameInterpolationIdentity | undefined;
        if (failedIdentity != null && !failedIdentity.recoveryBlocked) {
          patchMediaNode(nodeId, { frameInterpolation: { ...failedIdentity, recoveryBlocked: true } });
        }
      });
  };
  recoverFrameInterpolationRef.current = recoverFrameInterpolation;

  const beginVideoEnhanceSubmission = (nodeId: string) => {
    const pending = videoEnhanceInFlightRef.current.get(nodeId) ?? new Set<{ projectId: string | null; loadEpoch: object }>();
    const request = { projectId: activeProjectRef.current, loadEpoch: docLoadEpochRef.current };
    pending.add(request);
    videoEnhanceInFlightRef.current.set(nodeId, pending);
    toolRuntime.notifyInFlight('videoEnhance', nodeId);
    toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    return () => {
      if (!pending.delete(request)) return;
      if (pending.size === 0) videoEnhanceInFlightRef.current.delete(nodeId);
      toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    };
  };

  /** HD 任务提交（IKJJR3）：交运行时受理（draft 角色先落盘再 POST，B.3）；
   *  受理即写 lastParams（失败重试原样重发、重新编辑回填共用）；受理失败草稿回配置态，
   *  轮询/归属/保存确认归运行时。 */
  const startVideoEnhanceJob = async (submission: VideoEnhanceSubmission): Promise<void> => {
    const { nodeId, payload: input, identity } = submission;
    const finish = beginVideoEnhanceSubmission(nodeId);
    return new Promise<void>((resolve, reject) => {
      const submitted = submitVideoToolTask({ kind: 'videoEnhance', input }, nodeId, {
        replaceSubmitting: true,
        onAccepted: () => {
          finish();
          patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: undefined });
          // 提交即写 lastParams（契约单键形态）：失败重试原样重发、重新编辑回填共用
          patchMediaNode(nodeId, { videoEnhance: { ...identity, lastParams: { resolution: input.resolution } } });
          resolve();
        },
        onCreateFailure: (e: unknown) => {
          finish();
          reject(e);
          return true;
        },
        onStale: () => { finish(); resolve(); },
      });
      if (!submitted) { finish(); resolve(); }
    });
  };

  toolHostsRef.current.panels = {
    getProjectId: () => activeProjectRef.current,
    getNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    getNodes: () => mediaNodesRef.current,
    canOpen: canOpenEditor,
    activate(nodeId, toolbar) {
      editingTargetRef.current = nodeId;
      const node = mediaNodesRef.current.find((node) => node.id === nodeId);
      if (toolbar && mediaCardToolbarVisible((node?.data ?? {}) as Record<string, unknown>)) {
        setSoloSelectedNodeId(nodeId);
        setSelectRequest({ id: nodeId, ts: Date.now() });
      }
    },
    isValidTarget(nodeId, kind) {
      const node = mediaNodesRef.current.find((node) => node.id === nodeId);
      return Boolean(node && (node.data.draft === true || hasGenerationRecord(node)) && node.data[kind]);
    },
    // 插帧按运行时阶段重算；HD 按同卡所有物理创建请求重算，旧请求不清新请求的锁。
    isFrameInFlight: (nodeId) => generationRuntimeRef.current?.statusOf(nodeId)?.phase === 'submitting',
    isVideoEnhanceInFlight: isVideoEnhanceCardInFlight,
    startImage: (input) => startImageEnhanceJob(input, true),
    startVideo: (input) => startVideoEnhanceJob(input),
    startFrame: startFrameInterpolationJob,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
    httpError: (message) => globalToast.error(message),
  };

  toolHostsRef.current.audioVideoMux = {
    getProjectId: () => currentId,
    getNode: (id) => mediaNodesRef.current.find((node) => node.id === id),
    createDraft: (source) => {
      const draftId = createVideoDraftCard(undefined, findAudioMixPosition(source, mediaNodesRef.current), {
        fileName: AUDIO_VIDEO_MUX_TITLE,
        data: { audioVideoMux: buildAudioVideoMuxIdentity(source.id, readAssetId(source.data)) },
      });
      addCanvasEdge(source.id, draftId, undefined, { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN });
      return draftId;
    },
    patchIdentity: (draftId, identity) => patchMediaNode(draftId, { audioVideoMux: identity }),
    removeBindEdges: (draft) => {
      const stale = edgesRef.current.filter((edge) => isAudioVideoMuxBindEdge(edge, draft));
      if (stale.length > 0) removeTargetInputs(stale.map((edge) => edge.id));
    },
    addVideoEdge: (sourceId, draftId) => addCanvasEdge(sourceId, draftId, undefined, { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN }),
    isInFlight: () => audioVideoMuxInFlightRef.current,
    setInFlight: (value) => { audioVideoMuxInFlightRef.current = value; },
    canApply: (projectId) => activeProjectRef.current === projectId,
    // IKJJR4：提交交生成任务运行时（mixMuxTasks 定义）。目标 = 原草稿卡（角色 draft，
    // 运行时先落盘再提交 B.3）；受理回执、幂等键（submission_id）、轮询与保存确认归运行时。
    createTask: async ({ payload, draftId }) => {
      const runtime = generationRuntimeRef.current;
      if (!runtime) throw new Error('生成任务运行时未就绪，请刷新后重试');
      const draft = mediaNodesRef.current.find((node) => node.id === draftId);
      if (!draft) throw new Error('合成草稿卡不在画布上，无法发送');
      const seedTarget = seedTargetOfNode(draft as unknown as RuntimeNodeView);
      return await new Promise<{ job_id: string }>((resolve, reject) => {
        const unwatch = watchMixSubmit(draftId, {
          accepted: (jobId) => { unwatch(); resolve({ job_id: jobId }); },
          failed: (error) => { unwatch(); reject(error); },
        });
        const issued = runtime.submit(
          audioVideoMuxTask,
          {
            payload,
            target: {
              targetNodeId: draftId,
              seedTarget,
              seedSources: seedSourcesOfNode(draftId, generationRuntimeHostRef.current!),
              expectedBindingRevision: runtime.bindingRevisionOf(draftId),
            },
          },
          {
            // 未受理：草稿卡回待生成（保留参数与绑定，留在面板改正后重发），提示归会话 onError
            onCreateFailure: () => {
              patchMediaNode(draftId, {
                genStatus: 'draft', progress: undefined, errorText: undefined,
                jobId: undefined, generationRecovery: undefined,
              });
              return true;
            },
            // IKJP8B：提交不会受理到底（失效/被替代/保存失败未发出）——收尾旧等待并释放
            // 会话锁，失效链不交接、不改写当前草稿
            onStale: () => { unwatch(); reject(staleMixSubmitError()); },
          },
        );
        if (!issued) {
          unwatch();
          reject(new Error('音视频合成任务未受理，请重试'));
        }
      });
    },
    handoff: async ({ projectId, draftId }) => {
      // 合成使用原草稿卡与持久身份；会话失效不丢弃已受理任务。受理后原卡原地转生成中
      //（jobId 已由运行时回填），保存与轮询归运行时。
      if (mediaNodesRef.current.some((node) => node.id === draftId)) {
        patchMediaNode(draftId, { genStatus: 'generating', progress: 0, errorText: undefined });
      }
      void flushCanvasSave(projectId).catch(() => {});
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  /** 上传成品后的落卡与来源边沿用画布宿主，裁切不进入后台任务链。 */
  const handoffCropResult: CropHost['handoff'] = ({ source }, uploaded) => {
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(source), {
      fileName: '裁切',
      skipSelect: true,
      data: {
        src: uploaded.url,
        assetId: uploaded.asset_id,
        width: uploaded.width,
        height: uploaded.height,
        mime: uploaded.mime,
        size: uploaded.size,
        // 裁切是客户端即时成品（无服务端任务/jobId）：清掉草稿态占位，成品图片正常展示；
        // 同时挂 imageCrop 身份标记——MediaNode 据此渲染左侧 target Handle 接收来源连线
        // （裁切无 jobId 走不通 jobId 通道，靠身份标记让成品态仍被识别为生成宿主）。
        genStatus: undefined,
        draft: undefined,
        imageCrop: { sourceAssetId: String(uploaded.asset_id) } satisfies ImageCropIdentity,
      },
    });
    addCanvasEdge(source.id, draftId, undefined, { origin: IMAGE_CROP_EDGE_ORIGIN });
  };
  toolHostsRef.current.crop = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    uploadFile: (file, projectId) => uploadAssetFile(file, { projectId, silent: true }),
    handoff: handoffCropResult,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  /* ===== 音视频分离/截取/调速发送链路（IKH28X/IKHB7A/IKHW5S 建卡与来源线差异保留；
     IKJJR3 受理与后续生命周期归运行时：canvas_binding 先受理，受理回执丢失由统一恢复兜底） ===== */

  toolHostsRef.current.audioVideoSplit = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    // IKJJR3：预分配占位卡 id（media-extract-{uuid}，前缀家族判定兼容）；受理后 jobId 由运行时回写
    startTask: (input: AudioVideoSplitSubmission): boolean => {
      const { source: node, payload } = input;
      const targetNodeId = mediaExtractNodeId(newIdempotencyKey());
      const placeholder = attachCallbacks(
        buildMediaExtractPlaceholderNode({
          jobId: targetNodeId.slice(MEDIA_EXTRACT_NODE_PREFIX.length),
          outputFormat: payload.output_format,
          sourceAssetId: payload.source_asset_id,
          source: node,
        }) as Node,
      );
      const current = mediaNodesRef.current;
      const next = current.some((item) => item.id === targetNodeId) ? current : [...current, placeholder];
      mediaNodesRef.current = next;
      setMediaNodes(next);
      addCanvasEdge(node.id, targetNodeId, undefined, { origin: MEDIA_EXTRACT_EDGE_ORIGIN });
      return submitVideoToolTask({ kind: 'mediaExtract', input: payload }, targetNodeId);
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  toolHostsRef.current.audioTrim = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    // IKJJR3：预分配占位卡 id（audio-trim-{uuid}）；贴边省略的可选键随冻结 input 原样进占位身份
    startTask: (input: AudioToolSubmission<AudioTrimInput>): boolean => {
      const { source: node, payload } = input;
      const targetNodeId = audioTrimNodeId(newIdempotencyKey());
      const placeholder = attachCallbacks(
        buildAudioTrimPlaceholderNode({
          jobId: targetNodeId.slice(AUDIO_TRIM_NODE_PREFIX.length),
          outputFormat: payload.output_format,
          timeParams: { start_time: payload.start_time, end_time: payload.end_time },
          sourceAssetId: payload.source_asset_id,
          source: node,
        }) as Node,
      );
      const current = mediaNodesRef.current;
      const next = current.some((item) => item.id === targetNodeId) ? current : [...current, placeholder];
      mediaNodesRef.current = next;
      setMediaNodes(next);
      // 连一条源音频 → 截取卡的**来源边**（带 origin 标记）：参考推导跳过，
      // 避免截取产物再次编辑时把源音频误当参考输入（防参考污染）
      addCanvasEdge(node.id, targetNodeId, undefined, { origin: AUDIO_TRIM_EDGE_ORIGIN });
      return submitVideoToolTask({ kind: 'audioTrim', input: payload }, targetNodeId);
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  toolHostsRef.current.audioSpeed = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    // IKJJR3：预分配占位卡 id（audio-speed-{uuid}）。跨项目接续由运行时归属检查与统一恢复
    // 接管（迟到受理归发起项目，回原项目水合时按服务端关联补卡续轮询），原页面暂存机制删除。
    startTask: (input: AudioToolSubmission<AudioSpeedInput>): boolean => {
      const { source: node, payload } = input;
      const targetNodeId = audioSpeedNodeId(newIdempotencyKey());
      const placeholder = attachCallbacks(
        buildAudioSpeedPlaceholderNode({
          jobId: targetNodeId.slice(AUDIO_SPEED_NODE_PREFIX.length),
          speed: payload.speed ?? 1,
          sourceAssetId: payload.source_asset_id,
          source: node,
        }) as Node,
      );
      const current = mediaNodesRef.current;
      const next = current.some((item) => item.id === targetNodeId) ? current : [...current, placeholder];
      mediaNodesRef.current = next;
      setMediaNodes(next);
      // 连一条源音频 → 调速卡的**来源边**（带 origin 标记）：参考推导跳过（防参考污染）
      addCanvasEdge(node.id, targetNodeId, undefined, { origin: AUDIO_SPEED_EDGE_ORIGIN });
      return submitVideoToolTask({ kind: 'audioSpeed', input: payload }, targetNodeId);
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  /** 人声分离任务发送核心（IKJJR5 迁入统一任务运行时，形态对齐场景切分）：退会话后本地
   *  预建占位卡（node id 预分配，vocal-split- 前缀保持家族判定；受理前不伪造恢复标记）+
   *  拉来源边（origin=vocal-split），runtime.submit 接管创建（Idempotency-Key =
   *  submission_id + canvas_binding）、轮询、终态收敛与多轨扇出（规范 track:<type> node_id
   *  + 纵向轨列 + 一笔原子保存）。创建失败：占位卡转失败态（卡上重试按 lastInput 原样重发，
   *  归 runtime.retry）。占位卡不落盘由恢复协议兜底（result-placeholder 角色，受理回执
   *  丢失走恢复扫描补卡）。 */
  const runVocalSplitTask = async (input: AudioToolSubmission<VocalSplitPayload>): Promise<void> => {
    const { source: node, payload } = input;
    const sourceNodeId = node.id;
    const placeholderId = newNodeId('vocal-split');
    const placeholder = attachCallbacks(
      buildVocalSplitPlaceholderNode({
        nodeId: placeholderId,
        scene: payload.scene,
        outputFormat: payload.output_format,
        sourceAssetId: payload.source_asset_id,
        source: node,
      }) as Node,
    );
    const current = mediaNodesRef.current;
    const next = current.some((item) => item.id === placeholderId) ? current : [...current, placeholder];
    mediaNodesRef.current = next;
    setMediaNodes(next);
    addCanvasEdge(sourceNodeId, placeholderId, undefined, { origin: VOCAL_SPLIT_EDGE_ORIGIN });
    const runtime = generationRuntimeRef.current;
    const placeholderView = mediaNodesRef.current.find((item) => item.id === placeholderId);
    if (!runtime || !placeholderView) throw new Error('生成任务运行时未就绪');
    const dispatched = runtime.submit(
      vocalSplitTask,
      {
        payload: { source_asset_id: payload.source_asset_id, scene: payload.scene, output_format: payload.output_format },
        target: {
          targetNodeId: placeholderId,
          seedTarget: seedTargetOfNode(placeholderView as unknown as RuntimeNodeView),
          seedSources: seedSourcesOfNode(placeholderId, generationRuntimeHostRef.current!),
          expectedBindingRevision: runtime.bindingRevisionOf(placeholderId),
        },
      },
      {
        onCreateFailure: (e: unknown) => {
          patchMediaNode(placeholderId, {
            genStatus: 'failed',
            errorText: isApiError(e) ? e.message : '人声背景分离任务创建失败，请重试',
          });
          return true;
        },
      },
    );
    if (!dispatched) throw new Error('人声背景分离任务提交被拒绝（无项目或在途防重入），请重试');
  };
  toolHostsRef.current.vocalSplit = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    runTask: runVocalSplitTask,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  /* ===== 场景切分发送链路（IKH8BR，镜像去字幕/HD 家族）：先退会话 → 本地建任务占位卡
     （target_node_id 取该卡）→ POST video-scene-splits → job_id 回写占位卡 → 轮询终态 ===== */

  /** 场景切分任务发送核心（IKJJR5 迁入统一任务运行时）：保留 IKH8BO 顺序——先退会话，
   *  再本地预建任务占位卡（target_node_id = 该卡节点 id，受理前不伪造恢复标记）、拉来源边
   *  （origin=scene-split，参考推导跳过），随后 runtime.submit 接管：canvas_binding 组装
   *  （client_token = submission_id）、受理台账、轮询、终态收敛与多结果扇出（规范
   *  segment:<n> node_id + 网格排列 + 一笔原子保存 replaceTarget/apply）均在运行时。
   *  创建失败（门槛拒/网络）：占位卡转失败态（卡上重试按 lastInput 原参数原粒度重发，
   *  归 runtime.retry）；不静默删卡。免费口径不变：无积分预估、不走余额拦截门。 */
  const runSceneSplitTask = async (input: SceneSplitSubmission): Promise<void> => {
    const { source: node, payload } = input;
    const sourceNodeId = node.id;
    sceneSplitSendingRef.current = true;
    const placeholderId = payload.target_node_id;
    const placeholder = attachCallbacks(
      buildSceneSplitPlaceholderNode({
        nodeId: placeholderId,
        granularity: payload.granularity,
        sourceAssetId: payload.source_asset_id,
        source: node,
      }) as Node,
    );
    // 先同步写 ref 再 setState：后续连线端点与运行时宿主读卡都要求节点已在
    const current = mediaNodesRef.current;
    const next = current.some((item) => item.id === placeholderId) ? current : [...current, placeholder];
    mediaNodesRef.current = next;
    setMediaNodes(next);
    addCanvasEdge(sourceNodeId, placeholderId, undefined, { origin: SCENE_SPLIT_EDGE_ORIGIN });
    try {
      const runtime = generationRuntimeRef.current;
      const placeholderView = mediaNodesRef.current.find((item) => item.id === placeholderId);
      if (!runtime || !placeholderView) throw new Error('生成任务运行时未就绪');
      const dispatched = runtime.submit(
        sceneSplitTask,
        {
          payload: { source_asset_id: payload.source_asset_id, target_node_id: placeholderId, granularity: payload.granularity },
          target: {
            targetNodeId: placeholderId,
            seedTarget: seedTargetOfNode(placeholderView as unknown as RuntimeNodeView),
            seedSources: seedSourcesOfNode(placeholderId, generationRuntimeHostRef.current!),
            expectedBindingRevision: runtime.bindingRevisionOf(placeholderId),
          },
        },
        {
          onCreateFailure: (e: unknown) => {
            patchMediaNode(placeholderId, {
              genStatus: 'failed',
              errorText: isApiError(e) ? e.message : '场景切分任务创建失败，请重试',
            });
            return true; // 失败收敛归占位卡（可重试），不落通用失败卡
          },
        },
      );
      if (!dispatched) throw new Error('场景切分任务提交被拒绝（无项目或在途防重入），请重试');
    } finally {
      sceneSplitSendingRef.current = false;
    }
  };
  toolHostsRef.current.sceneSplit = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    newTargetId: () => newNodeId('scene-split'),
    isSending: () => sceneSplitSendingRef.current,
    runTask: runSceneSplitTask,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };




  toolHostsRef.current.audioMix = {
    getProjectId: () => currentId,
    getNode: (id) => mediaNodesRef.current.find((node) => node.id === id),
    isInFlight: () => audioMixInFlightRef.current,
    setInFlight: (value) => { audioMixInFlightRef.current = value; },
    canApply: (projectId) => activeProjectRef.current === projectId,
    linkAssets: async (input) => {
      await linkAudioMixAssetsMutation.mutateAsync({ projectId: input.projectId, assetIds: input.libraryAssetIds });
    },
    // IKJJR4：提交交生成任务运行时（mixMuxTasks 定义）。占位卡预建（节点 id 预分配 =
    // canvas_binding.target_node_id，jobId 受理后由运行时回填）+ 来源线先行，失败未受理
    // 即撤回；受理回执、幂等键（submission_id）、轮询与保存确认归运行时。
    createTask: async ({ projectId, payload, source }) => {
      const runtime = generationRuntimeRef.current;
      if (!runtime) throw new Error('生成任务运行时未就绪，请刷新后重试');
      // IKJPM4：提交时加载身份——迟到收尾撤回占位前的归属核对要素之一
      const submitEpoch = docLoadEpochRef.current;
      // 未受理窗口内同载荷重发沿用同一占位卡身份：运行时按（节点 × 载荷签名）复用
      // submission_id，回执丢失的原样重发不重复建任务；受理或改参即换新卡新意图。
      const payloadText = JSON.stringify(payload);
      const previousCard = audioMixSubmitCardRef.current;
      const nodeId = previousCard && previousCard.projectId === projectId
        && previousCard.payload === payloadText && !previousCard.accepted
        ? previousCard.nodeId
        : newNodeId('audio-mix');
      audioMixSubmitCardRef.current = { projectId, payload: payloadText, nodeId, accepted: false };
      const occupied = [
        ...mediaNodesRef.current,
        ...textNodesRef.current,
        ...productNodesRef.current,
        ...assetNodesRef.current,
      ];
      const position = findAudioMixPosition(source, occupied);
      const placeholder = attachCallbacks(buildAudioMixPlaceholderNode(nodeId, payload.output_format, position));
      const current = mediaNodesRef.current;
      mediaNodesRef.current = current.some((node) => node.id === nodeId) ? current : [...current, placeholder];
      setMediaNodes(mediaNodesRef.current);
      const liveNodeIds = new Set(current.map((node) => node.id));
      for (const input of payload.inputs) {
        if (input.node_id && liveNodeIds.has(input.node_id)) {
          addCanvasEdge(input.node_id, nodeId, undefined, { origin: AUDIO_MIX_EDGE_ORIGIN });
        }
      }
      const rollbackPlaceholder = () => {
        // IKJPM4（F1）：撤回前核对占位仍属本次未受理提交——发起项目未切换、加载身份未更替
        // （同项目文档重载/切换后同 id 卡属新加载资源）、卡仍在场且仍是未受理占位形态
        // （受理/恢复会回填 jobId）、公开运行时尚无执行接管（恢复接续/新提交）。核对失败
        // 只结算旧等待与锁：当前恢复卡、用户编辑与来源连线全部保留，不复活删除目标。
        // 撤回时连线只删本次提交经 AUDIO_MIX_EDGE_ORIGIN 建的来源边，不动恢复/水合文档里
        // 的可靠来源关系（含用户拖线）。
        if (activeProjectRef.current !== projectId) return;
        if (docLoadEpochRef.current !== submitEpoch) return;
        const currentNode = mediaNodesRef.current.find((node) => node.id === nodeId);
        if (!currentNode || currentNode.data?.jobId != null) return;
        if (generationRuntimeRef.current?.statusOf(nodeId) != null) return;
        const keepEdge = (edge: Edge) => !(edge.target === nodeId && edge.data?.origin === AUDIO_MIX_EDGE_ORIGIN);
        mediaNodesRef.current = mediaNodesRef.current.filter((node) => node.id !== nodeId);
        edgesRef.current = edgesRef.current.filter(keepEdge);
        setMediaNodes((prev) => prev.filter((node) => node.id !== nodeId));
        setEdges((prev) => prev.filter(keepEdge));
      };
      return await new Promise<{ job_id: string }>((resolve, reject) => {
        const unwatch = watchMixSubmit(nodeId, {
          accepted: (jobId) => {
            const entry = audioMixSubmitCardRef.current;
            if (entry?.nodeId === nodeId) audioMixSubmitCardRef.current = { ...entry, accepted: true };
            unwatch();
            resolve({ job_id: jobId });
          },
          failed: (error) => { unwatch(); reject(error); },
        });
        const issued = runtime.submit(
          audioMixTask,
          {
            payload,
            target: {
              targetNodeId: nodeId,
              seedTarget: {
                role: 'result-placeholder',
                x: position.x,
                y: position.y,
                width: 480,
                height: 284,
                name: `混合结果.${payload.output_format}`,
              },
              seedSources: seedSourcesOfNode(nodeId, generationRuntimeHostRef.current!),
              expectedBindingRevision: runtime.bindingRevisionOf(nodeId),
            },
          },
          {
            // 未受理：撤回刚建的占位卡与来源线，错误提示归会话 onError（留在面板重发）
            onCreateFailure: () => { rollbackPlaceholder(); return true; },
            // IKJP8B：提交不会受理到底——收尾旧等待、撤回占位并释放会话锁
            onStale: () => { unwatch(); rollbackPlaceholder(); reject(staleMixSubmitError()); },
          },
        );
        if (!issued) {
          unwatch();
          rollbackPlaceholder();
          reject(new Error('音频混合任务未受理，请重试'));
        }
      });
    },
    handoff: async (_input, _task, context) => {
      // 建卡/连线已在 createTask 完成，受理/轮询/落盘确认归运行时；会话仍按原时机退出
      //（首保存反馈跟随会话时效的旧骨架已由恢复扫描保障替代）。
      context.exitForSubmission();
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };

  /** 场景切分发送（单条发送钮）：源素材身份 + 当前所选粒度 → 先退会话再建占位卡发任务。
   *  请求发出即返回（飞行期 submitting 防重复提交）；创建往返与轮询收敛由
   *  runSceneSplitTask 承担。 */

  /* ===== 智能抠像发送链路（IKHK9N，先建占位卡再受理；IKJJR3 受理与后续生命周期归运行时） ===== */

  /** 抠像的预建卡保留宿主实现；受理/轮询/归属/保存确认交运行时（client_token = submission_id，
   *  B.3「工具原 client_token」口径，由家族定义在创建请求内携带）。 */
  const runSmartMattingTask = async (input: SmartMattingSubmission): Promise<void> => {
    smartMattingSendingRef.current = true;
    const { source: node, payload: lastInput } = input;
    const sourceNodeId = node.id;
    const placeholderId = lastInput.target_node_id;
    try {
      const placeholder = attachCallbacks(
        buildSmartMattingPlaceholderNode({
          nodeId: placeholderId,
          mode: lastInput.mode,
          sourceAssetId: lastInput.source_asset_id,
          lastInput,
          source: node,
        }) as Node,
      );
      // 先同步写 ref 再 setState：后续连线端点与轮询 guard 都要求节点已在（无 pendingNodeIdsRef
      // 登记：占位卡身份以 smartMatting 身份标记为准，失败由卡上重试收敛）
      const current = mediaNodesRef.current;
      const next = current.some((item) => item.id === placeholderId) ? current : [...current, placeholder];
      mediaNodesRef.current = next;
      setMediaNodes(next);
      addCanvasEdge(sourceNodeId, placeholderId, undefined, { origin: SMART_MATTING_EDGE_ORIGIN });
      // IKJJR3：运行时受理失败落失败卡（异步），同步 false 仅发生在无项目/防重入窗口
      if (!submitVideoToolTask({ kind: 'smartMatting', input: lastInput }, placeholderId)) {
        patchMediaNode(placeholderId, { genStatus: 'failed', errorText: '智能抠像任务未发出，请重试' });
      }
    } finally {
      smartMattingSendingRef.current = false;
    }
  };
  toolHostsRef.current.smartMatting = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    newTargetId: () => newNodeId('smart-matting'),
    isSending: () => smartMattingSendingRef.current,
    runTask: runSmartMattingTask,
    warn: (message) => showToast('warn', message),
    error: (message) => globalToast.error(message),
  };

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
   *  开发模式走 Vite /__tos-fetch；测试/生产直连 TOS 时绕开 <img> 无 CORS 缓存以免报跨域 */
  const fetchAssetBlob = async (src: string): Promise<Blob | null> => {
    try {
      const res = await fetchRemoteMedia(src);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  };

  /** 下载单个媒体节点：成功返回 true，无素材则 false。
   *  文件名以当前卡片名称为基础，扩展名经 resolveDownloadMime 纠正 M4A 错标后再取（IKFA8Y） */
  const downloadMediaById = async (id: string, notifyMissing: boolean): Promise<boolean> => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (node?.data?.assetMissing) {
      if (notifyMissing) showToast('warn', '素材已被删除');
      return false;
    }
    const src = node?.data?.src as string | undefined;
    if (!src) return false;
    const name = (node?.data?.fileName as string) || id;
    const nodeMime = node?.data?.mime as string | undefined;
    const mediaType = node?.data?.mediaType as string | undefined;
    const blob = await fetchAssetBlob(src);
    if (blob) {
      const sniffed = await sniffMediaMime(blob, mediaType);
      const type = resolveDownloadMime({
        sniffed,
        blobType: blob.type,
        nodeMime,
        src,
        fileName: name,
        mediaType,
      });
      triggerFileDownload(URL.createObjectURL(blob), downloadFileNameOf(name, type, src), true);
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
          const cardName = (media.data?.fileName as string) || id;
          const mediaType = media.data?.mediaType as string | undefined;
          const sniffed = await sniffMediaMime(blob, mediaType);
          const mime = resolveDownloadMime({
            sniffed,
            blobType: blob.type,
            nodeMime: media.data?.mime as string | undefined,
            src,
            fileName: cardName,
            mediaType,
          });
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

  toolDepsRef.current = buildToolSessionDeps();
  actionsRef.current.download = handleNodeDownload;
  actionsRef.current.showDetails = handleNodeShowDetails;

  /** 应用事实来自已持久化的文本节点来源，删除与刷新后自然同步。 */
  const appliedCardIds = useMemo(() => new Set(textNodes.flatMap(node => {
    const source = node.data.promptSource as GenerationCardBlock['source'];
    return source ? [`${source.revisionId}#${source.shotNo}`] : [];
  })), [textNodes]);

  /** IKIN23：整文档待复核（清空保存 412 / 空覆盖 422 后置位）统一拦截保存/切换入口——
   *  弹对应刷新复核提示并返回 true；当前项目成功重新水合后解除，confirmEmpty 按新基线重新授予。
   *  （原 IKILTB blockedByPendingEmptyClear 仅拦「仍为空」的清空待复核，IKIN23 起覆盖一切整文档保存。） */
  const blockedByPendingCanvasReview = (): boolean => {
    if (emptyClearConflictRef.current) {
      showToast('warn', EMPTY_CLEAR_CONFLICT_TOAST);
      return true;
    }
    if (emptyOverwriteRejectedRef.current) {
      showToast('warn', EMPTY_OVERWRITE_REJECTED_TOAST);
      return true;
    }
    if (recoverySaveConflictRef.current) {
      showToast('warn', '画布保存冲突，当前内容已保留，请刷新后复核');
      return true;
    }
    return false;
  };

  /** IKILTB：保存失败 toast 三分叉统一（项目切换强制保存与手动重试保存两个 catch 原为逐字
   *  重复的级联）：412 已登记清空待复核闸门 → 刷新复核；422 空覆盖被拒 → 刷新复核（重试注定再拒）；
   *  否则笼统重试。 */
  const showCanvasSaveFailureToast = (e: unknown) => {
    if (emptyClearConflictRef.current) showToast('warn', EMPTY_CLEAR_CONFLICT_TOAST);
    else if (isApiError(e) && e.status === 422) showToast('warn', EMPTY_OVERWRITE_REJECTED_TOAST);
    else showToast('error', '保存失败，请重试');
  };

  /** IKIMPQ：空文档保存的 confirmEmpty 授予判定（自动保存与 flush 两条路径原为逐字重复的口径，
   *  收拢于此）：仅当待发文档为空且本会话成功确认过非空画布（水合基线非空，或本会话成功保存
   *  非空文档并取得新版本——IKIMQK 空基线新增后再删光的合法例外，依据详见 confirmedNonEmptyRef
   *  头注释）时授予；412 后据此区分「清空待复核」与普通版本冲突。 */
  const shouldConfirmEmptyClear = (nodes: Node[]): boolean =>
    nodes.length === 0 && confirmedNonEmptyRef.current;

  /** IKIMPQ：成功保存非空文档并取得新版本——登记确认清空资格（空保存的 If-Match 即用该版本，
   *  缺版本时服务端按 428 拒绝）；口径收拢，自动保存与 flush 共用。 */
  const registerConfirmedNonEmpty = (nodes: Node[]): void => {
    if (nodes.length > 0) confirmedNonEmptyRef.current = true;
  };

  /** IKIMQK / IKJLTY（PR981-REVIEW2-Standards 3）：保存成功落账三件套（防抖自动保存 .then 与
   *  flush 循环体原为两处平行复制）——以实际落盘载荷登记确认清空资格（确认笔落盘的是原载荷
   *  而非当前编辑）、对齐实际落盘内容签名（与 lastSavedRef 的差量驱动下一轮防抖/flush 以确认
   *  后版本补存新内容），并仅当本次新编辑真正落盘（sentSignature 与当前签名一致，非确认笔）
   *  时核销未保存新增节点（核销口径由调用方给出：防抖删本次快照成员保留飞行中新增，flush 全清）。
   *  返回是否新内容笔（flush 据此决定收束或继续补存）。 */
  const settleSavedCanvas = (
    plan: ReturnType<typeof planRecoverySave>,
    signature: string,
    settlePendingNodes: () => void,
  ): boolean => {
    registerConfirmedNonEmpty(plan.payload.nodes);
    lastSavedRef.current = plan.sentSignature;
    if (plan.sentSignature === signature) {
      settlePendingNodes();
      return true;
    }
    return false;
  };

  /** 等待在途保存完成并立即落盘当前画布编辑（IKDLQE 应用预览的保存串行化模式；IKDLQF 目标生图提交复用）。
   *  返回 false 表示等待期间项目已切换，调用方应中止后续动作。
   *  IKFS5W：自身也登记进 savePromiseRef，与 800ms 防抖自动保存互斥——同一时刻只有一个 PUT、
   *  不会两次请求共用同一个 If-Match（调用方持 applyingRef 仍是推荐做法，但不再是正确性前提）。
   *  IKJLTY（R6）：存在结果未明确的保留命令时，本次 flush 先原样重放确认原命令（确认笔，
   *  版本随之对齐），随即以确认后版本保存当前内容（新内容笔）——循环至多两笔，确认笔落定
   *  后保留命令已释放，第二轮必走新命令或发现签名已对齐而收束。 */
  const flushCanvasSave = (projectId: string): Promise<boolean> => {
    const runFlush = async (): Promise<boolean> => {
      if (activeProjectRef.current !== projectId) return false;
      // IKIIWN：未成功水合（加载失败/切换中，ref 被置 null）不保存——返回 false 语义同项目切换，调用方中止后续动作
      if (hydratedProjectRef.current === null) return false;
      if (blockInvalidDraft(textNodesRef.current.map(n => n.id))) return false;
      for (;;) {
        const contentNodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
        // 组伪节点随 nodes 持久化（IKD0JT A3）：与防抖自动保存同口径，否则切换项目/应用预览时组关系丢失
        const nodes = [...contentNodes, ...groupsRef.current.map((g) => groupToNode(g))];
        // IKIN23：整文档待复核期间一律静默返回 false 不发请求——无论待发节点数；排队中的
        // flush 在实际执行时同样走到此复查（flush 多为后台链路 .catch(()=>{})，用户可见提示
        // 由重试保存/项目切换入口给出）
        if (emptyClearConflictRef.current || emptyOverwriteRejectedRef.current || recoverySaveConflictRef.current) return false;
        const signature = JSON.stringify(viewport) + serializeNodes(nodes) + serializeEdges(edgesRef.current);
        // IKJLTY：签名已对齐但仍有未决命令（确认笔成功、新内容笔丢响应后用户撤回编辑等窗口）
        //  也不得直接报 saved——先把未决命令重放落定
        if (signature === lastSavedRef.current && retainedRecoverySaveRef.current?.projectId !== projectId) break;
        // IKILUE：空文档保存的显式确认标记（授予口径见 shouldConfirmEmptyClear），
        // 412 后据此登记清空待复核闸门
        // IKILTB：提到 try 外——catch 登记 412 闸门时同口径复用，不再重写同义表达式（与自动保存路径一致）
        const confirmEmpty = shouldConfirmEmptyClear(nodes);
        // IKJJR1：恢复保存（有显式待确认状态时）走新协议原子保存；回执回填台账。
        // IKJKU8：回执丢失后的完全相同重试复用保留命令原载荷与 If-Match 重发（幂等回放）。
        const plan = planRecoverySave(
          projectId, signature, { viewport, nodes, edges: edgesRef.current, confirmEmpty },
        );
        const { recoveryFields, payload: recoveryPayload } = plan;
        try {
          const saved = recoveryFields
            ? await putCanvasDocWithRecovery(
              projectId,
              recoveryPayload,
              plan.ifMatch,
              { recoveryProtocolVersion: 1, commandId: recoveryFields.commandId, recoveryChanges: recoveryFields.recoveryChanges },
            )
            : await saveCanvasDoc(projectId, { viewport, nodes, edges: edgesRef.current, confirmEmpty }, versionRef.current);
          if (recoveryFields) {
            generationRuntimeRef.current?.onSaveReceipt((saved as CanvasRecoverySaveData).recoveryReceipt);
            settleRetainedRecoverySave(projectId, recoveryFields.commandId);
          }
          if (activeProjectRef.current !== projectId) {
            // 旧项目的保存结束后重启当前项目的自动保存防抖。
            setSaveEpoch((value) => value + 1);
            return false;
          }
          versionRef.current = saved.version;
          // IKIMQK / IKJLTY：成功落账三件套见 settleSavedCanvas；仅确认笔（落盘的是原载荷）
          //  才继续循环补存当前内容——正常笔成功即收束，不把 flush 期间并发的新状态变化提前
          //  吃进本次 flush（留给下轮防抖/flush，既有口径）
          if (!settleSavedCanvas(plan, signature, () => { pendingNodeIdsRef.current.clear(); })) continue;
        } catch (error) {
          if (activeProjectRef.current !== projectId) {
            setSaveEpoch((value) => value + 1);
            throw error;
          }
          // IKJKU8：结果落定——明确拒绝（4xx）释放保留命令，响应丢失保留供重放
          if (recoveryFields) settleRetainedRecoverySave(projectId, recoveryFields.commandId, error);
          // IKJJR1（验收 8）：新协议保存冲突保留本地内容，不采纳版本重发；闸门至重新水合。
          //  项冲突（409 recovery_item_conflict）例外：resolve 定向对账后由下次保存重推导。
          const flushRecoveryReason = readRecoveryErrorReason(error);
          if (recoveryFields && flushRecoveryReason === 'recovery_item_conflict') {
            void generationRuntimeRef.current?.reconcileConflictItems(projectId);
            setSaveBlocked(true);
            setSaveStatus('error');
            throw error;
          }
          if (recoveryFields && flushRecoveryReason != null) {
            recoverySaveConflictRef.current = true;
            setSaveBlocked(true);
            setSaveStatus('error');
            throw error;
          }
          if (!recoveryFields && readRecoveryErrorReason(error) === 'recovery_protocol_required') {
            void generationRuntimeRef.current?.recover(projectId);
          }
          const aligned = adoptCanvasConflictVersion(error);
          // IKILUE：带 confirmEmpty 的清空保存 412——登记闸门；flush 链路不 toast（后台调用方多），
          // 用户可见提示由入口（重试保存/项目切换）给出
          if (aligned && confirmEmpty) {
            emptyClearConflictRef.current = true;
          }
          // IKILTB：空覆盖被 422 拒——登记阻断标记，saveBlocked 期间项目切换/返回首页提示刷新复核
          if (isApiError(error) && error.status === 422) {
            emptyOverwriteRejectedRef.current = true;
          }
          setSaveBlocked(true);
          setSaveStatus('error');
          throw error;
        }
        // 正常笔（含同签名重放笔）成功：当前内容已落盘，收束；确认笔已在上面 continue
        break;
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

  /* ═══ IKJJR1 生成任务运行时宿主与实例 ═══
   * 每渲染重建宿主实现（闭包读最新画布状态/保存函数），运行时本体只建一次：
   * 内部所有异步经归属检查（项目/加载身份/承接轮次/删除登记）后才会经宿主写画布。 */
  generationRuntimeHostRef.current = ({
    getProjectId: () => activeProjectRef.current,
    getLoadEpoch: () => docLoadEpochRef.current,
    getMediaNodes: () => mediaNodesRef.current as unknown as RuntimeNodeView[],
    findNode: (nodeId) => {
      const node = mediaNodesRef.current.find((n) => n.id === nodeId);
      return node ? (node as unknown as RuntimeNodeView) : null;
    },
    patchNode: patchMediaNode,
    insertMediaNode: (node) => {
      const built = attachCallbacks({
        id: node.id,
        type: 'mediaNode',
        position: node.position,
        data: {
          ...node.data,
          onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
          onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
          onRetryJob: (id: string) => actionsRef.current.retryJob(id),
          onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
        },
      } as Node);
      mediaNodesRef.current = [...mediaNodesRef.current, built];
      setMediaNodes(mediaNodesRef.current);
    },
    removeMediaNode: (nodeId) => {
      // 同步写 ref + setState（页面惯例）：紧随其后的 insertMediaNode/拉来源边读 ref，
      // 函数式 setState 异步生效会把刚移除的占位卡带回（IKJJR5 扇出交错修复）
      const next = mediaNodesRef.current.filter((n) => n.id !== nodeId);
      mediaNodesRef.current = next;
      setMediaNodes(next);
      const nextEdges = edgesRef.current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
    },
    getEdges: () => edgesRef.current.map((edge) => ({ source: edge.source, target: edge.target })),
    addEdge: (source, target, role, marker) => { addCanvasEdge(source, target, role as VideoRefRole, marker); },
    getActiveJob: (nodeId) => activeJobByNodeRef.current.get(nodeId),
    setActiveJob: (nodeId, token) => { activeJobByNodeRef.current.set(nodeId, token); },
    clearActiveJob: (nodeId) => { activeJobByNodeRef.current.delete(nodeId); },
    isLocallyRemoved: (nodeId) => locallyRemovedGenerationNodesRef.current.has(nodeId),
    markLocallyRemoved: (nodeId) => { locallyRemovedGenerationNodesRef.current.add(nodeId); },
    registerPendingDelete: (nodeId) => { pendingDeleteJobNodesRef.current.add(nodeId); },
    isPendingDelete: (nodeId) => pendingDeleteJobNodesRef.current.has(nodeId),
    applyTerminal: (nodeId, jobId, detail) => applyJobTerminal(nodeId, jobId, detail),
    settleCancelled: settleCancelledNode,
    saveCanvas: (projectId) => flushCanvasSave(projectId),
    // IKJKU9：恢复扫描取页经 Query 生命周期（资源旁 generationRecoveryPageOptions，
    // 按项目+游标 key 隔离、staleTime 0 每轮重扫、retry false 错误单一呈现），
    // 由运行时扫描编排对账推进游标；错误经运行时 console.warn 等下轮水合重试。
    fetchRecoveryPage: (projectId, options) => queryClient.fetchQuery(generationRecoveryPageOptions(projectId, options)),
    toast: (kind, message) => showToast(kind, message),
    openRechargeForCreditsError,
    addAuthResume: (fn) => { useAuthPromptStore.getState().addResume(fn); },
    rememberAsset: rememberGeneratedAsset,
  } satisfies GenerationRuntimeHost);
  if (generationRuntimeRef.current == null) {
    const hostRef = generationRuntimeHostRef;
    // 转发宿主：每次调用读最新实现（宿主闭包每渲染重建，运行时只持转发层）
    const forwardHost = new Proxy({} as GenerationRuntimeHost, {
      get(_target, prop: string) {
        const impl = hostRef.current as unknown as Record<string, unknown>;
        const value = impl[prop];
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(impl) : value;
      },
    });
    const runtime = createGenerationRuntime(forwardHost);
    runtime.register(normalGenerationTask);
    runtime.register(storyboardTask); // IKJJR6：成片/重生样片提交差异定义（卡片生命周期归 normalGeneration）
    runtime.register(imageToolsTask);
    // IKJJR4：混合（audio_mix）/合成（audio_video_mux）家族接入——各自类型定义承载
    // 专属创建/重试协议与恢复落卡规划；retry/cancel/remove/水合经 claims 分派到此处。
    runtime.register(audioMixTask);
    runtime.register(audioVideoMuxTask);
    runtime.register(sceneSplitTask); // IKJJR5：多结果家族（场景切分/人声分离）
    runtime.register(vocalSplitTask);
    runtime.register(videoToolsTask); // IKJJR3：视频处理七类家族（去字幕/分离/截取/调速/抠像/HD/插帧）
    generationRuntimeRef.current = runtime;
  }
  /* IKJJR3：调速「返回发起项目补建卡立即保存」effect 已随跨项目接续机制删除——补卡与
   * 落盘现由统一恢复扫描在恢复页对账时完成（restore-target 分支自带补卡落盘）。 */

  const handleRetryCanvasSave = async () => {
    if (!currentId || applyingRef.current) return;
    // IKIN23：整文档待复核期间不发请求，引导刷新复核（当前项目成功重新水合后才恢复保存）
    if (blockedByPendingCanvasReview()) return;
    applyingRef.current = true;
    setSaveStatus('saving');
    try {
      if (!(await flushCanvasSave(currentId))) setSaveStatus('error');
      else setSaveEpoch(value => value + 1);
    } catch (e) {
      setSaveStatus('error');
      // IKILTB：412 闸门/422/笼统三分叉提示统一走 helper（口径见 showCanvasSaveFailureToast）
      showCanvasSaveFailureToast(e);
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
      const missingNodeIds = new Set(
        mediaNodesRef.current
          .filter((node) => (node.data as { assetMissing?: boolean }).assetMissing === true)
          .map((node) => node.id),
      );
      if (!(await flushCanvasSave(projectId))) return;
      const result = await applyMutation.mutateAsync({ projectId, source: payload.source, position: spawnPosition() });
      if (activeProjectRef.current !== projectId) return;
      const savedNodes = JSON.parse(result.canvas.nodes ?? '[]') as Node[];
      const savedEdges = JSON.parse(result.canvas.edges ?? '[]') as Edge[];
      const savedViewport = JSON.parse(result.canvas.viewport ?? 'null') as Viewport | null;
      const textNodeId = result.node.id;
      const extraAssetIds = (payload.assetRefItems ?? []).map((item) => item.assetId);
      const assetIds = appliedPlanAssetIds(result.node as Node, extraAssetIds);
      const rebuilt = replaceMissingPlanMediaNodes({
        textNodeId,
        assetIds,
        nodes: savedNodes.map((node) => (
          node.id === result.node.id
            ? { ...node, data: { ...(node.data ?? {}), ...((result.node as Node).data ?? {}) } }
            : node
        )),
        missingNodeIds,
        createNodeId: () => newNodeId('media'),
      });
      const keptEdges = savedEdges.filter((edge) => !rebuilt.removedNodeIds.has(edge.source) && !rebuilt.removedNodeIds.has(edge.target));
      const oriented = dropReversedTextIndexEdges(textNodeId, keptEdges);
      const indexEdges = textIndexEdgesForAppliedPlan(textNodeId, assetIds, rebuilt.nodes, oriented);
      let nextNodes = rebuilt.nodes;
      let nextEdges = [...oriented, ...indexEdges];
      let nextVersion = result.canvas.version;
      if (indexEdges.length > 0 || oriented.length !== savedEdges.length || rebuilt.replaced) {
        try {
          const persisted = await saveCanvasDoc(
            projectId,
            { viewport: savedViewport ?? viewport, nodes: nextNodes, edges: nextEdges },
            result.canvas.version,
          );
          nextVersion = persisted.version;
          nextNodes = JSON.parse(persisted.nodes ?? '[]') as Node[];
          nextEdges = JSON.parse(persisted.edges ?? '[]') as Edge[];
        } catch {
          // 连线已在本地补上；落盘失败留给后续编辑触发保存
        }
      }
      // IKFPOT：应用方案卡后服务端已把来源素材关联进项目，但前端快照资产字典停留在打开画布时的旧状态，
      // 水合 resolveNodeAssets 查不到会误标「素材已被删除」。这里从应用返回的节点里提取素材资产信息
      // 增量并入字典（与 acceptDoc 同一批处理，水合 effect 重跑时字典已是最新，无中间闪烁）。
      const newAssets: SnapshotAsset[] = [];
      for (const n of nextNodes) {
        if (n.type !== 'mediaNode') continue;
        const d = (n.data ?? {}) as Record<string, unknown>;
        const aid = d.assetId ?? d.asset_id ?? d.assetID;
        if (aid == null || aid === '') continue;
        const src = typeof d.src === 'string' ? d.src : '';
        if (!src || src.startsWith('blob:')) continue;
        const mediaType = d.mediaType;
        if (mediaType !== 'image' && mediaType !== 'video' && mediaType !== 'audio') continue;
        newAssets.push({
          asset_id: Number(aid),
          type: mediaType,
          access_url: src,
          width: typeof d.width === 'number' ? d.width : null,
          height: typeof d.height === 'number' ? d.height : null,
          material_id: null,
          material_status: null,
        });
      }
      upsertAssets(newAssets);
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
        onHoverChange: handleAssetHoverChange,
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
              onDownload: (id: string) => actionsRef.current.download(id),
              ...dockToolCallbacks,
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
              onHoverChange: handleAssetHoverChange,
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
        // IKIQGR：正文全文参与 @ 检索——无标题文本节点显示为「文本节点」也能按正文关键词命中
        searchText: extractTextNodeText(data),
      });
    }
    return items;
  }, [mediaNodes, textNodes]);

  /** 图片面板 @ 选中：图片写入参考，文本建连线成为附件 */
  const handleImageAtMention = (item: AtMentionItem) => {
    generationDock.referencePicked('image');
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

  /** 音频面板 @ 选中：图片或音频写入参考（不可混用），文本连入当前目标。 */
  const handleAudioAtMention = (item: AtMentionItem) => {
    if (item.kind === 'text') {
      if (audioDraftId) connectPair(item.id, audioDraftId);
      else showToast('warn', '文本参考需要绑定生成节点');
      return;
    }
    if ((item.kind !== 'audio' && item.kind !== 'image') || !item.thumbUrl) {
      showToast('warn', PANEL_REF_MEDIA_TYPES.audio.canvasRefError);
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
        kind: item.kind,
        mediaType: item.kind,
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
        name: file.name,
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
      const res = await fetchRemoteMedia(url);
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

  imageDockHostRef.current = {
    getNodes: () => [...mediaNodesRef.current, ...textNodesRef.current],
    getEdges: () => edgesRef.current,
    attachmentsOf: textAttachmentsOf,
    canOpen: canOpenEditor,
    beginEdit: nodeId => { if (nodeId) editingTargetRef.current = nodeId; exitEditSessionForGenPanel(); },
    endPicking: endImagePickSession,
    clearPickResult: () => setImagePickResult(null),
    patchNode: patchMediaNode,
    getAvailability: () => ({ submittingNodeId, saveFailed: saveBlocked || saveStatus === 'error' }),
    getProjectId: () => currentId,
    isApplying: () => applyingRef.current,
    isSaveBlocked: () => saveBlocked,
    setApplying: value => { applyingRef.current = value; },
    setSubmittingNode: setSubmittingNodeId,
    promptMaxLength: modelId => promptMaxLengthOfModel('image', modelId),
    collectInputAssetIds: collectImageInputAssetIds,
    save: flushCanvasSave,
    isProjectCurrent: projectId => activeProjectRef.current === projectId,
    startTask: input => startGenerationJob('image', {
      prompt: input.text, model_id: input.modelId, aspect_ratio: input.ratio, size: input.size,
    }, undefined, input.references.length ? { references: input.references } : undefined, input.targetNodeId, undefined, input.promptDoc),
    toast: showToast,
    reportError: error => console.warn('图片生成前准备失败:', error),
    render: () => (
      <ImageGenerationDockPanel
        view={generationDock.panel('image')}
        actions={{
          close: () => generationDock.close('image'),
          updateDraft: patch => generationDock.updateDraft('image', patch),
          submit: input => generationDock.submit('image', input),
        }}
        resources={{
          projectId: currentId ?? undefined,
          stripOrder: refStripOrderOf(imageDraftId),
          onStripOrderChange: imageDraftId ? keys => handleRefStripOrderChange(imageDraftId, keys) : undefined,
          onRemoveAttachment: id => {
            const targetId = imageDraftId ?? imageSeed?.targetNodeId;
            if (targetId && isGeneratingNode(targetId)) return;
            removePlanAttachment(targetId, id);
            generationDock.updateDraft('image', { attachments: { targetNodeId: targetId, removeNodeId: id } });
          },
          pendingPlanSyncs: pendingPlanSyncs(imageSeed?.targetNodeId),
          onSyncPlan: id => syncPlanToTarget(id, imageSeed?.targetNodeId),
          syncingPlan: applying,
          planReferenceError: planReferenceErrors.image,
          onRemoveMediaRef: imageDraftId ? nodeId => removeRefEdges(imageDraftId, nodeId) : undefined,
          onLocateTextSource: locateTextSource,
          onReorderMediaRefs: imageDraftId ? ids => reorderTargetEdges(imageDraftId, ids) : undefined,
          onReorderAttachments: imageSeed?.targetNodeId ? ids => handleReorderAttachments(imageSeed.targetNodeId!, ids) : undefined,
          onPickFromCanvas: () => { setPickMode('image'); setPickTarget('image'); setImagePickSession(imageDraftId); },
          onPickFromAssets: () => openAssetsPicker('imageDialog'),
          pickMode: pickMode === 'image',
          externalPick: imagePickResult,
          onExternalPickConsumed: () => setImagePickResult(null),
          onOpenCharacterLibrary: () => { setCharacterLibraryTarget('image'); setShowCharacterLibrary(true); },
          onToast: showToast,
          mentionItems: atMentionItems.filter(item => item.id !== imageDraftId),
          onMentionCanvas: handleImageAtMention,
          currentNodes: mediaNodes,
          followAnchor: imageDraftId ? followAnchor : null,
          dragHidden: isAnchoredOverlayDragHidden(imageDraftId),
        }}
      />
    ),
  };
  videoDockHostRef.current = {
    getNodes: () => [...mediaNodesRef.current, ...textNodesRef.current],
    getEdges: () => edgesRef.current,
    attachmentsOf: textAttachmentsOf,
    canOpen: canOpenEditor,
    beginEdit: id => { if (id) editingTargetRef.current = id; exitEditSessionForGenPanel(); },
    endPicking: endVideoPickSession,
    resetAssetPicking: () => { setVideoAssetPickRole('reference'); setVideoAssetPickKind('video'); },
    warnStaleRefs: id => warnStaleMediaRefs(id, 'video'),
    patchNode: patchMediaNode,
    getAvailability: () => ({ submittingNodeId, saveFailed: saveBlocked || saveStatus === 'error' }),
    getProjectId: () => currentId,
    isApplying: () => applyingRef.current,
    isSaveBlocked: () => saveBlocked,
    setApplying: value => { applyingRef.current = value; },
    setSubmittingNode: setSubmittingNodeId,
    promptMaxLength: modelId => promptMaxLengthOfModel('video', modelId),
    save: flushCanvasSave,
    refUnsupported: videoRefUnsupportedByModel,
    toast: showToast,
    reportError: error => console.warn('生成前画布落盘失败:', error),
    startTask: input => startGenerationJob('video', input.parameters, undefined,
      input.references.length ? { references: input.references } : undefined,
      input.targetNodeId,
      { mode: input.options.mode, references: [], ...(input.options.sampleMode && input.options.expectedCredits != null && input.options.quoteRevision ? { expectedCredits: input.options.expectedCredits, quoteRevision: input.options.quoteRevision } : {}) },
      input.promptDoc ?? undefined),
    render: () => (
      <VideoGenerationDockPanel
        view={generationDock.panel('video')}
        actions={{ close: closeVideoDialog, updateDraft: patch => generationDock.updateDraft('video', patch), submit: input => generationDock.submit('video', input) }}
        resources={{
          projectId: currentId ?? undefined,
          stripOrder: refStripOrderOf(videoDraftId),
          onStripOrderChange: videoDraftId ? keys => handleRefStripOrderChange(videoDraftId, keys) : undefined,
          onRemoveAttachment: id => {
            const targetId = videoDraftId ?? videoSeed?.targetNodeId;
            if (targetId && isGeneratingNode(targetId)) return;
            removePlanAttachment(targetId, id);
            generationDock.updateDraft('video', { attachments: { targetNodeId: targetId, removeNodeId: id } });
          },
          pendingPlanSyncs: pendingPlanSyncs(videoSeed?.targetNodeId),
          onSyncPlan: id => syncPlanToTarget(id, videoSeed?.targetNodeId),
          syncingPlan: applying,
          planReferenceError: planReferenceErrors.video,
          planIndices: planReferenceErrors.videoIndices,
          onLocateTextSource: locateTextSource,
          onReorderAttachments: videoSeed?.targetNodeId ? ids => handleReorderAttachments(videoSeed.targetNodeId!, ids) : undefined,
          onPickFromCanvas: (kind, role) => { endImagePickSession(); setPickMode(kind); setPickTarget('video'); setPickRefRole(role ?? null); setVideoPickSession(videoDraftId ?? null); },
          onPickFromAssets: (kind, role) => { setVideoAssetPickRole(role ?? 'reference'); setVideoAssetPickKind(kind); openAssetsPicker('videoDraft'); },
          pickMode: pickTarget === 'video' && pickMode !== 'audio' && pickMode !== 'product' && pickMode !== 'asset' ? pickMode : null,
          pickLocked: videoPickSessionActive,
          onRemoveVideoRef: videoDraftId ? id => removeRefEdges(videoDraftId, id) : removeVideoFreeRef,
          onAssignRefRoles: videoDraftId ? assignments => assignVideoRefRoles(videoDraftId, assignments) : assignVideoFreeRefRoles,
          onRemoveMaterialRef: videoDraftId ? id => removeDraftMaterialRef(videoDraftId, id) : removeVideoFreeRef,
          onReorderMediaRefs: videoDraftId ? keys => handleReorderVideoMediaRefs(videoDraftId, keys) : reorderVideoFreeRefs,
          onToast: showToast,
          mentionItems: atMentionItems.filter(item => item.id !== videoDraftId).map(item => {
            const node = mediaNodes.find(node => node.id === item.id);
            return node?.data.complianceFailed === true ? { ...item, disabled: true } : item;
          }),
          onMentionCanvas: handleVideoAtMention,
          followAnchor: videoDraftId ? followAnchor : null,
          dragHidden: isAnchoredOverlayDragHidden(videoDraftId),
        }}
      />
    ),
  };
  audioDockHostRef.current = {
    getNodes: () => [...mediaNodesRef.current, ...textNodesRef.current],
    getEdges: () => edgesRef.current,
    attachmentsOf: textAttachmentsOf,
    canOpen: canOpenEditor,
    beginEdit: id => { if (id) editingTargetRef.current = id; exitEditSessionForGenPanel(); },
    endPicking: endAudioPickSession,
    clearPickResult: () => setAudioPickResult(null),
    addReferenceEdge: (source, target) => addCanvasEdge(source, target),
    patchNode: patchMediaNode,
    getAvailability: () => ({ submittingNodeId, saveFailed: saveBlocked || saveStatus === 'error' }),
    getProjectId: () => currentId,
    isApplying: () => applyingRef.current,
    isSaveBlocked: () => saveBlocked || saveStatus === 'error',
    setApplying: value => { applyingRef.current = value; },
    setSubmittingNode: setSubmittingNodeId,
    promptMaxLength: modelId => promptMaxLengthOfModel('audio', modelId),
    fetchFile: fetchUrlAsFile,
    upload: uploadFileToAsset,
    save: flushCanvasSave,
    startTask: input => startGenerationJob('audio', { prompt: input.text, model_id: input.modelId }, undefined,
      input.refs.length ? { references: input.refs.map(ref => ({ role: 'reference' as const, type: audioRefItemMediaTypeOf(ref), asset_id: String(ref.assetId) })) } : undefined,
      input.targetNodeId, undefined, input.promptDoc),
    toast: showToast,
    reportError: error => console.warn('音频生成前准备失败:', error),
    render: () => <AudioGenerationDockPanel
      view={generationDock.panel('audio')}
      actions={{ close: closeAudioDialog, updateDraft: patch => generationDock.updateDraft('audio', patch), submit: input => generationDock.submit('audio', input), switchToMusic: () => { generationDock.open('music', { fromAudio: true }); } }}
      resources={{
        projectId: currentId ?? undefined,
        stripOrder: refStripOrderOf(audioDraftId),
        onStripOrderChange: audioDraftId ? keys => handleRefStripOrderChange(audioDraftId, keys) : undefined,
        onToast: showToast,
        canvasMedia,
        onPickFromCanvas: () => { endImagePickSession(); endVideoPickSession(); setPickMode('audio'); setPickTarget('audio'); setAudioPickSession(audioDraftId ?? null); },
        onPickFromAssets: () => {
          generationDock.referencePicked('audio');
          setPickMode(null); setPickTarget(null);
          setAudioAssetPickTarget({ nodeId: audioDraftId, seed: audioSeed?.ts });
          openAssetsPicker('audioDialog');
        },
        externalAssetPick: audioAssetPickResult,
        onAssetPickConsumed: () => setAudioAssetPickResult(null),
        externalPick: audioPickResult,
        pickMode: pickMode === 'audio',
        onLocateTextSource: locateTextSource,
        onRemoveDraftRef: audioDraftId ? nodeId => removeRefEdges(audioDraftId, nodeId) : undefined,
        onAddCanvasRef: audioDraftId ? handleAddAudioCanvasRef : undefined,
        mentionItems: atMentionItems.filter(item => item.id !== audioDraftId),
        onMentionCanvas: handleAudioAtMention,
        followAnchor: audioDraftId ? followAnchor : null,
        dragHidden: isAnchoredOverlayDragHidden(audioDraftId),
        onRemoveAttachment: id => removePlanAttachment(audioDraftId ?? undefined, id),
        onReorderAttachments: audioDraftId ? ids => handleReorderAttachments(audioDraftId, ids) : undefined,
      }}
    />,
  };
  musicDockHostRef.current = {
    beginEdit: exitEditSessionForGenPanel,
    recordSend: input => console.log('Music dialog send:', input.text, input.model, input.options, input.refs),
    render: () => <MusicGenerationDockPanel
      actions={{ close: closeMusicDialog, submit: input => generationDock.submit('music', input), switchToAudio: () => { generationDock.open('audio', {}); } }}
      resources={{ canvasMedia, mentionItems: atMentionItems, onMentionCanvas: handleMusicAtMention, externalPick: musicPickResult }}
    />,
  };
  textDockHostRef.current = {
    getNodes: () => textNodesRef.current,
    getEdges: () => edgesRef.current,
    attachmentsOf: textAttachmentsOf,
    beginEdit: exitEditSessionForGenPanel,
    patchNode: (id, data) => setTextNodes(previous => previous.map(node => node.id === id ? { ...node, data: { ...node.data, ...data } } : node)),
    render: () => <TextGenerationDockPanel
      view={generationDock.panel('text')}
      actions={{ close: closeTextGenDialog, updateDraft: patch => generationDock.updateDraft('text', patch), submit: input => generationDock.submit('text', input) }}
      resources={{ followAnchor, dragHidden: isAnchoredOverlayDragHidden(textGenDraftId) }}
    />,
  };
  /** 「输入已更新 → 更新生成」：用节点已存参数 + 画布上最新文本输入，在当前卡原位重跑。
   *  ratioOverride（IKJ79D）：一键修复传入 'adaptive' 覆盖卡上比例——仅换比例重交，
   *  其余参数（提示词/分辨率/时长/带音频/参考）仍取卡上冻结值。 */
  const handleUpdateGenerate = async (nodeId: string, opts?: { ratioOverride?: string }) => {
    if (applyingRef.current) return;
    if (saveBlocked || saveStatus === 'error') {
      showToast('warn', '保存失败，请重试');
      return;
    }
    const node = mediaNodesRef.current.find((item) => item.id === nodeId);
    if (!node || node.type !== 'mediaNode') return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (data.genStatus === 'generating') {
      showToast('warn', '正在生成中');
      return;
    }
    const mediaType = data.mediaType;
    if (mediaType !== 'image' && mediaType !== 'video' && mediaType !== 'audio') return;
    const modelId = typeof data.draftModelId === 'string' ? data.draftModelId : '';
    if (!modelId) {
      showToast('warn', '缺少模型参数，请先打开面板选择模型');
      return;
    }
    const projectId = currentId;
    if (!projectId) {
      showToast('warn', '未选中项目，无法生成');
      return;
    }
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    const promptDoc = restorePromptDoc(data.promptDoc, data.prompt);
    const composedPrompt = composeImageSendPrompt(textAttachmentsOf(nodeId), prompt, promptDoc);
    const updatePromptLimitError = composedPromptLimitError(
      composedPrompt,
      await promptMaxLengthOfModel(mediaType, modelId),
    );
    if (updatePromptLimitError) {
      showToast('warn', updatePromptLimitError);
      return;
    }

    if (mediaType === 'image') {
      const size = typeof data.draftSize === 'string' ? data.draftSize : '';
      const ratio = typeof data.draftRatio === 'string' ? data.draftRatio : '';
      if (!size || !ratio) {
        showToast('warn', '缺少分辨率或比例，请先打开面板确认参数');
        return;
      }
      const syncError = imageTextIndexSendError(
        nodeId,
        edgesRef.current,
        [...mediaNodesRef.current, ...textNodesRef.current],
        DEFAULT_IMAGE_REFERENCE_LIMIT,
      );
      if (syncError) {
        showToast('warn', syncError);
        return;
      }
      applyingRef.current = true;
      setSubmittingNodeId(nodeId);
      try {
        const inputAssetIds: string[] = [];
        for (const ref of mergedImageRefsOf(nodeId, edgesRef.current, [...mediaNodesRef.current, ...textNodesRef.current])) {
          if (!inputAssetIds.includes(ref.assetId)) inputAssetIds.push(ref.assetId);
        }
        if (!(await flushCanvasSave(projectId))) return;
        if (activeProjectRef.current !== projectId) return;
        const jobRefs = buildImageJobReferences(inputAssetIds);
        const submitted = startGenerationJob(
          'image',
          { prompt, model_id: modelId, aspect_ratio: ratio, size },
          undefined,
          jobRefs.length > 0 ? { references: jobRefs } : undefined,
          nodeId,
          undefined,
          promptDoc,
        );
        if (submitted && imageDraftId === nodeId) generationDock.submitted('image', nodeId);
      } catch (error) {
        showToast('error', '保存或提交失败，请重试');
        console.warn('更新生成失败:', error);
      } finally {
        applyingRef.current = false;
        setSubmittingNodeId(null);
      }
      return;
    }

    if (mediaType === 'video') {
      const aspectRatio = opts?.ratioOverride ?? (typeof data.draftRatio === 'string' ? data.draftRatio : '');
      const resolution = typeof data.draftSize === 'string' ? data.draftSize : '';
      const duration = typeof data.draftDuration === 'number' ? data.draftDuration : Number(data.draftDuration);
      if (!aspectRatio || !resolution || !Number.isFinite(duration) || duration <= 0) {
        showToast('warn', '缺少视频参数，请先打开面板确认比例、分辨率和时长');
        return;
      }
      const syncError = videoTextIndexSendError(
        nodeId,
        edgesRef.current,
        mediaNodesRef.current,
        textNodesRef.current,
      );
      if (syncError) {
        showToast('warn', syncError);
        return;
      }
      const sourceDraftRefs = mergedVideoRefsWithTextIndex(
        nodeId,
        edgesRef.current,
        mediaNodesRef.current,
        textNodesRef.current,
      );
      const savedStripOrder = data.referenceStripOrder;
      const draftRefs = {
        ...sourceDraftRefs,
        reference: orderRefStripItems(
          sourceDraftRefs.reference,
          videoRefStripKey,
          Array.isArray(savedStripOrder) ? savedStripOrder : [],
        ),
      };
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
      // 视频/音频参考的能力位（ADR-0086）：按卡上模型的能力行判定（同 handleDialogSend），
      // 模型未解析不阻断，交服务端兜底
      const refGate = videoRefUnsupportedByModel(modelId, draftRefs);
      if (refGate) {
        showToast('warn', refGate);
        return;
      }
      applyingRef.current = true;
      setSubmittingNodeId(nodeId);
      try {
        if (!(await flushCanvasSave(projectId))) return;
        if (activeProjectRef.current !== projectId) return;
        const jobRefs = buildVideoJobReferences(draftRefs);
        // IKIPSX：原位更新生成/文本索引重发不走面板，draftMode 兜底——草稿已保存模式优先；
        // 缺失（2026-09-13 前存量旧草稿）按提交时参考集合派生默认（与面板显示同源）。
        const fallbackMode =
          typeof data.draftMode === 'string'
            ? data.draftMode
            : firstEnabledVideoMode(enabledVideoFollowModes(draftRefs));
        const submitted = startGenerationJob(
          'video',
          {
            prompt,
            model_id: modelId,
            aspect_ratio: aspectRatio,
            resolution,
            duration,
            generate_audio: typeof data.draftGenerateAudio === 'boolean' ? data.draftGenerateAudio : true,
          },
          undefined,
          jobRefs.length > 0 ? { references: jobRefs } : undefined,
          nodeId,
          { mode: fallbackMode, references: [] },
          promptDoc,
        );
        if (submitted && videoDraftId === nodeId) generationDock.submitted('video', nodeId);
      } catch (error) {
        showToast('error', '保存或提交失败，请重试');
        console.warn('更新生成失败:', error);
      } finally {
        applyingRef.current = false;
        setSubmittingNodeId(null);
      }
      return;
    }

    const syncError = audioTextIndexSendError(
      nodeId,
      edgesRef.current,
      mediaNodesRef.current,
      textNodesRef.current,
    );
    if (syncError) {
      showToast('warn', syncError);
      return;
    }
    applyingRef.current = true;
    setSubmittingNodeId(nodeId);
    try {
      const { refs } = mergedAudioRefsWithTextIndex(
        nodeId,
        edgesRef.current,
        mediaNodesRef.current,
        textNodesRef.current,
      );
      const resolved = refs.filter((ref) => ref.assetId);
      if (!(await flushCanvasSave(projectId))) return;
      if (activeProjectRef.current !== projectId) return;
      const submitted = startGenerationJob(
        'audio',
        { prompt, model_id: modelId },
        undefined,
        resolved.length
          ? { references: resolved.map((ref) => ({
              role: 'reference' as const,
              type: ref.mediaType,
              asset_id: String(ref.assetId),
            })) }
          : undefined,
        nodeId,
        undefined,
        promptDoc,
      );
      if (submitted && audioDraftId === nodeId) generationDock.submitted('audio', nodeId);
    } catch (error) {
      showToast('error', '保存或提交失败，请重试');
      console.warn('更新生成失败:', error);
    } finally {
      applyingRef.current = false;
      setSubmittingNodeId(null);
    }
  };
  updateGenerateRef.current = (nodeId) => {
    void handleUpdateGenerate(nodeId);
  };

  /** 一键修复「改为跟随视频并重试」（IKJ79D）：task_type_param_constraint 失败卡的动作——
   *  仅把比例改为 adaptive（Auto），提示词/素材/时长不动直接重交（编辑/延长同动作；编辑单
   *  时长由 worker 按任务类型强制 -1，前端不改）。重交复用「更新生成」链路（同一套校验 +
   *  原位承接，仅多传比例覆盖）；draftRatio 同步改 Auto 落卡，重开面板即显示修复后比例。 */
  const handleFixFollowVideo = (nodeId: string) => {
    const node = mediaNodesRef.current.find((item) => item.id === nodeId);
    if (!node || node.type !== 'mediaNode') return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (data.genStatus !== 'failed' || data.mediaType !== 'video') return;
    if (!isTaskTypeParamConstraintCode(data.errorCode as number | string | undefined)) return;
    patchMediaNode(nodeId, { draftRatio: 'adaptive' });
    void handleUpdateGenerate(nodeId, { ratioOverride: 'adaptive' });
  };
  actionsRef.current.fixFollowVideo = handleFixFollowVideo;

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
    }, undefined, { recordHistory: true });
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

  /** 源音频卡有在途音视频合成任务（IKIHMX 审查修复 1）：画布上 genStatus=generating 且带
   *  audioVideoMux 身份的卡（正常发送原地转生成中 + 刷新恢复补的占位卡同源）→ 其固定音频源
   *  卡工具条「音视频合成」按钮保留高亮（规格：发送后面板关闭、工具条恢复且高亮保留；
   *  终态回填清身份、失败卡不高亮失败即可重试）。渲染期注入 audioVideoMuxInFlight 标记，
   *  不持久化（口径同 soloToolbarHidden）。 */
  const audioVideoMuxInFlightSourceIds = new Set(
    mediaNodes
      .filter((n) => {
        if ((n.data as Record<string, unknown>).genStatus !== 'generating') return false;
        return audioVideoMuxIdentityOf(n) !== undefined;
      })
      .map((n) => audioVideoMuxIdentityOf(n)!.sourceNodeId),
  );

  /** IKIZQE：样片卡标题行成片按钮的渲染期派生状态（不持久化，口径同 soloToolbarHidden）。
   *  推导链（服务端报价 + 截止 + 两卡关系三重门）：成片卡在场且生成中/核对中 → 按钮禁用
   *  （成片生成中…/状态核对中…）；成片卡已终态（成功/失败/取消）或本会话已受理过 → 不再
   *  渲染（首版一张样片至多一条成片，服务端 1057/空报价兜底）；其余按报价/截止落
   *  ready/loading/empty/expired/checking。IKJ7UI：expired（过期/缺可信截止）仅作派生
   *  标记，MediaNode 对该 phase 整钮不渲染——过期信息由画面内角标表达（ADR-0119）。 */
  const finalizeCtaByNodeId = new Map<string, NonNullable<MediaNodeData['finalizeCta']>>();
  if (currentId) {
    for (const n of mediaNodes) {
      const d = (n.data ?? {}) as Record<string, unknown>;
      if (d.videoStage !== 'sample' || d.jobId == null) continue;
      if (d.genStatus != null || d.draft === true) continue; // 仅成功样片卡提供入口
      const jobId = String(d.jobId);
      const finalNode = mediaNodes.find(
        (m) =>
          ((m.data ?? {}) as Record<string, unknown>).videoStage === 'final'
          && String(((m.data ?? {}) as Record<string, unknown>).sourceSampleJobId ?? '') === jobId,
      );
      if (finalizeUnknownSamples.has(n.id)) {
        finalizeCtaByNodeId.set(n.id, { phase: 'checking' });
        continue;
      }
      const finalGen = (finalNode?.data ?? {}) as Record<string, unknown> | undefined;
      if (finalGen?.genStatus === 'generating') {
        finalizeCtaByNodeId.set(n.id, { phase: 'running' });
        continue;
      }
      if (finalGen?.genStatus === 'checking') {
        finalizeCtaByNodeId.set(n.id, { phase: 'checking' });
        continue;
      }
      if (finalNode != null || finalizeAttemptedJobIdsRef.current.has(jobId)) {
        continue; // 已有成片卡（终态）或本会话已受理过：不再渲染（首版一张样片至多一条成片）
      }
      if (typeof d.finalizeDeadlineAt !== 'string' || sampleDeadlineExpired(d.finalizeDeadlineAt)) {
        finalizeCtaByNodeId.set(n.id, { phase: 'expired' });
        continue;
      }
      const quote = finalizeQuotes[n.id];
      finalizeCtaByNodeId.set(n.id, quote == null
        ? { phase: 'loading' }
        : quote.phase === 'ready'
          ? { phase: 'ready', credits: quote.credits }
          : { phase: 'unavailable' });
    }
  }

  /** IKIZQG：重新生成样片入口的渲染期派生状态（不持久化，口径同 finalizeCtaByNodeId）。
   *  IKJ7UI（ADR-0119）起唯一入口是成片失败卡失败区（身份解析见 regenEntrySampleJobIdOf；
   *  过期样片卡标题行入口已移除）。本会话已受理过重新生成的样片任务不再渲染（新样片卡
   *  有自己的截止与成片入口）。 */
  const regenerateCtaByNodeId = new Map<string, NonNullable<MediaNodeData['regenerateCta']>>();
  if (currentId) {
    for (const n of mediaNodes) {
      const sampleJobId = regenEntrySampleJobIdOf((n.data ?? {}) as Record<string, unknown>);
      if (sampleJobId == null) continue;
      if (sampleRegenUnknownSamples.has(sampleJobId)) {
        regenerateCtaByNodeId.set(n.id, { phase: 'checking' });
        continue;
      }
      if (sampleRegenAttemptedJobIdsRef.current.has(sampleJobId)) continue;
      const quote = sampleRegenQuotes[sampleJobId];
      regenerateCtaByNodeId.set(n.id, quote == null
        ? { phase: 'loading' }
        : quote.phase === 'ready'
          ? { phase: 'ready', credits: quote.credits }
          : { phase: 'unavailable' });
    }
  }

  return (
    <div className={styles.canvasPage}>
      {/* 顶部工具栏 */}
      <CanvasHeader
        projects={projects}
        currentProjectId={currentId}
        onSelectProject={handleSelect}
        onRenameProject={handleRename}
        onDeleteProject={handleDelete}
        onTogglePinProject={handleToggleProjectPin}
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
      <div ref={canvasWrapperRef} data-canvas-stage className={`${styles.canvasWrapper} ${pickMode === 'image' ? styles.pickingImage : ''}`}>
        {applying && <div role="status" style={{ position: 'fixed', inset: 0, zIndex: 10000, cursor: 'wait' }}>正在保存画布引用…</div>}
      {/* 资产卡参考图上限（ADR-0086）：节点组件经 context 读能力行，避免为卡内上限在
          节点树层层透传 props；未注入/未加载时回落能力缺省值 */}
      <AssetImageRefLimitProvider value={assetImageRefMax}>
      <FlowCanvas
          showMiniMap={showMiniMap}
          toolMode={toolMode}
          extraNodes={uploadedNodes}
          textNodes={textNodes}
          mediaNodes={mediaNodes.map((source) => {
            const node = toolSessions.decorateNode(source);
            const finalizeCta = finalizeCtaByNodeId.get(node.id);
            const regenerateCta = regenerateCtaByNodeId.get(node.id);
            if (node.id !== submittingNodeId && !audioVideoMuxInFlightSourceIds.has(node.id) && !finalizeCta && !regenerateCta) return node;
            return { ...node, data: { ...node.data,
              ...(node.id === submittingNodeId ? { submitting: true } : {}),
              ...(audioVideoMuxInFlightSourceIds.has(node.id) ? { audioVideoMuxInFlight: true } : {}),
              ...(finalizeCta ? { finalizeCta, onFinalizeSample: handleFinalizeSample } : {}),
              ...(regenerateCta ? { regenerateCta, onRegenerateSample: handleRegenerateSample } : {}),
            } };
          })}
          productNodes={productNodes}
          assetNodes={assetNodes}
          showEdges={showEdges}
          snapAlignmentEnabled={snapAlignmentOn}
          followToolbarLayer={
            <>
              {/* IKGYYD：媒体卡悬浮工具条迁入钉屏幕层（NodeFollowToolbar 容器 + MediaNodeToolbar
                  内容）——渲染于画布缩放层之外，任何缩放级别屏幕尺寸恒定，拖动/平移缩放实时跟随。
                  IKGZ5O 工具会话模态：编辑会话激活或插帧面板打开期间整条不渲染（词条「工具会话」
                  模态口径；注册装配派生的模态门对全部
                  媒体卡生效）。高清/HD 参数面板与普通生成面板一样，打开时仍露出上方操作条
                  （IKHFUF）；插帧面板按其规格（ADR-0113）保留模态。 */}
              {soloMediaToolbarNode ? (
                <NodeFollowToolbar
                  nodeId={soloMediaToolbarNode.id}
                  show={showSoloMediaToolbar && !toolSessions.isModal()}
                  hovered={
                    enhancePanelToolbarNode != null
                    && enhancePanelToolbarNode.id === soloMediaToolbarNode.id
                  }
                >
                  <MediaNodeToolbar
                    id={soloMediaToolbarNode.id}
                    data={{
                      ...soloMediaToolbarNode.data,
                      // 在途合成源卡（IKIHMX 审查修复 1）：工具条数据取自 state，此处合并
                      // 渲染期标记让「音视频合成」按钮保留高亮（不持久化）
                      ...(audioVideoMuxInFlightSourceIds.has(soloMediaToolbarNode.id)
                        ? { audioVideoMuxInFlight: true }
                        : {}),
                    } as MediaNodeData}
                  />
                </NodeFollowToolbar>
              ) : null}
              {/* IKGYYF：资产卡顶部操作条迁入钉屏幕层（同容器 + AssetCardToolbar 内容）；
                  hover 的资产卡走 hovered 门（等价迁移前 CSS .wrapper:hover，不受唯一选中约束）。
                  IKGYYB：toolbarLift 对齐文本卡操作条 42 口径；条根指针事件接 hover 桥接 */}
              {assetToolbarNode ? (
                <NodeFollowToolbar
                  nodeId={assetToolbarNode.id}
                  hovered={hoverAssetToolbarNode != null}
                  toolbarLift={ASSET_TOOLBAR_LIFT}
                  show={assetCardToolbarVisible(
                    ((assetToolbarNode.data ?? {}) as { kind?: AssetCardKind }).kind,
                  )}
                >
                  <AssetCardToolbar
                    id={assetToolbarNode.id}
                    data={assetToolbarNode.data as AssetCardNodeData}
                    onToolbarPointerEnter={handleToolbarPointerEnter}
                    onToolbarPointerLeave={handleToolbarPointerLeave}
                  />
                </NodeFollowToolbar>
              ) : null}
            </>
          }
          {...toolSessions.canvasLayers()}
          edges={edges}
          onEdgesChange={guardEdgesChange}
          onConnect={handleConnect}
          onConnectStart={(nodeId) => {
            connectingSourceRef.current = nodeId;
            // IKIHPK：合成会话期内从视频成品卡拖线 → 面板视频槽进「绑定中跟手」态
            toolSessions.wireStart(nodeId);
          }}
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
          onSelectionChange={handleSelectionChangeStable}
          refPickActive={imagePickSessionActive || videoPickSessionActive || audioPickSessionActive || toolSessions.blocksCanvasDrag()}
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
          onDuplicateSelected={(ids) => {
            withHistoryBatch(() => {
              ids.forEach((id) => actionsRef.current.duplicate(id));
            });
          }}
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
          onAnchoredOverlayDragHideChange={setAnchoredOverlayHiddenIds}
          onUpdateGenerate={onUpdateGenerate}
        />
      </AssetImageRefLimitProvider>
        {connectMenu && (
          <ConnectTypeMenu
            x={connectMenu.x}
            y={connectMenu.y}
            enabled={availableGenKinds(connectMenu.sourceIds.map(findCanvasNode).filter((n): n is Node => !!n))}
            onClose={closeConnectMenu}
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
              { key: 'undo', label: '撤销', disabled: toolSessions.eraseHistory().active ? !toolSessions.eraseHistory().canUndo : !canvasHistory.canUndo },
              { key: 'redo', label: '重做', disabled: toolSessions.eraseHistory().active ? !toolSessions.eraseHistory().canRedo : !canvasHistory.canRedo },
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
                openImageDraftDialog(createImageDraftCard(flow, { recordHistory: true }));
              } else if (key === 'add-video') {
                if (!canOpenEditor()) return;
                openVideoDraftDialog(createVideoDraftCard(undefined, flow, { recordHistory: true }));
              } else if (key === 'add-audio') {
                if (!canOpenEditor()) return;
                openAudioDraftDialog(createAudioDraftCard(flow, { recordHistory: true }));
              }
              else if (key === 'undo') {
                if (toolSessions.eraseHistory().active) toolSessions.eraseHistory().undo();
                else canvasHistory.undo();
              }
              else if (key === 'redo') {
                if (toolSessions.eraseHistory().active) toolSessions.eraseHistory().redo();
                else canvasHistory.redo();
              }
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
            const draftId = createVideoDraftCard(undefined, undefined, { recordHistory: true });
            openVideoDraftDialog(draftId);
          }}
          onToggleImageDialog={() => {
            // 左侧工具栏：先建图片草稿卡，再打开跟随输入框；发送在原卡生成
            if (!canOpenEditor()) return;
            setPickMode(null);
            setPickTarget(null);
            setImagePickResult(null);
            const draftId = createImageDraftCard(undefined, { recordHistory: true });
            openImageDraftDialog(draftId);
          }}
          onToggleAudioDialog={() => {
            // 左侧工具栏：先建音频草稿卡，再打开跟随输入框；发送在原卡生成
            if (!canOpenEditor()) return;
            setPickMode(null);
            setPickTarget(null);
            const draftId = createAudioDraftCard(undefined, { recordHistory: true });
            openAudioDraftDialog(draftId);
          }}
          showVideoDialog={showBottomDialog}
          showImageDialog={showImageDialog}
          showAudioDialog={showAudioDialog}
          onAddTextNode={() => handleAddTextNode()}
          onMenuSelect={handleToolMenuSelect}
        />

        {/* 左下角：返回首页 + 小地图切换 */}
        <div className={styles.bottomLeftActions} data-canvas-chrome>
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

        {generationDock.render()}
        {toolSessions.render(generationDock.renderedToolKinds)}

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
              <span>从节点添加素材：连续点击画布中的图片或音频节点带入参考，点击文本卡带入创作上下文；点击空白、按 Esc 或点「完成选取」结束选取</span>
              <button type="button" className={styles.pickHintFinish} onClick={endAudioPickSession}>完成选取</button>
            </div>
          ) : (
          <div className={styles.pickHint} data-gen-panel-territory>
            {pickMode === 'image' && ((pickRefRole === 'first' || pickRefRole === 'last')
              ? '从节点添加素材：点击画布中的图片节点带入首帧/尾帧，点击空白处取消'
              : '从节点添加素材：点击画布中的图片节点或方案节点，带入完整参考，点击空白处取消')}
            {pickMode === 'video' && '从节点添加素材：点击画布中的图片、视频或音频节点带入参考，点击空白处取消'}
            {pickMode === 'audio' && '到节点选择：点击画布中的图片或音频节点带入参考，点击文本卡带入创作上下文，点击空白处取消'}
            {pickMode === 'product' && '到节点选择：点击画布中的图片节点带入商品图，点击空白处取消'}
            {pickMode === 'asset' && '到节点选择：点击画布中的图片节点或方案节点，带入完整参考，点击空白处取消'}
          </div>
          )
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
          rejectUnapprovedForVideo={assetsPickerTarget === 'videoDraft'}
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
        <div data-testid="canvas-toast" style={{
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

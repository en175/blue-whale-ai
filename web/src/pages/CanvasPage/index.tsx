import { releaseRemovedPromptSources, promptBindingList, promptBindingsSchema, type PromptBinding } from '@lib/contracts/prompt-target';
import { promptMentionSchema, validPromptMentions } from '@lib/contracts/prompt-preview';
import { unifiedTextNodeText } from '@lib/contracts/text-node-markdown';
import { replaceImageMentionsWithAssetTokens, type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { toast as globalToast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { frameInterpolationRecoveryOptions } from '@/api/frameInterpolationRecovery';
import { newNodeId } from './nodeId';
import { nextDraftPosition } from './draftSpawn';
import { nodeBoxOf, readRecoveryErrorReason, imageToolTargetBesideSource, fetchUrlAsFile, planReferenceErrorFor, pendingPlanSyncsOf, pickMarkedIdsFor, complianceBlockedIds, canvasMediaOf, atMentionItemsOf, appliedCardIdsOf } from './canvasPureNodeHelpers';
import { computeFollowAnchor } from './followDialog';
import { defaultVideoModeFor, draftVideoModeOf } from './videoModes';
import {
  frameSlotCountOf,
  isFrameMode,
  normalizeVideoMode,
  type VideoMode,
} from '@/lib/video-modes';
import { imageRefSourceError, isImageDraftNode, readAssetId } from './mediaRefs';
import { appliedPlanAssetIds, dropReversedTextIndexEdges, replaceMissingPlanMediaNodes, textIndexEdgesForAppliedPlan } from './planApplyEdges';
import { mergedImageRefsOf, mergedVideoRefsWithTextIndex } from './textIndexSync';
import { audioRefItemMediaTypeOf, audioRefSourceError } from './audioMediaRefs';
import { PANEL_REF_MEDIA_TYPES } from './refSourceTypes';
import { assetsPickerMediaTypes } from './assetsPickerTargets';
import { hasGenerationRecord, isInPlaceRegenTarget } from './mediaReEdit';
import {
  asVideoRefMediaType,
  readRefRole,
  readDraftMaterialRefs,
  mergedVideoMediaRefsOf,
  videoRefSourceError,
  videoRefIdentityIds,
  type VideoMediaRef,
  type VideoRefRole,
} from './videoMediaRefs';
import { AssetImageRefLimitProvider } from './modelCaps';
import { imageReferenceMaxOf } from '@/lib/model-reference-limits';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { isTaskTypeParamConstraintCode } from '@/lib/video-reference-hints';
import { type MediaDims } from './components/MediaNode/mediaContentSize';
import type { MediaNodeData } from './components/MediaNode';
import MediaNodeToolbar from './components/MediaNode/Toolbar';
import NodeFollowToolbar from './components/NodeFollowToolbar';
import AssetCardToolbar from './components/AssetCardNode/Toolbar';
import { assetCardToolbarVisible } from './components/AssetCardNode/toolbarVisibility';
import { mediaCardToolbarVisible } from './components/MediaNode/toolbarVisibility';
import {
  MEDIA_EXTRACT_EDGE_ORIGIN,
  MEDIA_EXTRACT_NODE_PREFIX,
  buildMediaExtractPlaceholderNode,
  mediaExtractNodeId,
} from './mediaExtract';
import { createCanvasToolSessions, useCanvasToolSessionEffects, type CanvasToolHosts, type CanvasToolView } from './canvasToolSessions';
import { type ImageEnhanceSubmission, type VideoEnhanceSubmission, type FrameInterpolationSubmission } from './panelToolSessions';
import { apiErrorMessage, isSilentAuthError } from './toolSessionCapture';
import { type AudioVideoSplitSubmission } from './audioVideoSplitSession';
import {
  AUDIO_TRIM_EDGE_ORIGIN,
  AUDIO_TRIM_NODE_PREFIX,
  audioTrimNodeId,
  buildAudioTrimPlaceholderNode,
} from './audioTrim';
import { type VocalSplitPayload, type AudioToolSubmission } from './audioToolSessions';
import {
  type AudioTrimInput,
} from '@lib/contracts/audio-trim';
import { AUDIO_MIX_EDGE_ORIGIN, buildAudioMixPlaceholderNode, findAudioMixPosition, isAudioMixNodeId } from './audioMix';
import {
  AUDIO_SPEED_EDGE_ORIGIN,
  AUDIO_SPEED_NODE_PREFIX,
  audioSpeedNodeId,
  buildAudioSpeedPlaceholderNode,
} from './audioSpeed';
import type { AudioSpeedInput } from '@lib/contracts/audio-speed';
import { AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON, AUDIO_VIDEO_MUX_EDGE_ORIGIN, AUDIO_VIDEO_MUX_TITLE, audioVideoMuxIdentityOf, audioVideoMuxVideoError, buildAudioVideoMuxIdentity, isAudioVideoMuxAudioEdge, isAudioVideoMuxBindEdge, isAudioVideoMuxDraftNode } from './audioVideoMux';
import { VOCAL_SPLIT_EDGE_ORIGIN, buildVocalSplitPlaceholderNode } from './vocalSplit';
import { SCENE_SPLIT_EDGE_ORIGIN, buildSceneSplitPlaceholderNode } from './sceneSplit';
import { type SceneSplitSubmission } from './sceneSplitSession';
import { SMART_MATTING_EDGE_ORIGIN, buildSmartMattingPlaceholderNode } from './smartMatting';
import {
  IMAGE_ENHANCE_EDGE_ORIGIN,
  imageEnhanceDraftPosition,
} from './imageEnhance';
import {
  VIDEO_ENHANCE_EDGE_ORIGIN,
  videoEnhanceDraftPosition,
  videoEnhanceGateReason,
  type VideoEnhanceIdentity,
} from './videoEnhance';
import type { VideoEnhanceResolution } from '@lib/contracts/video-enhance';
import {
  FRAME_INTERPOLATION_DEFAULT_FPS,
  FRAME_INTERPOLATION_EDGE_ORIGIN,
  frameInterpolationDisplayName,
  frameInterpolationDraftPosition,
  frameInterpolationGateReason,
  type FrameInterpolationFps,
  type FrameInterpolationIdentity,
} from './frameInterpolation';
import { IMAGE_ERASE_EDGE_ORIGIN, rasterizeMaskToPngFile } from './imageErase';
import { VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN } from '@lib/contracts/video-subtitle-erase';
import { IMAGE_CUTOUT_EDGE_ORIGIN } from '@lib/contracts/image-cutout';
import { IMAGE_OUTPAINT_EDGE_ORIGIN, buildImageOutpaintInput, type ImageOutpaintIdentity } from './imageOutpaint';
import { type OutpaintFrozenInput, type OutpaintTaskSubmission, type CutoutSubmission } from './imageToolSessions';
import { type SmartMattingSubmission } from './smartMattingSession';
import { type SubtitleEraseTaskSubmission, type ImageEraseTaskSubmission } from './maskToolSessions';
import { type CropHost } from './cropSession';
import { IMAGE_CROP_EDGE_ORIGIN, type ImageCropIdentity } from './imageCrop';
import { type ToolSessionDeps } from './toolSessionCoordinator';
import { persistSnapAlignmentEnabled, readSnapAlignmentEnabled } from './snapPreference';
import CanvasHeader from './components/CanvasHeader';
import AgentPanel from './components/AgentPanel';
import CanvasToolbar from './components/CanvasToolbar';
import type { VideoGenSeedParams } from './components/BottomDialog';
import { type UploadedFile, type ImageTextAttachment } from './components/ImageDialog';
import ImageGenerationDockPanel from './imageGenerationDockPanel';
import { promptMaxLengthOfModel } from '@/lib/prompt-max-length';
import { type CanvasPickItem } from './components/AudioDialog';
import SharedAssetsModal from './components/SharedAssetsModal';
import LegacyHistoryModal from './components/LegacyHistoryModal';
import AssetsPickerModal from './components/AssetsPickerModal';
import CharacterLibraryModal from './components/CharacterLibraryModal';
import CanvasToast from './components/CanvasToast';
import CanvasBottomLeftActions from './components/CanvasBottomLeftActions';
import CanvasPickHint from './components/CanvasPickHint';
import CanvasPaneContextMenu from './components/CanvasPaneContextMenu';
import type { MaterialAsset } from '@/api/material';
import type { ImageOutpaintInput } from '@lib/contracts/image-outpaint';
import type { AssetCardKind, AssetCardNodeData } from './components/AssetCardNode';
import type { CanvasProject } from './components/ProjectSelector';
import FlowCanvas from './components/Canvas';
import { isEditableKeyboardTarget } from './components/Canvas/keyboardDelete';
import { useOverlayWheelPassthrough } from './components/Canvas/canvasWheelPassthrough';
import { canvasUndoKeyAction } from './components/Canvas/keyboardUndo';
import { isMentionMenuOpen } from './components/Canvas/canvasKeyboard';
import { hasCustomName, planBindingsCoveredBy, readNodeAssetId, mapBackendNode, resolveNodeAssets } from './canvasNodeUtils';
import { createConnectValidators } from './canvasConnectValidation';
import { useEdgesState, type Connection, type Edge, type Node, type Viewport, type OnSelectionChangeParams } from '@xyflow/react';
import { useAuthStore } from '@/stores/auth';
import { fetchMe, fetchCredits, toSessionUser } from '@/api/auth';
import {
  fetchProjects,
  createProject,
  touchProjectLastOpened,
  type SnapshotAsset,
} from '@/api/projects';
import { fetchUploadPresign, putToPresignedUrl, completeUpload, linkAssetToProject, type AssetType, type UploadCompleteData } from '@/api/assets';
import AssetDetailModal from '@/pages/Assets/components/AssetDetailModal';
import { rememberAssetUrl } from './components/AgentPanel/assetUrlCache';
import { referencePromptPlan, applyPromptPreview, createConversationQuote, legacyCardHistoryOptions, saveCanvasDoc, serializeEdges, serializeNodes } from '@/api/canvas';
import { isApiError } from '@/api/http';
import { useAuthPromptStore } from '@/stores/authPrompt';
import { openRechargeForCreditsError } from '@/utils/creditsGate';
import type { GenerationCardBlock, SessionContentBlock } from '@/api/agentSessions';
import {
  fetchJobStatus,
 } from '@/api/jobs';
import { newIdempotencyKey } from '@/api/idempotencyKey';
import { uploadAssetFile, probeMediaMeta } from '@/utils/upload';
import ConfirmModal from '@/components/ConfirmModal';
import { buildImageJobReferences, buildVideoJobReferencesFromList } from './videoJobReferences';
import {
  availableGenKinds,
  canConnectSourcesToGen,
  genKindOf,
  isConnectableSource,
  wouldCreateCycle,
  type ConnectGenKind,
} from './connectAbility';
import ConnectTypeMenu from './components/ConnectTypeMenu';
import { checkFileBeforeUpload, isFileRejected } from '@/utils/fileSignature';
import { takeGenHandoff, type GenHandoff } from '@/utils/gen-handoff';
import { takeAgentHandoff } from '@/utils/agent-handoff';
import { createGenerationRuntime, type GenerationRuntime, type GenerationRuntimeHost } from './generationRuntime/runtime';
import { normalGenerationTask } from './generationRuntime/normalGeneration';
import { storyboardTask } from './generationRuntime/storyboardTasks';
import { createImageToolsTask, isImageToolsCard, imageToolsRetryPayloadOf, type ImageToolsPayload } from './generationRuntime/imageTools';
import { audioMixTask, audioVideoMuxTask, staleMixSubmitError, watchMixSubmit } from './generationRuntime/mixMuxTasks';
import { sceneSplitTask, vocalSplitTask } from './generationRuntime/multiOutputTasks';
import { videoToolsTask, videoToolFrozenPayload, type VideoToolPayload } from './generationRuntime/videoTools';
import { seedTargetOfNode, seedSourcesOfNode } from './generationRuntime/seedFacts';
import type { RecoverySeedSource, RecoverySeedTarget, RuntimeNodeView } from './generationRuntime/types';
import { generationRecoveryPageOptions, putCanvasDocWithRecovery, type CanvasRecoverySaveData, type RecoveryChange } from '@/api/canvasRecovery';
import { useCanvasDoc } from './hooks/useCanvasDoc';
import { useCanvasHistory, type CanvasHistoryApi } from './hooks/useCanvasHistory';
import { useAssetHoverBridge } from './hooks/useAssetHoverBridge';
import { useCanvasPickers } from './hooks/useCanvasPickers';
import { useCanvasGenerationTerminal } from './hooks/useCanvasGenerationTerminal';
import { useCanvasGenerationSubmission } from './hooks/useCanvasGenerationSubmission';
import { useCanvasAssetActions } from './hooks/useCanvasAssetActions';
import { useCanvasNodeFactories } from './hooks/useCanvasNodeFactories';
import { useCanvasSave, EMPTY_CLEAR_CONFLICT_TOAST, EMPTY_OVERWRITE_REJECTED_TOAST } from './hooks/useCanvasSave';
import { useCanvasRefStripOrder } from './hooks/useCanvasRefStripOrder';
import { useCanvasCompliance } from './hooks/useCanvasCompliance';
import { useCanvasProjects } from './hooks/useCanvasProjects';
import { useCanvasClipboard } from './hooks/useCanvasClipboard';
import { useCanvasUploadDrop } from './hooks/useCanvasUploadDrop';
import { useCanvasPickSessionClick } from './hooks/useCanvasPickSessionClick';
import { useCanvasAssetsPlacement } from './hooks/useCanvasAssetsPlacement';
import { useCanvasUpdateGenerate } from './hooks/useCanvasUpdateGenerate';
import { useCanvasGroupActions } from './hooks/useCanvasGroupActions';
import {
  applyDraggedNodesToGroups,
  groupToNode,
  parseGroupsFromNodes,
  type CanvasGroup,
} from './canvasGroups';
import { collectMediaBlocks, type CanvasGalleryRef } from './collectMediaBlocks';
import { QUOTE_TEXT_LIMIT, extractTextNodeText, quoteChipLabel, readPromptSource, textQuoteBlock, type QuoteConversationInput } from './quoteConversation';
import {
  canvasLocationSearch,
  findLastOpenedProjectId,
  findLatestCreatedProjectId,
  pickCanvasIdAfterLoad,
  readCanvasIdFromSearch,
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
const ASSET_TOOLBAR_LIFT = 42;
export default function CanvasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [currentId, setCurrentId] = useState(() => readCanvasIdFromSearch(searchParams));
  const [showAgent, setShowAgent] = useState(false);
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
  const [anchoredOverlayHiddenIds, setAnchoredOverlayHiddenIds] = useState<Set<string> | null>(null);
  const isAnchoredOverlayDragHidden = (id: string | null | undefined) =>
    id != null && (anchoredOverlayHiddenIds?.has(id) ?? false);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperSize, setWrapperSize] = useState({ width: 0, height: 0 });
  const [liveViewport, setLiveViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1.1 });
  const [soloSelectedNodeId, setSoloSelectedNodeId] = useState<string | null>(null);
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
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  const [characterLibraryTarget, setCharacterLibraryTarget] = useState<'image' | 'asset' | null>(null);
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
  toolRuntime.setProject(currentId);
  const audioMixInFlightRef = useRef(false);
  const audioVideoMuxInFlightRef = useRef(false);
  const audioMixSubmitCardRef = useRef<{ projectId: string; payload: string; nodeId: string; accepted: boolean } | null>(null);
  const sceneSplitSendingRef = useRef(false);
  const smartMattingSendingRef = useRef(false);
  const [showEdges, setShowEdges] = useState(true);
  const [snapAlignmentOn, setSnapAlignmentOn] = useState(readSnapAlignmentEnabled);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const referencePlanRef = useRef<(source: string, target: string, syncBindings?: PromptBinding[]) => Promise<void>>(async () => {});
  const edgesRef = useRef<Edge[]>([]);
  edgesRef.current = edges;
  const historyRef = useRef<CanvasHistoryApi | null>(null);
  const withHistoryBatch = (fn: () => void) => {
    historyRef.current?.beginBatch();
    try {
      fn();
    } finally {
      historyRef.current?.endBatch();
    }
  };
  const eraseHistoryRef = useRef({
    active: false,
    undo: () => {},
    redo: () => {},
  });
  eraseHistoryRef.current = toolSessions.eraseHistory();
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const groupsRef = useRef<CanvasGroup[]>([]);
  groupsRef.current = groups;
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<{ id: string; count: number } | null>(null);
  const [submittingNodeId, setSubmittingNodeId] = useState<string | null>(null);
  const isGeneratingNode = (id: string) =>
    id === submittingNodeId || mediaNodesRef.current.some(
      (n) => n.id === id && (n.data as Record<string, unknown> | undefined)?.genStatus === 'generating',
    );
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
    const next = [...edgesRef.current, edge];
    edgesRef.current = next;
    setEdges(next);
  };
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
  const {
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
    draftModelOf,
    videoCapsOfDraft,
    imageRefMaxOfDraft,
    videoRefUnsupportedByModel,
  } = createConnectValidators({
    getMediaNodes: () => mediaNodesRef.current,
    getTextNodes: () => textNodesRef.current,
    getEdges: () => edgesRef.current,
    getVideoModels: () => videoModelsRef.current,
    getImageModels: () => imageModelsRef.current,
    findCanvasNode: (id) => findCanvasNode(id),
    isGeneratingNode: (id) => isGeneratingNode(id),
    showToast: (type, msg) => showToast(type, msg),
  });
  const findCanvasNode = (id: string): Node | undefined =>
    mediaNodesRef.current.find((n) => n.id === id)
    ?? textNodesRef.current.find((n) => n.id === id)
    ?? productNodesRef.current.find((n) => n.id === id)
    ?? assetNodesRef.current.find((n) => n.id === id);
  const draftModeOfNode = (nodeId: string, data?: Record<string, unknown> | undefined): VideoMode | null =>
    draftVideoModeOf(
      data ?? (mediaNodesRef.current.find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined),
      mergedVideoMediaRefsOf(nodeId, edgesRef.current, mediaNodesRef.current),
    );
  const videoEdgeRoleFor = (targetId: string, requested?: VideoRefRole | null): VideoRefRole => {
    if (requested === 'first' || requested === 'last') return requested;
    const slots = frameSlotCountOf(draftModeOfNode(targetId));
    if (slots === 0) return 'reference';
    const refs = mergedVideoMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current);
    if (!refs.first) return 'first';
    if (slots === 2 && !refs.last) return 'last';
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
    const toolConnection = toolSessions.connect(sourceNode, targetNode);
    if (toolConnection !== null) return toolConnection;
    const imageRefOk = genKindOf(targetNode) === 'image' && sourceNode.type === 'mediaNode'
      && imageRefSourceError(sourceNode) === null;
    if (!imageRefOk && !isConnectableSource(sourceNode)) return false;
    if (wouldCreateCycle(source, target, edgesRef.current)) return false;
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
      if (targetKind === 'video' && videoRole === 'reference' && isFrameMode(draftModeOfNode(target, targetData))) {
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
  const handleConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      connectPair(params.source, params.target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, submittingNodeId],
  );
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
    edgesRef.current = after;
    setEdges(after);
  };
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
  const handleMediaIndexChange = (id: string, mediaMentions: MediaMention[], mediaRefs: MediaRef[], delta: { added: string[]; removed: string[] }) => {
    setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, mediaMentions, mediaRefs } } : n));
    syncTextIndexEdges(id, delta);
  };
  const removePlanAttachment = (targetId: string | undefined, planNodeId: string) => {
    if (!targetId || isGeneratingNode(targetId)) return;
    removeTargetInputs(edgesRef.current.filter(edge => edge.source === planNodeId && edge.target === targetId).map(edge => edge.id));
  };
  const guardEdgesChange: typeof onEdgesChange = (changes) => {
    const allowed = changes.filter((c) => {
      if (c.type !== 'remove') return true;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      if (!edge) return true;
      if (isGeneratingNode(edge.target)) return false;
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
    const removedEdges: Edge[] = [];
    for (const c of allowed) {
      if (c.type !== 'remove') continue;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      if (edge) removedEdges.push(edge);
    }
    if (removedEdges.length > 0) removeTargetInputs(removedEdges.map(edge => edge.id));
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
  const showToast = useCallback((type: 'success' | 'error' | 'warn', msg: string) => {
    setToast({ type, msg });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);
  const [textNodes, setTextNodes] = useState<Node[]>([]);
  const [mediaNodes, setMediaNodes] = useState<Node[]>([]);
  const [productNodes, setProductNodes] = useState<Node[]>([]);
  const [assetNodes, setAssetNodes] = useState<Node[]>([]);
  const mediaNodesRef = useRef<Node[]>([]);
  mediaNodesRef.current = mediaNodes;
  const [videoModels, setVideoModels] = useState<GenerationModel[]>([]);
  const [imageModels, setImageModels] = useState<GenerationModel[]>([]);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  const [assetsModalDefaultTab, setAssetsModalDefaultTab] = useState<string | undefined>(undefined);
  const [assetsModalDefaultFilter, setAssetsModalDefaultFilter] = useState<string | undefined>(undefined);
  const [agentContext, setAgentContext] = useState<{
    text: string;
    label?: string;
    skillId?: string;
    skillName?: string;
    ts: number;
    mediaBlocks?: SessionContentBlock[];
  } | null>(null);
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
  const { visible: showTextGenDialog, boundId: textGenDraftId } = generationDock.panel('text');
  const [selectRequest, setSelectRequest] = useState<{ id: string; ts: number } | null>(null);
  const [selectManyRequest, setSelectManyRequest] = useState<{ ids: string[]; ts: number } | null>(null);
  const pendingGenRef = useRef<GenHandoff | null>(null);
  const pendingVideoDraftSeedRef = useRef<VideoGenSeedParams | null>(null);
  useEffect(() => {
    const state = location.state as { genKind?: 'video' | 'image' } | null;
    if (!state?.genKind) return;
    const handoff = takeGenHandoff();
    if (!handoff) {
      navigate(location.pathname + location.search, { replace: true, state: null });
      return;
    }
    if (handoff.kind === 'video') {
      pendingVideoDraftSeedRef.current = {
        modelId: handoff.modelId,
        aspectRatio: handoff.aspectRatio,
        resolution: handoff.resolution,
        duration: handoff.duration,
        mode: handoff.mode,
        generateAudio: handoff.generateAudio,
      };
    } else {
      generationDock.open('image', { seed: {
        ts: Date.now(), text: '', files: [],
        params: { modelId: handoff.modelId, ratio: handoff.ratio, size: handoff.size },
      } });
    }
    pendingGenRef.current = handoff;
    actionsRef.current.firePendingGen?.();
    actionsRef.current.firePendingVideoDraft?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, location.search, navigate]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1.1 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(() => { setLiveViewport(viewport); }, [viewport]);
  useEffect(() => {
    fetchGenerationModels('video').then(setVideoModels).catch(() => undefined);
    fetchGenerationModels('image').then(setImageModels).catch(() => undefined);
  }, []);
  const assetImageRefMax = imageReferenceMaxOf(
    (imageModels.find((m) => m.is_default) ?? imageModels[0])?.features,
  );
  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    const update = () => setWrapperSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useOverlayWheelPassthrough(canvasWrapperRef, { ignoreInsideReactFlow: true });
  const spawnPosRef = useRef<(screenPt?: { x: number; y: number }) => { x: number; y: number }>(
    () => ({ x: 300, y: 200 }),
  );
  const registerSpawnPosition = useCallback(
    (fn: (screenPt?: { x: number; y: number }) => { x: number; y: number }) => {
      spawnPosRef.current = fn;
    },
    [],
  );
  const spawnPosition = () => {
    const c = spawnPosRef.current();
    return {
      x: Math.round(c.x + (Math.random() * 160 - 80)),
      y: Math.round(c.y + (Math.random() * 160 - 80)),
    };
  };
  const spawnNearScreen = (screenPt: { x: number; y: number }) => {
    const center = spawnPosRef.current(screenPt);
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    return nextDraftPosition({ center, dockTop: center.y + 2000, nodes: nodes.map(nodeBoxOf) });
  };
  const DOCK_RESERVE_PX = 300;
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
  const selectedMediaToolbarNode = soloSelectedNodeId
    ? mediaNodes.find((n) => n.id === soloSelectedNodeId) ?? null
    : null;
  const enhancePanelToolbarNode = toolSessions.toolbarNode();
  const soloMediaToolbarNode = enhancePanelToolbarNode ?? selectedMediaToolbarNode;
  const showSoloMediaToolbar = soloMediaToolbarNode != null
    && mediaCardToolbarVisible(soloMediaToolbarNode.data ?? {});
  const hoverAssetToolbarNode = hoveredAssetNodeId
    ? assetNodes.find((n) => n.id === hoveredAssetNodeId) ?? null
    : null;
  const soloAssetToolbarNode = soloSelectedNodeId
    ? assetNodes.find((n) => n.id === soloSelectedNodeId) ?? null
    : null;
  const assetToolbarNode = hoverAssetToolbarNode ?? soloAssetToolbarNode;
  const spawnDraftPosition = () => {
    const center = spawnPosRef.current();
    const dockTop = spawnPosRef.current({ x: window.innerWidth / 2, y: window.innerHeight - DOCK_RESERVE_PX }).y;
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    return nextDraftPosition({ center, dockTop, nodes: nodes.map(nodeBoxOf) });
  };
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
  const linkAudioMixAssetsMutation = useMutation({
    mutationFn: (vars: { projectId: string; assetIds: string[] }) =>
      Promise.all(vars.assetIds.map((assetId) => linkAssetToProject(vars.projectId, assetId, { silent: true }))),
  });
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
  const [savedAt, setSavedAt] = useState('');
  const versionRef = useRef<number | null>(null);
  const lastSavedRef = useRef('');
  const retainedRecoverySaveRef = useRef<{
    projectId: string;
    commandId: string;
    recoveryChanges: RecoveryChange[];
    payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean };
    version: number | null;
    signature: string;
  } | null>(null);
  const pendingNodeIdsRef = useRef<Set<string>>(new Set());
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
  const productSeq = useRef(0);
  useEffect(() => {
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, [updateUser]);
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
  const lastTouchedProjectRef = useRef('');
  useEffect(() => {
    if (!currentId || lastTouchedProjectRef.current === currentId) return;
    if (!projects.some((p) => p.id === currentId)) return;
    lastTouchedProjectRef.current = currentId;
    touchProjectLastOpened(currentId).catch(() => undefined);
  }, [currentId, projects]);
  useEffect(() => {
    const fromQuery = readCanvasIdFromSearch(new URLSearchParams(location.search));
    if (fromQuery && audioMixInFlightRef.current && activeProjectRef.current && fromQuery !== activeProjectRef.current) {
      navigate({ pathname: location.pathname, search: canvasLocationSearch(new URLSearchParams(location.search), activeProjectRef.current) },
        { replace: true, state: location.state });
      return;
    }
    if (fromQuery && activeProjectRef.current && fromQuery !== activeProjectRef.current && blockedByPendingCanvasReview()) {
      navigate({ pathname: location.pathname, search: canvasLocationSearch(new URLSearchParams(location.search), activeProjectRef.current) },
        { replace: true, state: location.state });
      return;
    }
    if (fromQuery) setCurrentId(fromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname, location.state, navigate]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);
  const prevProjectIdRef = useRef(currentId);
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
    historyRef.current?.clear();
  }, [currentId, setAgentAssetPicks]);
  const { doc, assets: snapshotAssets, loadFailed: canvasLoadFailed, refetch, acceptDoc, legacyMigration, patchAsset, upsertAssets } = useCanvasDoc(currentId);
  const snapshotAssetsRef = useRef(snapshotAssets);
  snapshotAssetsRef.current = snapshotAssets;
  const historyQuery = useQuery({ ...legacyCardHistoryOptions(currentId), enabled: Boolean(doc && currentId) });
  const legacyHistory = historyQuery.data?.items;
  const [showLegacyHistory, setShowLegacyHistory] = useState(false);
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
  const attachCallbacks = (node: Node): Node => {
    const base: Node = { ...node, position: node.position ?? { x: 0, y: 0 }, data: { ...node.data, toolMode } };
    switch (node.type) {
      case 'textNode': {
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
          onLocateInputSource: (sourceNodeId: string) => locateTextSource(sourceNodeId),
        };
        break;
      case 'productNode':
        base.data = {
          ...base.data,
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
  const hydratedDocRef = useRef<typeof doc>(null);
  const hydratedProjectRef = useRef<string | null>(null);
  const confirmedNonEmptyRef = useRef(false);
  const emptyClearConflictRef = useRef(false);
  const emptyOverwriteRejectedRef = useRef(false);
  const recoverySaveConflictRef = useRef(false);
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
      emptyClearConflictRef.current = false;
      emptyOverwriteRejectedRef.current = false;
      recoverySaveConflictRef.current = false;
      setSaveStatus('idle');
      return;
    }    const docChanged = hydratedDocRef.current !== doc;
    hydratedDocRef.current = doc;
    if (!docChanged) {
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
    docLoadEpochRef.current = {};
    generationRuntimeRef.current?.reset();
    if (!canvasLoadFailed) {
      emptyClearConflictRef.current = false;
      emptyOverwriteRejectedRef.current = false;
      recoverySaveConflictRef.current = false;
    }
    const t: Node[] = [];
    const m: Node[] = [];
    const p: Node[] = [];
    const a: Node[] = [];
    const { groups: hydratedGroups, contentNodes } = parseGroupsFromNodes(doc.nodes);
    contentNodes.forEach((node) => {
      if (node.type === 'textNode') t.push(attachCallbacks(node));
      else if (node.type === 'mediaNode') m.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets, true)));
      else if (node.type === 'productNode') p.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets)));
      else if (node.type === 'assetNode') a.push(attachCallbacks(resolveNodeAssets(node, snapshotAssets)));
      else {
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
    versionRef.current = doc.version;
    setViewport(doc.viewport);
    const hydratedAll = [...t, ...m, ...p, ...a];
    const upgradedTextNodes = contentNodes.some(
      (node) => node.type === 'textNode' && typeof (node.data as Record<string, unknown> | undefined)?.html === 'string',
    );
    lastSavedRef.current = upgradedTextNodes
      ? ''
      : JSON.stringify(doc.viewport) +
        serializeNodes([...hydratedAll, ...hydratedGroups.map((g) => groupToNode(g))]) +
        serializeEdges(hydratedEdges);
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
    m
      .filter(
        (n) =>
          ((n.data ?? {}) as Record<string, unknown>).frameInterpolation != null,
      )
      .forEach((n) => recoverFrameInterpolationRef.current(n.id, n.data.jobId));
    if (currentId && !canvasLoadFailed) void generationRuntimeRef.current?.recover(currentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, snapshotAssets]);
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
  useEffect(() => {
    if (!currentId || !doc || applyingRef.current) return;
    const timer = window.setTimeout(() => {
      if (applyingRef.current || savePromiseRef.current) return;
      if (hydratedProjectRef.current === null) return;
      if (textNodesRef.current.some(node => draftErrorsRef.current.has(node.id))) return;
      const contentNodes = [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes];
      const nodes = [...contentNodes, ...groups.map((g) => groupToNode(g))];
      const sig = JSON.stringify(viewport) + serializeNodes(nodes) + serializeEdges(edges);
      if (sig === lastSavedRef.current) return;
      if (emptyClearConflictRef.current || emptyOverwriteRejectedRef.current || recoverySaveConflictRef.current) return;
      if (import.meta.env.DEV) {
        console.info(`[canvas] 自动保存：${nodes.length} 个节点 / ${edges.length} 条连线（version=${versionRef.current}）`);
      }
      lastSavedRef.current = sig;
      setSaveStatus('saving');
      const confirmEmpty = shouldConfirmEmptyClear(nodes);
      const pendingSnapshot = new Set(pendingNodeIdsRef.current);
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
            settleSavedCanvas(plan, sig, () => pendingSnapshot.forEach((id) => pendingNodeIdsRef.current.delete(id)));
            setSaveBlocked(false);
            setSaveStatus(textNodesRef.current.some(node => draftErrorsRef.current.has(node.id)) ? 'error' : 'saved');
            setSaveEpoch(value => value + 1);
            setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
          })
          .catch((e) => {
            lastSavedRef.current = '';
            if (recoveryFields) settleRetainedRecoverySave(currentId, recoveryFields.commandId, e);
            const hadPendingAdds = pendingSnapshot.size > 0 && plan.sentSignature === sig;
            const recoveryReason = readRecoveryErrorReason(e);
            if (recoveryFields && recoveryReason === 'recovery_item_conflict') {
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
            if (!recoveryFields && readRecoveryErrorReason(e) === 'recovery_protocol_required') {
              void generationRuntimeRef.current?.recover(currentId);
              setSaveBlocked(true);
              setSaveStatus('error');
              showToast('warn', '画布包含任务恢复保护内容，正在同步状态，请稍后重试保存');
              return;
            }
            const aligned = adoptCanvasConflictVersion(e);
            if (aligned) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textNodes, mediaNodes, productNodes, assetNodes, edges, groups, viewport, currentId, doc, refetch, applying, saveEpoch, rollbackPendingNodes, showToast]);
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
      const mentionedSources = [...new Set(((copy.data.mediaMentions ?? []) as MediaMention[]).map(mention => mention.nodeId))]
        .filter(source => findCanvasNode(source));
      if (mentionedSources.length > 0) syncTextIndexEdges(copy.id, { added: mentionedSources, removed: [] });
      return;
    }
    const m = mediaNodesRef.current.find((n) => n.id === id);
    if (m) {
      const copy: Node = { ...m, id: newNodeId('media'), position: { x: m.position.x + 40, y: m.position.y + 40 }, data: { ...m.data } };
      delete (copy.data as Record<string, unknown>).generationRecovery;
      pendingNodeIdsRef.current.add(copy.id);
      historyRef.current?.pushAddNodes([copy.id]);
      setMediaNodes((prev) => [...prev, copy]);
    }
  };
  const renameCard = (id: string, name: string) => {
    if (textNodesRef.current.some((n) => n.id === id)) {
      setTextNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, title: name, customName: true } } : n)));
      return;
    }
    if (mediaNodesRef.current.some((n) => n.id === id)) {
      setMediaNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, fileName: name, customName: true } } : n)));
    }
  };
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
  const complianceCheckRef = useRef<((id: string) => void) | undefined>(undefined);
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
    fixFollowVideo: (_id: string) => {},
    removeMediaNode: (_id: string) => {},
    download: (_id: string) => {},
    showDetails: (_id: string) => {},
    firePendingGen: () => {},
    firePendingVideoDraft: () => {},
    renameCard: (_id: string, _name: string) => {},
  });
  actionsRef.current = { ...actionsRef.current, duplicate: handleDuplicateNode, addToChat: handleAddToChatNode, renameCard };
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
  const {
    handleImagePickSessionClick,
    handleVideoPickSessionClick,
    handleAudioPickSessionClick,
    resetPickState,
  } = useCanvasPickSessionClick({
    mediaNodesRef,
    showToast,
    pickMode,
    pickRefRole,
    imagePickSession,
    videoPickSession,
    audioPickSession,
    endImagePickSession,
    endVideoPickSession,
    endAudioPickSession,
    connectPair,
    addCanvasEdge,
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
    videoCapsOfDraft,
    edgesRef,
    videoFreeRefs,
    removeRefEdges: (draftId, sourceNodeId) => removeRefEdges(draftId, sourceNodeId),
    removeDraftMaterialRef: (draftId, materialId) => removeDraftMaterialRef(draftId, materialId),
    appendVideoFreeRef: (item, role) => appendVideoFreeRef(item, role),
    replaceFreeReference: (item, role) => generationDock.updateDraft('video', { freeReference: { operation: 'replace', item, role } }),
    setPickMode,
    setPickTarget,
    setPickRefRole,
    setPickProductId,
    setPickAssetId,
    setImagePickResult,
    setAudioPickResult,
  });
  const handleCanvasNodeClick = (node: Node) => {
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
    if (imagePickSessionActive) {
      handleImagePickSessionClick(node);
      return;
    }
    if (videoPickSessionActive) {
      handleVideoPickSessionClick(node);
      return;
    }
    if (audioPickSessionActive) {
      handleAudioPickSessionClick(node);
      return;
    }
    if (!pickMode || !pickTarget) {
      const data = (node.data ?? {}) as Record<string, unknown>;
      if (
        node.type === 'mediaNode' &&
        isInPlaceRegenTarget(node) &&
        (saveBlocked || saveStatus === 'error') &&
        node.id !== editingTargetRef.current
      ) {
        showToast('warn', '保存失败，请重试');
        return;
      }
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
        openMediaDraftDialog(node.id, data.mediaType);
      }
      return;
    }
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (pickTarget === 'video' && (pickRefRole === 'first' || pickRefRole === 'last')
      && (node.type !== 'mediaNode' || data.mediaType !== 'image')) {
      showToast('warn', '首尾帧仅支持图片素材');
      return;
    }
    if (node.type === 'textNode' && pickTarget === 'video') {
      if (!videoDraftId) {
        showToast('warn', '文本参考需要绑定生成节点');
        return;
      }
      if (!connectPair(node.id, videoDraftId)) return;
      generationDock.referencePicked('video');
      setPickMode(null);
      setPickTarget(null);
      setPickRefRole(null);
      return;
    }
    if (pickTarget === 'video' && (pickMode === 'image' || pickMode === 'video')) {
      const isFrameSlot = pickRefRole === 'first' || pickRefRole === 'last';
      if ((isFrameSlot || pickMode === 'image') && (node.type !== 'mediaNode' || data.mediaType !== 'image')) {
        if (node.type === 'mediaNode') {
          showToast('warn', isFrameSlot ? '首尾帧仅支持图片素材' : PANEL_REF_MEDIA_TYPES.videoText2Video.canvasRefError);
          return;
        }
      } else if (videoDraftId) {
        if (node.type === 'mediaNode' && validateVideoRefConnect(node.id, videoDraftId, pickRefRole ?? undefined)) {
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
    if (isReadyMedia && data.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    if (isReadyMedia && (data.src as string).startsWith('blob:')) {
      showToast('warn', '素材上传中，请稍候再选择');
      return;
    }
    if (pickMode === 'product' && isReadyMedia && data.mediaType === 'image') {
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
  const buildToolSessionDeps = (): ToolSessionDeps => ({
    dismissGenPanels,
    selectNode: (nodeId) => setSelectRequest({ id: nodeId, ts: Date.now() }),
  });
  const editSessionActive = toolRuntime.hasEditSession();
  const exitEditSessionForGenPanel = () => {
    toolRuntime.beforeGenPanel();
  };
  const handleCanvasPaneClick = () => {
    cancelAgentCandidate();
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
  const handleSelectionChange = ({ nodes }: OnSelectionChangeParams) => {
    const candidates = nodes.filter((n) => {
      const m = mediaNodesRef.current.find((x) => x.id === n.id);
      if (!m || m.selected !== false) return true;
      return !nodes.some((other) => mediaNodesRef.current.find((x) => x.id === other.id)?.selected === true);
    });
    const soloId = candidates.length === 1 ? candidates[0]!.id : null;
    setSoloSelectedNodeId(soloId);
    if (pickMode || pickTarget) return;
    if (toolRuntime.onSelectionChange(
      { soloId, multiSelect: candidates.length > 1 },
    )) return;
    if (soloId && !editSessionActive) {
      const mediaNode = mediaNodesRef.current.find((n) => n.id === soloId);
      const mediaData = (mediaNode?.data ?? {}) as Record<string, unknown>;
      const toolDraft = mediaNode && toolSessions.draft(mediaNode);
      if (mediaNode && !mediaData.audioVideoMux && (
        mediaData.draft === true
        || hasGenerationRecord(mediaNode)
        || Boolean(toolDraft)
      )) {
        const mediaType = mediaData.mediaType;
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
  const handleSelectionChangeRef = useRef(handleSelectionChange);
  handleSelectionChangeRef.current = handleSelectionChange;
  const handleSelectionChangeStable = useCallback(
    (params: OnSelectionChangeParams) => handleSelectionChangeRef.current(params),
    [],
  );
  const anyGenPanelOpen = generationDock.view.activePanel !== null;
  useEffect(() => {
    if (!anyGenPanelOpen) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyGenPanelOpen]);
  useEffect(() => {
    if (!anyGenPanelOpen && !toolRuntime.hasEscExitSession()) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-canvas-keyboard-scope="mention"]')) return;
      if (isEditableKeyboardTarget(event.target)) return;
      if (toolRuntime.escDefersToToolSessionHandler()) return;
      if (imagePickSessionActive || videoPickSessionActive || audioPickSessionActive) return;
      if (pickMode || pickTarget) {
        resetPickState();
        return;
      }
      if (toolRuntime.onEscape()) return;
      dismissAllGenPanels();
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyGenPanelOpen, editSessionActive, imagePickSessionActive, videoPickSessionActive, audioPickSessionActive, pickMode, pickTarget]);
  const handleNodeDragStop = (_node: Node, draggedNodes: Node[]) => {
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
    if (groupsRef.current.length > 0) {
      setGroups((prev) => applyDraggedNodesToGroups(prev, before, draggedNodes, positions));
    }
  };
  actionsRef.current.openImageDialog = () => generationDock.open('image', {});
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
  useEffect(() => {
    toolRuntime.reconcileSources(new Set(mediaNodes.map((node) => node.id)));
  }, [toolRuntime, mediaNodes]);
  useEffect(() => {
    if (imagePickSession !== undefined && !showImageDialog) endImagePickSession();
    if (videoPickSession !== undefined && !showBottomDialog) endVideoPickSession();
    if (audioPickSession !== undefined && !showAudioDialog) endAudioPickSession();
    if (
      imagePickSession === undefined
      && videoPickSession === undefined
      && audioPickSession === undefined
    ) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      if (imagePickSession !== undefined) endImagePickSession();
      if (videoPickSession !== undefined) endVideoPickSession();
      if (audioPickSession !== undefined) endAudioPickSession();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    showImageDialog,
    showBottomDialog,
    showAudioDialog,
    imagePickSession,
    videoPickSession,
    audioPickSession,
    endImagePickSession,
    endVideoPickSession,
    endAudioPickSession,
  ]);
  useEffect(() => { generationDock.reconcile(); }, [generationDock, textGenDraftId, textNodes]);
  const openVideoDraftDialog = (nodeId: string, preset?: VideoGenSeedParams) => generationDock.open('video', { nodeId, preset });
  const createVideoDraftCard = (seed?: {
    modelId?: string;
    ratio?: string;
    size?: string;
    duration?: number;
    mode?: string;
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
        draftMode: seed?.mode ?? defaultVideoModeFor({ reference: [] }),
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
    toolSessions.wireStart(null);
    const from = fromId ? findCanvasNode(fromId) ?? state?.fromNode ?? undefined : undefined;
    if (!from) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const handleNodeId = state?.toHandle?.nodeId ?? null;
    const droppedId =
      (handleNodeId && handleNodeId !== from.id && findCanvasNode(handleNodeId) ? handleNodeId : null)
      ?? (state?.toNode && state.toNode.id !== from.id && findCanvasNode(state.toNode.id) ? state.toNode.id : null)
      ?? canvasNodeIdAtScreen(point.clientX, point.clientY);
    if (droppedId && droppedId !== from.id) {
      connectPair(from.id, droppedId);
      return;
    }
    if (!isConnectableSource(from)) return;
    if (state?.isValid) return;
    openConnectTypeMenu([from.id], point.clientX, point.clientY);
  };
  const handleConnectGroupDrop = (
    memberIds: string[],
    _targetId: string | null,
    client: { x: number; y: number },
  ) => {
    const sources = memberIds.filter((id) => isConnectableSource(findCanvasNode(id)));
    if (sources.length === 0) return;
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
    if (isAudioVideoMuxDraftNode(targetNode)) return audioVideoMuxVideoError(sourceNode) === null;
    if (wouldCreateCycle(connection.source, connection.target, edgesRef.current)) return false;
    const kind = genKindOf(targetNode);
    if (kind === 'image' && sourceNode.type === 'mediaNode') {
      return imageRefSourceError(sourceNode) === null;
    }
    if (!isConnectableSource(sourceNode)) return false;
    if (kind && !canConnectSourcesToGen([sourceNode], kind)) return false;
    return true;
  };
  useEffect(() => { generationDock.reconcile(); }, [generationDock, videoDraftId, videoSeed, mediaNodes]);
  const openAudioDraftDialog = (nodeId: string) => generationDock.open('audio', { nodeId });
  useEffect(() => { generationDock.reconcile(); }, [generationDock, audioDraftId, audioSeed, mediaNodes]);
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
  const videoModelsRef = useRef<GenerationModel[]>([]);
  videoModelsRef.current = videoModels;
  const imageModelsRef = useRef<GenerationModel[]>([]);
  imageModelsRef.current = imageModels;
  const textNodesRef = useRef<Node[]>([]);
  textNodesRef.current = textNodes;
  const assetNodesRef = useRef<Node[]>([]);
  assetNodesRef.current = assetNodes;
  const productNodesRef = useRef<Node[]>([]);
  productNodesRef.current = productNodes;
  const {
    assetDetailTarget,
    assetDetailLoading,
    handleCloseAssetDetail,
    handleNodeShowDetails,
    handleNodeDownload,
    handleDownloadGroupNodes,
    handleSaveMediaToAssets,
    handleSaveTextToAssets,
    handleSaveCardToAssets,
    handleSaveGoodsToAssets,
  } = useCanvasAssetActions({
    mediaNodesRef,
    textNodesRef,
    productNodesRef,
    assetNodesRef,
    showToast,
  });
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
    onNodesRemoved: (ids) => ids.forEach((id) => pendingNodeIdsRef.current.delete(id)),
  });
  historyRef.current = canvasHistory;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasHistory.undo, canvasHistory.redo]);
  const locallyRemovedGenerationNodesRef = useRef<Set<string>>(new Set());
  const settledExtractNodesRef = useRef<Set<string>>(new Set());
  const activeJobByNodeRef = useRef<Map<string, string>>(new Map());
  const generationRuntimeHostRef = useRef<GenerationRuntimeHost | null>(null);
  const generationRuntimeRef = useRef<GenerationRuntime | null>(null);
  const {
    flushCanvasSave,
    handleRetryCanvasSave,
    ensureSavedBeforeProjectSwitch,
    blockedByPendingCanvasReview,
    shouldConfirmEmptyClear,
    planRecoverySave,
    trackCanvasSave,
    settleSavedCanvas,
    adoptCanvasConflictVersion,
    settleRetainedRecoverySave,
  } = useCanvasSave({
    activeProjectRef,
    hydratedProjectRef,
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    groupsRef,
    edgesRef,
    draftErrorsRef,
    versionRef,
    lastSavedRef,
    retainedRecoverySaveRef,
    pendingNodeIdsRef,
    savePromiseRef,
    generationRuntimeRef,
    confirmedNonEmptyRef,
    emptyClearConflictRef,
    emptyOverwriteRejectedRef,
    recoverySaveConflictRef,
    viewportRef,
    setSaveEpoch,
    setSaveStatus,
    setSaveBlocked,
    setSavedAt,
    saveBlocked,
    submittingNodeId,
    audioMixInFlightRef,
    currentId,
    doc,
    applyingRef,
    blockInvalidDraft,
    showToast,
  });
  const {
    handleSelect,
    handleRename,
    handleToggleProjectPin,
    handleDelete,
    handleNewProject,
  } = useCanvasProjects({
    currentId,
    setCurrentId,
    projects,
    setProjects,
    ensureSavedBeforeProjectSwitch,
  });
  const { handleComplianceCheck } = useCanvasCompliance({
    setMediaNodes,
    mediaNodesRef,
    snapshotAssetsRef,
    patchAsset,
    showToast,
  });
  complianceCheckRef.current = (id) => { void handleComplianceCheck(id); };
  const docLoadEpochRef = useRef<object>({});
  const imageToolsAcceptanceRef = useRef(new Map<string, { resolve: (jobId: string) => void; reject: (e: unknown) => void }>());
  const imageToolsTask = useMemo(() => createImageToolsTask((nodeId, settled) => {
    const pending = imageToolsAcceptanceRef.current.get(nodeId);
    if (!pending) return;
    imageToolsAcceptanceRef.current.delete(nodeId);
    if ('jobId' in settled) pending.resolve(settled.jobId);
    else pending.reject(settled.error);
  }), []);
  useEffect(() => {
    const activeJobs = activeJobByNodeRef.current;
    return () => {
      activeJobs.clear();
      generationRuntimeRef.current?.reset();
    };
  }, []);
  const patchMediaNode = (nodeId: string, patch: Record<string, unknown>) => {
    setMediaNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  };
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
  const { handleAssetsPickerSelect } = useCanvasAssetsPlacement({
    currentId,
    toolMode,
    mediaNodesRef,
    textNodesRef,
    edgesRef,
    pendingNodeIdsRef,
    actionsRef,
    setMediaNodes,
    spawnPosition,
    dockToolCallbacks,
    handleMediaDims,
    handleSaveMediaToAssets,
    addCanvasEdge,
    validateVideoRefConnect,
    videoCapsOfDraft,
    imageRefMaxOfDraft,
    videoFreeRefs,
    appendVideoFreeRef: (item, role) => appendVideoFreeRef(item, role),
    showToast,
    assetsPickerTarget,
    setShowAssetsPicker,
    videoAssetPickRole,
    videoDraftId,
    audioDraftId,
    audioAssetPickTarget,
    audioSeed,
    isGeneratingNode,
    imageDraftId,
    showAudioDialog,
    setAudioAssetPickResult,
    setImagePickResult,
    setAgentAssetPicks,
  });
  const {
    placeFileOnCanvas,
    handleUploadFile,
    handleCopyImage,
    handleFillEmptyShell,
    applyClipboardAtFlow,
  } = useCanvasUploadDrop({
    currentId,
    toolMode,
    spawnPosition,
    handleMediaDims,
    handleSaveMediaToAssets,
    dockToolCallbacks,
    actionsRef,
    setMediaNodes,
    pendingNodeIdsRef,
    historyRef,
    upsertAssets,
    mediaNodesRef,
    handleAddTextNode,
    showToast,
  });
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
    complianceCheck: (id) => { void complianceCheckRef.current?.(id); },
    fillEmptyShell: handleFillEmptyShell,
  };
  const { handleCopySelectedNodes, handlePasteClipboard } = useCanvasClipboard({
    currentId,
    textNodesRef,
    mediaNodesRef,
    setTextNodes,
    setMediaNodes,
    pendingNodeIdsRef,
    historyRef,
    spawnPosRef,
    attachCallbacks,
    findCanvasNode,
    syncTextIndexEdges,
    setSelectManyRequest,
    placeFileOnCanvas,
    handleAddTextNode,
  });
  const recoverFrameInterpolationRef = useRef<(nodeId: string, savedJobId?: unknown) => void>(() => {});
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
          onCreateFailure: (e: unknown) => { reject(e); return false; },
        },
      );
      if (!dispatched) {
        imageToolsAcceptanceRef.current.delete(target.targetNodeId);
        reject(new Error('任务提交中，请勿重复发送'));
      }
    });
  };
  const startImageEnhanceJob = async (submission: ImageEnhanceSubmission, silent = false): Promise<void> => {
    const { nodeId, payload: input, identity } = submission;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const isDraftTarget = ((node?.data ?? {}) as Record<string, unknown>).draft === true;
    patchMediaNode(nodeId, {
      genStatus: 'generating',
      progress: 0,
      errorText: undefined,
      ...(isDraftTarget && !hasCustomName(node) ? { fileName: '高清生成中' } : {}),
      imageEnhance: { ...identity, lastParams: input },
    });
    const target = imageToolTargetOfNode(nodeId);
    if (!target) throw new Error('高清目标卡不存在');
    try {
      await dispatchImageToolTask({ kind: 'imageEnhance', input }, target);
    } catch (error) {
      if (!silent || !isSilentAuthError(error)) throw error;
    }
  };
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
    createTask: ({ source, payload }) => {
      const target = imageToolTargetBesideSource(source, '擦除', payload.target_node_id);
      return dispatchImageToolTask({ kind: 'imageErase', input: payload }, target).then((job_id) => ({ job_id }));
    },
    handoff: handoffImageEraseTask,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
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
    createTask: ({ source, payload }) => {
      const target = imageToolTargetBesideSource(source, '抠图', payload.target_node_id);
      return dispatchImageToolTask({ kind: 'imageCutout', input: payload }, target).then((job_id) => ({ job_id }));
    },
    handoff: handoffCutoutTask,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
  const handleCancelJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (node && generationRuntimeRef.current?.claims(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      generationRuntimeRef.current.cancel(nodeId);
      return;
    }
  };
  const pendingDeleteJobNodesRef = useRef<Set<string>>(new Set());
  const removeMediaNodeNow = (nodeId: string) => {
    setMediaNodes((prev) => {
      const target = prev.find((n) => n.id === nodeId);
      const src = target?.data?.src;
      if (typeof src === 'string' && src.startsWith('blob:')) URL.revokeObjectURL(src);
      return prev.filter((n) => n.id !== nodeId);
    });
  };
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
  const { applyJobTerminal, settleCancelledNode, jobResponseGuarded, rememberGeneratedAsset } =
    useCanvasGenerationTerminal({
      mediaNodesRef,
      locallyRemovedGenerationNodesRef,
      pendingDeleteJobNodesRef,
      settledExtractNodesRef,
      activeJobByNodeRef,
      generationRuntimeRef,
      setMediaNodes,
      upsertAssets,
      patchMediaNode,
      removeAudioMixCardNow,
      showToast,
      edgesRef,
      textNodesRef,
      productNodesRef,
      assetNodesRef,
      currentId,
      attachCallbacks,
      addCanvasEdge,
      nodeBoxOf,
      flushCanvasSave: (projectId) => flushCanvasSave(projectId),
    });
  const {
    startGenerationJob,
    handleFinalizeSample,
    handleRegenerateSample,
    finalizeCtaByNodeId,
    regenerateCtaByNodeId,
  } = useCanvasGenerationSubmission({
    mediaNodesRef,
    locallyRemovedGenerationNodesRef,
    pendingDeleteJobNodesRef,
    settledExtractNodesRef,
    activeJobByNodeRef,
    generationRuntimeRef,
    setMediaNodes,
    upsertAssets,
    patchMediaNode,
    removeAudioMixCardNow,
    showToast,
    edgesRef,
    textNodesRef,
    productNodesRef,
    assetNodesRef,
    currentId,
    attachCallbacks,
    addCanvasEdge,
    nodeBoxOf,
    flushCanvasSave: (projectId) => flushCanvasSave(projectId),
    mediaNodes,
    setEdges,
    actionsRef,
    toolMode,
    blockInvalidDraft,
    spawnPosition,
    textAttachmentsForSend: (targetNodeId) => textAttachmentsForSend(targetNodeId),
    handleMediaDims,
    handleSaveMediaToAssets: (nodeId) => handleSaveMediaToAssets(nodeId),
    dockCallbacks: dockToolCallbacks,
  });
  const deleteGeneratingNode = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (node && generationRuntimeRef.current?.claims(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      generationRuntimeRef.current.remove(nodeId);
      return;
    }
    removeMediaNodeNow(nodeId);
  };
  const removeCanvasNodes = (ids: string[]) => {
    if (ids.length === 0) return;
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
    removedNodes.forEach((n) => {
      const src = (n.data as Record<string, unknown> | undefined)?.src;
      if (typeof src === 'string' && src.startsWith('blob:')) URL.revokeObjectURL(src);
    });
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
    if (undoableNodes.length > 0) {
      historyRef.current?.pushDelete(undoableNodes, undoableEdges, undefined, {
        before: edgesRef.current.filter(e =>
          (undoableIds.has(e.source) || survivingIds.has(e.source)) &&
          (undoableIds.has(e.target) || survivingIds.has(e.target))),
        after: remainingEdges,
      });
    }
    idSet.forEach((id) => pendingNodeIdsRef.current.delete(id));
    const filter = (prev: Node[]) => prev.filter((n) => !idSet.has(n.id));
    setTextNodes(filter);
    setMediaNodes(filter);
    setProductNodes(filter);
    setAssetNodes(filter);
    if (removedEdges.length > 0) {
      setEdges(remainingEdges);
    }
    if (Array.from(idSet).some(isAudioMixNodeId)) {
      mediaNodesRef.current = filter(mediaNodesRef.current);
      edgesRef.current = remainingEdges;
      if (currentId) void flushCanvasSave(currentId).catch(() => {});
    }
  };
  const {
    handleCreateProduct,
    handleCreateAssetCard,
    handleProductChange,
    handleCardChange,
    handleAddSharedAsset,
  } = useCanvasNodeFactories({
    newNodeId,
    spawnPosition,
    toolMode,
    currentId,
    productSeq,
    pendingNodeIdsRef,
    actionsRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    removeCanvasNodes,
    handleMediaIndexChange,
    handleMediaDims,
    handleAssetHoverChange,
    handleSaveMediaToAssets,
    handleSaveTextToAssets,
    handleSaveCardToAssets,
    handleSaveGoodsToAssets,
    dockToolCallbacks,
    showToast,
    pickers: { setPickMode, setPickTarget, setPickProductId, setPickAssetId },
  });
  /* ============ 成组交互（IKD0JT A3/A4） ============ */
  const {
    handleCreateGroup,
    handleGroupFrameDragStop,
    handleBringGroupToFront,
    handleUngroup,
    handleDeleteGroup,
    confirmDeleteGroup,
  } = useCanvasGroupActions({
    setGroups,
    groupsRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    historyRef,
    pendingDeleteGroup,
    setPendingDeleteGroup,
    removeCanvasNodes,
    showToast,
  });
  const handleRemoveMediaNode = (nodeId: string) => {
    removeCanvasNodes([nodeId]);
  };
  const handleRetryJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | string | undefined;
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
    if (node && isImageToolsCard(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      if (jobId != null) {
        generationRuntimeRef.current?.retry(nodeId);
        return;
      }
      const payload = imageToolsRetryPayloadOf(nodeId, (node.data ?? {}) as Record<string, unknown>);
      if (!payload) {
        showToast('warn', '原任务输入已不可信，请重新编辑后再发送');
        return;
      }
      const target = imageToolTargetOfNode(nodeId);
      if (!target) return;
      patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '', errorCode: undefined });
      dispatchImageToolTask(payload, target).catch(() => {});
      return;
    }
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
  const textAttachmentsForSend = (targetNodeId: string): ImageTextAttachment[] =>
    textAttachmentsOf(targetNodeId).map((att) => {
      const node = textNodesRef.current.find((n) => n.id === att.nodeId);
      const mentions = Array.isArray(node?.data.mediaMentions) ? (node.data.mediaMentions as MediaMention[]) : [];
      const refs = Array.isArray(node?.data.mediaRefs) ? (node.data.mediaRefs as MediaRef[]) : [];
      const imageNodeIds = new Set(refs.filter((ref) => ref.mediaType === 'image').map((ref) => ref.nodeId));
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
  const { reorderTargetEdges, refStripOrderOf, handleRefStripOrderChange, handleReorderAttachments, handleReorderVideoMediaRefs, reorderVideoFreeRefs } = useCanvasRefStripOrder({
    setEdges,
    edgesRef,
    mediaNodesRef,
    edges,
    mediaNodes,
    textNodes,
    isGeneratingNode,
    patchMediaNode,
    textAttachmentsOf,
    generationDock,
  });
  const planReferenceErrors = useMemo(() => {
    const videoRefs = videoSeed?.targetNodeId
      ? mergedVideoRefsWithTextIndex(videoSeed.targetNodeId, edges, mediaNodes, textNodes)
      : { reference: [] };
    const videoAvailableIds = [...videoRefs.reference, ...(videoRefs.first ? [videoRefs.first] : []), ...(videoRefs.last ? [videoRefs.last] : [])]
      .flatMap((ref) => videoRefIdentityIds(ref));
    return {
      image: planReferenceErrorFor(
        imageSeed?.targetNodeId,
        imageSeed?.targetNodeId
          ? mergedImageRefsOf(imageSeed.targetNodeId, edges, [...mediaNodes, ...textNodes]).map((ref) => ref.assetId)
          : [],
        edges,
        textNodes,
      ),
      videoIndices: edges.filter(e => e.target === videoSeed?.targetNodeId).flatMap(e => {
        const plan = textNodes.find(n => n.id === e.source && n.data.promptSource);
        const mentions = promptMentionSchema.array().safeParse(plan?.data.promptMentions ?? []);
        return mentions.success ? promptBindingList(mentions.data).map(m => `#${m.index}`) : [];
      }).join('、'),
      video: planReferenceErrorFor(videoSeed?.targetNodeId, videoAvailableIds, edges, textNodes),
    };
  }, [imageSeed?.targetNodeId, videoSeed?.targetNodeId, edges, mediaNodes, textNodes]);
  const pendingPlanSyncs = (targetId: string | undefined) => pendingPlanSyncsOf(targetId, edges, textNodes);
  const syncPlanToTarget = (planNodeId: string, targetId: string | undefined) => {
    const pending = pendingPlanSyncs(targetId).find(plan => plan.nodeId === planNodeId);
    if (pending && targetId) connectPlanToDraft(planNodeId, targetId);
  };
  const imagePickMarkedIds = useMemo(
    () => pickMarkedIdsFor(imagePickSession, imagePickSessionActive, edges, textNodes),
    [imagePickSessionActive, imagePickSession, edges, textNodes],
  );
  const videoPickMarkedIds = useMemo(
    () => pickMarkedIdsFor(videoPickSession, videoPickSessionActive, edges, textNodes, pickRefRole ?? 'reference'),
    [videoPickSessionActive, videoPickSession, pickRefRole, edges, textNodes],
  );
  const videoPickBlockedIds = useMemo(() => complianceBlockedIds(mediaNodes), [mediaNodes]);
  const audioPickMarkedIds = useMemo(
    () => pickMarkedIdsFor(audioPickSession, audioPickSessionActive, edges, textNodes),
    [audioPickSessionActive, audioPickSession, edges, textNodes],
  );
  const locateTextSource = useCallback((nodeId: string) => {
    const target = findCanvasNode(nodeId);
    if (!target) return;
    const width = (target as Node & { measured?: { width?: number } }).measured?.width ?? 360;
    const height = (target as Node & { measured?: { height?: number } }).measured?.height ?? 270;
    setFocusViewport({ x: window.innerWidth / 2 - (target.position.x + width / 2), y: window.innerHeight / 2 - (target.position.y + height / 2), zoom: 1 });
    setSelectRequest({ id: nodeId, ts: Date.now() });
  }, []);
  const removeRefEdges = (draftId: string, sourceNodeId: string) => {
    if (isGeneratingNode(draftId)) return;
    removeTargetInputs(edgesRef.current.filter(edge => edge.source === sourceNodeId && edge.target === draftId).map(edge => edge.id));
  };
  const handleAddAudioCanvasRef = (nodeId: string) => {
    if (!audioDraftId) return;
    if (!validateAudioRefConnect(nodeId, audioDraftId)) return;
    addCanvasEdge(nodeId, audioDraftId);
  };
  const removeDraftMaterialRef = (draftId: string, materialId: string) => {
    const existing = readDraftMaterialRefs(mediaNodesRef.current.find((n) => n.id === draftId));
    patchMediaNode(draftId, {
      draftMaterialRefs: existing.filter((m) => m.materialId !== materialId),
    });
  };
  const assignVideoRefRoles = (
    draftId: string,
    assignments: Array<{ nodeId: string; role: VideoRefRole }>,
  ) => {
    if (assignments.length === 0) return;
    const roleByKey = new Map(assignments.map((a) => [a.nodeId, a.role]));
    const prevEdges = edgesRef.current;
    let edgesChanged = false;
    const nextEdges = prevEdges.map((e) => {
      if (e.target !== draftId) return e;
      const role = roleByKey.get(e.source);
      if (!role) return e;
      const currentRole = (e.data as Record<string, unknown> | undefined)?.refRole;
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
  const appendVideoFreeRef = (item: VideoMediaRef, role: VideoRefRole) => generationDock.updateDraft('video', { freeReference: { operation: 'add', item, role } });
  const removeVideoFreeRef = (key: string) => generationDock.updateDraft('video', { freeReference: { operation: 'remove', key } });
  const assignVideoFreeRefRoles = (assignments: Array<{ nodeId: string; role: VideoRefRole }>) => generationDock.updateDraft('video', { freeReference: { operation: 'assign', assignments } });
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
  const handleVideoEnhanceParamsChange = (nodeId: string, resolution: VideoEnhanceResolution) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).videoEnhance as VideoEnhanceIdentity | undefined;
    patchMediaNode(nodeId, {
      videoEnhance: { ...identity, lastParams: { resolution } },
    });
  };
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
  const handleFrameInterpolationParamsChange = (nodeId: string, fps: FrameInterpolationFps) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).frameInterpolation as FrameInterpolationIdentity | undefined;
    patchMediaNode(nodeId, {
      frameInterpolation: { ...identity, lastParams: { fps } },
      ...(hasCustomName(node) ? {} : { fileName: frameInterpolationDisplayName(fps) }),
    });
  };
  const startFrameInterpolationJob = async (submission: FrameInterpolationSubmission): Promise<boolean> => {
    const { nodeId, payload: input, identity } = submission;
    const fps = input.fps;
    toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: undefined });
    const sent = submitVideoToolTask({ kind: 'frameInterpolation', input }, nodeId, {
      onAccepted: () => {
        const current = (mediaNodesRef.current.find((node) => node.id === nodeId)?.data.frameInterpolation as FrameInterpolationIdentity | undefined);
        patchMediaNode(nodeId, {
          frameInterpolation: { ...identity, lastParams: current?.lastParams, frozenParams: { fps } },
        });
      },
      onCreateFailure: (e: unknown) => {
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
          patchMediaNode(nodeId, { frameInterpolation: { ...identity, recoveryBlocked: undefined } });
        }
        if (current.status === 'queued' || current.status === 'processing') {
          patchMediaNode(nodeId, {
            genStatus: 'generating',
            progress: current.progress,
            errorText: undefined,
            jobId: current.job_id,
          });
          generationRuntimeRef.current?.resumeFromHydration(nodeId, String(current.job_id), (node.data ?? {}) as Record<string, unknown>);
          return;
        }
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
  const startVideoEnhanceJob = async (submission: VideoEnhanceSubmission): Promise<void> => {
    const { nodeId, payload: input, identity } = submission;
    const finish = beginVideoEnhanceSubmission(nodeId);
    return new Promise<void>((resolve, reject) => {
      const submitted = submitVideoToolTask({ kind: 'videoEnhance', input }, nodeId, {
        replaceSubmitting: true,
        onAccepted: () => {
          finish();
          patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: undefined });
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
            onCreateFailure: () => {
              patchMediaNode(draftId, {
                genStatus: 'draft', progress: undefined, errorText: undefined,
                jobId: undefined, generationRecovery: undefined,
              });
              return true;
            },
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
      if (mediaNodesRef.current.some((node) => node.id === draftId)) {
        patchMediaNode(draftId, { genStatus: 'generating', progress: 0, errorText: undefined });
      }
      void flushCanvasSave(projectId).catch(() => {});
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
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
  toolHostsRef.current.audioVideoSplit = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
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
      addCanvasEdge(node.id, targetNodeId, undefined, { origin: AUDIO_TRIM_EDGE_ORIGIN });
      return submitVideoToolTask({ kind: 'audioTrim', input: payload }, targetNodeId);
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
  toolHostsRef.current.audioSpeed = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
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
      addCanvasEdge(node.id, targetNodeId, undefined, { origin: AUDIO_SPEED_EDGE_ORIGIN });
      return submitVideoToolTask({ kind: 'audioSpeed', input: payload }, targetNodeId);
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
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
            return true;
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
    createTask: async ({ projectId, payload, source }) => {
      const runtime = generationRuntimeRef.current;
      if (!runtime) throw new Error('生成任务运行时未就绪，请刷新后重试');
      const submitEpoch = docLoadEpochRef.current;
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
            onCreateFailure: () => { rollbackPlaceholder(); return true; },
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
      context.exitForSubmission();
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
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
      const current = mediaNodesRef.current;
      const next = current.some((item) => item.id === placeholderId) ? current : [...current, placeholder];
      mediaNodesRef.current = next;
      setMediaNodes(next);
      addCanvasEdge(sourceNodeId, placeholderId, undefined, { origin: SMART_MATTING_EDGE_ORIGIN });
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
  toolDepsRef.current = buildToolSessionDeps();
  actionsRef.current.download = handleNodeDownload;
  actionsRef.current.showDetails = handleNodeShowDetails;
  const appliedCardIds = useMemo(() => appliedCardIdsOf(textNodes), [textNodes]);
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
    fetchRecoveryPage: (projectId, options) => queryClient.fetchQuery(generationRecoveryPageOptions(projectId, options)),
    toast: (kind, message) => showToast(kind, message),
    openRechargeForCreditsError,
    addAuthResume: (fn) => { useAuthPromptStore.getState().addResume(fn); },
    rememberAsset: rememberGeneratedAsset,
  } satisfies GenerationRuntimeHost);
  if (generationRuntimeRef.current == null) {
    const hostRef = generationRuntimeHostRef;
    const forwardHost = new Proxy({} as GenerationRuntimeHost, {
      get(_target, prop: string) {
        const impl = hostRef.current as unknown as Record<string, unknown>;
        const value = impl[prop];
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(impl) : value;
      },
    });
    const runtime = createGenerationRuntime(forwardHost);
    runtime.register(normalGenerationTask);
    runtime.register(storyboardTask);
    runtime.register(imageToolsTask);
    runtime.register(audioMixTask);
    runtime.register(audioVideoMuxTask);
    runtime.register(sceneSplitTask);
    runtime.register(vocalSplitTask);
    runtime.register(videoToolsTask);
    generationRuntimeRef.current = runtime;
  }
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
      const savedNodes = JSON.parse(saved.nodes ?? '[]') as Node[];
      const serverMode = normalizeVideoMode((savedNodes.find(n => n.id === targetNodeId)?.data as Record<string, unknown> | undefined)?.draftMode);
      const localMode = normalizeVideoMode((mediaNodesRef.current.find(n => n.id === targetNodeId)?.data as Record<string, unknown> | undefined)?.draftMode);
      if (serverMode && serverMode !== localMode) patchMediaNode(targetNodeId, { draftMode: serverMode });
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
        }
      }
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
  const handleToolMenuSelect = (menu: string, item: string) => {
    if (menu === 'assets' && item === 'shared') {
      setAssetsModalDefaultTab(undefined);
      setAssetsModalDefaultFilter('all-assets');
      setShowAssetsModal(true);
      return;
    }
    if (menu === 'assets') {
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
  const canvasMedia: CanvasPickItem[] = useMemo(() => canvasMediaOf(mediaNodes), [mediaNodes]);
  const atMentionItems: AtMentionItem[] = useMemo(() => atMentionItemsOf(mediaNodes, textNodes), [mediaNodes, textNodes]);
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
      if (role === 'reference' && isFrameMode(draftModeOfNode(videoDraftId))) {
        const refs = mergedVideoMediaRefsOf(videoDraftId, edgesRef.current, mediaNodesRef.current);
        if (refs.first || refs.last) {
          showToast('warn', '首帧和尾帧已指定，请先移除现有帧');
          return;
        }
      }
      if (!validateVideoRefConnect(item.id, videoDraftId, role)) return;
      addCanvasEdge(item.id, videoDraftId, role);
      return;
    }
    const freeMode = normalizeVideoMode(videoSeed?.params?.mode);
    const freeSlots = frameSlotCountOf(freeMode);
    const freeRole: VideoRefRole = freeSlots > 0
      ? (!videoFreeRefs.first ? 'first' : freeSlots === 2 && !videoFreeRefs.last ? 'last' : 'reference')
      : 'reference';
    if (freeRole === 'reference' && isFrameMode(freeMode) && (videoFreeRefs.first || videoFreeRefs.last)) {
      showToast('warn', '首帧和尾帧已指定，请先移除现有帧');
      return;
    }
    appendVideoFreeRef(refItem, freeRole);
  };
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
  const uploadFileToAsset = async (file: File, type: 'image' | 'video' | 'audio'): Promise<UploadCompleteData | null> => {
    try {
      const assetType: AssetType = type;
      const rejection = await checkFileBeforeUpload(file, assetType);
      if (rejection) {
        showToast('warn', rejection);
        return null;
      }
      const presign = await fetchUploadPresign({ type: assetType, mime: file.type, size: file.size });
      await putToPresignedUrl(presign, file);
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
      if (f.assetId) {
        ids.push(String(f.assetId));
        continue;
      }
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
  const { handleUpdateGenerate } = useCanvasUpdateGenerate({
    currentId,
    saveBlocked,
    saveStatus,
    mediaNodesRef,
    textNodesRef,
    edgesRef,
    applyingRef,
    activeProjectRef,
    imageDraftId,
    videoDraftId,
    audioDraftId,
    setSubmittingNodeId,
    showToast,
    flushCanvasSave,
    startGenerationJob,
    generationDock,
    textAttachmentsOf,
    draftModelOf,
    videoRefUnsupportedByModel,
  });
  updateGenerateRef.current = (nodeId) => {
    void handleUpdateGenerate(nodeId);
  };
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
  const firePendingGen = () => {
    const handoff = pendingGenRef.current;
    if (!handoff) return;
    if (!currentId) return;
    if (!doc) return;
    pendingGenRef.current = null;
    const projectId = currentId;
    (async () => {
      const items = handoff.kind === 'image'
        ? handoff.files.map(f => ({ url: f.url, name: f.name, mediaType: 'image' as const, file: f.file, assetId: f.assetId, role: 'reference' as VideoRefRole }))
        : handoff.refs.map((r, i) => ({ url: r.preview, name: r.file?.name ?? `参考${i + 1}`, mediaType: r.type, file: r.file, assetId: r.assetId,
            role: (isFrameMode(handoff.mode) ? (i === 0 ? 'first' : 'last') : 'reference') as VideoRefRole }));
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
            resolution: handoff.resolution, duration: handoff.duration, mode: handoff.mode,
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
    navigate(location.pathname + location.search, { replace: true, state: null });
  };
  actionsRef.current.firePendingGen = firePendingGen;
  const firePendingVideoDraft = () => {
    const seed = pendingVideoDraftSeedRef.current;
    if (!seed) return;
    if (!currentId) return;
    if (!doc) return;
    pendingVideoDraftSeedRef.current = null;
    const nodeId = createVideoDraftCard({
      modelId: seed.modelId,
      ratio: seed.aspectRatio,
      size: seed.resolution,
      duration: seed.duration,
      mode: seed.mode,
      generateAudio: seed.generateAudio,
    }, undefined, { recordHistory: true });
    openVideoDraftDialog(nodeId, seed);
  };
  actionsRef.current.firePendingVideoDraft = firePendingVideoDraft;
  useEffect(() => {
    actionsRef.current.firePendingGen();
    actionsRef.current.firePendingVideoDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, doc]);
  const audioVideoMuxInFlightSourceIds = new Set(
    mediaNodes
      .filter((n) => {
        if ((n.data as Record<string, unknown>).genStatus !== 'generating') return false;
        return audioVideoMuxIdentityOf(n) !== undefined;
      })
      .map((n) => audioVideoMuxIdentityOf(n)!.sourceNodeId),
  );
  const handleCharacterLibrarySelect = (assets: MaterialAsset[]) => {
    const ts = Date.now();
    if (characterLibraryTarget === 'image') {
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
  };

  return (
    <div className={styles.canvasPage}>
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
      <div ref={canvasWrapperRef} data-canvas-stage className={`${styles.canvasWrapper} ${pickMode === 'image' ? styles.pickingImage : ''}`}>
        {applying && <div role="status" style={{ position: 'fixed', inset: 0, zIndex: 10000, cursor: 'wait' }}>正在保存画布引用…</div>}
      {
}
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
              {
}
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
                      ...(audioVideoMuxInFlightSourceIds.has(soloMediaToolbarNode.id)
                        ? { audioVideoMuxInFlight: true }
                        : {}),
                    } as MediaNodeData}
                  />
                </NodeFollowToolbar>
              ) : null}
              {
}
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
        <CanvasPaneContextMenu
          paneMenu={paneMenu}
          canUndo={toolSessions.eraseHistory().active ? toolSessions.eraseHistory().canUndo : canvasHistory.canUndo}
          canRedo={toolSessions.eraseHistory().active ? toolSessions.eraseHistory().canRedo : canvasHistory.canRedo}
          onClose={() => setPaneMenu(null)}
          onUpload={() => {
            paneUploadPosRef.current = spawnNearScreen(paneMenu!);
            paneUploadRef.current?.click();
          }}
          onAddNode={(kind) => {
            const flow = spawnNearScreen(paneMenu!);
            if (kind === 'text') handleAddTextNode(flow);
            else if (kind === 'image') {
              if (!canOpenEditor()) return;
              openImageDraftDialog(createImageDraftCard(flow, { recordHistory: true }));
            } else if (kind === 'video') {
              if (!canOpenEditor()) return;
              openVideoDraftDialog(createVideoDraftCard(undefined, flow, { recordHistory: true }));
            } else if (kind === 'audio') {
              if (!canOpenEditor()) return;
              openAudioDraftDialog(createAudioDraftCard(flow, { recordHistory: true }));
            }
          }}
          onUndo={() => {
            if (toolSessions.eraseHistory().active) toolSessions.eraseHistory().undo();
            else canvasHistory.undo();
          }}
          onRedo={() => {
            if (toolSessions.eraseHistory().active) toolSessions.eraseHistory().redo();
            else canvasHistory.redo();
          }}
        />
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
        <CanvasToolbar
          mode={toolMode}
          onModeChange={setToolMode}
          onUploadFile={handleUploadFile}
          onOpenAssetsPicker={() => openAssetsPicker('toolbar')}
          onToggleVideoDialog={() => {
            if (!canOpenEditor()) return;
            setPickMode(null);
            setPickTarget(null);
            setPickRefRole(null);
            const draftId = createVideoDraftCard(undefined, undefined, { recordHistory: true });
            openVideoDraftDialog(draftId);
          }}
          onToggleImageDialog={() => {
            if (!canOpenEditor()) return;
            setPickMode(null);
            setPickTarget(null);
            setImagePickResult(null);
            const draftId = createImageDraftCard(undefined, { recordHistory: true });
            openImageDraftDialog(draftId);
          }}
          onToggleAudioDialog={() => {
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
        <CanvasBottomLeftActions
          showMiniMap={showMiniMap}
          showEdges={showEdges}
          snapAlignmentOn={snapAlignmentOn}
          saveStatus={saveStatus}
          savedAt={savedAt}
          onBackHome={() => { void ensureSavedBeforeProjectSwitch().then((ok) => { if (ok) navigate('/'); }); }}
          onToggleMiniMap={() => setShowMiniMap(!showMiniMap)}
          onToggleEdges={() => setShowEdges(!showEdges)}
          onToggleSnap={() => {
            const next = !snapAlignmentOn;
            setSnapAlignmentOn(next);
            persistSnapAlignmentEnabled(next);
          }}
          onRetrySave={handleRetryCanvasSave}
        />
        {generationDock.render()}
        {toolSessions.render(generationDock.renderedToolKinds)}
        {
}
        <CanvasPickHint
          pickMode={pickMode}
          pickTarget={pickTarget}
          pickRefRole={pickRefRole}
          imagePickSessionActive={imagePickSessionActive}
          videoPickSessionActive={videoPickSessionActive}
          audioPickSessionActive={audioPickSessionActive}
          showImageDialog={showImageDialog}
          showBottomDialog={showBottomDialog}
          showAudioDialog={showAudioDialog}
          onEndImagePick={endImagePickSession}
          onEndVideoPick={endVideoPickSession}
          onEndAudioPick={endAudioPickSession}
        />
      </div>
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
      {showAssetsPicker && (
        <AssetsPickerModal
          onClose={() => setShowAssetsPicker(false)}
          onSelect={handleAssetsPickerSelect}
          mediaTypes={assetsPickerMediaTypes(assetsPickerTarget, videoAssetPickRole, videoAssetPickKind)}
          confirmText={assetsPickerTarget === 'toolbar' ? '插入画布' : '确定'}
          showLivenessTab={assetsPickerTarget === 'toolbar' || assetsPickerTarget === 'videoDraft'}
          showCharacterTab={assetsPickerTarget === 'videoDraft'}
          rejectUnapprovedForVideo={assetsPickerTarget === 'videoDraft'}
        />
      )}
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
      {showCharacterLibrary && (
        <CharacterLibraryModal
          onClose={() => {
            setShowCharacterLibrary(false);
            setCharacterLibraryTarget(null);
          }}
          onSelectAssets={handleCharacterLibrarySelect}
        />
      )}
      <LegacyHistoryModal
        open={showLegacyHistory}
        items={legacyHistory ?? []}
        onClose={() => setShowLegacyHistory(false)}
      />
      <CanvasToast toast={toast} />
    </div>
  );
}

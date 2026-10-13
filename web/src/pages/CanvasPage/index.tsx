import { promptBindingList, type PromptBinding } from '@lib/contracts/prompt-target';
import { promptMentionSchema } from '@lib/contracts/prompt-preview';
import { type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { newNodeId } from './nodeId';
import { nodeBoxOf, readRecoveryErrorReason, fetchUrlAsFile, planReferenceErrorFor, pendingPlanSyncsOf, pickMarkedIdsFor, complianceBlockedIds, canvasMediaOf, atMentionItemsOf, appliedCardIdsOf } from './canvasPureNodeHelpers';
import { computeFollowAnchor } from './followDialog';
import { normalizeVideoMode } from '@/lib/video-modes';import { imageRefSourceError, isImageDraftNode } from './mediaRefs';
import { mergedImageRefsOf, mergedVideoRefsWithTextIndex } from './textIndexSync';
import { audioRefSourceError } from './audioMediaRefs';

import { hasGenerationRecord } from './mediaReEdit';
import {
  readRefRole,
  mergedVideoMediaRefsOf,
  videoRefSourceError,
  videoRefIdentityIds,
} from './videoMediaRefs';

import { imageReferenceMaxOf } from '@/lib/model-reference-limits';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { isTaskTypeParamConstraintCode } from '@/lib/video-reference-hints';
import { type MediaDims } from './components/MediaNode/mediaContentSize';

import { mediaCardToolbarVisible } from './components/MediaNode/toolbarVisibility';
import { createCanvasToolSessions, useCanvasToolSessionEffects, type CanvasToolHosts, type CanvasToolView } from './canvasToolSessions';
import { audioVideoMuxIdentityOf } from './audioVideoMux';
import { type ToolSessionDeps } from './toolSessionCoordinator';
import { persistSnapAlignmentEnabled, readSnapAlignmentEnabled } from './snapPreference';
import type { VideoGenSeedParams } from './components/BottomDialog';
import { type UploadedFile, type ImageTextAttachment } from './components/ImageDialog';

import { type CanvasPickItem } from './components/AudioDialog';
import type { MaterialAsset } from '@/api/material';
import type { AssetCardKind } from './components/AssetCardNode';
import type { CanvasProject } from './components/ProjectSelector';
import { isEditableKeyboardTarget } from './components/Canvas/keyboardDelete';
import { useOverlayWheelPassthrough } from './components/Canvas/canvasWheelPassthrough';
import { canvasUndoKeyAction } from './components/Canvas/keyboardUndo';
import { isMentionMenuOpen } from './components/Canvas/canvasKeyboard';
import { createConnectValidators } from './canvasConnectValidation';
import { useEdgesState, type Edge, type Node, type Viewport } from '@xyflow/react';
import { useAuthStore } from '@/stores/auth';
import { fetchMe, fetchCredits, toSessionUser } from '@/api/auth';
import {
  fetchProjects,
  createProject,
  touchProjectLastOpened,
} from '@/api/projects';
import { fetchUploadPresign, putToPresignedUrl, completeUpload, linkAssetToProject, type AssetType, type UploadCompleteData } from '@/api/assets';
import { rememberAssetUrl } from './components/AgentPanel/assetUrlCache';
import { referencePromptPlan, applyPromptPreview, legacyCardHistoryOptions, saveCanvasDoc, serializeEdges, serializeNodes } from '@/api/canvas';
import { isApiError } from '@/api/http';
import type { SessionContentBlock } from '@/api/agentSessions';
import { probeMediaMeta } from '@/utils/upload';
import {
  availableGenKinds,
  isConnectableSource,
} from './connectAbility';
import { checkFileBeforeUpload } from '@/utils/fileSignature';
import { takeGenHandoff, type GenHandoff } from '@/utils/gen-handoff';
import { takeAgentHandoff } from '@/utils/agent-handoff';
import { type GenerationRuntime, type GenerationRuntimeHost } from './generationRuntime/runtime';
import { mapBackendNode, resolveNodeAssets } from './canvasNodeUtils';
import { createImageToolsTask } from './generationRuntime/imageTools';
import { putCanvasDocWithRecovery, type CanvasRecoverySaveData, type RecoveryChange } from '@/api/canvasRecovery';
import { useCanvasDoc } from './hooks/useCanvasDoc';
import { useCanvasHydration } from './hooks/useCanvasHydration';
import { syncCanvasNodeActions } from './hooks/patchCanvasNodeActions';
import { useCanvasGraph } from './hooks/useCanvasGraph';
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
import { useCanvasNodeClickDispatch } from './hooks/useCanvasNodeClickDispatch';
import { useCanvasNodeAttachCallbacks } from './hooks/useCanvasNodeAttachCallbacks';
import { useCanvasHomeHandoff } from './hooks/useCanvasHomeHandoff';
import { useCanvasApplyAgentCard } from './hooks/useCanvasApplyAgentCard';
import { useCanvasRetryJob } from './hooks/useCanvasRetryJob';
import { useCanvasAssetsPlacement } from './hooks/useCanvasAssetsPlacement';
import { useCanvasUpdateGenerate } from './hooks/useCanvasUpdateGenerate';
import { useCanvasToolDraftCreators } from './hooks/useCanvasToolDraftCreators';
import { useCanvasChatQuote } from './hooks/useCanvasChatQuote';
import { useCanvasDraftCardCreators } from './hooks/useCanvasDraftCardCreators';
import { useCanvasAtMentionHandlers } from './hooks/useCanvasAtMentionHandlers';
import { useCanvasConnectHandlers } from './hooks/useCanvasConnectHandlers';
import { useCanvasNodeDragHandlers } from './hooks/useCanvasNodeDragHandlers';
import { useCanvasDraftRefActions } from './hooks/useCanvasDraftRefActions';
import { useCanvasTextNodeFactories } from './hooks/useCanvasTextNodeFactories';
import { useCanvasToolJobSubmissions } from './hooks/useCanvasToolJobSubmissions';
import { useCanvasImageToolHosts } from './hooks/useCanvasImageToolHosts';
import { useCanvasCompoundToolHosts } from './hooks/useCanvasCompoundToolHosts';
import { useGenerationRuntimeBinding } from './hooks/useGenerationRuntimeBinding';
import { useCanvasSelectionBridge } from './hooks/useCanvasSelectionBridge';
import { useCanvasNodeDeletion } from './hooks/useCanvasNodeDeletion';
import { useCanvasEdgeOps } from './hooks/useCanvasEdgeOps';
import { useCanvasConnectPair } from './hooks/useCanvasConnectPair';
import { useCanvasSpawn } from './hooks/useCanvasSpawn';
import { textAttachmentsOf as textAttachmentsOfPure, textAttachmentsForSend as textAttachmentsForSendPure } from './textAttachments';
import { useCanvasGroupActions } from './hooks/useCanvasGroupActions';
import {
  groupToNode,
  parseGroupsFromNodes,
  type CanvasGroup,
} from './canvasGroups';
import {
  canvasLocationSearch,
  findLastOpenedProjectId,
  findLatestCreatedProjectId,
  pickCanvasIdAfterLoad,
  readCanvasIdFromSearch,
} from './canvasQuery';
import type { AtMentionItem } from './atMention';
import { createGenerationDockCoordinator } from './generationDockCoordinator';
import { useGenerationDockHosts } from './generationDockHosts';
import { createImageGenerationDock, type ImageGenerationDockHost } from './imageGenerationDock';
import { createVideoGenerationDock, type VideoGenerationDockHost } from './videoGenerationDock';
import { createAudioMusicGenerationDocks, type AudioGenerationDockHost, type MusicGenerationDockHost } from './audioMusicGenerationDock';
import { createTextGenerationDock, type TextGenerationDockHost } from './textGenerationDock';
import { createToolGenerationDock } from './toolGenerationDock';
import CanvasPageShell from './CanvasPageShell';
type ToolMode = 'drag' | 'select';
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
  const {
    addCanvasEdge,
    connectPlanToDraft,
    syncPlanEdgeBindingsOnShrink,
    removeTargetInputs,
    syncTextIndexEdges,
  } = useCanvasEdgeOps({
    edgesRef,
    setEdges,
    historyRef,
    isApplying: () => applyingRef.current,
    findCanvasNode: (id) => findCanvasNode(id),
    getTextNodes: () => textNodesRef.current,
  });
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
  const {
    connectPair,
    draftModeOfNode,
    videoEdgeRoleFor,
    handleConnect,
    handleConnectGroupToTarget,
    handleConnectSourceToGroup,
    guardEdgesChange,
  } = useCanvasConnectPair({
    isApplying: () => applyingRef.current,
    showToast: (type, msg) => showToast(type, msg),
    isGeneratingNode: (id) => isGeneratingNode(id),
    findCanvasNode: (id) => findCanvasNode(id),
    edgesRef,
    getMediaNodes: () => mediaNodesRef.current,
    toolConnect: (source, target) => toolSessions.connect(source, target),
    addCanvasEdge: (source, target, refRole, marker) => addCanvasEdge(source, target, refRole, marker),
    connectPlanToDraft,
    removeTargetInputs,
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
    withHistoryBatch,
    patchMediaNode: (nodeId, patch) => patchMediaNode(nodeId, patch),
    onEdgesChange,
    setEdges,
    submittingNodeId,
  });
  const handleMediaIndexChange = (id: string, mediaMentions: MediaMention[], mediaRefs: MediaRef[], delta: { added: string[]; removed: string[] }) => {
    setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, mediaMentions, mediaRefs } } : n));
    syncTextIndexEdges(id, delta);
  };
  const removePlanAttachment = (targetId: string | undefined, planNodeId: string) => {
    if (!targetId || isGeneratingNode(targetId)) return;
    removeTargetInputs(edgesRef.current.filter(edge => edge.source === planNodeId && edge.target === targetId).map(edge => edge.id));
  };
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
  const textNodesRef = useRef<Node[]>([]);
  textNodesRef.current = textNodes;
  const productNodesRef = useRef<Node[]>([]);
  productNodesRef.current = productNodes;
  const assetNodesRef = useRef<Node[]>([]);
  assetNodesRef.current = assetNodes;
  const graph = useCanvasGraph({
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
  });
  const findCanvasNode = useCallback((id: string): Node | undefined => graph.findNode(id), [graph]);
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
  const { spawnPosRef, registerSpawnPosition, spawnPosition, spawnNearScreen, spawnDraftPosition } = useCanvasSpawn({
    graph,
  });
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
    graph.allNodes().forEach((n) => {
      if (ids.has(n.id)) {
        const src = n.data?.src as string | undefined;
        if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
      }
    });
    graph.setAll((prev) => prev.filter((n) => !ids.has(n.id)));
    ids.forEach((id) => pendingNodeIdsRef.current.delete(id));
  }, [graph]);
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
  const hydratedDocRef = useRef<typeof doc>(null);
  const hydratedProjectRef = useRef<string | null>(null);
  const confirmedNonEmptyRef = useRef(false);
  const emptyClearConflictRef = useRef(false);
  const emptyOverwriteRejectedRef = useRef(false);
  const recoverySaveConflictRef = useRef(false);
  const canvasNodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(
      [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes].map((n) => n.id),
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
  }, [textNodes, mediaNodes, productNodes, assetNodes, setEdges]);
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
      const contentNodes = graph.allNodes();
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
  const { handleAddTextNode, handleDuplicateNode, renameCard } = useCanvasTextNodeFactories({
    toolMode,
    textNodesRef,
    mediaNodesRef,
    pendingNodeIdsRef,
    historyRef,
    getActions: () => actionsRef.current,
    spawnPosition,
    findCanvasNode,
    removeCanvasNodes: (ids) => removeCanvasNodes(ids),
    handleDraftError,
    handleSaveTextToAssets: (id) => handleSaveTextToAssets(id),
    handleMediaIndexChange,
    syncTextIndexEdges,
    showToast,
    setTextNodes,
    setMediaNodes,
  });
  const { addToChatNode: handleAddToChatNode, confirmAgentCandidate } = useCanvasChatQuote({
    currentId,
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    showToast,
    blockInvalidDraft,
    draftErrorsRef,
    setAgentContext,
    setShowAgent,
    setAgentCandidate,
  });
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
  const { handleCanvasNodeClick } = useCanvasNodeClickDispatch({
    toolRuntime,
    buildToolSessionDeps: () => buildToolSessionDeps(),
    showAgent,
    setAgentCandidate,
    imagePickSessionActive,
    videoPickSessionActive,
    audioPickSessionActive,
    handleImagePickSessionClick,
    handleVideoPickSessionClick,
    handleAudioPickSessionClick,
    pickMode,
    pickTarget,
    pickRefRole,
    pickProductId,
    pickAssetId,
    saveBlocked,
    saveStatus,
    editingTargetRef,
    toolSessions,
    openCoordinatedToolDraft: (node, open) => openCoordinatedToolDraft(node, open),
    openImageDraftDialog: (nodeId) => openImageDraftDialog(nodeId),
    openVideoDraftDialog: (nodeId) => openVideoDraftDialog(nodeId),
    openAudioDraftDialog: (nodeId) => openAudioDraftDialog(nodeId),
    openTextGenDialog: (nodeId, intent) => openTextGenDialog(nodeId, intent),
    openMediaDraftDialog: (nodeId, mediaType, intent) => openMediaDraftDialog(nodeId, mediaType, intent),
    videoDraftId,
    connectPair,
    addCanvasEdge,
    validateVideoRefConnect,
    appendVideoFreeRef: (item, role) => appendVideoFreeRef(item, role),
    generationDock,
    showToast,
    setPickMode,
    setPickTarget,
    setPickRefRole,
    setPickProductId,
    setPickAssetId,
    setProductPickResult,
    setAssetPickResult,
  });
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
  const { handleSelectionChangeStable } = useCanvasSelectionBridge({
    mediaNodesRef,
    pickMode,
    pickTarget,
    onSelectionChange: (selection) => toolRuntime.onSelectionChange(selection),
    editSessionActive,
    draftOfNode: (node) => toolSessions.draft(node),
    hasGenerationRecord,
    showImageDialog,
    showBottomDialog,
    showAudioDialog,
    imageDraftId,
    videoDraftId,
    audioDraftId,
    openMediaDraftDialog: (nodeId, mediaType, intent) => openMediaDraftDialog(nodeId, mediaType, intent),
    setSoloSelectedNodeId,
    selection: (input) => generationDock.selection(input),
    submittingNodeId,
  });
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
  const { handleNodeDragStop } = useCanvasNodeDragHandlers({
    graph,
    groupsRef,
    historyRef,
    handleCanvasNodeClick,
    setGroups,
  });
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
  const {
    createVideoDraftCard,
    createAudioDraftCard,
    createImageDraftCard,
    createTextGenDraft,
  } = useCanvasDraftCardCreators({
    toolMode,
    spawnDraftPosition,
    mediaNodesRef,
    actionsRef,
    historyRef,
    pendingNodeIdsRef,
    dockToolCallbacks,
    handleMediaDims: (id, dims) => handleMediaDims(id, dims),
    handleMediaIndexChange: (id, mediaMentions, mediaRefs, delta) => handleMediaIndexChange(id, mediaMentions, mediaRefs, delta),
    handleDraftError: (id, error) => handleDraftError(id, error),
    removeCanvasNodes: (ids) => removeCanvasNodes(ids),
    handleSaveMediaToAssets: (id) => { void handleSaveMediaToAssets(id); },
    handleSaveTextToAssets: (id) => { void handleSaveTextToAssets(id); },
    generationDock,
    showToast,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    setSelectRequest,
  });
  const openTextGenDialog = (nodeId: string, intent?: 'nodeClick') => generationDock.open('text', { nodeId, intent });
  useEffect(() => { generationDock.reconcile(); }, [generationDock, videoDraftId, videoSeed, mediaNodes]);
  const openAudioDraftDialog = (nodeId: string) => generationDock.open('audio', { nodeId });
  const { applyConnectType, handleConnectEnd, handleConnectGroupDrop, isValidCanvasConnection } = useCanvasConnectHandlers({
    connectMenu,
    connectingSourceRef,
    edgesRef,
    findCanvasNode,
    isConnectableSource,
    availableGenKinds,
    setConnectMenu,
    addCanvasEdge: (source, target, refRole, marker) => addCanvasEdge(source, target, refRole, marker),
    connectPlanToDraft,
    connectPair,
    videoRefSourceError: (node, role) => videoRefSourceError(node, role),
    imageRefSourceError: (node) => imageRefSourceError(node),
    audioRefSourceError: (node) => audioRefSourceError(node),
    spawnNearScreen,
    withHistoryBatch,
    creators: { createVideoDraftCard, createImageDraftCard, createAudioDraftCard, createTextGenDraft },
    openVideoDraftDialog,
    openImageDraftDialog,
    openAudioDraftDialog,
    openTextGenDialog,
    toolSessions: { wireStart: (id) => toolSessions.wireStart(id) },
  });
  useEffect(() => { generationDock.reconcile(); }, [generationDock, audioDraftId, audioSeed, mediaNodes]);
  useEffect(() => {
    graph.setAll((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
  }, [toolMode, graph]);
  const videoModelsRef = useRef<GenerationModel[]>([]);
  videoModelsRef.current = videoModels;
  const imageModelsRef = useRef<GenerationModel[]>([]);
  imageModelsRef.current = imageModels;
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
    graph.patchNode(nodeId, patch);
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
  const { attachCallbacks } = useCanvasNodeAttachCallbacks({
    toolMode,
    currentId,
    actionsRef,
    removeCanvasNodes: (ids) => removeCanvasNodes(ids),
    handleDraftError,
    setTextNodes,
    setAssetNodes,
    syncPlanEdgeBindingsOnShrink,
    handleMediaIndexChange,
    handleMediaDims,
    handleAssetHoverChange,
    handleSaveMediaToAssets: (id) => handleSaveMediaToAssets(id),
    handleSaveTextToAssets: (id) => handleSaveTextToAssets(id),
    handleSaveCardToAssets: (id) => handleSaveCardToAssets(id),
    handleSaveGoodsToAssets: (id) => handleSaveGoodsToAssets(id),
    handleProductChange: (id, patch) => handleProductChange(id, patch),
    handleCardChange: (id, patch) => handleCardChange(id, patch),
    generationDock,
    dockToolCallbacks,
    locateTextSource: (nodeId) => locateTextSource(nodeId),
    showToast,
    pickers: { setPickMode, setPickTarget, setPickProductId, setPickAssetId },
  });

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
  useCanvasHydration({
    currentId,
    doc,
    snapshotAssets,
    canvasLoadFailed,
    recoverFrameInterpolationRef,
    attachCallbacks,
    resolveNodeAssets,
    mapBackendNode,
    parseGroupsFromNodes,
    groupToNode,
    serializeNodes,
    serializeEdges,
    generationRuntimeRef,
    hydratedDocRef,
    hydratedProjectRef,
    confirmedNonEmptyRef,
    emptyClearConflictRef,
    emptyOverwriteRejectedRef,
    recoverySaveConflictRef,
    docLoadEpochRef,
    productSeq,
    versionRef,
    lastSavedRef,
    settledExtractNodesRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    setEdges,
    setGroups,
    setViewport,
    setSaveStatus,
  });
  const {
    imageToolTargetOfNode,
    dispatchImageToolTask,
    startImageEnhanceJob,
    submitVideoToolTask,
    handleCancelJob,
    outpaint,
    erase: imageEraseHost,
    subtitleErase: subtitleEraseHost,
    cutout: imageCutoutHost,
  } = useCanvasImageToolHosts({
    currentId,
    mediaNodesRef,
    generationRuntimeRef,
    generationRuntimeHostRef,
    imageToolsTask,
    imageToolsAcceptanceRef,
    creators: { createImageDraftCard },
    addCanvasEdge,
    removeCanvasNodes: (ids) => removeCanvasNodes(ids),
    patchMediaNode,
    clearPickState: () => {
      if (imagePickSessionActive) endImagePickSession();
      if (videoPickSessionActive) endVideoPickSession();
      if (audioPickSessionActive) endAudioPickSession();
      if (pickMode || pickTarget) {
        setPickMode(null); setPickTarget(null); setPickRefRole(null); setPickProductId(null); setPickAssetId(null);
      }
    },
    showToast,
  });
  toolHostsRef.current.outpaint = outpaint;
  toolHostsRef.current.erase = imageEraseHost;
  toolHostsRef.current.subtitleErase = subtitleEraseHost;
  toolHostsRef.current.cutout = imageCutoutHost;
  const pendingDeleteJobNodesRef = useRef<Set<string>>(new Set());
  const { removeAudioMixCardNow, removeCanvasNodes, handleRemoveMediaNode } = useCanvasNodeDeletion({
    currentId,
    mediaNodesRef,
    textNodesRef,
    productNodesRef,
    assetNodesRef,
    edgesRef,
    historyRef,
    generationRuntimeRef,
    activeJobByNodeRef,
    pendingNodeIdsRef,
    isGeneratingNode,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    setEdges,
    flushCanvasSave,
  });
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
    graph,
    setGroups,
    groupsRef,
    historyRef,
    pendingDeleteGroup,
    setPendingDeleteGroup,
    removeCanvasNodes,
    showToast,
  });
  const { handleRetryJob } = useCanvasRetryJob({
    currentId,
    mediaNodesRef,
    generationRuntimeRef,
    patchMediaNode,
    isVideoEnhanceCardInFlight,
    imageToolTargetOfNode: (nodeId) => imageToolTargetOfNode(nodeId),
    dispatchImageToolTask: (payload, target) => dispatchImageToolTask(payload, target),
    beginVideoEnhanceSubmission: (nodeId) => beginVideoEnhanceSubmission(nodeId),
    captureSessionOwnership: (kind) => toolRuntime.captureSessionOwnership(kind),
    showToast,
  });
  const textAttachmentsOf = (targetNodeId: string): ImageTextAttachment[] =>
    textAttachmentsOfPure(targetNodeId, edgesRef.current, textNodesRef.current);
  const textAttachmentsForSend = (targetNodeId: string): ImageTextAttachment[] =>
    textAttachmentsForSendPure(targetNodeId, edgesRef.current, textNodesRef.current);
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
  }, [findCanvasNode]);
  const {
    removeRefEdges,
    handleAddAudioCanvasRef,
    removeDraftMaterialRef,
    assignVideoRefRoles,
    appendVideoFreeRef,
    removeVideoFreeRef,
    assignVideoFreeRefRoles,
  } = useCanvasDraftRefActions({
    audioDraftId,
    mediaNodesRef,
    edgesRef,
    historyRef,
    setEdges,
    isGeneratingNode,
    removeTargetInputs,
    patchMediaNode,
    validateAudioRefConnect,
    addCanvasEdge: (source, target, refRole, marker) => addCanvasEdge(source, target, refRole, marker),
    generationDock: { updateVideoDraft: (input) => generationDock.updateDraft('video', input) },
  });
  const {
    handleNodeEnhanceImage,
    handleNodeVideoEnhance,
    handleVideoEnhanceParamsChange,
    handleNodeFrameInterpolation,
    handleFrameInterpolationParamsChange,
  } = useCanvasToolDraftCreators({
    mediaNodesRef,
    showToast,
    createImageDraftCard,
    createVideoDraftCard,
    addCanvasEdge,
    patchMediaNode,
  });
  const {
    handleStartFrameInterpolation: startFrameInterpolationJob,
    recoverFrameInterpolation,
    beginVideoEnhanceSubmission,
    handleStartVideoEnhance: startVideoEnhanceJob,
  } = useCanvasToolJobSubmissions({
    activeProjectRef,
    mediaNodesRef,
    activeJobByNodeRef,
    locallyRemovedGenerationNodesRef,
    videoEnhanceInFlightRef,
    docLoadEpochRef,
    generationRuntimeRef,
    queryClient,
    patchMediaNode,
    toolRuntime: {
      reconcileSources: (ids) => toolRuntime.reconcileSources(ids),
      notifyInFlight: (kind, targetId) => toolRuntime.notifyInFlight(kind, targetId),
    },
    submitVideoToolTask: (payload, targetNodeId, options) => submitVideoToolTask(payload, targetNodeId, options),
    applyJobTerminal,
    settleCancelledNode,
    jobResponseGuarded,
    showToast,
  });
  recoverFrameInterpolationRef.current = recoverFrameInterpolation;
  useCanvasCompoundToolHosts({
    toolHostsRef,
    toolDepsRef,
    currentId,
    canOpenEditor,
    mediaNodesRef,
    textNodesRef,
    productNodesRef,
    assetNodesRef,
    edgesRef,
    setMediaNodes,
    setEdges,
    activeProjectRef,
    docLoadEpochRef,
    generationRuntimeRef,
    generationRuntimeHostRef,
    editingTargetRef,
    audioVideoMuxInFlightRef,
    audioMixInFlightRef,
    audioMixSubmitCardRef,
    sceneSplitSendingRef,
    smartMattingSendingRef,
    attachCallbacks,
    patchMediaNode,
    addCanvasEdge,
    removeTargetInputs,
    createVideoDraftCard,
    createImageDraftCard,
    submitVideoToolTask,
    startImageEnhanceJob,
    startVideoEnhanceJob,
    startFrameInterpolationJob,
    isVideoEnhanceCardInFlight,
    setSoloSelectedNodeId,
    setSelectRequest,
    flushCanvasSave,
    linkAudioMixAssets: (vars) => linkAudioMixAssetsMutation.mutateAsync(vars),
    showToast,
    dismissGenPanels,
  });
  const appliedCardIds = useMemo(() => appliedCardIdsOf(textNodes), [textNodes]);
  useGenerationRuntimeBinding({
    generationRuntimeHostRef,
    generationRuntimeRef,
    activeProjectRef,
    docLoadEpochRef,
    mediaNodesRef,
    edgesRef,
    activeJobByNodeRef,
    locallyRemovedGenerationNodesRef,
    pendingDeleteJobNodesRef,
    actionsRef,
    setMediaNodes,
    setEdges,
    patchMediaNode,
    attachCallbacks,
    handleSaveMediaToAssets,
    handleMediaDims,
    addCanvasEdge,
    applyJobTerminal,
    settleCancelledNode,
    flushCanvasSave,
    queryClient,
    showToast,
    rememberGeneratedAsset,
    imageToolsTask,
  });
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
  };
  const canvasMedia: CanvasPickItem[] = useMemo(() => canvasMediaOf(mediaNodes), [mediaNodes]);
  const atMentionItems: AtMentionItem[] = useMemo(() => atMentionItemsOf(mediaNodes, textNodes), [mediaNodes, textNodes]);
  const { handleImageAtMention, handleVideoAtMention, handleAudioAtMention, handleMusicAtMention } = useCanvasAtMentionHandlers({
    imageDraftId,
    videoDraftId,
    audioDraftId,
    videoSeed,
    videoFreeRefs,
    findCanvasNode,
    connectPair,
    addCanvasEdge: (source, target, refRole) => addCanvasEdge(source, target, refRole),
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    draftModeOfNode: (nodeId) => draftModeOfNode(nodeId),
    videoEdgeRoleFor: (targetId) => videoEdgeRoleFor(targetId),
    mergedVideoRefsOf: (targetId) => mergedVideoMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current),
    appendVideoFreeRef,
    generationDock: { referencePicked: (kind) => generationDock.referencePicked(kind) },
    showToast,
    setImagePickResult,
    setAudioPickResult,
    setMusicPickResult,
  });
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
  useGenerationDockHosts(
    {
      isGeneratingNode: (id) => isGeneratingNode(id),
      patchMediaNode: (nodeId, patch) => patchMediaNode(nodeId, patch),
      setSubmittingNodeId: (id) => setSubmittingNodeId(id),
      textAttachmentsOf: (targetNodeId) => textAttachmentsOf(targetNodeId),
      mediaNodesRef,
      textNodesRef,
      edgesRef,
    },
    {
      currentId,
      pickMode,
      pickTarget,
      applying,
      saveBlocked,
      saveStatus,
      submittingNodeId,
      imageDraftId,
      imageSeed,
      imagePickResult,
      setImagePickResult: (result) => setImagePickResult(result),
      videoDraftId,
      videoSeed,
      videoPickSessionActive,
      audioDraftId,
      audioSeed,
      audioPickResult,
      setAudioPickResult: (result) => setAudioPickResult(result),
      audioAssetPickResult,
      audioAssetPickTarget,
      setAudioAssetPickResult: (result) => setAudioAssetPickResult(result),
      setAudioAssetPickTarget: (target) => setAudioAssetPickTarget(target),
      musicPickResult,
      textGenDraftId,
      setTextNodes: (updater) => setTextNodes(updater),
      setPickMode: (mode) => setPickMode(mode),
      setPickTarget: (target) => setPickTarget(target),
      setPickRefRole: (role) => setPickRefRole(role),
      setImagePickSession: (id) => setImagePickSession(id),
      setVideoPickSession: (id) => setVideoPickSession(id),
      setAudioPickSession: (id) => setAudioPickSession(id),
      setVideoAssetPickRole: (role) => setVideoAssetPickRole(role),
      setVideoAssetPickKind,
      setCharacterLibraryTarget: (target) => setCharacterLibraryTarget(target),
      setShowCharacterLibrary: (show) => setShowCharacterLibrary(show),
      endImagePickSession,
      endVideoPickSession,
      endAudioPickSession,
      openAssetsPicker,
      closeVideoDialog,
      closeAudioDialog,
      closeMusicDialog,
      closeTextGenDialog,
      exitEditSessionForGenPanel,
      canOpenEditor,
      isGeneratingNode: (id) => isGeneratingNode(id),
      isAnchoredOverlayDragHidden,
      warnStaleMediaRefs,
      locateTextSource,
      followAnchor,
      planReferenceErrors,
      atMentionItems,
      refStripOrderOf,
      handleRefStripOrderChange,
      handleReorderAttachments,
      handleReorderVideoMediaRefs,
      removeRefEdges,
      removePlanAttachment,
      removeVideoFreeRef,
      assignVideoRefRoles,
      assignVideoFreeRefRoles,
      removeDraftMaterialRef,
      reorderTargetEdges,
      reorderVideoFreeRefs,
      pendingPlanSyncs,
      syncPlanToTarget,
      collectImageInputAssetIds,
      handleAddAudioCanvasRef,
      flushCanvasSave: (projectId) => flushCanvasSave(projectId),
      startGenerationJob: startGenerationJob as never,
      videoRefUnsupportedByModel,
      editingTargetRef,
      activeProjectRef,
      applyingRef,
      showToast,
      generationDock: generationDock as never,
      collectCanvasMedia: () => canvasMedia,
      imageAtMention: (item) => handleImageAtMention(item),
      videoAtMention: (item) => handleVideoAtMention(item),
      audioAtMention: (item) => handleAudioAtMention(item),
      musicAtMention: (item) => handleMusicAtMention(item),
      currentMediaNodes: mediaNodes,
      addCanvasEdge,
      uploadFileToAsset,
    },
    { imageDockHostRef, videoDockHostRef, audioDockHostRef, musicDockHostRef, textDockHostRef },
  );
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
  const { firePendingGen, firePendingVideoDraft } = useCanvasHomeHandoff({
    currentId,
    doc,
    activeProjectRef,
    pendingGenRef,
    pendingVideoDraftSeedRef,
    navigate,
    location,
    showToast,
    uploadFileToAsset: (file, type) => uploadFileToAsset(file, type),
    createVideoDraftCard: (seed, position, overrides) => createVideoDraftCard(seed, position, overrides),
    openVideoDraftDialog: (nodeId, preset) => openVideoDraftDialog(nodeId, preset),
    startGenerationJob: (type, parameters, inputAssetIds, videoRefs, targetNodeId, initialDraft) => startGenerationJob(type, parameters, inputAssetIds, videoRefs, targetNodeId, initialDraft),
  });
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

  const { handleAgentCardApply } = useCanvasApplyAgentCard({
    currentId,
    viewport,
    mediaNodesRef,
    applyingRef,
    activeProjectRef,
    setApplying,
    setSaveStatus,
    setSavedAt,
    setFocusViewport,
    spawnPosition,
    flushCanvasSave: (projectId) => flushCanvasSave(projectId),
    applyMutation,
    acceptDoc,
    upsertAssets,
    showToast,
  });

  syncCanvasNodeActions(actionsRef.current, {
    duplicate: handleDuplicateNode,
    addToChat: handleAddToChatNode,
    renameCard,
    openImageDialog: () => generationDock.open('image', {}),
    pasteAtNode: (id) => {
      const node = graph.findNode(id);
      const position = node
        ? { x: node.position.x + 40, y: node.position.y + 40 }
        : spawnPosition();
      void applyClipboardAtFlow(position);
    },
    copyImage: (id) => { void handleCopyImage(id); },
    complianceCheck: (id) => { void complianceCheckRef.current?.(id); },
    fillEmptyShell: handleFillEmptyShell,
    cancelJob: handleCancelJob,
    retryJob: handleRetryJob,
    removeMediaNode: handleRemoveMediaNode,
    download: handleNodeDownload,
    showDetails: handleNodeShowDetails,
    fixFollowVideo: handleFixFollowVideo,
    firePendingGen,
    firePendingVideoDraft,
  });

  return (
    <CanvasPageShell
      shellTop={{
        canvasWrapperRef, currentId, applying, assetImageRefMax,
        toast, toolSessions, handleCopySelectedNodes, handlePasteClipboard,
        navigate, generationDock,
      }}
      canvas={{
        showMiniMap, setShowMiniMap, toolMode, setToolMode,
        textNodes, mediaNodes, productNodes, assetNodes,
        showEdges, setShowEdges, snapAlignmentOn, setSnapAlignmentOn, edges,
        guardEdgesChange, onConnect: handleConnect, connectingSourceRef, handleConnectEnd,
        isValidCanvasConnection, focusViewport, docViewport: doc?.viewport,
        setViewport, setLiveViewport, registerSpawnPosition, handleNodeDragStop,
        handleCanvasNodeClick, handleCanvasPaneClick, handleSelectionChangeStable,
        refPickActive: imagePickSessionActive || videoPickSessionActive || audioPickSessionActive || toolSessions.blocksCanvasDrag(),
        refPickMarkedIds: audioPickSessionActive ? audioPickMarkedIds : videoPickSessionActive ? videoPickMarkedIds : imagePickMarkedIds,
        refPickBlockedIds: videoPickSessionActive ? videoPickBlockedIds : undefined,
        selectRequest, selectManyRequest, productPickResult, assetPickResult,
        setAnchoredOverlayHiddenIds, onUpdateGenerate, withHistoryBatch,
        removeCanvasNodes, actionsRef, handleConnect,
      }}
      menus={{
        connectMenu, closeConnectMenu, applyConnectType, paneMenu, setPaneMenu, canvasHistory,
        findCanvasNode, showToast,
        spawnNearScreen, paneUploadRef, paneUploadPosRef, placeFileOnCanvas,
        handleToolMenuSelect, handleUploadFile, placeNodeFile: (file) => placeFileOnCanvas(file),
      }}
      nodeActions={{
        handleAddTextNode, canOpenEditor, openImageDraftDialog, createImageDraftCard,
        openVideoDraftDialog, createVideoDraftCard, openAudioDraftDialog, createAudioDraftCard,
      }}
      pick={{
        pickMode, setPickMode, pickTarget, setPickTarget, pickRefRole, setPickRefRole, setImagePickResult,
        showImageDialog, showBottomDialog, showAudioDialog,
        endImagePickSession, endVideoPickSession, endAudioPickSession,
        videoPickSessionActive, audioPickSessionActive, imagePickSessionActive,
        audioPickMarkedIds, videoPickMarkedIds, imagePickMarkedIds, videoPickBlockedIds,
        videoDraftId, videoAssetPickRole, videoAssetPickKind, assetsPickerTarget,
        openAssetsPicker, setVideoAssetPickRole, setVideoAssetPickKind,
      }}
      groupActions={{
        groups, handleCreateGroup, handleUngroup, handleDeleteGroup, handleDownloadGroupNodes,
        handleGroupFrameDragStop, handleBringGroupToFront, handleConnectGroupToTarget,
        handleConnectGroupDrop, handleConnectSourceToGroup,
      }}
      save={{
        saveStatus, savedAt, handleRetryCanvasSave, ensureSavedBeforeProjectSwitch,
        persistSnapAlignmentEnabled,
      }}
      assetsPicker={{ showAssetsPicker, setShowAssetsPicker, handleAssetsPickerSelect }}
      agent={{
        showAgent, setShowAgent, agentOpened, agentContext, agentCandidate,
        confirmAgentCandidate, cancelAgentCandidate, appliedCardIds, handleAgentCardApply, agentAssetPicks,
      }}
      mediaUpdates={{
        submittingNodeId, audioVideoMuxInFlightSourceIds, finalizeCtaByNodeId,
        regenerateCtaByNodeId, handleFinalizeSample, handleRegenerateSample,
      }}
      toolbars={{
        soloMediaToolbarNode, showSoloMediaToolbar, enhancePanelToolbarNode,
        assetToolbarNode, hoverAssetToolbarNode, handleToolbarPointerEnter, handleToolbarPointerLeave,
      }}
      projectHandlers={{
        projects, handleSelect, handleRename, handleDelete, handleToggleProjectPin,
        handleNewProject, legacyHistory, showLegacyHistory, setShowLegacyHistory,
      }}
      overlays={{
        assetDetailTarget, assetDetailLoading, handleCloseAssetDetail,
        pendingDeleteGroup, setPendingDeleteGroup, confirmDeleteGroup,
        showAssetsModal, setShowAssetsModal, handleAddSharedAsset,
        assetsModalDefaultTab, assetsModalDefaultFilter: assetsModalDefaultFilter as never, showCharacterLibrary,
        setShowCharacterLibrary, setCharacterLibraryTarget, handleCharacterLibrarySelect,
      }}
    />
  );
}

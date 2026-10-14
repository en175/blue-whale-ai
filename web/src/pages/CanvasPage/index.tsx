import { type PromptBinding } from '@lib/contracts/prompt-target';
import { type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { useState, useRef, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { newNodeId } from './nodeId';
import { nodeBoxOf, canvasMediaOf, atMentionItemsOf, appliedCardIdsOf } from './canvasPureNodeHelpers';
import { normalizeVideoMode } from '@/lib/video-modes';import { imageRefSourceError } from './mediaRefs';
import { audioRefSourceError } from './audioMediaRefs';

import { hasGenerationRecord } from './mediaReEdit';
import {
  readRefRole,
  mergedVideoMediaRefsOf,
  videoRefSourceError,
} from './videoMediaRefs';

import { isTaskTypeParamConstraintCode } from '@/lib/video-reference-hints';
import { audioVideoMuxIdentityOf } from './audioVideoMux';
import { type ToolSessionDeps } from './toolSessionCoordinator';
import type { VideoGenSeedParams } from './components/BottomDialog';
import { type ImageTextAttachment } from './components/ImageDialog';

import { type CanvasPickItem } from './components/AudioDialog';
import type { CanvasProject } from './components/ProjectSelector';
import { createConnectValidators } from './canvasConnectValidation';
import { type Edge, type Node } from '@xyflow/react';
import { linkAssetToProject } from '@/api/assets';
import { referencePromptPlan, applyPromptPreview, legacyCardHistoryOptions, serializeEdges, serializeNodes } from '@/api/canvas';
import {
  availableGenKinds,
  isConnectableSource,
} from './connectAbility';
import { type GenHandoff } from '@/utils/gen-handoff';
import { mapBackendNode, resolveNodeAssets } from './canvasNodeUtils';
import { useCanvasDoc } from './hooks/useCanvasDoc';
import { useCanvasHydration } from './hooks/useCanvasHydration';
import { syncCanvasNodeActions } from './hooks/patchCanvasNodeActions';
import { useCanvasHistory } from './hooks/useCanvasHistory';
import { useAssetHoverBridge } from './hooks/useAssetHoverBridge';
import { useCanvasPickers } from './hooks/useCanvasPickers';
import { useCanvasGenerationTerminal } from './hooks/useCanvasGenerationTerminal';
import { useCanvasGenerationSubmission } from './hooks/useCanvasGenerationSubmission';
import { useCanvasAssetActions } from './hooks/useCanvasAssetActions';
import { useCanvasNodeFactories } from './hooks/useCanvasNodeFactories';
import { useCanvasSave } from './hooks/useCanvasSave';
import { useCanvasSaveSession } from './hooks/useCanvasSaveSession';
import { useCanvasSessionBootstrap } from './hooks/useCanvasSessionBootstrap';
import { useCanvasToast } from './hooks/useCanvasToast';
import { useCanvasViewportSurface } from './hooks/useCanvasViewportSurface';
import { useCanvasGenerationModels } from './hooks/useCanvasGenerationModels';
import { useCanvasProjectRoute } from './hooks/useCanvasProjectRoute';
import { useCanvasLegacyMigrationToast } from './hooks/useCanvasLegacyMigrationToast';
import { useCanvasWorkbenchChrome } from './hooks/useCanvasWorkbenchChrome';
import { useCanvasToolWorkspace } from './hooks/useCanvasToolWorkspace';
import { useCanvasDocument } from './hooks/useCanvasDocument';
import { useCanvasGenerationRuntime } from './hooks/useCanvasGenerationRuntime';
import { useCanvasHydrationFlags } from './hooks/useCanvasHydrationFlags';
import { useCanvasPlanMentions } from './hooks/useCanvasPlanMentions';
import { useCanvasFollowToolbar } from './hooks/useCanvasFollowToolbar';
import { useCanvasHomeAgentInject } from './hooks/useCanvasHomeAgentInject';
import { useCanvasOrphanEdges } from './hooks/useCanvasOrphanEdges';
import { useCanvasUndoHotkeys } from './hooks/useCanvasUndoHotkeys';
import { useCanvasChromeActions } from './hooks/useCanvasChromeActions';
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
import { useGenerationDockBinding } from './hooks/useGenerationDockBinding';
import { useGenerationDockChrome } from './hooks/useGenerationDockChrome';
import { useCanvasAgentSurface } from './hooks/useCanvasAgentSurface';
import { useCanvasGenerationUploads } from './hooks/useCanvasGenerationUploads';
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
} from './canvasGroups';
import {
  readCanvasIdFromSearch,
} from './canvasQuery';
import type { AtMentionItem } from './atMention';
import { useGenerationDockHosts } from './generationDockHosts';
import CanvasPageShell from './CanvasPageShell';
export default function CanvasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [currentId, setCurrentId] = useState(() => readCanvasIdFromSearch(searchParams));
  const {
    showAgent, setShowAgent,
    agentOpened, setAgentOpened,
    agentCandidate, setAgentCandidate,
    cancelAgentCandidate,
    agentContext, setAgentContext,
  } = useCanvasAgentSurface();
  const { toast, showToast } = useCanvasToast();
  const {
    canvasWrapperRef,
    wrapperSize,
    viewport,
    setViewport,
    viewportRef,
    liveViewport,
    setLiveViewport,
  } = useCanvasViewportSurface();
  const { videoModelsRef, imageModelsRef, assetImageRefMax } = useCanvasGenerationModels();
  const {
    showMiniMap, setShowMiniMap,
    toolMode, setToolMode,
    paneMenu, setPaneMenu,
    connectMenu, setConnectMenu, closeConnectMenu, connectingSourceRef,
    paneUploadRef, paneUploadPosRef,
    anchoredOverlayHiddenIds, setAnchoredOverlayHiddenIds, isAnchoredOverlayDragHidden,
    soloSelectedNodeId, setSoloSelectedNodeId,
    showCharacterLibrary, setShowCharacterLibrary, characterLibraryTarget, setCharacterLibraryTarget,
    showAssetsModal, setShowAssetsModal, assetsModalDefaultTab, setAssetsModalDefaultTab,
    assetsModalDefaultFilter, setAssetsModalDefaultFilter,
    showEdges, setShowEdges, snapAlignmentOn, setSnapAlignmentOn, persistSnap: persistSnapAlignmentEnabled,
    pendingDeleteGroup, setPendingDeleteGroup,
    submittingNodeId, setSubmittingNodeId,
    editingTargetRef, selectRequest, setSelectRequest, selectManyRequest, setSelectManyRequest,
    showLegacyHistory, setShowLegacyHistory,
  } = useCanvasWorkbenchChrome();
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
  const videoEnhanceInFlightRef = useRef(new Map<string, Set<{ projectId: string | null; loadEpoch: object }>>());
  const isVideoEnhanceCardInFlight = (nodeId: string) =>
    [...(videoEnhanceInFlightRef.current.get(nodeId) ?? [])].some((request) =>
      request.projectId === activeProjectRef.current && request.loadEpoch === docLoadEpochRef.current);
  const {
    toolHostsRef,
    toolViewRef,
    toolDepsRef,
    toolSessions,
    toolRuntime,
    eraseHistoryRef,
    historyRef,
    withHistoryBatch,
  } = useCanvasToolWorkspace(currentId);
  const audioMixInFlightRef = useRef(false);
  const audioVideoMuxInFlightRef = useRef(false);
  const audioMixSubmitCardRef = useRef<{ projectId: string; payload: string; nodeId: string; accepted: boolean } | null>(null);
  const sceneSplitSendingRef = useRef(false);
  const smartMattingSendingRef = useRef(false);
  const {
    textNodes, setTextNodes, textNodesRef,
    mediaNodes, setMediaNodes, mediaNodesRef,
    productNodes, setProductNodes, productNodesRef,
    assetNodes, setAssetNodes, assetNodesRef,
    edges, setEdges, onEdgesChange, edgesRef,
    groups, setGroups, groupsRef,
    graph, findCanvasNode, patchMediaNode, handleMediaDims,
  } = useCanvasDocument(toolMode);
  const referencePlanRef = useRef<(source: string, target: string, syncBindings?: PromptBinding[]) => Promise<void>>(async () => {});
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
  const {
    generationDock,
    imageDockHostRef,
    videoDockHostRef,
    audioDockHostRef,
    musicDockHostRef,
    textDockHostRef,
    showImageDialog,
    imageDraftId,
    imageSeed,
    showBottomDialog,
    videoDraftId,
    videoSeed,
    videoFreeRefs,
    dockToolCallbacks,
    openCoordinatedToolDraft,
    showAudioDialog,
    audioDraftId,
    audioSeed,
    showTextGenDialog,
    textGenDraftId,
    closeVideoDialog,
    closeAudioDialog,
    closeTextGenDialog,
    closeMusicDialog,
    dismissGenPanels,
    dismissAllGenPanels,
    openImageDraftDialog,
    openVideoDraftDialog,
    openTextGenDialog,
    openAudioDraftDialog,
    openMediaDraftDialog,
  } = useGenerationDockBinding({
    toolSessions,
    toolViewRef,
    toolDepsRef,
    mediaNodesRef,
  });
  const pendingGenRef = useRef<GenHandoff | null>(null);
  const pendingVideoDraftSeedRef = useRef<VideoGenSeedParams | null>(null);
  const { spawnPosRef, registerSpawnPosition, spawnPosition, spawnNearScreen, spawnDraftPosition } = useCanvasSpawn({
    graph,
  });
  const {
    followAnchor,
    enhancePanelToolbarNode,
    soloMediaToolbarNode,
    showSoloMediaToolbar,
    hoverAssetToolbarNode,
    assetToolbarNode,
  } = useCanvasFollowToolbar({
    showImageDialog,
    imageDraftId,
    showBottomDialog,
    videoDraftId,
    showAudioDialog,
    audioDraftId,
    showTextGenDialog,
    textGenDraftId,
    mediaNodes,
    textNodes,
    assetNodes,
    wrapperSize,
    liveViewport,
    soloSelectedNodeId,
    hoveredAssetNodeId,
    toolSessions,
  });
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
  const {
    draftErrorsRef,
    handleDraftError,
    blockInvalidDraft,
    applyingRef,
    updateGenerateRef,
    onUpdateGenerate,
    applying,
    setApplying,
    saveEpoch,
    setSaveEpoch,
    savePromiseRef,
    activeProjectRef,
    focusViewport,
    setFocusViewport,
    saveStatus,
    setSaveStatus,
    saveBlocked,
    setSaveBlocked,
    savedAt,
    setSavedAt,
    versionRef,
    lastSavedRef,
    retainedRecoverySaveRef,
    pendingNodeIdsRef,
    rollbackPendingNodes,
  } = useCanvasSaveSession({ currentId, graph, showToast });
  const blockedByPendingCanvasReviewRef = useRef<() => boolean>(() => false);
  const applyMutation = useMutation({ mutationFn: applyPromptPreview });
  const referencePlanMutation = useMutation({ mutationFn: (input: Parameters<typeof referencePromptPlan>[0]) => referencePromptPlan(input) });
  const linkAudioMixAssetsMutation = useMutation({
    mutationFn: (vars: { projectId: string; assetIds: string[] }) =>
      Promise.all(vars.assetIds.map((assetId) => linkAssetToProject(vars.projectId, assetId, { silent: true }))),
  });
  useCanvasSessionBootstrap({
    currentId,
    projects,
    setProjects,
    setCurrentId,
  });
  useCanvasProjectRoute({
    currentId,
    setCurrentId,
    location,
    navigate,
    audioMixInFlightRef,
    activeProjectRef,
    blockedByPendingCanvasReviewRef,
    onProjectSwitch: () => {
      setShowAgent(false);
      setAgentOpened(false);
      setAgentContext(null);
      setAgentAssetPicks(null);
      setAgentCandidate(null);
      setFocusViewport(undefined);
      historyRef.current?.clear();
    },
  });
  const { doc, assets: snapshotAssets, loadFailed: canvasLoadFailed, refetch, acceptDoc, legacyMigration, patchAsset, upsertAssets } = useCanvasDoc(currentId);
  const snapshotAssetsRef = useRef(snapshotAssets);
  snapshotAssetsRef.current = snapshotAssets;
  const historyQuery = useQuery({ ...legacyCardHistoryOptions(currentId), enabled: Boolean(doc && currentId) });
  const legacyHistory = historyQuery.data?.items;
  useCanvasLegacyMigrationToast({ legacyMigration, showToast });
  const {
    hydratedDocRef,
    hydratedProjectRef,
    confirmedNonEmptyRef,
    emptyClearConflictRef,
    emptyOverwriteRejectedRef,
    recoverySaveConflictRef,
    productSeq,
    docLoadEpochRef,
  } = useCanvasHydrationFlags();
  useCanvasOrphanEdges({
    textNodes,
    mediaNodes,
    productNodes,
    assetNodes,
    setEdges,
  });
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
  const buildToolSessionDeps = (): ToolSessionDeps => ({
    dismissGenPanels,
    selectNode: (nodeId: string) => setSelectRequest({ id: nodeId, ts: Date.now() }),
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
  useGenerationDockChrome({
    generationDock,
    toolRuntime,
    mediaNodes,
    textNodes,
    showImageDialog,
    showBottomDialog,
    showAudioDialog,
    imageDraftId,
    imageSeed,
    videoDraftId,
    videoSeed,
    audioDraftId,
    audioSeed,
    textGenDraftId,
    imagePickSession,
    videoPickSession,
    audioPickSession,
    imagePickSessionActive,
    videoPickSessionActive,
    audioPickSessionActive,
    pickMode,
    pickTarget,
    editSessionActive,
    resetPickState,
    endImagePickSession,
    endVideoPickSession,
    endAudioPickSession,
    dismissAllGenPanels,
  });
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
  useCanvasUndoHotkeys({
    applyingRef,
    eraseHistoryRef,
    canvasHistory,
  });
  const {
    locallyRemovedGenerationNodesRef,
    settledExtractNodesRef,
    activeJobByNodeRef,
    generationRuntimeHostRef,
    generationRuntimeRef,
    imageToolsAcceptanceRef,
    imageToolsTask,
  } = useCanvasGenerationRuntime();
  const {
    flushCanvasSave,
    handleRetryCanvasSave,
    ensureSavedBeforeProjectSwitch,
    blockedByPendingCanvasReview,
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
    graph,
    groups,
    viewport,
    edges,
    applying,
    saveEpoch,
    rollbackPendingNodes,
    textNodes,
    mediaNodes,
    productNodes,
    assetNodes,
    refetch,
  });
  blockedByPendingCanvasReviewRef.current = blockedByPendingCanvasReview;
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
  useCanvasHomeAgentInject({
    doc,
    placeFileOnCanvas,
    setAgentAssetPicks,
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
  const {
    planReferenceErrors,
    pendingPlanSyncs,
    syncPlanToTarget,
    imagePickMarkedIds,
    videoPickMarkedIds,
    videoPickBlockedIds,
    audioPickMarkedIds,
    locateTextSource,
  } = useCanvasPlanMentions({
    imageSeed,
    videoSeed,
    edges,
    mediaNodes,
    textNodes,
    imagePickSession,
    imagePickSessionActive,
    videoPickSession,
    videoPickSessionActive,
    audioPickSession,
    audioPickSessionActive,
    pickRefRole,
    findCanvasNode,
    setFocusViewport,
    setSelectRequest,
    connectPlanToDraft,
  });
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
  const { handleToolMenuSelect, handleCharacterLibrarySelect } = useCanvasChromeActions({
    setAssetsModalDefaultTab,
    setAssetsModalDefaultFilter,
    setShowAssetsModal,
    handleCreateAssetCard,
    handleCreateProduct,
    characterLibraryTarget,
    pickAssetId,
    setImagePickResult,
    setAssetPickResult,
  });
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
  const { uploadFileToAsset, collectImageInputAssetIds } = useCanvasGenerationUploads({
    currentId,
    showToast,
    mediaNodesRef,
    textNodesRef,
    edgesRef,
    findCanvasNode,
    textAttachmentsOf,
  });
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
    openImageFromHandoff: (params) => generationDock.open('image', {
      seed: { ts: Date.now(), text: '', files: [], params },
    }),
    showToast,
    uploadFileToAsset: (file, type) => uploadFileToAsset(file, type),
    createVideoDraftCard: (seed, position, overrides) => createVideoDraftCard(seed, position, overrides),
    openVideoDraftDialog: (nodeId, preset) => openVideoDraftDialog(nodeId, preset),
    startGenerationJob: (type, parameters, inputAssetIds, videoRefs, targetNodeId, initialDraft) => startGenerationJob(type, parameters, inputAssetIds, videoRefs, targetNodeId, initialDraft),
  });
  const audioVideoMuxInFlightSourceIds = new Set(
    mediaNodes
      .filter((n) => {
        if ((n.data as Record<string, unknown>).genStatus !== 'generating') return false;
        return audioVideoMuxIdentityOf(n) !== undefined;
      })
      .map((n) => audioVideoMuxIdentityOf(n)!.sourceNodeId),
  );
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

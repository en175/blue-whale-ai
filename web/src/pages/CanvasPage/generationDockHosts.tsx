import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { ImageTextAttachment, UploadedFile } from './components/ImageDialog';
import type { AudioRefItem, CanvasPickItem } from './components/AudioDialog';
import type { PickChannel } from './hooks/useCanvasPickers';
import type { AtMentionItem } from './atMention';
import type { VideoRefRole, VideoMediaRefs } from './videoMediaRefs';
import type { FollowDialogAnchor } from './followDialog';
import type { AssetsPickerTarget } from './assetsPickerTargets';
import { audioRefItemMediaTypeOf } from './audioMediaRefs';
import { fetchUrlAsFile } from './canvasPureNodeHelpers';
import { promptMaxLengthOfModel } from '@/lib/prompt-max-length';
import type { ImageGenerationDockHost } from './imageGenerationDock';
import type { VideoGenerationDockHost } from './videoGenerationDock';
import type { AudioGenerationDockHost, MusicGenerationDockHost } from './audioMusicGenerationDock';
import type { TextGenerationDockHost } from './textGenerationDock';
import ImageGenerationDockPanel from './imageGenerationDockPanel';
import VideoGenerationDockPanel from './videoGenerationDockPanel';
import AudioGenerationDockPanel from './audioGenerationDockPanel';
import MusicGenerationDockPanel from './musicGenerationDockPanel';
import TextGenerationDockPanel from './textGenerationDockPanel';

export interface GenerationDockHostsDeps {
  isGeneratingNode: (id: string) => boolean;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  setSubmittingNodeId: (id: string | null) => void;
  textAttachmentsOf: (targetNodeId: string) => ImageTextAttachment[];
  mediaNodesRef: RefObject<Node[]>;
  textNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
}

export interface GenerationDockHostsTargets {
  imageDockHostRef: RefObject<ImageGenerationDockHost | null>;
  videoDockHostRef: RefObject<VideoGenerationDockHost | null>;
  audioDockHostRef: RefObject<AudioGenerationDockHost | null>;
  musicDockHostRef: RefObject<MusicGenerationDockHost | null>;
  textDockHostRef: RefObject<TextGenerationDockHost | null>;
}

interface GenerationDockRenderHost {
  render: () => ReactNode;
  renderedToolKinds: ReadonlySet<string>;
}

interface GenerationDockCore {
  panel: (kind: string) => any;
  open: (kind: string, input: any) => void;
  close: (kind: string) => void;
  updateDraft: (kind: string, patch: any) => void;
  submit: (kind: string, input: any) => any;
  referencePicked: (kind: string) => void;
}

type GenerationDockAtMention = (item: AtMentionItem) => void;

export interface GenerationDockHostsInput {
  currentId: string | null;
  applying: boolean;
  saveBlocked: boolean;
  saveStatus: string;
  submittingNodeId: string | null;
  imageDraftId: string | null;
  imageSeed: { targetNodeId?: string; ts?: number } | null | undefined;
  imagePickResult: { ts: number; files: UploadedFile[] } | null;
  setImagePickResult: (result: { ts: number; files: UploadedFile[] } | null) => void;
  videoDraftId: string | null;
  videoSeed: { targetNodeId?: string; ts?: number } | null | undefined;
  videoPickSessionActive: boolean;
  audioDraftId: string | null;
  audioSeed: { targetNodeId?: string; ts?: number } | null | undefined;
  audioPickResult: { ts: number; item: AudioRefItem } | null;
  setAudioPickResult: (result: { ts: number; item: AudioRefItem } | null) => void;
  audioAssetPickResult: { ts: number; items: AudioRefItem[] } | null;
  setAudioAssetPickResult: (result: { ts: number; items: AudioRefItem[] } | null) => void;
  audioAssetPickTarget: { nodeId: string | null; seed: number | undefined } | null;
  setAudioAssetPickTarget: (target: { nodeId: string | null; seed: number | undefined } | null) => void;
  musicPickResult: { ts: number; item: AudioRefItem } | null;
  textGenDraftId: string | null;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setPickMode: (mode: PickChannel | null) => void;
  setPickTarget: (target: PickChannel | null) => void;
  setPickRefRole: (role: VideoRefRole | null) => void;
  pickTarget: PickChannel | null;
  pickMode: PickChannel | null;
  setImagePickSession: (id: string | null) => void;
  setVideoPickSession: (id: string | null) => void;
  setAudioPickSession: (id: string | null) => void;
  setVideoAssetPickRole: (role: VideoRefRole) => void;
  setVideoAssetPickKind: (kind: 'video' | 'image') => void;
  setCharacterLibraryTarget: (target: 'image' | 'asset' | null) => void;
  setShowCharacterLibrary: (show: boolean) => void;
  endImagePickSession: () => void;
  endVideoPickSession: () => void;
  endAudioPickSession: () => void;
  openAssetsPicker: (target: AssetsPickerTarget) => void;
  closeVideoDialog: () => void;
  closeAudioDialog: () => void;
  closeMusicDialog: () => void;
  closeTextGenDialog: () => void;
  exitEditSessionForGenPanel: () => void;
  canOpenEditor: (nodeId?: string) => boolean;
  isGeneratingNode: (id: string) => boolean;
  isAnchoredOverlayDragHidden: (id: string | null | undefined) => boolean;
  warnStaleMediaRefs: (targetNodeId: string, kind: 'image' | 'video') => void;
  locateTextSource: (nodeId: string) => void;
  followAnchor: FollowDialogAnchor | null;
  planReferenceErrors: { image?: any; video?: any; videoIndices?: any };
  atMentionItems: AtMentionItem[];
  refStripOrderOf: (draftId: string | null | undefined) => string[] | undefined;
  handleRefStripOrderChange: (draftId: string, keys: string[]) => void;
  handleReorderAttachments: (targetNodeId: string, ids: string[]) => void;
  handleReorderVideoMediaRefs: (draftId: string, keys: string[]) => void;
  removeRefEdges: (draftId: string, sourceNodeId: string) => void;
  removePlanAttachment: (targetId: string | undefined, planNodeId: string) => void;
  removeVideoFreeRef: (id: string) => void;
  assignVideoRefRoles: (draftId: string, assignments: Array<{ nodeId: string; role: VideoRefRole }>) => void;
  assignVideoFreeRefRoles: (assignments: Array<{ nodeId: string; role: VideoRefRole }>) => void;
  removeDraftMaterialRef: (draftId: string, materialId: string) => void;
  reorderTargetEdges: (draftId: string, ids: string[]) => void;
  reorderVideoFreeRefs: (keys: string[]) => void;
  pendingPlanSyncs: (targetNodeId: string | undefined) => Array<{ nodeId: string; title: string }> | undefined;
  syncPlanToTarget: (planNodeId: string, targetId: string | undefined) => void;
  collectImageInputAssetIds: (targetNodeId: string | undefined, files: UploadedFile[], useEdgeRefs: boolean) => Promise<string[]>;
  handleAddAudioCanvasRef: (id: string) => void;
  flushCanvasSave: (projectId: string) => Promise<boolean>;
  startGenerationJob: (type: 'image' | 'video' | 'audio', parameters: any, inputAssetIds?: unknown, videoRefs?: unknown, targetNodeId?: string, initialDraft?: unknown, promptDoc?: unknown) => boolean;
  videoRefUnsupportedByModel: (modelId: string, refs: VideoMediaRefs) => string | null;
  editingTargetRef: RefObject<string | null>;
  activeProjectRef: RefObject<string | null>;
  applyingRef: RefObject<boolean>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  generationDock: GenerationDockCore & GenerationDockRenderHost;
  collectCanvasMedia: () => CanvasPickItem[];
  imageAtMention: GenerationDockAtMention;
  videoAtMention: GenerationDockAtMention;
  currentMediaNodes: Node[];
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  uploadFileToAsset: (file: File, type: 'image' | 'audio') => Promise<{ asset_id: string | number; url: string } | null>;
  audioAtMention: GenerationDockAtMention;
  musicAtMention: GenerationDockAtMention;
}

export function buildGenerationDockHosts(
  deps: GenerationDockHostsDeps,
  input: GenerationDockHostsInput,
  targets: GenerationDockHostsTargets,
): void {
  const {
    imageDockHostRef,
    videoDockHostRef,
    audioDockHostRef,
    musicDockHostRef,
    textDockHostRef,
  } = targets;
  const {
    isGeneratingNode,
    patchMediaNode,
    setSubmittingNodeId,
    textAttachmentsOf,
    mediaNodesRef,
    textNodesRef,
    edgesRef,
  } = deps;
  const {
    pickTarget,
    pickMode,
    setPickRefRole,
    currentId,
    applying,
    saveBlocked,
    saveStatus,
    submittingNodeId,
    imageDraftId,
    imageSeed,
    imagePickResult,
    setImagePickResult,
    videoDraftId,
    videoSeed,
    videoPickSessionActive,
    audioDraftId,
    audioSeed,
    audioPickResult,
    setAudioPickResult,
    audioAssetPickResult,
    setAudioAssetPickResult,
    setAudioAssetPickTarget,
    musicPickResult,
    textGenDraftId,
    setTextNodes,
    setPickMode,
    setPickTarget,
    setImagePickSession,
    setVideoPickSession,
    setAudioPickSession,
    setVideoAssetPickRole,
    setVideoAssetPickKind,
    setCharacterLibraryTarget,
    setShowCharacterLibrary,
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
    flushCanvasSave,
    startGenerationJob,
    videoRefUnsupportedByModel,
    editingTargetRef,
    activeProjectRef,
    applyingRef,
    showToast,
    generationDock,
    collectCanvasMedia,
    imageAtMention,
    videoAtMention,
    audioAtMention,
    musicAtMention,
    currentMediaNodes,
    addCanvasEdge,
    uploadFileToAsset,
  } = input;

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
        onMentionCanvas: imageAtMention,
        currentNodes: currentMediaNodes,
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
          const node = currentMediaNodes.find(node => node.id === item.id);
          return node?.data.complianceFailed === true ? { ...item, disabled: true } : item;
        }),
        onMentionCanvas: videoAtMention,
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
      canvasMedia: collectCanvasMedia(),
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
      onMentionCanvas: audioAtMention,
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
    resources={{ canvasMedia: collectCanvasMedia(), mentionItems: atMentionItems, onMentionCanvas: musicAtMention, externalPick: musicPickResult }}
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
}

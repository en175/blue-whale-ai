import { type PickChannel, type VideoRefRole, type AssetsPickerTarget } from '@/custom/enums';
import { useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { ImageTextAttachment, UploadedFile } from './components/ImageDialog';
import type { AudioRefItem, CanvasPickItem } from './components/AudioDialog';

import type { AtMentionItem } from './atMention';
import type { VideoMediaRefs } from './tools/video/videoMediaRefs';
import type { FollowDialogAnchor } from './followDialog';

import { audioRefItemMediaTypeOf } from './tools/audio/audioMediaRefs';
import { fetchUrlAsFile } from './canvasPureNodeHelpers';
import { promptMaxLengthOfModel } from '@/custom/utils/prompt-max-length';
import type { ImageGenerationDockHost } from './tools/image/imageGenerationDock';
import type { VideoGenerationDockHost } from './tools/video/videoGenerationDock';
import type { AudioGenerationDockHost, MusicGenerationDockHost } from './tools/audio/audioMusicGenerationDock';
import type { TextGenerationDockHost } from './textGenerationDock';
import type { CanvasGenerationSubmissionHandles } from './hooks/useCanvasGenerationSubmission';
import { useGenerationDockBinding } from './hooks/useGenerationDockBinding';
import ImageGenerationDockPanel from './tools/image/imageGenerationDockPanel';
import VideoGenerationDockPanel from './tools/video/videoGenerationDockPanel';
import AudioGenerationDockPanel from './tools/audio/audioGenerationDockPanel';
import MusicGenerationDockPanel from './tools/audio/musicGenerationDockPanel';
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
  startGenerationJob: CanvasGenerationSubmissionHandles['startGenerationJob'];
  videoRefUnsupportedByModel: (modelId: string, refs: VideoMediaRefs) => string | null;
  editingTargetRef: RefObject<string | null>;
  activeProjectRef: RefObject<string | null>;
  applyingRef: RefObject<boolean>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  generationDock: ReturnType<typeof useGenerationDockBinding>['generationDock'];
  collectCanvasMedia: () => CanvasPickItem[];
  imageAtMention: GenerationDockAtMention;
  videoAtMention: GenerationDockAtMention;
  currentMediaNodes: Node[];
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  uploadFileToAsset: (file: File, type: 'image' | 'audio') => Promise<{ asset_id: string | number; url: string } | null>;
  audioAtMention: GenerationDockAtMention;
  musicAtMention: GenerationDockAtMention;
}

function createMediaDockBase(
  depsRef: RefObject<GenerationDockHostsDeps>,
  inputRef: RefObject<GenerationDockHostsInput>,
  kind: 'image' | 'video' | 'audio',
) {
  return {
    getNodes: () => [...depsRef.current.mediaNodesRef.current, ...depsRef.current.textNodesRef.current],
    getEdges: () => depsRef.current.edgesRef.current,
    attachmentsOf: (nodeId: string) => depsRef.current.textAttachmentsOf(nodeId),
    canOpen: (nodeId?: string) => inputRef.current.canOpenEditor(nodeId),
    beginEdit: (nodeId?: string) => {
      if (nodeId) inputRef.current.editingTargetRef.current = nodeId;
      inputRef.current.exitEditSessionForGenPanel();
    },
    patchNode: (nodeId: string, patch: Record<string, unknown>) => depsRef.current.patchMediaNode(nodeId, patch),
    getAvailability: () => {
      const { submittingNodeId, saveBlocked, saveStatus } = inputRef.current;
      return { submittingNodeId, saveFailed: saveBlocked || saveStatus === 'error' };
    },
    getProjectId: () => inputRef.current.currentId,
    isApplying: () => inputRef.current.applyingRef.current,
    isSaveBlocked: () => {
      const { saveBlocked, saveStatus } = inputRef.current;
      return kind === 'audio' ? saveBlocked || saveStatus === 'error' : saveBlocked;
    },
    setApplying: (value: boolean) => { inputRef.current.applyingRef.current = value; },
    setSubmittingNode: (id: string | null) => depsRef.current.setSubmittingNodeId(id),
    promptMaxLength: (modelId: string) => promptMaxLengthOfModel(kind, modelId),
    save: (projectId: string) => inputRef.current.flushCanvasSave(projectId),
    toast: (type: 'success' | 'error' | 'warn', msg: string) => inputRef.current.showToast(type, msg),
  };
}

function createGenerationDockHostBag(
  depsRef: RefObject<GenerationDockHostsDeps>,
  inputRef: RefObject<GenerationDockHostsInput>,
) {
  const image: ImageGenerationDockHost = {
    ...createMediaDockBase(depsRef, inputRef, 'image'),
    endPicking: () => inputRef.current.endImagePickSession(),
    clearPickResult: () => inputRef.current.setImagePickResult(null),
    collectInputAssetIds: (targetNodeId, files, useEdgeRefs) =>
      inputRef.current.collectImageInputAssetIds(targetNodeId, files, useEdgeRefs),
    isProjectCurrent: (projectId) => inputRef.current.activeProjectRef.current === projectId,
    startTask: (task) => inputRef.current.startGenerationJob('image', {
      prompt: task.text, model_id: task.modelId, aspect_ratio: task.ratio, size: task.size,
    }, undefined, task.references.length ? { references: task.references } : undefined, task.targetNodeId, undefined, task.promptDoc),
    reportError: (error) => console.warn('图片生成前准备失败:', error),
    render: () => {
      const input = inputRef.current;
      const { generationDock, imageDraftId, imageSeed, isAnchoredOverlayDragHidden } = input;
      return (
        <ImageGenerationDockPanel
          view={generationDock.panel('image')}
          actions={{
            close: () => generationDock.close('image'),
            updateDraft: (patch) => generationDock.updateDraft('image', patch),
            submit: (send) => generationDock.submit('image', send),
          }}
          resources={{
            projectId: input.currentId ?? undefined,
            stripOrder: input.refStripOrderOf(imageDraftId),
            onStripOrderChange: imageDraftId ? (keys) => input.handleRefStripOrderChange(imageDraftId, keys) : undefined,
            onRemoveAttachment: (id) => {
              const targetId = imageDraftId ?? imageSeed?.targetNodeId;
              if (targetId && input.isGeneratingNode(targetId)) return;
              input.removePlanAttachment(targetId, id);
              generationDock.updateDraft('image', { attachments: { targetNodeId: targetId, removeNodeId: id } });
            },
            pendingPlanSyncs: input.pendingPlanSyncs(imageSeed?.targetNodeId),
            onSyncPlan: (id) => input.syncPlanToTarget(id, imageSeed?.targetNodeId),
            syncingPlan: input.applying,
            planReferenceError: input.planReferenceErrors.image,
            onRemoveMediaRef: imageDraftId ? (nodeId) => input.removeRefEdges(imageDraftId, nodeId) : undefined,
            onLocateTextSource: input.locateTextSource,
            onReorderMediaRefs: imageDraftId ? (ids) => input.reorderTargetEdges(imageDraftId, ids) : undefined,
            onReorderAttachments: imageSeed?.targetNodeId ? (ids) => input.handleReorderAttachments(imageSeed.targetNodeId!, ids) : undefined,
            onPickFromCanvas: () => {
              input.setPickMode('image');
              input.setPickTarget('image');
              input.setImagePickSession(imageDraftId);
            },
            onPickFromAssets: () => input.openAssetsPicker('imageDialog'),
            pickMode: input.pickMode === 'image',
            externalPick: input.imagePickResult,
            onExternalPickConsumed: () => input.setImagePickResult(null),
            onOpenCharacterLibrary: () => {
              input.setCharacterLibraryTarget('image');
              input.setShowCharacterLibrary(true);
            },
            onToast: input.showToast,
            mentionItems: input.atMentionItems.filter((item) => item.id !== imageDraftId),
            onMentionCanvas: input.imageAtMention,
            currentNodes: input.currentMediaNodes,
            followAnchor: imageDraftId ? input.followAnchor : null,
            dragHidden: isAnchoredOverlayDragHidden(imageDraftId),
          }}
        />
      );
    },
  };

  const video: VideoGenerationDockHost = {
    ...createMediaDockBase(depsRef, inputRef, 'video'),
    endPicking: () => inputRef.current.endVideoPickSession(),
    resetAssetPicking: () => {
      inputRef.current.setVideoAssetPickRole('reference');
      inputRef.current.setVideoAssetPickKind('video');
    },
    warnStaleRefs: (id) => inputRef.current.warnStaleMediaRefs(id, 'video'),
    refUnsupported: (modelId, refs) => inputRef.current.videoRefUnsupportedByModel(modelId, refs),
    startTask: (task) => inputRef.current.startGenerationJob('video', task.parameters, undefined,
      task.references.length ? { references: task.references } : undefined,
      task.targetNodeId,
      { mode: task.options.mode, references: [], ...(task.options.sampleMode && task.options.expectedCredits != null && task.options.quoteRevision ? { expectedCredits: task.options.expectedCredits, quoteRevision: task.options.quoteRevision } : {}) },
      task.promptDoc ?? undefined),
    reportError: (error) => console.warn('生成前画布落盘失败:', error),
    render: () => {
      const input = inputRef.current;
      const { generationDock, videoDraftId, videoSeed, isAnchoredOverlayDragHidden } = input;
      return (
        <VideoGenerationDockPanel
          view={generationDock.panel('video')}
          actions={{ close: input.closeVideoDialog, updateDraft: (patch) => generationDock.updateDraft('video', patch), submit: (send) => generationDock.submit('video', send) }}
          resources={{
            projectId: input.currentId ?? undefined,
            stripOrder: input.refStripOrderOf(videoDraftId),
            onStripOrderChange: videoDraftId ? (keys) => input.handleRefStripOrderChange(videoDraftId, keys) : undefined,
            onRemoveAttachment: (id) => {
              const targetId = videoDraftId ?? videoSeed?.targetNodeId;
              if (targetId && input.isGeneratingNode(targetId)) return;
              input.removePlanAttachment(targetId, id);
              generationDock.updateDraft('video', { attachments: { targetNodeId: targetId, removeNodeId: id } });
            },
            pendingPlanSyncs: input.pendingPlanSyncs(videoSeed?.targetNodeId),
            onSyncPlan: (id) => input.syncPlanToTarget(id, videoSeed?.targetNodeId),
            syncingPlan: input.applying,
            planReferenceError: input.planReferenceErrors.video,
            planIndices: input.planReferenceErrors.videoIndices,
            onLocateTextSource: input.locateTextSource,
            onReorderAttachments: videoSeed?.targetNodeId ? (ids) => input.handleReorderAttachments(videoSeed.targetNodeId!, ids) : undefined,
            onPickFromCanvas: (kind, role) => {
              input.endImagePickSession();
              input.setPickMode(kind);
              input.setPickTarget('video');
              input.setPickRefRole(role ?? null);
              input.setVideoPickSession(videoDraftId ?? null);
            },
            onPickFromAssets: (kind, role) => {
              input.setVideoAssetPickRole(role ?? 'reference');
              input.setVideoAssetPickKind(kind);
              input.openAssetsPicker('videoDraft');
            },
            pickMode: input.pickTarget === 'video' && input.pickMode !== 'audio' && input.pickMode !== 'product' && input.pickMode !== 'asset' ? input.pickMode : null,
            pickLocked: input.videoPickSessionActive,
            onRemoveVideoRef: videoDraftId ? (id) => input.removeRefEdges(videoDraftId, id) : input.removeVideoFreeRef,
            onAssignRefRoles: videoDraftId ? (assignments) => input.assignVideoRefRoles(videoDraftId, assignments) : input.assignVideoFreeRefRoles,
            onRemoveMaterialRef: videoDraftId ? (id) => input.removeDraftMaterialRef(videoDraftId, id) : input.removeVideoFreeRef,
            onReorderMediaRefs: videoDraftId ? (keys) => input.handleReorderVideoMediaRefs(videoDraftId, keys) : input.reorderVideoFreeRefs,
            onToast: input.showToast,
            mentionItems: input.atMentionItems.filter((item) => item.id !== videoDraftId).map((item) => {
              const node = input.currentMediaNodes.find((media) => media.id === item.id);
              return node?.data.complianceFailed === true ? { ...item, disabled: true } : item;
            }),
            onMentionCanvas: input.videoAtMention,
            followAnchor: videoDraftId ? input.followAnchor : null,
            dragHidden: isAnchoredOverlayDragHidden(videoDraftId),
          }}
        />
      );
    },
  };

  const audio: AudioGenerationDockHost = {
    ...createMediaDockBase(depsRef, inputRef, 'audio'),
    endPicking: () => inputRef.current.endAudioPickSession(),
    clearPickResult: () => inputRef.current.setAudioPickResult(null),
    addReferenceEdge: (source, target) => inputRef.current.addCanvasEdge(source, target),
    fetchFile: fetchUrlAsFile,
    upload: (file, type) => inputRef.current.uploadFileToAsset(file, type),
    startTask: (task) => inputRef.current.startGenerationJob('audio', { prompt: task.text, model_id: task.modelId }, undefined,
      task.refs.length ? { references: task.refs.map((ref) => ({ role: 'reference' as const, type: audioRefItemMediaTypeOf(ref), asset_id: String(ref.assetId) })) } : undefined,
      task.targetNodeId, undefined, task.promptDoc),
    reportError: (error) => console.warn('音频生成前准备失败:', error),
    render: () => {
      const input = inputRef.current;
      const { generationDock, audioDraftId, audioSeed, isAnchoredOverlayDragHidden } = input;
      return (
        <AudioGenerationDockPanel
          view={generationDock.panel('audio')}
          actions={{ close: input.closeAudioDialog, updateDraft: (patch) => generationDock.updateDraft('audio', patch), submit: (send) => generationDock.submit('audio', send), switchToMusic: () => { generationDock.open('music', { fromAudio: true }); } }}
          resources={{
            projectId: input.currentId ?? undefined,
            stripOrder: input.refStripOrderOf(audioDraftId),
            onStripOrderChange: audioDraftId ? (keys) => input.handleRefStripOrderChange(audioDraftId, keys) : undefined,
            onToast: input.showToast,
            canvasMedia: input.collectCanvasMedia(),
            onPickFromCanvas: () => {
              input.endImagePickSession();
              input.endVideoPickSession();
              input.setPickMode('audio');
              input.setPickTarget('audio');
              input.setAudioPickSession(audioDraftId ?? null);
            },
            onPickFromAssets: () => {
              generationDock.referencePicked('audio');
              input.setPickMode(null);
              input.setPickTarget(null);
              input.setAudioAssetPickTarget({ nodeId: audioDraftId, seed: audioSeed?.ts });
              input.openAssetsPicker('audioDialog');
            },
            externalAssetPick: input.audioAssetPickResult,
            onAssetPickConsumed: () => input.setAudioAssetPickResult(null),
            externalPick: input.audioPickResult,
            pickMode: input.pickMode === 'audio',
            onLocateTextSource: input.locateTextSource,
            onRemoveDraftRef: audioDraftId ? (nodeId) => input.removeRefEdges(audioDraftId, nodeId) : undefined,
            onAddCanvasRef: audioDraftId ? input.handleAddAudioCanvasRef : undefined,
            mentionItems: input.atMentionItems.filter((item) => item.id !== audioDraftId),
            onMentionCanvas: input.audioAtMention,
            followAnchor: audioDraftId ? input.followAnchor : null,
            dragHidden: isAnchoredOverlayDragHidden(audioDraftId),
            onRemoveAttachment: (id) => input.removePlanAttachment(audioDraftId ?? undefined, id),
            onReorderAttachments: audioDraftId ? (ids) => input.handleReorderAttachments(audioDraftId, ids) : undefined,
          }}
        />
      );
    },
  };

  const music: MusicGenerationDockHost = {
    beginEdit: () => inputRef.current.exitEditSessionForGenPanel(),
    recordSend: (send) => { console.log('Music dialog send:', send.text, send.model, send.options, send.refs); },
    render: () => {
      const input = inputRef.current;
      return (
        <MusicGenerationDockPanel
          actions={{ close: input.closeMusicDialog, submit: (send) => input.generationDock.submit('music', send), switchToAudio: () => { input.generationDock.open('audio', {}); } }}
          resources={{ canvasMedia: input.collectCanvasMedia(), mentionItems: input.atMentionItems, onMentionCanvas: input.musicAtMention, externalPick: input.musicPickResult }}
        />
      );
    },
  };

  const text: TextGenerationDockHost = {
    getNodes: () => depsRef.current.textNodesRef.current,
    getEdges: () => depsRef.current.edgesRef.current,
    attachmentsOf: (nodeId) => depsRef.current.textAttachmentsOf(nodeId),
    beginEdit: () => inputRef.current.exitEditSessionForGenPanel(),
    patchNode: (id, data) => inputRef.current.setTextNodes((previous) => previous.map((node) => node.id === id ? { ...node, data: { ...node.data, ...data } } : node)),
    render: () => {
      const input = inputRef.current;
      const { isAnchoredOverlayDragHidden } = input;
      return (
        <TextGenerationDockPanel
          view={input.generationDock.panel('text')}
          actions={{ close: input.closeTextGenDialog, updateDraft: (patch) => input.generationDock.updateDraft('text', patch), submit: (send) => input.generationDock.submit('text', send) }}
          resources={{ followAnchor: input.followAnchor, dragHidden: isAnchoredOverlayDragHidden(input.textGenDraftId) }}
        />
      );
    },
  };

  return { image, video, audio, music, text };
}

export function useGenerationDockHosts(
  deps: GenerationDockHostsDeps,
  input: GenerationDockHostsInput,
  targets: GenerationDockHostsTargets,
): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const inputRef = useRef(input);
  inputRef.current = input;
  const hosts = useMemo(() => createGenerationDockHostBag(depsRef, inputRef), []);
  if (targets.imageDockHostRef.current !== hosts.image) {
    targets.imageDockHostRef.current = hosts.image;
    targets.videoDockHostRef.current = hosts.video;
    targets.audioDockHostRef.current = hosts.audio;
    targets.musicDockHostRef.current = hosts.music;
    targets.textDockHostRef.current = hosts.text;
  }
}

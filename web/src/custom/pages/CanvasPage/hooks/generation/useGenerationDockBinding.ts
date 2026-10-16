import { useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import type { Node } from '@xyflow/react';
import type { VideoGenSeedParams } from '../../components/BottomDialog';
import { createGenerationDockCoordinator } from '../../generation/generationDockCoordinator';
import { createImageGenerationDock, type ImageGenerationDockHost } from '../../tools/image/imageGenerationDock';
import { createVideoGenerationDock, type VideoGenerationDockHost } from '../../tools/video/videoGenerationDock';
import { createAudioMusicGenerationDocks, type AudioGenerationDockHost, type MusicGenerationDockHost } from '../../tools/audio/audioMusicGenerationDock';
import { createTextGenerationDock, type TextGenerationDockHost } from '../../generation/textGenerationDock';
import { createToolGenerationDock } from '../../tool-runtime/toolGenerationDock';
import { createCanvasToolSessions, type CanvasToolView } from '../../tool-runtime/canvasToolSessions';
import type { ToolSessionDeps } from '../../tool-runtime/toolSessionCoordinator';

type CanvasToolSessions = ReturnType<typeof createCanvasToolSessions>;

export interface GenerationDockBindingInput {
  toolSessions: CanvasToolSessions;
  toolViewRef: RefObject<CanvasToolView | null>;
  toolDepsRef: RefObject<ToolSessionDeps | null>;
  mediaNodesRef: RefObject<Node[]>;
}

export function useGenerationDockBinding(input: GenerationDockBindingInput) {
  const { toolSessions, toolViewRef, toolDepsRef, mediaNodesRef } = input;
  const toolRuntime = toolSessions.runtime;
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
      updateDraft: value => toolViewRef.current!.changeVideoParams(value.nodeId, value.value),
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
      updateDraft: value => toolViewRef.current!.changeFrameParams(value.nodeId, value.value),
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
  const { visible: showAudioDialog, boundId: audioDraftId, seed: audioSeed } = generationDock.panel('audio');
  const { visible: showTextGenDialog, boundId: textGenDraftId } = generationDock.panel('text');
  const closeVideoDialog = () => generationDock.close('video');
  const closeAudioDialog = () => generationDock.close('audio');
  const closeTextGenDialog = () => generationDock.close('text');
  const closeMusicDialog = () => generationDock.close('music');
  const dismissGenPanels = () => generationDock.dismissAll('ordinary');
  const dismissAllGenPanels = () => generationDock.dismissAll();
  const openImageDraftDialog = (nodeId: string) => generationDock.open('image', { nodeId });
  const openVideoDraftDialog = (nodeId: string, preset?: VideoGenSeedParams) => generationDock.open('video', { nodeId, preset });
  const openTextGenDialog = (nodeId: string, intent?: 'nodeClick') => generationDock.open('text', { nodeId, intent });
  const openAudioDraftDialog = (nodeId: string) => generationDock.open('audio', { nodeId });
  const openMediaDraftDialog = (nodeId: string, mediaType: unknown, intent?: 'selection') => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const toolDraft = node && toolSessions.draft(node);
    if (toolDraft) { openCoordinatedToolDraft(node!, toolDraft.open); return; }
    if (mediaType === 'video') return generationDock.open('video', { nodeId, intent });
    if (mediaType === 'audio') return generationDock.open('audio', { nodeId, intent });
    return generationDock.open('image', { nodeId, intent });
  };
  return {
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
  };
}

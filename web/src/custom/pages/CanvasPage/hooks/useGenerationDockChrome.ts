import { useEffect } from 'react';
import type { Node } from '@xyflow/react';
import { isEditableKeyboardTarget } from '../components/Canvas/keyboardDelete';
import type { createGenerationDockCoordinator } from '../generationDockCoordinator';
import type { createCanvasToolSessions } from '../canvasToolSessions';

export interface GenerationDockChromeInput {
  generationDock: ReturnType<typeof createGenerationDockCoordinator>;
  toolRuntime: ReturnType<typeof createCanvasToolSessions>['runtime'];
  mediaNodes: Node[];
  textNodes: Node[];
  showImageDialog: boolean;
  showBottomDialog: boolean;
  showAudioDialog: boolean;
  imageDraftId: string | null;
  imageSeed: unknown;
  videoDraftId: string | null;
  videoSeed: unknown;
  audioDraftId: string | null;
  audioSeed: unknown;
  textGenDraftId: string | null;
  imagePickSession: string | null | undefined;
  videoPickSession: string | null | undefined;
  audioPickSession: string | null | undefined;
  imagePickSessionActive: boolean;
  videoPickSessionActive: boolean;
  audioPickSessionActive: boolean;
  pickMode: unknown;
  pickTarget: unknown;
  editSessionActive: boolean;
  resetPickState: () => void;
  endImagePickSession: () => void;
  endVideoPickSession: () => void;
  endAudioPickSession: () => void;
  dismissAllGenPanels: () => void;
}

export function useGenerationDockChrome(input: GenerationDockChromeInput): void {
  const {
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
  } = input;
  const anyGenPanelOpen = generationDock.view.activePanel !== null;
  useEffect(() => {
    if (!anyGenPanelOpen) return;
    const CLICK_DRAG_SLOP_PX = 4;
    let downAt: { x: number; y: number } | null = null;
    let downInTerritory = false;
    const onMouseDown = (event: MouseEvent) => {
      downAt = { x: event.clientX, y: event.clientY };
      const target = event.target;
      downInTerritory = target instanceof Element && target.closest('[data-gen-panel-territory]') != null;
    };
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-gen-panel-territory]')) return;
      if (target.closest('.react-flow')) return;
      if (downInTerritory) return;
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
  useEffect(() => { generationDock.reconcile(); }, [generationDock, videoDraftId, videoSeed, mediaNodes]);
  useEffect(() => { generationDock.reconcile(); }, [generationDock, audioDraftId, audioSeed, mediaNodes]);
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, useStore, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Image, Video, AudioLines, ImageOff, Plus, Check, RefreshCw, ChevronDown, Clock, Film } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/shared/useDismissOnOutside';
import { isMediaExtractNodeId, type MediaExtractIdentity } from '../../media/mediaExtract';
import { isAudioTrimNodeId } from '../../tools/audio/audioTrim';
import { isAudioMixNodeId } from '../../tools/audio/audioMix';
import type { AudioVideoMuxIdentity } from '../../tools/audio/audioVideoMux';
import type { ImageEnhanceIdentity } from '../../tools/image/imageEnhance';
import type { ImageCutoutIdentity } from '../../tools/image/imageCutout';
import type { ImageCropIdentity } from '../../tools/image/imageCrop';
import type { VideoEnhanceIdentity } from '../../tools/video/videoEnhance';
import { type MediaGenStatus, type VideoSubtitleEraseMode } from '@/custom/enums';
import type { FrameInterpolationIdentity } from '../../tools/video/frameInterpolation';
import type { MaskOp, MaskPoint } from '../../tools/image/eraseMask';
import type { SubtitleBoxOp, SubtitleBoxPoint } from '../../tools/video/subtitleEraseBoxes';

import type { SmartMattingMode } from '../../tools/image/smartMatting';
import EraseMaskLayer from './EraseMaskLayer';
import SubtitleEraseBoxesLayer from './SubtitleEraseBoxesLayer';
import AudioTrimOverlay from './AudioTrimOverlay';
import AudioPlayer from './AudioPlayer';
import { useAudioTrimSeekBridge } from './useAudioTrimSeekBridge';
import VideoPlayerControls from './VideoPlayerControls';
import { sampleDeadlineExpired, videoSourceList, videoLoadErrorMessage, toggleVideoPlayback } from './mediaPlayback';
import { commitCardName } from '../cardName';
import { mediaNodeFailHeadline } from './failHeadline';
import { isCanvasToolGeneration, mediaNodeGenerationOverlay } from './generationOverlay';
import { mediaContentBox, type MediaDims } from './mediaContentSize';
import { HOVER_PREVIEW_DELAY_MS, videoHoverPreviewBlocked, videoHoverPreviewEligible } from './hoverPreview';
import { isMultiNodeSelection } from '../../hooks/chrome/useSoloNodeSelected';
import { nodeTitleSizing } from '../nodeTitleSizing';
import CanvasContextMenu from '../CanvasContextMenu';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { isTaskTypeParamConstraintCode } from '@/custom/utils/video-reference-hints';
import styles from './index.module.css';

const HANDLE_STYLE = { background: 'transparent', border: 'none', width: 24, height: 24 } as const;

function HandlePlus({ onAdd }: { onAdd?: (client: { x: number; y: number }) => void }) {
  return (
    <span className="nodrag nopan" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 24,
      height: 24,
      borderRadius: '50%',
      background: '#2a2a2a',
      border: '1px solid #555',
      color: '#ccc',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      cursor: onAdd ? 'pointer' : undefined,
    }}
      onClick={(e) => {
        if (!onAdd) return;
        e.stopPropagation();
        onAdd({ x: e.clientX, y: e.clientY });
      }}
    >
      <Plus size={14} strokeWidth={2.5} />
    </span>
  );
}

const durationLabel = (duration?: number) =>
  typeof duration === 'number' && duration > 0 ? `${Math.round(duration)}s` : '';

const VIDEO_CLICK_SLOP_PX = 6;

function isVideoClickSlop(press: { x: number; y: number }, clientX: number, clientY: number) {
  const dx = clientX - press.x;
  const dy = clientY - press.y;
  return dx * dx + dy * dy > VIDEO_CLICK_SLOP_PX ** 2;
}

const pendingFirstFrameSeek = new WeakSet<HTMLVideoElement>();

function sampleDeadlineLabel(at?: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function paintVideoFirstFrame(
  video: HTMLVideoElement | null,
  onSeeked?: (video: HTMLVideoElement) => void,
) {
  if (!video) return;
  if (video.readyState < 1) return;
  if (!video.paused) return;
  const duration = video.duration;
  const epsilon = Number.isFinite(duration) && duration > 0 ? Math.min(0.04, duration / 4) : 0.04;
  if (video.currentTime >= epsilon) {
    onSeeked?.(video);
    return;
  }
  if (pendingFirstFrameSeek.has(video)) return;
  pendingFirstFrameSeek.add(video);
  const handleSeeked = () => {
    pendingFirstFrameSeek.delete(video);
    video.removeEventListener('seeked', handleSeeked);
    onSeeked?.(video);
  };
  video.addEventListener('seeked', handleSeeked, { once: true });
  try {
    video.currentTime = epsilon;
  } catch {
    pendingFirstFrameSeek.delete(video);
    video.removeEventListener('seeked', handleSeeked);
  }
}

export interface MediaNodeData {
  src?: string;
  srcH264?: string;
  fileName?: string;
  mediaType?: 'image' | 'video' | 'audio';
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  jobId?: number | string;
  genStatus?: MediaGenStatus;
  audioMixCancelPending?: boolean;
  draft?: boolean;
  draftModelId?: string;
  draftSize?: string;
  draftRatio?: string;
  videoStage?: 'sample' | 'final';
  finalizeDeadlineAt?: string | null;
  sourceSampleJobId?: string;
  chargeState?: 'held' | 'settled' | 'released';
  actualCredits?: number | null;
  finalizeCta?: {
    phase: 'ready' | 'loading' | 'running' | 'checking' | 'expired' | 'unavailable';
    credits?: number;
  };
  onFinalizeSample?: (id: string) => void;
  regenerateCta?: {
    phase: 'ready' | 'loading' | 'checking' | 'unavailable';
    credits?: number;
  };
  onRegenerateSample?: (id: string) => void;
  imageEnhance?: ImageEnhanceIdentity;
  videoEnhance?: VideoEnhanceIdentity;
  frameInterpolation?: FrameInterpolationIdentity;
  imageCutout?: ImageCutoutIdentity;
  imageCrop?: ImageCropIdentity;
  progress?: number;
  errorText?: string;
  errorCode?: number | string;
  prompt?: string;
  assetId?: string | number;
  materialId?: string;
  emptyShell?: boolean;
  complianceBusy?: boolean;
  compliancePassed?: boolean;
  complianceFailed?: boolean;
  assetMissing?: boolean;
  mime?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  targetRatio?: string;
  inputStale?: boolean;
  inputSourceNodeId?: string | null;
  onLocateInputSource?: (sourceNodeId: string) => void;
  onUpdateGenerate?: (id: string) => void;
  pickMarked?: boolean;
  soloToolbarHidden?: boolean;
  pickBlocked?: boolean;
  eraseEditing?: {
    ops: readonly MaskOp[];
    liveOp: MaskOp | null;
    onStrokeStart: (point: MaskPoint) => void;
    onStrokeMove: (point: MaskPoint) => void;
    onStrokeEnd: () => void;
  };
  subtitleEraseEditing?: {
    boxes: readonly SubtitleBoxOp[];
    liveBox: SubtitleBoxOp | null;
    onBoxStart: (point: SubtitleBoxPoint) => void;
    onBoxMove: (point: SubtitleBoxPoint) => void;
    onBoxEnd: () => void;
  };
  subtitleErasePaused?: true;
  splitEditing?: true;
  trimEditing?: {
    selection: { start: number; end: number };
    duration: number;
    onSelectionChange: (selection: { start: number; end: number }) => void;
  };
  speedEditing?: true | { speed: number };
  mediaExtract?: MediaExtractIdentity;
  audioVideoMux?: AudioVideoMuxIdentity;
  cropEditing?: true;
  onMediaDims?: (id: string, dims: MediaDims) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  onCancelJob?: (id: string) => void;
  onRetryJob?: (id: string) => void;
  onAddLeft?: (client: { x: number; y: number }) => void;
  onAddRight?: (client: { x: number; y: number }) => void;
  onFixFollowVideo?: (id: string) => void;
  onTitleChange?: (id: string, name: string) => void;
  onEnhanceImage?: (id: string) => void;
  onEraseImage?: (id: string) => void;
  onOutpaintImage?: (id: string) => void;
  onCropImage?: (id: string) => void;
  onCutoutImage?: (id: string) => void;
  onVideoSubtitleErase?: (id: string, mode: VideoSubtitleEraseMode) => void;
  onVideoEnhance?: (id: string) => void;
  onFrameInterpolation?: (id: string) => void;
  onAudioVideoSplit?: (id: string) => void;
  onTrimAudio?: (id: string) => void;
  onMixAudio?: (id: string) => void;
  onComposeAudioVideo?: (id: string) => void;
  onAudioSpeed?: (id: string) => void;
  onVocalBackgroundSplit?: (id: string) => void;
  onSceneSplit?: (id: string) => void;
  onSmartMatting?: (id: string, mode: SmartMattingMode) => void;
  onDownload?: (id: string) => void;
  onShowDetails?: (id: string) => void;
  onPaste?: (id: string) => void;
  onCopyImage?: (id: string) => void;
  onComplianceCheck?: (id: string) => void;
  onFillEmptyShell?: (id: string, file: File) => void;
}

export default function MediaNode({ id, data, selected }: NodeProps & { data: MediaNodeData; selected?: boolean }) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const shellFileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoPosterRef = useRef<HTMLCanvasElement | null>(null);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [staleMenuOpen, setStaleMenuOpen] = useState(false);
  const staleMenuRef = useRef<HTMLDivElement>(null);

  const zoom = useStore((state) => state.transform[2]);
  const multiNodeSelection = useStore((state) => isMultiNodeSelection(state.nodes));
  const isSelect = data.toolMode === 'select';
  const subtitleEraseLocked = data.subtitleEraseEditing != null || data.subtitleErasePaused === true;
  const videoInteractive = Boolean(selected) && isSelect && !subtitleEraseLocked;
  const [videoControlsArmed, setVideoControlsArmed] = useState(false);
  const [hoverPlaying, setHoverPlaying] = useState(false);
  const [adoptedVideoRef, setAdoptedVideoRef] = useState<React.RefObject<HTMLVideoElement | null> | null>(null);
  const videoPressRef = useRef<{ x: number; y: number } | null>(null);
  const hoverPreviewHostRef = useRef<HTMLDivElement | null>(null);
  const hoverSessionRef = useRef<{
    video: HTMLVideoElement;
    onEnded: () => void;
    homeHost: Node | null;
    inTree: boolean;
    yielded: boolean;
    adopted?: boolean;
    onPause?: () => void;
    onPlay?: () => void;
    onSeeked?: () => void;
    onVideoMouseDown?: (event: MouseEvent) => void;
    onVideoClick?: (event: MouseEvent) => void;
  } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!videoInteractive) {
      setVideoControlsArmed(false);
      if (!hoverPlaying) videoRef.current?.pause();
      return;
    }
    if (hoverPlaying) return;
    const timer = window.setTimeout(() => setVideoControlsArmed(true), 80);
    return () => window.clearTimeout(timer);
  }, [videoInteractive, hoverPlaying]);

  const commitName = useCallback(() => {
    const result = commitCardName(nameDraft, data.fileName ?? '');
    if (result.kind === 'invalid') {
      setNameError(result.message);
      return;
    }
    setNameError('');
    setNameEditing(false);
    if (result.kind === 'save') data.onTitleChange?.(id, result.value);
  }, [data, id, nameDraft]);

  const cancelName = useCallback(() => {
    setNameDraft(data.fileName ?? '');
    setNameError('');
    setNameEditing(false);
  }, [data.fileName]);

  useDismissOnOutside([
    { open: staleMenuOpen, ref: staleMenuRef, dismiss: () => setStaleMenuOpen(false) },
  ]);

  useEffect(() => {
    if (!staleMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setStaleMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [staleMenuOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!subtitleEraseLocked) return;
    videoRef.current?.pause();
  }, [subtitleEraseLocked]);

  useEffect(() => {
    if (!data.splitEditing) return;
    videoRef.current?.pause();
  }, [data.splitEditing]);

  const trimSeekBridge = useAudioTrimSeekBridge();

  const isEmptyShell = data.emptyShell === true;
  const isGenHost =
    data.draft === true
    || data.genStatus === 'draft'
    || data.genStatus === 'generating'
    || data.genStatus === 'failed'
    || data.genStatus === 'cancelled'
    || data.jobId != null
    || data.imageCrop != null;
  const showTargetHandle = !isEmptyShell && isGenHost;
  const blockNodeMenu =
    isEmptyShell || data.genStatus === 'generating' || data.genStatus === 'checking';

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (data.toolMode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    if (blockNodeMenu) return;
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [data.toolMode, blockNodeMenu]);

  const handleDelete = useCallback(() => {
    setContextMenu(null);
    data.onDelete?.(id);
  }, [data, id]);

  const handleDuplicate = useCallback(() => {
    setContextMenu(null);
    data.onDuplicate?.(id);
  }, [data, id]);

  const handleAddToChat = useCallback(() => {
    setContextMenu(null);
    data.onAddToChat?.(id);
  }, [data, id]);

  const acceptShellFile = useCallback((file: File | undefined) => {
    if (!file) return;
    data.onFillEmptyShell?.(id, file);
  }, [data, id]);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h) return;
    if (data.width === w && data.height === h) return;
    data.onMediaDims?.(id, { width: w, height: h });
  }, [data, id]);

  const onMediaDims = data.onMediaDims;
  const syncVideoDims = useCallback((video: HTMLVideoElement) => {
    const { videoWidth: w, videoHeight: h, duration } = video;
    const dims: MediaDims = {};
    if (w > 0) dims.width = w;
    if (h > 0) dims.height = h;
    if (Number.isFinite(duration) && duration > 0 && typeof data.duration !== 'number') {
      dims.duration = duration;
    }
    const widthUnchanged = dims.width === undefined || data.width === dims.width;
    const heightUnchanged = dims.height === undefined || data.height === dims.height;
    if (widthUnchanged && heightUnchanged && dims.duration === undefined) return;
    onMediaDims?.(id, dims);
  }, [data.width, data.height, data.duration, onMediaDims, id]);

  const [videoError, setVideoError] = useState<{ code?: number } | null>(null);
  useEffect(() => {
    setVideoError(null);
  }, [data.src, data.srcH264]);

  const hoverPreviewInput = {
    mediaType: data.mediaType,
    src: data.src,
    toolMode: data.toolMode,
    hasVideoError: videoError != null,
    genStatus: data.genStatus,
    draft: data.draft,
    assetMissing: data.assetMissing,
    emptyShell: data.emptyShell,
    subtitleEraseLocked,
    splitEditing: data.splitEditing === true,
    multiSelected: multiNodeSelection,
  };
  const hoverPreviewBlocked = videoHoverPreviewBlocked(hoverPreviewInput);
  const hoverPreviewEligible = videoHoverPreviewEligible(hoverPreviewInput);

  const endHoverPlayback = useCallback((options: { keepFrame?: boolean } = {}) => {
    const { keepFrame = false } = options;
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (keepFrame) return;
    const session = hoverSessionRef.current;
    hoverSessionRef.current = null;
    if (session) {
      session.video.removeEventListener('ended', session.onEnded);
      if (session.onPause) session.video.removeEventListener('pause', session.onPause);
      if (session.onPlay) session.video.removeEventListener('play', session.onPlay);
      if (session.onSeeked) session.video.removeEventListener('seeked', session.onSeeked);
      if (session.onVideoMouseDown) session.video.removeEventListener('mousedown', session.onVideoMouseDown);
      if (session.onVideoClick) session.video.removeEventListener('click', session.onVideoClick);
      session.video.classList.remove(styles.adopted);
      session.video.pause();
      if (!session.inTree) {
        try {
          session.video.currentTime = 0;
        } catch {
        }
        if (session.homeHost?.isConnected) session.homeHost.appendChild(session.video);
        session.video.muted = true;
      }
    }
    const host = hoverPreviewHostRef.current;
    while (host && host.firstChild) host.removeChild(host.firstChild);
    setAdoptedVideoRef(null);
    setHoverPlaying(false);
  }, []);

  const attachControlListeners = useCallback((video: HTMLVideoElement) => {
    const onPause = () => {
      if (video.ended) return;
      const session = hoverSessionRef.current;
      if (session?.video === video) session.yielded = true;
    };
    const onPlay = () => {
      const session = hoverSessionRef.current;
      if (session?.video === video) session.yielded = false;
    };
    const onSeeked = () => {
      const session = hoverSessionRef.current;
      if (session?.video !== video) return;
      session.yielded = false;
      if (video.paused) video.play().catch(() => {});
    };
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('seeked', onSeeked);
    return { onPause, onPlay, onSeeked };
  }, []);

  const adoptHoverSession = useCallback((session: { video: HTMLVideoElement; adopted?: boolean; onPause?: () => void; onPlay?: () => void; onSeeked?: () => void }) => {
    session.adopted = true;
    Object.assign(session, attachControlListeners(session.video));
    const onVideoMouseDown = (event: MouseEvent) => {
      videoPressRef.current = { x: event.clientX, y: event.clientY };
    };
    const onVideoClick = (event: MouseEvent) => {
      const press = videoPressRef.current;
      videoPressRef.current = null;
      if (!press || isVideoClickSlop(press, event.clientX, event.clientY)) return;
      toggleVideoPlayback(session.video);
    };
    session.video.addEventListener('mousedown', onVideoMouseDown);
    session.video.addEventListener('click', onVideoClick);
    Object.assign(session, { onVideoMouseDown, onVideoClick });
    session.video.classList.add(styles.adopted);
    setAdoptedVideoRef((prev) => (prev?.current === session.video ? prev : { current: session.video }));
  }, [attachControlListeners]);

  const startHoverPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || hoverSessionRef.current) return;
    const host = hoverPreviewHostRef.current;
    if (host == null) {
      if (!video.paused) return;
      const onEnded = () => {
        setHoverPlaying(false);
      };
      const { onPause, onPlay, onSeeked } = attachControlListeners(video);
      hoverSessionRef.current = { video, onEnded, homeHost: null, inTree: true, yielded: false, onPause, onPlay, onSeeked };
      video.addEventListener('ended', onEnded);
      video.loop = false;
      try {
        video.currentTime = 0;
      } catch {
      }
      setHoverPlaying(true);
      video.play().catch(() => {
        if (hoverSessionRef.current?.video !== video) return;
        video.muted = true;
        video.play().catch(() => {});
      });
      return;
    }
    const onEnded = () => {
      if (!hoverSessionRef.current?.adopted) setHoverPlaying(false);
    };
    hoverSessionRef.current = { video, onEnded, homeHost: video.parentNode, inTree: false, yielded: false };
    video.addEventListener('ended', onEnded);
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(video);
    try {
      video.currentTime = 0;
    } catch {
    }
    video.muted = false;
    setHoverPlaying(true);
    video.play().catch(() => {
      if (hoverSessionRef.current?.video !== video) return;
      video.muted = true;
      video.play().catch(() => {
      });
    });
  }, [attachControlListeners]);

  const handleContentPointerEnter = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (!hoverPreviewEligible) return;
    const session = hoverSessionRef.current;
    if (session && !session.video.paused && !session.video.ended) return;
    if (session && session.adopted) {
      if (hoverTimerRef.current != null) return;
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        const adopted = hoverSessionRef.current;
        if (!adopted || adopted !== session) return;
        try {
          adopted.video.currentTime = 0;
        } catch {
        }
        if (adopted.video.paused) {
          adopted.video.play().catch(() => {
          });
        }
      }, HOVER_PREVIEW_DELAY_MS);
      return;
    }
    if (session) endHoverPlayback();
    if (hoverSessionRef.current || hoverTimerRef.current != null) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      startHoverPlayback();
    }, HOVER_PREVIEW_DELAY_MS);
  }, [hoverPreviewEligible, startHoverPlayback, endHoverPlayback]);

  const handleContentPointerLeave = useCallback(() => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (selected) {
      const session = hoverSessionRef.current;
      if (!session) return;
      if (session.yielded || session.video.ended) {
        endHoverPlayback(session.adopted ? { keepFrame: true } : {});
      }
      return;
    }
    endHoverPlayback();
  }, [selected, endHoverPlayback]);

  useEffect(() => {
    if (hoverPreviewBlocked) endHoverPlayback();
  }, [hoverPreviewBlocked, endHoverPlayback]);

  useEffect(() => {
    if (!selected || hoverTimerRef.current == null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, [selected]);

  useEffect(() => {
    if (!selected || !hoverPlaying) return;
    const session = hoverSessionRef.current;
    if (!session || session.inTree) return;
    adoptHoverSession(session);
  }, [selected, hoverPlaying, adoptHoverSession]);

  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    const wasSelected = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (!(wasSelected && !selected)) return;
    if (hoverSessionRef.current != null || hoverPlaying) endHoverPlayback();
  }, [selected, hoverPlaying, endHoverPlayback]);

  useEffect(endHoverPlayback, [endHoverPlayback]);

  const drawVideoPoster = useCallback((video: HTMLVideoElement) => {
    const canvas = videoPosterRef.current;
    if (!canvas) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
  }, []);

  const hydratePausedVideo = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    if (video.readyState >= 2 && video.videoWidth === 0 && video.videoHeight === 0) {
      setVideoError({ code: 4 });
      return;
    }
    syncVideoDims(video);
    paintVideoFirstFrame(video, (ready) => {
      syncVideoDims(ready);
      drawVideoPoster(ready);
    });
  }, [drawVideoPoster, syncVideoDims]);

  const handleVideoReady = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    hydratePausedVideo(e.currentTarget);
  }, [hydratePausedVideo]);

  useEffect(() => {
    if (videoControlsArmed) {
      hydratePausedVideo(videoRef.current);
      return;
    }
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-240px;top:-240px;width:8px;height:8px;overflow:hidden;pointer-events:none;opacity:0';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    videoRef.current = video;
    for (const source of videoSourceList(data.src, data.srcH264)) {
      const el = document.createElement('source');
      el.src = source.src;
      el.type = source.type;
      video.appendChild(el);
    }
    const onReady = () => hydratePausedVideo(video);
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    const onError = () => {
      const code = video.error?.code;
      if (code === 1) return;
      setVideoError({ code });
    };
    video.addEventListener('error', onError);
    host.appendChild(video);
    document.body.appendChild(host);
    video.load();
    return () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      host.remove();
      if (videoRef.current === video) videoRef.current = null;
    };
  }, [data.src, data.srcH264, hydratePausedVideo, videoControlsArmed]);

  const handleVideoError = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const code = e.currentTarget.error?.code;
    if (code === 1) return;
    setVideoError({ code });
  }, []);

  const handleVideoPressDown = useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    videoPressRef.current = { x: event.clientX, y: event.clientY };
  }, []);
  const handleVideoClick = useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    const press = videoPressRef.current;
    videoPressRef.current = null;
    if (!press || isVideoClickSlop(press, event.clientX, event.clientY)) return;
    toggleVideoPlayback(videoRef.current);
  }, []);

  const isAudio = data.mediaType === 'audio';
  const Icon = data.mediaType === 'video' ? Video : isAudio ? AudioLines : Image;
  const isDraft = data.genStatus === 'draft';
  const showSourceHandle = !isEmptyShell && !isDraft;
  const updateNodeInternals = useUpdateNodeInternals();
  const handleVisibilityRef = useRef<[boolean, boolean] | null>(null);
  useEffect(() => {
    const prev = handleVisibilityRef.current;
    handleVisibilityRef.current = [showTargetHandle, showSourceHandle];
    if (prev === null) return;
    if (prev[0] === showTargetHandle && prev[1] === showSourceHandle) return;
    updateNodeInternals(id);
  }, [updateNodeInternals, id, showTargetHandle, showSourceHandle]);
  const isGenerating = data.genStatus === 'generating';
  const isChecking = data.genStatus === 'checking';
  const isGenDone = data.genStatus === 'failed' || data.genStatus === 'cancelled';
  const hasMediaSrc =
    typeof data.src === 'string' && data.src !== '' && !data.src.startsWith('blob:');
  const isMediaExtraction = isMediaExtractNodeId(id);
  const isAudioTrimCard = isAudioTrimNodeId(id);
  const isAudioMixCard = isAudioMixNodeId(id);
  const frameInterpolationIdentity = data.frameInterpolation as { sourceAssetId?: string } | undefined;
  const frameInterpolationRetryable =
    frameInterpolationIdentity == null
    || (typeof frameInterpolationIdentity.sourceAssetId === 'string' && frameInterpolationIdentity.sourceAssetId !== '');
  const hideCancel = isMediaExtraction
    || isAudioTrimCard
    || isAudioMixCard
    || isCanvasToolGeneration(data as Record<string, unknown>);
  const generationOverlay = mediaNodeGenerationOverlay(isMediaExtraction, hideCancel);
  const failHeadline = mediaNodeFailHeadline({
    genStatus: data.genStatus,
    errorText: data.errorText,
    isMediaExtraction,
  });
  const showFixFollowVideo =
    data.genStatus === 'failed'
    && data.mediaType === 'video'
    && isTaskTypeParamConstraintCode(data.errorCode)
    && data.onFixFollowVideo != null;

  const contentBox = mediaContentBox({
    mediaType: data.mediaType,
    width: data.width,
    height: data.height,
    ratio: data.targetRatio,
  });

  const titleMeta = isAudio
    ? durationLabel(data.duration)
    : [
        data.width && data.height ? `${data.width}×${data.height}` : '',
        data.mediaType === 'video' ? durationLabel(data.duration) : '',
      ]
        .filter(Boolean)
        .join(' ');

  const renderPlaceholder = () => {
    if (isDraft) {
      const isImageDraft = data.mediaType === 'image';
      const isVideoDraft = data.mediaType === 'video';
      const draftHint = isImageDraft && data.imageEnhance
        ? '配置参数生成高清图像'
        : isVideoDraft && data.videoEnhance
          ? '配置参数生成高清视频'
          : isVideoDraft && data.frameInterpolation
            ? '配置参数生成插帧视频'
            : isVideoDraft && data.audioVideoMux
              ? (data.audioVideoMux.video ? '已就绪，点击发送生成' : '选择视频并配置参数')
              : isVideoDraft ? '视频生成' : isImageDraft ? '图片生成' : '待生成';
      return (
        <div className={styles.genBox}>
          {isVideoDraft ? <Video size={22} strokeWidth={1.8} color="#666" /> : <Image size={22} strokeWidth={1.8} color="#666" />}
          <span className={styles.missingText}>{draftHint}</span>
        </div>
      );
    }
    if (isGenerating) {
      return (
        <div className={styles.genBox}>
          <div className={styles.genSpinner} />
          {isAudioMixCard && data.audioMixCancelPending === true &&
            <span className={styles.genText}>正在取消</span>}
          {generationOverlay.showProgress && (
            <>
              <span className={styles.genText}>
                {generationOverlay.progressLabel}
                {typeof data.progress === 'number' ? ` ${data.progress}%` : '…'}
              </span>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={typeof data.progress === 'number' ? data.progress : 0}
              >
                <div className={styles.progressFill} style={{ width: `${data.progress ?? 0}%` }} />
              </div>
            </>
          )}
          {generationOverlay.showCancel && (
            <button className={styles.genBtn} onClick={() => data.onCancelJob?.(id)}>
              取消生成
            </button>
          )}
        </div>
      );
    }
    if (isChecking) {
      return (
        <div className={styles.genBox} data-testid="job-checking-box">
          <div className={`${styles.genSpinner} ${styles.checkingSpinner}`} />
          <span className={styles.checkingText}>状态核对中</span>
          <span className={styles.genSub}>提交结果核对中，请勿重复提交</span>
        </div>
      );
    }
    if (isGenDone) {
      const canRetry = data.genStatus === 'failed'
        && data.videoStage !== 'final'
        && (!isMediaExtraction || data.mediaExtract != null)
        && (!isAudioTrimCard || data.audioTrim != null)
        && (!isAudioMixCard || data.jobId != null)
        && frameInterpolationRetryable;
      return (
        <div className={styles.genBox}>
          <span className={styles.genFailText}>{failHeadline}</span>
          {data.chargeState === 'released' && (
            <span className={styles.genSub} data-testid="charge-refund-note">本次未消耗积分，预扣已退回</span>
          )}
          {canRetry && (
            <button className={styles.genBtn} onClick={() => data.onRetryJob?.(id)}>
              重试
            </button>
          )}
          {}
          {data.videoStage === 'final' && data.regenerateCta && (() => {
            const cta = data.regenerateCta;
            const disabled = cta.phase !== 'ready';
            return (
              <button
                type="button"
                className={styles.genBtn}
                data-testid="regenerate-cta"
                disabled={disabled}
                title={cta.phase === 'ready'
                  ? `按原输入新建 480P 样片，预计消耗 ${cta.credits} 积分；样片完成后再单独发起成片（另行计费）`
                  : cta.phase === 'loading'
                    ? '正在获取样片报价'
                    : cta.phase === 'checking'
                      ? '上次提交结果不明，正在核对，请勿重复提交'
                      : '暂不能重新生成样片（无报价）'}
                onClick={(event) => {
                  event.stopPropagation();
                  if (disabled) return;
                  data.onRegenerateSample?.(id);
                }}
              >
                重试
              </button>
            );
          })()}

          {showFixFollowVideo && (
            <button className={styles.genBtn} onClick={() => data.onFixFollowVideo?.(id)}>
              重新编辑
            </button>
          )}
        </div>
      );
    }
    return (
      <div className={styles.missingBox}>
        <ImageOff size={22} strokeWidth={1.8} color="#666" />
        <span className={styles.missingText}>素材已被删除</span>
      </div>
    );
  };

  return (
    <div
      className={`${styles.wrapper} ${selected ? styles.selected : ''} ${data.pickBlocked ? styles.pickBlocked : ''}`}
      data-media-type={data.mediaType ?? 'image'}
      onContextMenu={handleContextMenu}
      style={{ ...nodeTitleSizing(zoom), width: contentBox.width }}
    >
      {}
      <div className={styles.titleRow} data-testid="media-title">
        <div className={styles.titleLeft}>
          <Icon className={styles.titleIcon} strokeWidth={2} color="#888" />
          {nameEditing ? (
            <input
              className="nodrag nopan"
              aria-label="卡片名称"
              value={nameDraft}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commitName();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelName();
                }
              }}
            />
          ) : (
            <span
              className={styles.titleName}
              title={data.fileName || undefined}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (!data.onTitleChange) return;
                setNameDraft(data.fileName ?? '');
                setNameError('');
                setNameEditing(true);
              }}
            >
              {data.fileName || (isEmptyShell ? (data.mediaType === 'video' ? '视频节点' : data.mediaType === 'audio' ? '音频节点' : '图片节点') : '')}
            </span>
          )}
          {data.complianceBusy ? (
            <span className={`nodrag nopan ${styles.complianceBadge}`} title="校验中">
              <span className={styles.complianceSpinner} />
            </span>
          ) : data.compliancePassed ? (
            <span className={`nodrag nopan ${styles.complianceBadge}`} title="校验通过，可用于seedance视频生成">
              <img src="/success.png" alt="" />
            </span>
          ) : data.complianceFailed ? (
            <span className={`nodrag nopan ${styles.complianceFailedText}`} title="seedance合规校验失败，不可用于视频生成">
              审核失败
            </span>
          ) : null}
        </div>
        {}
        <span className={styles.titleMeta} title={titleMeta || undefined}>{titleMeta}</span>
        {}
        {data.finalizeCta && data.finalizeCta.phase !== 'expired' && (() => {
          const cta = data.finalizeCta;
          const disabled = cta.phase !== 'ready';
          const label = cta.phase === 'running'
            ? '成片生成中…'
            : cta.phase === 'checking'
              ? '状态核对中…'
              : typeof cta.credits === 'number'
                ? `生成 1080P 成片 · ${cta.credits} 积分`
                : '生成 1080P 成片';
          const title = cta.phase === 'ready'
            ? `生成 1080P 成片，预计消耗 ${cta.credits} 积分（成片另行计费）`
            : cta.phase === 'loading'
              ? '正在获取成片报价'
              : cta.phase === 'running'
                ? '成片生成中'
                : cta.phase === 'checking'
                  ? '上次提交结果不明，正在核对，请勿重复提交'
                  : '暂不能生成成片（无报价或已有成片任务）';
          return (
            <button
              type="button"
              className={`nodrag nopan ${styles.finalizeCta}`}
              data-testid="finalize-cta"
              disabled={disabled}
              title={title}
              onClick={(event) => {
                event.stopPropagation();
                if (disabled) return;
                data.onFinalizeSample?.(id);
              }}
            >
              {label}
            </button>
          );
        })()}
      </div>
      {}
      {data.inputStale === true && (
        <div ref={staleMenuRef} className={`nodrag nopan ${styles.inputStaleWrap}`}>
          <button
            type="button"
            className={styles.inputStaleLabel}
            data-testid="input-stale-badge"
            title="输入已更新：来源文本已修改"
            aria-haspopup="menu"
            aria-expanded={staleMenuOpen || undefined}
            onClick={(event) => {
              event.stopPropagation();
              setStaleMenuOpen((open) => !open);
            }}
          >
            输入已更新
            <ChevronDown size={12} strokeWidth={2} />
          </button>
          {staleMenuOpen && (
            <div className={styles.inputStaleMenu} role="menu" data-testid="input-stale-menu">
              <button
                type="button"
                role="menuitem"
                className={styles.inputStaleMenuItem}
                data-testid="input-stale-update-generate"
                disabled={isGenerating}
                title={isGenerating ? '正在生成中' : '在当前节点用最新输入重新生成'}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isGenerating) return;
                  setStaleMenuOpen(false);
                  data.onUpdateGenerate?.(id);
                }}
              >
                <RefreshCw size={14} strokeWidth={2} />
                <span>更新生成</span>
              </button>
            </div>
          )}
        </div>
      )}
      {}
      {data.pickMarked === true && (
        <span
          className={`nodrag nopan ${styles.pickMarkedBadge}`}
          data-testid="pick-mark-badge"
          title="已加入当前参考"
        >
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      {nameError && <div role="alert" className="nodrag nopan">{nameError}</div>}
      {}
      <div
        className={`${styles.contentCard} ${isAudio ? styles.audioCard : ''}`}
        data-testid="media-content"
        style={{ width: contentBox.width, height: contentBox.height }}
        onPointerEnter={handleContentPointerEnter}
        onPointerLeave={handleContentPointerLeave}
      >
        {showTargetHandle && (
          <Handle type="target" position={Position.Left} className={styles.handle} style={{ ...HANDLE_STYLE, left: '-16px' }}>
          <HandlePlus onAdd={data.onAddLeft} />
        </Handle>
        )}
        {isEmptyShell ? (
          <button
            type="button"
            className={`${styles.emptyShell} nodrag nopan`}
            onClick={() => shellFileRef.current?.click()}
          >
            <Icon size={22} strokeWidth={1.8} color="#888" />
            <span className={styles.emptyShellHint}>点击上传素材</span>
            <input
              ref={shellFileRef}
              type="file"
              hidden
              accept={
                data.mediaType === 'video'
                  ? 'video/*'
                  : data.mediaType === 'audio'
                    ? 'audio/*'
                    : 'image/*'
              }
              onChange={(e) => {
                acceptShellFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </button>
        ) : isDraft || (isGenDone && !hasMediaSrc) || data.assetMissing || (isGenerating && !hasMediaSrc) || (isChecking && !hasMediaSrc) ? (
          renderPlaceholder()
        ) : isAudio ? (
          <AudioPlayer
            ref={trimSeekBridge.playerRef}
            src={data.src || ''}
            fileName={data.fileName}
            duration={typeof data.duration === 'number' ? data.duration : undefined}
            onDownload={() => data.onDownload?.(id)}
            speedEditing={data.speedEditing != null}
            speedFactor={data.speedEditing && data.speedEditing !== true ? data.speedEditing.speed : undefined}
            trimSelection={data.trimEditing ? data.trimEditing.selection : null}
            trimOverlay={
              data.trimEditing ? (
                <AudioTrimOverlay
                  selection={data.trimEditing.selection}
                  duration={data.trimEditing.duration}
                  onSelectionChange={data.trimEditing.onSelectionChange}
                  onSeekStart={trimSeekBridge.onSeekStart}
                  onSeek={trimSeekBridge.onSeek}
                  onSeekEnd={(time) => trimSeekBridge.onSeekEnd(time, data.trimEditing?.selection.end)}
                />
              ) : undefined
            }
          />
        ) : data.mediaType === 'video' ? (
          <>
            {}
            {data.transparentOutput === true && (
              <div className={styles.cutoutCheckerboard} aria-hidden data-testid="video-transparent-checkerboard" />
            )}
            {videoError ? (
              <div className={styles.genBox} data-testid="video-error-box">
                <span className={styles.genFailText} title={videoLoadErrorMessage(videoError.code)}>
                  {videoLoadErrorMessage(videoError.code)}
                </span>
                {data.src && (
                  <a
                    className={styles.genBtn}
                    href={data.src}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none', display: 'inline-block' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    新窗口打开
                  </a>
                )}
              </div>
            ) : (
              <div className={styles.mediaVideoLayer}>
                {videoControlsArmed ? (
                  <>
                    <video
                      ref={videoRef}
                      className={styles.mediaVideo}
                      playsInline
                      preload="metadata"
                      disablePictureInPicture
                      draggable={false}
                      onLoadedMetadata={handleVideoReady}
                      onLoadedData={handleVideoReady}
                      onError={handleVideoError}
                      onMouseDown={handleVideoPressDown}
                      onClick={handleVideoClick}
                    >
                      {videoSourceList(data.src, data.srcH264).map((source) => (
                        <source key={source.src} src={source.src} type={source.type} />
                      ))}
                    </video>
                    <VideoPlayerControls
                      videoRef={videoRef}
                      duration={typeof data.duration === 'number' ? data.duration : undefined}
                    />
                  </>
                ) : (
                  <>
                    <canvas ref={videoPosterRef} className={styles.mediaVideoPoster} aria-hidden />
                    {}
                    <div
                      ref={hoverPreviewHostRef}
                      className={styles.mediaHoverPreviewLayer}
                      aria-hidden
                      data-testid="video-hover-preview"
                    />
                    {}
                    {selected && hoverPlaying && adoptedVideoRef && (
                      <VideoPlayerControls
                        videoRef={adoptedVideoRef}
                        duration={typeof data.duration === 'number' ? data.duration : undefined}
                      />
                    )}
                  </>
                )}
              </div>
            )}
            {}
            {data.transparentOutput === true && (
              <span className={styles.transparentTag} data-testid="video-transparent-tag">
                透明背景 · WEBM
              </span>
            )}
            {}
            {data.videoStage === 'sample' && data.genStatus == null && data.draft !== true && (() => {
              const label = sampleDeadlineLabel(data.finalizeDeadlineAt);
              const expired = !label || sampleDeadlineExpired(data.finalizeDeadlineAt);
              return (
                <span
                  className={expired ? `${styles.stageTag} ${styles.stageTagExpired}` : styles.stageTag}
                  data-testid="video-sample-badge"
                  title={expired
                    ? (data.finalizeDeadlineAt == null
                      ? '样片缺少可信创建时间，无法生成成片；样片仍可预览、下载'
                      : '转成片期限已过，样片仍可预览、下载')
                    : `转成片截止 ${label}；成片另行计费`}
                >
                  <Clock size={11} strokeWidth={2} aria-hidden />
                  {expired ? '样片 480P' : <span className={styles.stageTagAcc}>样片 480P</span>}
                  <span className={styles.stageTagDim}>{expired ? '· 已过期' : `· 截止 ${label}`}</span>
                </span>
              );
            })()}
            {data.videoStage === 'final' && data.genStatus == null && data.draft !== true && (
              <span
                className={`${styles.stageTag} ${styles.stageTagFinal}`}
                data-testid="video-final-badge"
                title="从样片生成的 1080P 成片"
              >
                <Film size={11} strokeWidth={2} aria-hidden />
                成片 1080P
              </span>
            )}
            {}
            {data.subtitleEraseEditing && (
              <SubtitleEraseBoxesLayer
                boxes={data.subtitleEraseEditing.boxes}
                liveBox={data.subtitleEraseEditing.liveBox}
                displayWidth={contentBox.width}
                displayHeight={contentBox.height}
                onBoxStart={data.subtitleEraseEditing.onBoxStart}
                onBoxMove={data.subtitleEraseEditing.onBoxMove}
                onBoxEnd={data.subtitleEraseEditing.onBoxEnd}
              />
            )}
            {}
            {data.splitEditing && (
              <div
                className="nodrag nopan"
                data-testid="split-lock-layer"
                style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'default', touchAction: 'none' }}
              />
            )}
          </>
        ) : (
          <>
            {}
            {data.imageCutout && (
              <div className={styles.cutoutCheckerboard} aria-hidden data-testid="cutout-checkerboard" />
            )}
            <img
              className={styles.mediaImage}
              src={resolveMediaSrc(data.src)}
              crossOrigin={remoteImageCrossOrigin(data.src)}
              alt={data.fileName || 'image'}
              draggable={false}
              onLoad={handleImageLoad}
              style={isSelect ? undefined : { pointerEvents: 'none' }}
            />
            {}
            {data.eraseEditing && (
              <EraseMaskLayer
                ops={data.eraseEditing.ops}
                liveOp={data.eraseEditing.liveOp}
                displayWidth={contentBox.width}
                displayHeight={contentBox.height}
                onStrokeStart={data.eraseEditing.onStrokeStart}
                onStrokeMove={data.eraseEditing.onStrokeMove}
                onStrokeEnd={data.eraseEditing.onStrokeEnd}
              />
            )}
          </>
        )}
        {isGenerating && hasMediaSrc && (
          <div className={`nodrag nopan ${styles.regenOverlay}`} data-testid="regen-overlay">
            <span className={styles.regenSpinner} />
            <span className={styles.regenText}>
              重新生成中{typeof data.progress === 'number' ? ` ${data.progress}%` : ''}
            </span>
            {!hideCancel && (
              <button className={styles.regenCancel} onClick={() => data.onCancelJob?.(id)}>
                取消
              </button>
            )}
          </div>
        )}
        {}
        {isGenDone && hasMediaSrc && (
          <div className={`nodrag nopan ${styles.regenOverlay}`} data-testid="fail-overlay">
            <span className={styles.failOverlayText} title={failHeadline}>{failHeadline}</span>
            {data.genStatus === 'failed'
              && (!isMediaExtraction || data.mediaExtract != null)
              && (!isAudioTrimCard || data.audioTrim != null)
              && frameInterpolationRetryable && (
              <button className={styles.regenCancel} onClick={() => data.onRetryJob?.(id)}>
                重试
              </button>
            )}
            {showFixFollowVideo && (
              <button className={styles.regenCancel} onClick={() => data.onFixFollowVideo?.(id)}>
                重新编辑
              </button>
            )}
          </div>
        )}
        {showSourceHandle && (
        <Handle type="source" position={Position.Right} className={styles.handle} style={{ ...HANDLE_STYLE, right: '-16px' }}>
        <HandlePlus onAdd={data.onAddRight} />
      </Handle>
        )}
      </div>

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={isDraft
            ? [
                { key: 'duplicate', label: '创建副本' },
                { key: 'delete', label: '删除', danger: true },
              ]
            : [
                { key: 'chat', label: '添加到聊天' },
                ...(isAudio
                  ? []
                  : [{
                      key: 'compliance',
                      label: 'Seedance合规校验',
                      loading: data.complianceBusy,
                      disabled: data.assetMissing === true,
                    }]),
                { key: 'duplicate', label: '创建副本' },
                { key: 'delete', label: '删除', danger: true },
              ]}
          onClose={() => setContextMenu(null)}
          onSelect={(key) => {
            setContextMenu(null);
            if (key === 'chat') handleAddToChat();
            else if (key === 'compliance') data.onComplianceCheck?.(id);
            else if (key === 'duplicate') handleDuplicate();
            else if (key === 'delete') handleDelete();
          }}
        />
      )}
    </div>
  );
}

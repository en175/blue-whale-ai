import {
  ORDINARY_VIDEO_MODE_ORDER,
  isFrameMode,
  normalizeVideoMode,
  type VideoMode,
} from '@/custom/utils/video-modes';
import type { VideoPromptRefItem } from './videoPromptRefs';
import { hasAnyMediaRef, type VideoMediaRef, type VideoMediaRefs } from './videoMediaRefs';

export interface VideoRefsComposition {
  images: number;
  videos: number;
  audios: number;
  frameImages: number;
  hasFrames: boolean;
  hasMedia: boolean;
}

export function videoRefsCompositionOf(refs: VideoMediaRefs): VideoRefsComposition {
  const images = refs.reference.filter((r) => r.mediaType === 'image').length;
  const videos = refs.reference.filter((r) => r.mediaType === 'video').length;
  const audios = refs.reference.filter((r) => r.mediaType === 'audio').length;
  const hasFrames = Boolean(refs.first || refs.last);
  return {
    images,
    videos,
    audios,
    frameImages: images + (refs.first ? 1 : 0) + (refs.last ? 1 : 0),
    hasFrames,
    hasMedia: hasAnyMediaRef(refs),
  };
}

export function enabledVideoModes(
  refs: VideoMediaRefs,
  configured: readonly VideoMode[],
): VideoMode[] {
  const { videos, audios, frameImages, hasMedia } = videoRefsCompositionOf(refs);
  const noVideoOrAudio = videos === 0 && audios === 0;
  return configured.filter((mode) => {
    switch (mode) {
      case 'text2video':
        return !hasMedia;
      case 'omni':
        return true;
      case 'image_reference':
        return noVideoOrAudio && frameImages >= 1;
      case 'first_frame':
      case 'first_last_frame':
        return noVideoOrAudio;
      case 'edit':
      case 'extend':
        return videos === 1;
      default:
        return false;
    }
  });
}

export function defaultVideoModeFor(refs: VideoMediaRefs): VideoMode {
  const { images, videos, audios } = videoRefsCompositionOf(refs);
  if (videos > 1) return 'omni';
  if (videos === 1) return 'edit';
  if (images > 0) return 'image_reference';
  if (audios > 0) return 'omni';
  return 'text2video';
}

export function resolveVideoMode(
  target: VideoMode | null,
  enabled: readonly VideoMode[],
): VideoMode | null {
  if (target && enabled.includes(target)) return target;
  if (enabled.includes('omni')) return 'omni';
  return ORDINARY_VIDEO_MODE_ORDER.find((mode) => enabled.includes(mode)) ?? null;
}

export function videoModeRefsSignature(refs: VideoMediaRefs): string {
  const parts: string[] = [];
  for (const item of [refs.first, refs.last, ...refs.reference]) {
    if (!item) continue;
    parts.push(`${refIdentityOf(item)}:${item.mediaType}`);
  }
  return parts.sort().join(',');
}

function refIdentityOf(item: VideoMediaRef) {
  return item.materialId ?? item.assetId;
}

export function nextVideoModeOnRefsChange(
  current: VideoMode,
  refs: VideoMediaRefs,
  configured: readonly VideoMode[],
): VideoMode | null {
  const enabled = enabledVideoModes(refs, configured);
  if (!configured.includes(current)) {
    const fallback = resolveVideoMode(defaultVideoModeFor(refs), enabled);
    return fallback === current ? null : fallback;
  }
  if (isFrameMode(current)) return null;
  if (enabled.includes(current)) return null;
  const next = resolveVideoMode(defaultVideoModeFor(refs), enabled);
  return next === current ? null : next;
}

export function videoModeAfterRefAdd(
  current: string | null | undefined,
  refs: VideoMediaRefs,
  mediaType: VideoMediaRef['mediaType'],
): string | null {
  if (mediaType === 'video' && videoRefsCompositionOf(refs).videos >= 1) return 'omni';
  return current ?? null;
}

export function normalizeStoredVideoMode(
  raw: unknown,
  refs: VideoMediaRefs,
): VideoMode | null {
  if (raw === 'text2video') {
    const { images, videos, audios } = videoRefsCompositionOf(refs);
    return images >= 1 && videos === 0 && audios === 0 ? 'image_reference' : 'text2video';
  }
  return normalizeVideoMode(raw);
}

export function draftVideoModeOf(
  data: Record<string, unknown> | undefined,
  refs: VideoMediaRefs,
): VideoMode | null {
  return normalizeStoredVideoMode(data?.draftMode, refs);
}

export function videoModeAcceptsRef(
  mode: string,
  role: VideoPromptRefItem['role'],
  type: VideoPromptRefItem['type'],
): boolean {
  if (role === 'first_frame') {
    return type === 'image' && (mode === 'first_frame' || mode === 'first_last_frame');
  }
  if (role === 'last_frame') {
    return type === 'image' && mode === 'first_last_frame';
  }
  switch (mode) {
    case 'omni':
    case 'edit':
    case 'extend':
      return true;
    case 'image_reference':
      return type === 'image';
    default:
      return false;
  }
}

export function hasVideoReference(refs: VideoMediaRefs): boolean {
  return refs.reference.some((r) => r.mediaType === 'video');
}

import type { MediaGenStatus } from './index';

export const HOVER_PREVIEW_DELAY_MS = 100;

export interface VideoHoverPreviewInput {
  mediaType?: 'image' | 'video' | 'audio';
  src?: string;
  toolMode?: 'drag' | 'select';
  hasVideoError?: boolean;
  genStatus?: MediaGenStatus;
  draft?: boolean;
  assetMissing?: boolean;
  emptyShell?: boolean;
  subtitleEraseLocked?: boolean;
  splitEditing?: boolean;
  multiSelected?: boolean;
}

export function videoHoverPreviewBlocked(input: VideoHoverPreviewInput): boolean {
  if (input.mediaType !== 'video') return true;
  if (typeof input.src !== 'string' || input.src === '' || input.src.startsWith('blob:')) return true;
  if (input.toolMode !== 'select') return true;
  if (input.hasVideoError === true) return true;
  if (input.genStatus != null) return true;
  if (input.draft === true) return true;
  if (input.assetMissing === true) return true;
  if (input.emptyShell === true) return true;
  if (input.subtitleEraseLocked === true) return true;
  if (input.splitEditing === true) return true;
  if (input.multiSelected === true) return true;
  return false;
}

export function videoHoverPreviewEligible(input: VideoHoverPreviewInput): boolean {
  return !videoHoverPreviewBlocked(input);
}

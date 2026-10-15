import type { VideoMode } from '@/app/utils/video-modes';








export interface GenRefItem {
  preview: string;
  type: 'image' | 'video';

  file?: File;

  assetId?: string | number;
}


export interface GenFileItem {
  id: string;
  url: string;
  type: 'image';
  name: string;

  file?: File;

  assetId?: string | number;
}


export interface VideoGenHandoff {
  kind: 'video';
  text: string;
  modelId: string;
  aspectRatio: string;
  resolution: string;
  duration: number;
  mode: VideoMode;


  generateAudio: boolean;
  refs: GenRefItem[];
}


export interface ImageGenHandoff {
  kind: 'image';
  text: string;
  modelId: string;

  size: string;
  ratio: string;
  files: GenFileItem[];
}

export type GenHandoff = VideoGenHandoff | ImageGenHandoff;

let pending: GenHandoff | null = null;


export function setGenHandoff(h: GenHandoff) {
  pending = h;
}


export function takeGenHandoff(): GenHandoff | null {
  const h = pending;
  pending = null;
  return h;
}

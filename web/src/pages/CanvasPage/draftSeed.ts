import type { PromptDoc } from '@/utils/prompt-doc';
import type { VideoGenSeedParams } from './components/BottomDialog';
import type { ImageGenSeedParams, ImageTextAttachment, UploadedFile } from './components/ImageDialog';
import type { AudioRefItem } from './components/AudioDialog';

export type ImageDraftSeed = {
  ts: number;
  text: string;
  files: UploadedFile[];
  params?: ImageGenSeedParams;
  targetNodeId?: string;
  attachments?: ImageTextAttachment[];
  promptDoc?: PromptDoc | null;
};

export type VideoDraftSeed = {
  ts: number;
  text?: string;
  doc?: PromptDoc | null;
  params?: VideoGenSeedParams;
  targetNodeId?: string;
  attachments?: ImageTextAttachment[];
};

export type AudioDraftSeed = {
  ts: number;
  text?: string;
  modelId?: string;
  targetNodeId?: string;
  doc?: PromptDoc | null;
  refs?: AudioRefItem[];
};

export function draftSeedEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => draftSeedEquals(item, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).filter((k) => k !== 'ts');
  const bKeys = Object.keys(bObj).filter((k) => k !== 'ts');
  return aKeys.length === bKeys.length
    && aKeys.every((k) => Object.prototype.hasOwnProperty.call(bObj, k) && draftSeedEquals(aObj[k], bObj[k]));
}

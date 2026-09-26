import type { PromptDoc } from '@/lib/prompt-doc';
import type { VideoGenSeedParams } from './components/BottomDialog';
import type { ImageGenSeedParams, ImageTextAttachment, UploadedFile } from './components/ImageDialog';
import type { AudioRefItem } from './components/AudioDialog';

/** 图片面板草稿 seed 形状（IKIJ61 审查修订）：useState 声明与 openImageDraftDialog
 *  局部变量共用，此前同一字面量在两处各复制一份。字段语义见 index.tsx useState 处注释。 */
export type ImageDraftSeed = {
  ts: number;
  text: string;
  files: UploadedFile[];
  params?: ImageGenSeedParams;
  targetNodeId?: string;
  attachments?: ImageTextAttachment[];
  promptDoc?: PromptDoc | null;
};

/** 视频面板草稿 seed 形状（IKIJ61 审查修订）：useState 声明与 openVideoDraftDialog 局部变量共用 */
export type VideoDraftSeed = {
  ts: number;
  text?: string;
  doc?: PromptDoc | null;
  params?: VideoGenSeedParams;
  targetNodeId?: string;
  attachments?: ImageTextAttachment[];
};

/** 音频面板草稿 seed 形状（IKIJ61 审查修订）：useState 声明与 openAudioDraftDialog 局部变量共用 */
export type AudioDraftSeed = {
  ts: number;
  text?: string;
  modelId?: string;
  targetNodeId?: string;
  doc?: PromptDoc | null;
  refs?: AudioRefItem[];
};

/** 草稿面板 seed 内容等值比较（IKIJ61）：排除 ts 时间戳的深度等值——图片/视频/音频三面板
 *  的 seed 均为可 JSON 化纯数据（text/doc/promptDoc/params/targetNodeId/attachments/refs/files），
 *  数组按元素、对象按键递归比较。打开链路重复通报同一草稿时据此跳过 setSeed 写入，
 *  保留旧引用（面板 key 不变、不重挂载）；内容真实变化仍写入新对象。 */
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

/* ============================================
 * 首页 AI视频/AI图片 → 画布页生成交接
 * File / objectURL 无法序列化进 navigate state，
 * 经模块变量携带（SPA 同文档跳转有效），take 即清。
 * ============================================ */

/** 参考素材项（结构兼容 BottomDialog 的 BottomRefItem；资产库选择项带 assetId 无 file） */
export interface GenRefItem {
  preview: string;
  type: 'image' | 'video';
  /** 本地上传的原始 File；资产库选择项无 */
  file?: File;
  /** 已有资产 ID（资产库选择时携带，画布侧直接复用，跳过上传） */
  assetId?: string | number;
}

/** 参考图项（结构兼容 ImageDialog 的 UploadedFile；资产库选择项带 assetId 无 file） */
export interface GenFileItem {
  id: string;
  url: string;
  type: 'image';
  name: string;
  /** 本地上传的原始 File；资产库选择项无 */
  file?: File;
  /** 已有资产 ID（资产库选择时携带，画布侧直接复用，跳过上传） */
  assetId?: string | number;
}

/** AI视频交接：文本 + 生成参数 + 参考素材 + 模式 */
export interface VideoGenHandoff {
  kind: 'video';
  text: string;
  modelId: string;
  aspectRatio: string;
  resolution: string;
  duration: number;
  /** 画布侧模式：all 全能参考 / keyframe 首尾帧 / text2video 图生视频；
   *  keyframe 时 refs 为恰好 2 张图（首页已校验），走首尾帧提交 */
  mode: 'all' | 'keyframe' | 'text2video';
  /** IKG0LP：是否带音频（用户选择，缺省 true）。必须随交接带到画布，
   *  否则首页选的值会在跳转后丢失。 */
  generateAudio: boolean;
  refs: GenRefItem[];
}

/** AI图片交接：文本 + 生成参数 + 参考图 */
export interface ImageGenHandoff {
  kind: 'image';
  text: string;
  modelId: string;
  /** 分辨率档位 id，如 2k */
  size: string;
  ratio: string;
  files: GenFileItem[];
}

export type GenHandoff = VideoGenHandoff | ImageGenHandoff;

let pending: GenHandoff | null = null;

/** 首页发送时存入交接数据 */
export function setGenHandoff(h: GenHandoff) {
  pending = h;
}

/** 画布页取出交接数据（取后即清，刷新/直开页面为 null） */
export function takeGenHandoff(): GenHandoff | null {
  const h = pending;
  pending = null;
  return h;
}

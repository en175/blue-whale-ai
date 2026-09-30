/** IKJ7OS 视频卡悬停自动播放预览：起播/续播排除态谓词与常量。
 *  纯函数模块（家族先例 toolbarVisibility.ts / generationOverlay.ts），MediaNode 与测试共用。
 *  IKJ7RS 交付未选中卡基础链路；IKJ7S1 翻转起播门（选中卡同样自动开播）并加入多选抑制，
 *  选中卡尾播/让位的运行时状态机在 MediaNode/index.tsx。 */

/** 悬停布防延时：进入内容区满此时长才开播；计时内划过不播，保持首帧海报无视觉变化 */
export const HOVER_PREVIEW_DELAY_MS = 100;

/** 谓词入参：MediaNodeData / 组件派生态的扁平投影，测试无需构造完整 data */
export interface VideoHoverPreviewInput {
  mediaType?: 'image' | 'video' | 'audio';
  src?: string;
  toolMode?: 'drag' | 'select';
  /** 视频加载失败兜底态（MediaNode 内即 videoError != null） */
  hasVideoError?: boolean;
  /** 生成状态：任一有值即生成流程卡（含重生成中成品卡、质检 checking） */
  genStatus?: 'draft' | 'generating' | 'checking' | 'failed' | 'cancelled';
  /** 草稿身份标记 */
  draft?: boolean;
  /** 素材缺失（水合期派生） */
  assetMissing?: boolean;
  /** 空壳占位：待用户上传 */
  emptyShell?: boolean;
  /** 去字幕会话锁定（subtitleEraseEditing 注入或 subtitleErasePaused） */
  subtitleEraseLocked?: boolean;
  /** 音视频分离/人声背景/场景切分/智能抠像会话锁定（CanvasPage 注入 splitEditing） */
  splitEditing?: boolean;
  /** 画布处于多节点选中（框选 / Ctrl 加选 / Ctrl+A）：多选期间任何卡不自动播放（IKJ7S1） */
  multiSelected?: boolean;
}

/** 会话排除态：编辑会话锁定、生成流程卡、素材缺失、空壳、加载失败、抓手（拖动）工具模式、
 *  画布多选。悬停会话进行中任一排除态出现即立即停播。注意不含「选中」翻转——点选过渡
 *  （悬停播放中点击选中）不能被选中本身停掉（IKJ7RS）。 */
export function videoHoverPreviewBlocked(input: VideoHoverPreviewInput): boolean {
  if (input.mediaType !== 'video') return true;
  // 与 hasMediaSrc 同口径：blob 预览（上传中）不算可播素材
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

/** 悬停起播门：成品视频卡 + 选择工具 + 非任何排除态。
 *  选中卡与未选中卡同门（IKJ7S1 翻转：选中卡悬停同样自动开播——已布防卡在原生控件
 *  视频上就地开播，未布防卡走离屏元素路）。 */
export function videoHoverPreviewEligible(input: VideoHoverPreviewInput): boolean {
  return !videoHoverPreviewBlocked(input);
}

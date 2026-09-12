/* ============================================
 * videoPromptRefs 视频面板标签映射（IKFA1O）：正文素材标签在生视频场景的有效性判定。
 * 首尾帧按角色显示（首帧/尾帧），普通参考按同类型在 reference 序中的顺序连续编号
 * （图片N/视频N/音频N）；模式不接受的参考身份返回 null——失效与恢复完全由
 * 当前（参考集合 + 模式）推导（C2/C5），与服务端 videoRefLabel 同口径。
 * ============================================ */
import type { VideoMediaRef, VideoMediaRefs } from './videoMediaRefs';

/** 视频参考编译投影（与服务端 VideoRefItem 同构）：身份统一字符串（数字 assetId | asset- 前缀 materialId） */
export interface VideoPromptRefItem {
  id: string;
  role: 'first_frame' | 'last_frame' | 'reference';
  type: 'image' | 'video' | 'audio';
}

/** 视频面板标签映射：labelOf 为 null 表示该身份当前失效（不在集合或模式不接受） */
export interface VideoLabelMap {
  labelOf: (id: string) => string | null;
  /** 当前参考集合的提交投影（帧在前、reference 保序）：编译/一致性核对用 */
  refItems: VideoPromptRefItem[];
}

const TYPE_LABELS: Record<VideoPromptRefItem['type'], string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

/** 参考身份（唯一口径）：素材库 materialId 优先，画布数字 assetId 兜底——两空间不混用 */
export const refIdOf = (item: VideoMediaRef): string => item.materialId ?? item.assetId;

/** 模式是否接受该参考（与 BottomDialog modeConflict 同口径的结构判定）：
 *  keyframe 只收首尾帧；all 不收帧；text2video 不收帧且普通参考仅图片 */
function modeAccepts(mode: string, role: VideoPromptRefItem['role'], type: VideoPromptRefItem['type']): boolean {
  if (role !== 'reference') return mode === 'keyframe';
  if (mode === 'keyframe') return false;
  if (mode === 'text2video') return type === 'image';
  return true;
}

/** 视频面板有效标签映射（唯一口径）：附件区徽标、@ 菜单、正文标签、发送拍平共用 */
export function videoLabelMapOf(refs: VideoMediaRefs, mode: string): VideoLabelMap {
  const refItems: VideoPromptRefItem[] = [];
  if (refs.first) refItems.push({ id: refIdOf(refs.first), role: 'first_frame', type: 'image' });
  if (refs.last) refItems.push({ id: refIdOf(refs.last), role: 'last_frame', type: 'image' });
  for (const item of refs.reference) {
    refItems.push({ id: refIdOf(item), role: 'reference', type: item.mediaType });
  }
  const labels = new Map<string, string>();
  const typeCounters = new Map<VideoPromptRefItem['type'], number>();
  for (const item of refItems) {
    if (!modeAccepts(mode, item.role, item.type)) continue;
    if (item.role === 'first_frame') {
      labels.set(item.id, '首帧');
      continue;
    }
    if (item.role === 'last_frame') {
      labels.set(item.id, '尾帧');
      continue;
    }
    const next = (typeCounters.get(item.type) ?? 0) + 1;
    typeCounters.set(item.type, next);
    labels.set(item.id, `${TYPE_LABELS[item.type]}${next}`);
  }
  return { labelOf: (id) => labels.get(id) ?? null, refItems };
}

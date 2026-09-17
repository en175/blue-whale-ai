/* ============================================
 * 高清放大（IKGM9F/IKGLZV）：图片卡「高清放大」入口的身份标记与来源边常量。
 * 本票只做入口建卡；参数面板与提交链路由 IKGM9O 接入。
 * ============================================ */
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

/** 高清来源边标记（写在 edge.data.origin）：这条边表达「高清卡由该图放大而来」，
 *  是来源记录而非生成参考输入——图片参考推导（imageMediaRefsOf）会跳过带此标记的边，
 *  源图不占参考位、不参与 @ 编号与媒体索引（口径同 mediaExtract 来源边）。 */
export const IMAGE_ENHANCE_EDGE_ORIGIN = 'image-enhance';

/** 高清卡与源卡的横向间距（沿用既有「节点宽 + 60」口径） */
const IMAGE_ENHANCE_NODE_GAP = 60;

/** 高清身份标记（node.data.imageEnhance）：高清卡的「重新编辑」据此分流到高清放大面板（IKGM9O）。 */
export interface ImageEnhanceIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id 与面板回填共用 */
  sourceAssetId?: string;
  /** 上次提交参数（IKGM9O 面板提交时写入并回填；键名以 IKGM8U 契约为准，此处只预留形状） */
  lastParams?: Record<string, unknown>;
}

/** 高清草稿卡出生位：源卡右侧让开一格（按源卡实际内容宽，口径同 mediaExtract 占位节点）。 */
export function imageEnhanceDraftPosition(source: {
  position?: { x?: number; y?: number };
  data?: Record<string, unknown>;
}): { x: number; y: number } {
  const x = Number(source.position?.x ?? 0);
  const y = Number(source.position?.y ?? 0);
  const data = source.data ?? {};
  const box = mediaContentBox({
    mediaType: data.mediaType as 'image' | 'video' | 'audio' | undefined,
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    ratio: typeof data.targetRatio === 'string' ? data.targetRatio : undefined,
  });
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    x: Math.round(left + box.width + IMAGE_ENHANCE_NODE_GAP),
    y: Math.round(top),
  };
}

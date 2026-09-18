/* ============================================
 * 媒体内容区尺寸规则：图片/视频短边 280、长边按比例且不超过 840；音频恒为 280×280 方形
 * 真实宽高优先；缺失时用目标比例（生成参数透传，非真实分辨率）；均未知回退 280×280
 * ============================================ */

export interface MediaContentSizeInput {
  /** 媒体类型：音频无可视宽高，内容区恒方形 */
  mediaType?: 'image' | 'video' | 'audio';
  /** 真实媒体宽度（像素），来自资产数据或浏览器实测 */
  width?: number;
  /** 真实媒体高度（像素） */
  height?: number;
  /** 目标比例字符串，如 "16:9"；仅作形状依据，不得当作原始分辨率展示 */
  ratio?: string;
}

export interface MediaContentBox {
  width: number;
  height: number;
}

/** 浏览器量得的真实媒体尺寸（时长仅视频/音频可测得） */
export interface MediaDims {
  width: number;
  height: number;
  duration?: number;
}

const MEDIA_CONTENT_SHORT_SIDE = 280;
const MEDIA_CONTENT_LONG_SIDE_MAX = 840;

/** 媒体内容区相对节点左上角的纵向偏移（与 MediaNode wrapper 的 padding-top: 22.5px 对齐，
 *  扩图扩展框等屏幕空间覆盖层据此定位内容区（IKGOQX）。 */
export const MEDIA_CONTENT_TOP_OFFSET = 22.5;

function parseRatio(ratio?: string): number | null {
  if (!ratio) return null;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return w / h;
}

export function mediaContentBox({ mediaType, width, height, ratio }: MediaContentSizeInput): MediaContentBox {
  if (mediaType === 'audio') {
    return { width: MEDIA_CONTENT_SHORT_SIDE, height: MEDIA_CONTENT_SHORT_SIDE };
  }
  let r: number | null = null;
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    r = width / height;
  } else {
    r = parseRatio(ratio);
  }
  if (r == null) {
    return { width: MEDIA_CONTENT_SHORT_SIDE, height: MEDIA_CONTENT_SHORT_SIDE };
  }
  let w: number;
  let h: number;
  if (r >= 1) {
    h = MEDIA_CONTENT_SHORT_SIDE;
    w = MEDIA_CONTENT_SHORT_SIDE * r;
  } else {
    w = MEDIA_CONTENT_SHORT_SIDE;
    h = MEDIA_CONTENT_SHORT_SIDE / r;
  }
  const long = Math.max(w, h);
  if (long > MEDIA_CONTENT_LONG_SIDE_MAX) {
    const s = MEDIA_CONTENT_LONG_SIDE_MAX / long;
    w *= s;
    h *= s;
  }
  return { width: w, height: h };
}

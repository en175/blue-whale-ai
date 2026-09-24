/* ============================================
 * 图片擦除（IKGOSZ / IKGOT7+IKGOTB）：擦除入口门槛预检、来源边常量、
 * 结果卡身份标记与遮罩栅格化发送辅助。
 * 门槛/场景/键名/遮罩来源标记直接复用 backend/libs/contracts/image-erase.ts
 * （web 经 @lib alias 引入契约，先例见 imageEnhance.ts）。
 * ============================================ */
import {
  IMAGE_ERASE_INPUT_FORMATS,
  IMAGE_ERASE_MAX_FILE_BYTES,
  IMAGE_ERASE_MAX_LONG_SIDE_PX,
  IMAGE_ERASE_MAX_SHORT_SIDE_PX,
  IMAGE_ERASE_MIN_SIDE_PX,
  type ImageEraseInput,
} from '@lib/contracts/image-erase';

export type { ImageEraseInput };
import { rasterizeMask, type MaskCoordinateSpace, type MaskOp, type MaskRasterSink } from './eraseMask';

/* ============ 门槛预检（IKGOT7，常量与契约同源） ============ */

/** 输入尺寸上限（短边/长边语义：长边 ≤2560 且短边 ≤1440，竖图 1440×2560 合法）与
 *  最小边下限（任一边 ≥10，供应商硬性要求）；与后端创建入口复核同源，避免前端放行、
 *  后端拒绝的口径不对称。常量单源在契约 image-erase.ts（后端复核同源引用）。 */
export const IMAGE_ERASE_MAX_LONG_SIDE = IMAGE_ERASE_MAX_LONG_SIDE_PX;
export const IMAGE_ERASE_MAX_SHORT_SIDE = IMAGE_ERASE_MAX_SHORT_SIDE_PX;
export const IMAGE_ERASE_MIN_SIDE = IMAGE_ERASE_MIN_SIDE_PX;

/** 输入大小上限（≤10MB）。常量单源在契约 image-erase.ts。 */
export const IMAGE_ERASE_MAX_SIZE_BYTES = IMAGE_ERASE_MAX_FILE_BYTES;

/** 支持的擦除输入格式（契约白名单 png/jpg/jpeg/heic）。门槛判定按白名单反转：
 *  识别出格式且不在白名单（webp/gif/bmp 等）即置灰；识别不出（null）不拦，交后端按权威数据复核。 */
const IMAGE_ERASE_SUPPORTED_FORMATS = IMAGE_ERASE_INPUT_FORMATS;

/** 门槛判定输入：与 MediaNode data 字段同名（width/height/size/mime/fileName/src）。 */
export interface ImageEraseGateSource {
  width?: number;
  height?: number;
  size?: number;
  mime?: string;
  fileName?: string;
  src?: string;
}

/** 取字符串扩展名（去 query/hash 后的最后一段，小写）；无扩展名返回 null。 */
function extOf(value: string | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const clean = value.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1).toLowerCase();
}

/** 图片格式判定（小写扩展名）：mime 优先，缺失时依次从 src / fileName 扩展名推断；
 *  识别不出返回 null（不拦，与尺寸缺失同口径：交后端按权威数据复核）。 */
export function imageEraseFormatOf(source: ImageEraseGateSource): string | null {
  if (typeof source.mime === 'string' && source.mime !== '') {
    const slash = source.mime.lastIndexOf('/');
    const subtype = (slash >= 0 ? source.mime.slice(slash + 1) : source.mime).toLowerCase();
    if (subtype !== '') return subtype;
  }
  return extOf(source.src) ?? extOf(source.fileName);
}

/** 支持格式提示文案（契约白名单渲染，悬停用）。 */
const SUPPORTED_FORMATS_LABEL = IMAGE_ERASE_SUPPORTED_FORMATS.map((f) => f.toUpperCase()).join(' / ');

/** 「擦除」入口门槛预检：返回不可用原因（悬停展示），null 为可用。
 *  尺寸/大小缺失不拦（存量图宽高 null，onLoad 实测回填后按实测重判）；
 *  判定顺序：格式 → 尺寸 → 大小。 */
export function imageEraseGateReason(source: ImageEraseGateSource): string | null {
  const format = imageEraseFormatOf(source);
  if (format !== null && !(IMAGE_ERASE_SUPPORTED_FORMATS as readonly string[]).includes(format)) {
    return `${format} 格式不支持擦除（支持 ${SUPPORTED_FORMATS_LABEL}）`;
  }
  const { width, height, size } = source;
  if (typeof width === 'number' && typeof height === 'number') {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (longSide > IMAGE_ERASE_MAX_LONG_SIDE || shortSide > IMAGE_ERASE_MAX_SHORT_SIDE) {
      return `图片长边超过 ${IMAGE_ERASE_MAX_LONG_SIDE} 或短边超过 ${IMAGE_ERASE_MAX_SHORT_SIDE}，无法擦除`;
    }
    if (width < IMAGE_ERASE_MIN_SIDE || height < IMAGE_ERASE_MIN_SIDE) {
      return `图片尺寸小于 ${IMAGE_ERASE_MIN_SIDE}×${IMAGE_ERASE_MIN_SIDE} 像素，无法擦除`;
    }
  }
  if (typeof size === 'number' && size > IMAGE_ERASE_MAX_SIZE_BYTES) {
    return '图片超过 10MB，无法擦除';
  }
  return null;
}

/* ============ 结果卡身份与来源边（IKGOTB） ============ */

/** 擦除来源边标记（写在 edge.data.origin，模式同 imageEnhance.ts 的 IMAGE_ENHANCE_EDGE_ORIGIN）：
 *  这条边表达「擦除结果卡由该图擦除而来」，是来源记录而非生成参考输入——图片参考推导
 *  （imageMediaRefsOf）会跳过带此标记的边，源图不占参考位、不参与 @ 编号与媒体索引。 */
export const IMAGE_ERASE_EDGE_ORIGIN = 'image-erase';

/** 擦除身份标记（node.data.imageErase，形态对齐 ImageEnhanceIdentity）：
 *  「重新编辑」不分流专属面板（擦除无参数面板），lastInput 供失败重试原样重发创建接口。 */
export interface ImageEraseIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId?: string;
  /** 上次提交参数（契约三键/四键形态，target_node_id 指向本卡）；失败重试原样重发 */
  lastInput?: ImageEraseInput;
}

/* ============ 遮罩栅格化发送辅助（IKGOTB） ============ */

/** 涂区存在性探测（发送门用）：把图元按序标记到 64×36 粗网格（涂=1/橡皮=0，后写覆盖先写），
 *  返回最终并集是否非空。语义对齐 rasterizeMask 的差集叠加——「涂了又全被橡皮擦掉」不可发送；
 *  只做展示门，精确并集由发送时栅格化产出。零面积框（对角重合）按 1 格计（宽松门，无害）。 */
export function maskHasPaintArea(
  ops: readonly MaskOp[],
  displayWidth: number,
  displayHeight: number,
): boolean {
  const COLS = 64;
  const ROWS = 36;
  const grid = new Uint8Array(COLS * ROWS);
  const sx = COLS / Math.max(1, displayWidth);
  const sy = ROWS / Math.max(1, displayHeight);
  const markRect = (x1: number, y1: number, x2: number, y2: number, value: number) => {
    const left = Math.max(0, Math.round(Math.min(x1, x2)));
    const right = Math.min(COLS - 1, Math.round(Math.max(x1, x2)));
    const top = Math.max(0, Math.round(Math.min(y1, y2)));
    const bottom = Math.min(ROWS - 1, Math.round(Math.max(y1, y2)));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) grid[y * COLS + x] = value;
    }
  };
  for (const op of ops) {
    const value = op.erase ? 0 : 1;
    if (op.kind === 'rect') {
      markRect(op.from.x * sx, op.from.y * sy, op.to.x * sx, op.to.y * sy, value);
    } else {
      const r = Math.max(1, Math.round(op.radius * sx));
      for (const p of op.points) {
        markRect(p.x * sx - r, p.y * sy - r, p.x * sx + r, p.y * sy + r, value);
      }
    }
  }
  return grid.some((v) => v === 1);
}

/** 涂抹发送会话快照（IKI8L7）：点发送瞬间（遮罩栅格化之前）同步捕获的发送身份与输入——
 *  目标卡 nodeId、源资产 assetId（按 id 表达身份，不按名称/位置识别）、擦除会话纪元。
 *  栅格化、上传、创建任务全程只用这份快照：编码（canvas.toBlob）在途回调返回后不重新
 *  捕获当前会话、不读取新会话输入——旧编码结果不冒领重开会话的身份。 */
export interface EraseMaskSendSession {
  /** 发送时的目标源图卡 id */
  nodeId: string;
  /** 发送时源图卡承载的资产 id */
  sourceAssetId: string;
  /** 发送时捕获的擦除会话纪元（toolSessionCoordinator createToolSessionEpoch） */
  sessionEpoch: number;
}

/** 把图元序列栅格化成黑白遮罩 PNG File（发送链路用）：
 *  eraseMask.rasterizeMask → 离屏 canvas（尺寸=源图自然分辨率）→ toBlob('image/png')。
 *  返回 null 表示 canvas 不可用或编码失败（调用方按发送失败处理，不提交任务）。 */
export function rasterizeMaskToPngFile(
  ops: readonly MaskOp[],
  space: MaskCoordinateSpace,
): Promise<File | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = space.naturalWidth;
    canvas.height = space.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    const sink: MaskRasterSink = {
      fillRect(x, y, width, height, value) {
        ctx.fillStyle = `rgb(${value},${value},${value})`;
        ctx.fillRect(x, y, width, height);
      },
      strokePath(points, radius, value) {
        if (points.length === 0) return;
        ctx.fillStyle = `rgb(${value},${value},${value})`;
        ctx.strokeStyle = `rgb(${value},${value},${value})`;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, radius * 2);
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i]!.x, points[i]!.y);
        if (points.length === 1) ctx.lineTo(points[0]!.x, points[0]!.y);
        ctx.stroke();
        // 单点（或极短笔迹）在部分实现下 stroke 不落像素：补画圆点兜底
        if (points.length === 1) {
          ctx.beginPath();
          ctx.arc(points[0]!.x, points[0]!.y, Math.max(1, radius), 0, Math.PI * 2);
          ctx.fill();
        }
      },
    };
    rasterizeMask(ops, space, sink);
    canvas.toBlob((blob) => {
      resolve(blob ? new File([blob], 'erase-mask.png', { type: 'image/png' }) : null);
    }, 'image/png');
  });
}

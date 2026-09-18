/* ============================================
 * 图片裁切（IKGW1G，IKGV2J 整包第一票）：前端本地裁切的换算与决策纯函数库。
 * 覆盖：内收拖边/拖角换算、锁比例对角锚等比缩放、框内平移钳制、
 * 64 像素自然分辨率下限、内容区内最大内接指定比例矩形（居中）、
 * 显示坐标→自然分辨率换算（裁切按原图自然分辨率执行，与画布缩放无关）、
 * 产出格式决策（跟随源图）。打法对齐扩图 imageOutpaint.ts；裁切不经任务链路、
 * 无后端契约，公共常量以本文件为单源（规格 docs/specs/2026-09-18-image-crop-frontend.md）。
 * 坐标系约定：裁切框与内容区矩形（bounds）须同一坐标系（组件层用画布 flow 坐标，
 * 先例 OutpaintFrame 的 rect 形态）；内容区顶部 22.5px 偏移属组件层 bounds 构造职责，
 * 本文件只管矩形数学。内容盒是原图的等比缩放，显示坐标口径的比例换算与
 * 自然分辨率口径完全一致（同 imageOutpaint.ts 头注）。
 * ============================================ */

/** 裁切框矩形：与内容区同坐标系（组件层为画布 flow 坐标，未乘画布 zoom 的显示几何） */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 边手柄（自由模式可拖；锁比例模式下组件层禁用） */
export type CropEdge = 'top' | 'right' | 'bottom' | 'left';
/** 角手柄（nw=左上 / ne=右上 / sw=左下 / se=右下） */
export type CropCorner = 'nw' | 'ne' | 'sw' | 'se';

/* ============ 比例预设（面板六选项） ============ */

export type CropPresetKey = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

/** 预设展示名（free = 自由模式，不锁比例） */
export const CROP_PRESET_LABELS: Record<CropPresetKey, string> = {
  free: '自由',
  '1:1': '1:1',
  '4:3': '4:3',
  '3:4': '3:4',
  '16:9': '16:9',
  '9:16': '9:16',
};

/** 预设顺序（面板比例行渲染序） */
export const CROP_PRESET_ORDER: CropPresetKey[] = ['free', '1:1', '4:3', '3:4', '16:9', '9:16'];

/** 预设 → 目标比例（宽/高）；free 为 null（自由模式不锁比例） */
export function cropPresetRatio(key: CropPresetKey): number | null {
  switch (key) {
    case 'free': return null;
    case '1:1': return 1;
    case '4:3': return 4 / 3;
    case '3:4': return 3 / 4;
    case '16:9': return 16 / 9;
    case '9:16': return 9 / 16;
  }
}

/* ============ 裁切几何（拖拽换算与钳制，全部纯函数） ============ */

/** 进入裁切模式默认框：整个内容区（默认自由比例、全幅起点，不记忆上次状态） */
export function fullCropRect(bounds: CropRect): CropRect {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

/** 把框钳制到合法态：短边不小于 minSide、完整落在内容区内（先钳尺寸再钳位置，
 *  位置越界时贴边停靠）。minSide 大于内容区边长时退化为该边全幅（小图兜底）。 */
export function clampCropRect(rect: CropRect, bounds: CropRect, minSide: number): CropRect {
  const width = Math.min(Math.max(rect.width, minSide), bounds.width);
  const height = Math.min(Math.max(rect.height, minSide), bounds.height);
  const x = Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.width - width);
  const y = Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.height - height);
  return { x, y, width, height };
}

/** 内收拖边（自由模式）：被拖边跟随指针，对边与另两向保持不动；
 *  钳制保证不越过对边（短边下限）且不出内容区（对边不动由构造保证，位置钳制只处理越界）。 */
export function dragCropEdge(
  side: CropEdge,
  rect: CropRect,
  bounds: CropRect,
  pointer: { x: number; y: number },
  minSide: number,
): CropRect {
  let next: CropRect;
  if (side === 'top') {
    next = { x: rect.x, y: pointer.y, width: rect.width, height: rect.y + rect.height - pointer.y };
  } else if (side === 'bottom') {
    next = { x: rect.x, y: rect.y, width: rect.width, height: pointer.y - rect.y };
  } else if (side === 'left') {
    next = { x: pointer.x, y: rect.y, width: rect.x + rect.width - pointer.x, height: rect.height };
  } else {
    next = { x: rect.x, y: rect.y, width: pointer.x - rect.x, height: rect.height };
  }
  return clampCropRect(next, bounds, minSide);
}

/** 拖角换算（每帧从拖动开始那一刻的框 start 重算，无累积漂移）：
 *  lockedRatio = null 自由改宽高——两条邻边独立跟随指针，对角锚定不动；
 *  lockedRatio 非 null 以对角为锚等比缩放——取不超过指针期望框的最大内切等比框
 *  （面板锁定比例传预设值；Shift 临时锁传 start.width / start.height，同一算法两个入口，
 *  先例扩图 dragExpandCorner 的 Shift 锁比例口径）。最后统一钳制（撞墙时锚随墙让位，
 *  框恒在内容区内；比例撞 64 像素硬下限时让位于下限）。 */
export function dragCropCorner(
  corner: CropCorner,
  start: CropRect,
  bounds: CropRect,
  pointer: { x: number; y: number },
  minSide: number,
  lockedRatio: number | null,
): CropRect {
  // 对角锚点（拖角期间不动）：角的对角即框的另一个端点
  const anchorX = corner === 'nw' || corner === 'sw' ? start.x + start.width : start.x;
  const anchorY = corner === 'nw' || corner === 'ne' ? start.y + start.height : start.y;
  let next: CropRect;
  if (lockedRatio == null) {
    // 自由拖角：框 = 锚与指针构成的规范化矩形（指针越过锚时框翻到锚另一侧，仍合法）
    next = {
      x: Math.min(anchorX, pointer.x),
      y: Math.min(anchorY, pointer.y),
      width: Math.abs(pointer.x - anchorX),
      height: Math.abs(pointer.y - anchorY),
    };
  } else {
    // 锁比例：沿拖角方向的期望宽高（均为非负期望），等比内切不越过指针
    const wantW = Math.abs(pointer.x - anchorX);
    const wantH = Math.abs(pointer.y - anchorY);
    const boxW = Math.min(wantW, wantH * lockedRatio);
    const boxH = boxW / lockedRatio;
    next = {
      x: corner === 'nw' || corner === 'sw' ? anchorX - boxW : anchorX,
      y: corner === 'nw' || corner === 'ne' ? anchorY - boxH : anchorY,
      width: boxW,
      height: boxH,
    };
  }
  return clampCropRect(next, bounds, minSide);
}

/** 框内整体平移：尺寸不变，位置加位移后钳制在内容区内（先撞哪边停哪边） */
export function moveCropRect(rect: CropRect, dx: number, dy: number, bounds: CropRect): CropRect {
  const x = Math.min(Math.max(rect.x + dx, bounds.x), bounds.x + bounds.width - rect.width);
  const y = Math.min(Math.max(rect.y + dy, bounds.y), bounds.y + bounds.height - rect.height);
  return { x, y, width: rect.width, height: rect.height };
}

/** 内容区内最大内接 ratio（宽/高）矩形，居中放置（选默认比例时的初始框）。
 *  比例与内容区一致时恰为全幅；显示坐标口径的比例换算与自然分辨率口径一致（等比缩放）。 */
export function inscribeCropRect(bounds: CropRect, ratio: number): CropRect {
  const width = Math.min(bounds.width, bounds.height * ratio);
  const height = width / ratio;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

/* ============ 自然分辨率口径（64 像素下限与执行换算） ============ */

/** 裁切结果短边下限（原图自然分辨率像素）：与画布缩放和显示尺寸无关 */
export const IMAGE_CROP_MIN_NATURAL_SIDE = 64;

/** 坐标空间：内容区显示尺寸 × 源图自然分辨率（内容盒保持源图宽高比；形态对齐擦除 MaskCoordinateSpace） */
export interface CropCoordinateSpace {
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

/** 64 像素下限换算到显示坐标系（拖拽钳制用 minSide）：按横轴比例换算
 *  （内容盒是源图等比缩放，纵横比例一致，口径同擦除 displayRadiusToNatural）。 */
export function minCropSideDisplay(space: CropCoordinateSpace): number {
  return IMAGE_CROP_MIN_NATURAL_SIDE * (space.displayWidth / space.naturalWidth);
}

/** 自然分辨率整数像素矩形（离屏 canvas drawImage 的源矩形） */
export interface CropNaturalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 钳位到 [0, limit] */
function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(0, value));
}

/** 显示坐标裁切框 → 自然分辨率整数像素矩形（裁切执行口径，恒不放大）：
 *  先相对内容区原点、再乘比例、两端各自四舍五入并钳位到 [0, 自然分辨率]，
 *  宽高为两端差（取整口径同擦除 displayRectToNatural，任意缩放下与原图像素对齐）。 */
export function cropRectToNatural(
  rect: CropRect,
  bounds: CropRect,
  space: CropCoordinateSpace,
): CropNaturalRect {
  const scaleX = space.naturalWidth / space.displayWidth;
  const scaleY = space.naturalHeight / space.displayHeight;
  const x1 = clamp(Math.round((Math.min(rect.x, rect.x + rect.width) - bounds.x) * scaleX), space.naturalWidth);
  const y1 = clamp(Math.round((Math.min(rect.y, rect.y + rect.height) - bounds.y) * scaleY), space.naturalHeight);
  const x2 = clamp(Math.round((Math.max(rect.x, rect.x + rect.width) - bounds.x) * scaleX), space.naturalWidth);
  const y2 = clamp(Math.round((Math.max(rect.y, rect.y + rect.height) - bounds.y) * scaleY), space.naturalHeight);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/* ============ 产出格式决策（跟随源图） ============ */

/** JPEG 重编码质量（约 0.92：视觉近无损，规格 Implementation Decisions） */
export const IMAGE_CROP_JPEG_QUALITY = 0.92;

/** 格式判定输入：与 MediaNode data 字段同名（mime 优先，缺失时从 src / fileName 扩展名推断） */
export interface CropFormatSource {
  mime?: string;
  src?: string;
  fileName?: string;
}

/** 产出格式决策结果：mime 供 canvas.toBlob、quality 仅 JPEG 生效（PNG 填 1 表无损，toBlob 忽略）、ext 供产物文件名 */
export interface CropOutputFormat {
  mime: 'image/jpeg' | 'image/png';
  quality: number;
  ext: 'jpg' | 'png';
}

/** 取字符串扩展名（去 query/hash 后的最后一段，小写）；无扩展名返回 null（形态同擦除 extOf） */
function extOf(value: string | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const clean = value.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1).toLowerCase();
}

/** 产出格式决策（跟随源图）：JPEG 源出 JPEG（质量约 0.92）、PNG 源出 PNG（无损重编码）；
 *  判不出格式 PNG 兜底；webp/gif 等判得出但 canvas 通用编码器不覆盖的一律 PNG 兜底
 *  （无损、通用，避免文件莫名膨胀——规格 User Story 24）。 */
export function cropOutputFormat(source: CropFormatSource): CropOutputFormat {
  let format: string | null = null;
  if (typeof source.mime === 'string' && source.mime !== '') {
    const slash = source.mime.lastIndexOf('/');
    format = (slash >= 0 ? source.mime.slice(slash + 1) : source.mime).toLowerCase();
  }
  if (format == null || format === '') format = extOf(source.src) ?? extOf(source.fileName);
  if (format === 'jpeg' || format === 'jpg') {
    return { mime: 'image/jpeg', quality: IMAGE_CROP_JPEG_QUALITY, ext: 'jpg' };
  }
  return { mime: 'image/png', quality: 1, ext: 'png' };
}

/* ============ 来源边标记（子票建卡闭环用） ============ */

/** 裁切来源边标记（写在 edge.data.origin，模式同擦除 IMAGE_ERASE_EDGE_ORIGIN）：
 *  这条边表达「裁切结果卡由该图裁切而来」，是纯视觉来源记录而非生成参考输入——
 *  图片参考推导会跳过带此标记的边，源图不占参考位、不参与 @ 编号与媒体索引。 */
export const IMAGE_CROP_EDGE_ORIGIN = 'image-crop';

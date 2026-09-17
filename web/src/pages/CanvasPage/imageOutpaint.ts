/* ============================================
 * 图片扩图（IKGOQX）：前端本地的门槛预检与扩展框几何纯函数。
 * 契约票（IKGOQR）并行在建 backend/libs/contracts/image-outpaint.ts；
 * 本模块常量按已拍板字段写成易迁移形态，IKGOR6 接契约时单处替换出处。
 * 像素扩展量均用画布 flow 单位（与原图显示盒同比例，换算出的比例
 * 与用原图像素计算完全一致——显示盒就是原图的等比缩放）。
 * ============================================ */

/** 每方向最大扩展量（相对原图短边，已拍板 0.4） */
export const IMAGE_OUTPAINT_MAX_EXPAND_RATIO = 0.4;
/** 源图长边上限（像素） */
export const IMAGE_OUTPAINT_LONG_SIDE_LIMIT = 4160;
/** 源图文件大小上限（字节，10MB） */
export const IMAGE_OUTPAINT_FILE_SIZE_LIMIT = 10 * 1024 * 1024;

/** 四方向扩展量（画布 flow 像素，均 ≥ 0） */
export interface ExpandSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 全零扩展（进入模式默认态：框与原图重合） */
export const ZERO_EXPANDS: ExpandSides = { top: 0, right: 0, bottom: 0, left: 0 };

/** 原内容区矩形（flow 单位）：扩展框永远完整包住它 */
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ============ 门槛预检（IKGOQX 菜单项置灰口径） ============ */

/** 源图可用性预检：返回不可用原因，null 为可用。
 *  与高清放大档门槛同口径的实现方式（imageEnhanceTierGateReason 先例），
 *  服务端复核为权威（契约票落 contracts 后双端同源）。 */
export function outpaintGateReason(
  width: number | undefined,
  height: number | undefined,
  size: number | undefined,
): string | null {
  if (typeof width !== 'number' || typeof height !== 'number') {
    return '图片真实尺寸未知，无法扩图';
  }
  if (Math.max(width, height) > IMAGE_OUTPAINT_LONG_SIDE_LIMIT) {
    return `源图长边超过 ${IMAGE_OUTPAINT_LONG_SIDE_LIMIT}px，无法扩图`;
  }
  if (typeof size === 'number' && size > IMAGE_OUTPAINT_FILE_SIZE_LIMIT) {
    return '源图文件超过 10MB，无法扩图';
  }
  return null;
}

/* ============ 扩展几何（拖拽换算，全部纯函数） ============ */

/** 单方向扩展上限（原图短边 × 40%） */
export function maxExpandPerSide(rect: Pick<SourceRect, 'width' | 'height'>): number {
  return Math.min(rect.width, rect.height) * IMAGE_OUTPAINT_MAX_EXPAND_RATIO;
}

/** 每方向钳制到 [0, maxPerSide]（只许向外扩、40% 上限） */
export function clampExpands(expands: ExpandSides, maxPerSide: number): ExpandSides {
  const clamp = (v: number) => Math.min(Math.max(v, 0), maxPerSide);
  return {
    top: clamp(expands.top),
    right: clamp(expands.right),
    bottom: clamp(expands.bottom),
    left: clamp(expands.left),
  };
}

/** 像素扩展量 → 四方向扩展比例（相对原图短边；提交参数唯一来源，IKGOR6 接走） */
export function expandRatiosOf(
  expands: ExpandSides,
  rect: Pick<SourceRect, 'width' | 'height'>,
): { top: number; right: number; bottom: number; left: number } {
  const shortSide = Math.min(rect.width, rect.height);
  const ratio = (v: number) => Math.min(Math.max(v / shortSide, 0), IMAGE_OUTPAINT_MAX_EXPAND_RATIO);
  return {
    top: ratio(expands.top),
    right: ratio(expands.right),
    bottom: ratio(expands.bottom),
    left: ratio(expands.left),
  };
}

/** 拖 4 条边：单边跟随鼠标（原内容区边缘即零位），其余方向保持，钳制后返回 */
export function dragExpandEdge(
  side: keyof ExpandSides,
  rect: SourceRect,
  pointer: { x: number; y: number },
  current: ExpandSides,
  maxPerSide: number,
): ExpandSides {
  let raw: number;
  if (side === 'top') raw = rect.y - pointer.y;
  else if (side === 'bottom') raw = pointer.y - (rect.y + rect.height);
  else if (side === 'left') raw = rect.x - pointer.x;
  else raw = pointer.x - (rect.x + rect.width);
  return clampExpands({ ...current, [side]: raw }, maxPerSide);
}

/** 拖 4 个角。非 Shift：两边独立跟随鼠标；Shift：锁定开始拖动那一刻的框比例，
 *  以对角为锚等比外扩（取不超过鼠标期望框的最大内切等比框），再各自钳制。 */
export function dragExpandCorner(
  corner: 'nw' | 'ne' | 'sw' | 'se',
  rect: SourceRect,
  pointer: { x: number; y: number },
  start: ExpandSides,
  maxPerSide: number,
  shiftLock: boolean,
): ExpandSides {
  // 对角锚点（拖角期间不动）：角的对角即框的另一个端点
  const anchorX = corner === 'nw' || corner === 'sw'
    ? rect.x + rect.width + start.right
    : rect.x - start.left;
  const anchorY = corner === 'nw' || corner === 'ne'
    ? rect.y + rect.height + start.bottom
    : rect.y - start.top;
  // 鼠标给出的期望框宽高（沿外扩方向为正）
  const wantW = corner === 'nw' || corner === 'sw' ? anchorX - pointer.x : pointer.x - anchorX;
  const wantH = corner === 'nw' || corner === 'ne' ? anchorY - pointer.y : pointer.y - anchorY;
  const horizontal: keyof ExpandSides = corner === 'nw' || corner === 'sw' ? 'left' : 'right';
  const vertical: keyof ExpandSides = corner === 'nw' || corner === 'ne' ? 'top' : 'bottom';
  const rawW = Math.max(wantW, 0);
  const rawH = Math.max(wantH, 0);
  if (!shiftLock) {
    // 自由拖角：两边独立跟随鼠标（同拖边的原内容区边缘零位公式）
    return clampExpands(
      {
        ...start,
        [horizontal]: corner === 'nw' || corner === 'sw'
          ? rect.x - pointer.x
          : pointer.x - (rect.x + rect.width),
        [vertical]: corner === 'nw' || corner === 'ne'
          ? rect.y - pointer.y
          : pointer.y - (rect.y + rect.height),
      },
      maxPerSide,
    );
  }
  // 锁比例：以开始那一刻的框比例等比（内切鼠标期望框，不越过鼠标位置）
  const ratio0 = (rect.width + start.left + start.right) / (rect.height + start.top + start.bottom);
  const boxW = Math.min(rawW, rawH * ratio0);
  const boxH = boxW / ratio0;
  // 反解为两方向扩展量：锚定边保持开始值
  const rawHorizontal = corner === 'nw' || corner === 'sw'
    ? boxW - rect.width - start.right
    : boxW - rect.width - start.left;
  const rawVertical = corner === 'nw' || corner === 'ne'
    ? boxH - rect.height - start.bottom
    : boxH - rect.height - start.top;
  return clampExpands(
    { ...start, [horizontal]: rawHorizontal, [vertical]: rawVertical },
    maxPerSide,
  );
}

/* ============ 比例预设联动（纯函数便于测试） ============ */

export type OutpaintPresetKey = 'original' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

/** 预设展示名（original = 原图比例） */
export const OUTPAINT_PRESET_LABELS: Record<OutpaintPresetKey, string> = {
  original: '原图比例',
  '1:1': '1:1',
  '4:3': '4:3',
  '3:4': '3:4',
  '16:9': '16:9',
  '9:16': '9:16',
};

/** 预设顺序（面板比例行渲染序）；original 的目标比例按源图动态算 */
export const OUTPAINT_PRESET_ORDER: OutpaintPresetKey[] = ['original', '1:1', '4:3', '3:4', '16:9', '9:16'];

function presetRatio(key: OutpaintPresetKey): number | null {
  switch (key) {
    case 'original': return null;
    case '1:1': return 1;
    case '4:3': return 4 / 3;
    case '3:4': return 3 / 4;
    case '16:9': return 16 / 9;
    case '9:16': return 9 / 16;
  }
}

/** 点预设：以原图中心为锚外扩到「能完整包住原图的该比例最小包含框」。
 *  original 恒为全零（一键重置）；受 40% 上限约束达不到时返回 null（置灰）。 */
export function presetExpands(
  rect: Pick<SourceRect, 'width' | 'height'>,
  key: OutpaintPresetKey,
  maxPerSide: number,
): ExpandSides | null {
  const ratio = presetRatio(key);
  if (ratio == null) return { ...ZERO_EXPANDS };
  const boxW = Math.max(rect.width, rect.height * ratio);
  const boxH = boxW / ratio;
  const expands: ExpandSides = {
    left: (boxW - rect.width) / 2,
    right: (boxW - rect.width) / 2,
    top: (boxH - rect.height) / 2,
    bottom: (boxH - rect.height) / 2,
  };
  const max = Math.max(expands.top, expands.right, expands.bottom, expands.left);
  return max > maxPerSide ? null : expands;
}

/** 预设命中容差（相对比例差）：手拖落在该窗口内即高亮对应预设 */
export const OUTPAINT_PRESET_MATCH_TOLERANCE = 0.005;

/** 当前框命中哪个预设（比例相等判定，含原图比例）；都不匹配返回 null（自定义）。 */
export function matchOutpaintPreset(
  expands: ExpandSides,
  rect: Pick<SourceRect, 'width' | 'height'>,
): OutpaintPresetKey | null {
  const boxW = rect.width + expands.left + expands.right;
  const boxH = rect.height + expands.top + expands.bottom;
  const current = boxW / boxH;
  const within = (target: number) => Math.abs(current - target) / target <= OUTPAINT_PRESET_MATCH_TOLERANCE;
  if (within(rect.width / rect.height)) return 'original';
  for (const key of OUTPAINT_PRESET_ORDER) {
    if (key === 'original') continue;
    const ratio = presetRatio(key)!;
    if (within(ratio)) return key;
  }
  return null;
}

/** 各预设可达性：可达为 null，不可达给出悬停原因（original 恒可达）。 */
export function outpaintPresetAvailability(
  rect: Pick<SourceRect, 'width' | 'height'>,
  maxPerSide: number,
): Record<OutpaintPresetKey, string | null> {
  const result = {} as Record<OutpaintPresetKey, string | null>;
  for (const key of OUTPAINT_PRESET_ORDER) {
    result[key] = presetExpands(rect, key, maxPerSide) === null
      ? `受每方向最多扩展原图短边 ${Math.round(IMAGE_OUTPAINT_MAX_EXPAND_RATIO * 100)}% 限制，当前图片无法扩到${OUTPAINT_PRESET_LABELS[key]}`
      : null;
  }
  return result;
}

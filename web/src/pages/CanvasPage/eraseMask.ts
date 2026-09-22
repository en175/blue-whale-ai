/* ============================================
 * 擦除遮罩编辑纯逻辑（IKGOT8，IKGOSZ 波1）：零 React/DOM 依赖。
 * 覆盖三块能力（规格 docs/specs/2026-09-18-image-erase-mediakit.md「遮罩模型为独立纯逻辑模块」）：
 *  1. 图元模型与撤销/重做小栈：笔迹（stroke 折线+圆头笔刷半径）与矩形框（rect 对角）两类
 *     图元按顺序叠加成并集，橡皮是同形态图元的差集操作（后写覆盖先写）；框落笔即固化，无活框态。
 *     撤销/重做只作用于未发送的遮罩编辑（与画布撤销无关的独立小栈）。
 *  2. 显示坐标→源图自然分辨率换算：图元记录显示坐标（相对图片显示区域左上角，CSS 像素，
 *     未乘画布 zoom），换算输入=显示坐标+显示尺寸+自然分辨率，输出=自然分辨率像素，
 *     取整（四舍五入）+钳位保证任意缩放/卡片尺寸下与原图像素对齐。
 *  3. 栅格化：图元序列按顺序写入注入的 sink（像素写入口抽象，不依赖 canvas API），
 *     IKGOTB 用离屏 canvas 实现_sink 生成黑白遮罩 PNG；尺寸严格等于源图自然分辨率
 *     （火山接口硬性要求 mask 与原图同分辨率）。
 *
 * 黑白语义（重要）：火山官方文档（提交图像擦除修复任务 API）仅说明 mask_url 为
 * 「黑白遮罩图，可以指定需要擦除的任意形状区域」，未规定白/黑哪侧代表擦除。
 * 本模块按修复类接口通行惯例取「白=擦除区域、黑=保留区域」，以常量锁死；
 * 若联调实测方向相反，仅改 MASK_PIXEL_ERASED/MASK_PIXEL_KEPT 两常量即可全局反转。
 *
 * 接缝说明（给 IKGOTB）：state.ops 即棋盘格渲染数据（按序叠加的图元列表，显示坐标）；
 * 指针事件换算成显示坐标后经 applyMaskOp 落栈；发送前 rasterizeMask(ops, space, canvasSink)。
 * ============================================ */

/** 显示坐标点：相对图片显示区域左上角（CSS 像素，未乘画布 zoom） */
export interface MaskPoint {
  x: number;
  y: number;
}

/** 笔迹图元：显示坐标折线 + 圆头笔刷半径（显示坐标系）；erase=true 表示橡皮（从并集中减去） */
export interface MaskStrokeOp {
  kind: 'stroke';
  erase: boolean;
  /** 折线（至少一个点；单点=圆点） */
  points: readonly MaskPoint[];
  /** 笔刷半径（显示坐标系像素） */
  radius: number;
}

/** 矩形框图元：显示坐标拖拽对角（任一方向，换算时归一）；框落笔即固化，无活框选中态 */
export interface MaskRectOp {
  kind: 'rect';
  erase: boolean;
  from: MaskPoint;
  to: MaskPoint;
}

export type MaskOp = MaskStrokeOp | MaskRectOp;

/** 坐标空间：显示区域尺寸 × 源图自然分辨率（假定显示区域保持源图宽高比） */
export interface MaskCoordinateSpace {
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

/** 遮罩编辑状态（不可变）：ops=已应用操作（撤销栈，末尾为最近操作），redoStack=重做栈（末尾为最近撤销） */
export interface MaskEditState {
  ops: readonly MaskOp[];
  redoStack: readonly MaskOp[];
}

/** 灰度值：黑白遮罩只取两端 */
export type MaskPixelValue = 0 | 255;

/** 涂区像素值：白 255 = 擦除区域（见文件头「黑白语义」） */
export const MASK_PIXEL_ERASED = 255 as const satisfies MaskPixelValue;
/** 未涂像素值：黑 0 = 保留区域 */
export const MASK_PIXEL_KEPT = 0 as const satisfies MaskPixelValue;

/**
 * 栅格化像素写入口（IKGOTB 用离屏 canvas 实现，测试用内存网格）：
 * - fillRect：填充整数像素矩形（x,y 为左上角像素，width/height 为像素数）
 * - strokePath：沿自然分辨率坐标折线以圆头笔刷（半径=自然分辨率像素）描画
 * 两者的 value 均为 0/255；指令按操作顺序执行，后写覆盖先写（涂白/擦黑）。
 * canvas 实现参考：fillStyle=`rgb(v,v,v)`、lineCap/lineJoin='round'、lineWidth=2*radius；
 * stroke 有抗锯齿软边，如需严格二值可对结果按阈值归一。
 */
export interface MaskRasterSink {
  fillRect(x: number, y: number, width: number, height: number, value: MaskPixelValue): void;
  strokePath(points: readonly MaskPoint[], radius: number, value: MaskPixelValue): void;
}

/** 空编辑状态（初始/清空/发送后丢弃遮罩用） */
export const EMPTY_MASK_EDIT: MaskEditState = { ops: [], redoStack: [] };

/* ============ 坐标换算 ============ */

/** 钳位到 [0, limit] */
function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(0, value));
}

/** 显示坐标点 → 自然分辨率像素坐标（四舍五入 + 钳位到 [0, 自然分辨率]） */
export function displayPointToNatural(point: MaskPoint, space: MaskCoordinateSpace): MaskPoint {
  const scaleX = space.naturalWidth / space.displayWidth;
  const scaleY = space.naturalHeight / space.displayHeight;
  return {
    x: clamp(Math.round(point.x * scaleX), space.naturalWidth),
    y: clamp(Math.round(point.y * scaleY), space.naturalHeight),
  };
}

/** 笔刷半径 → 自然分辨率像素半径（按横轴比例换算；显示区域与源图同宽高比时纵横一致） */
export function displayRadiusToNatural(radius: number, space: MaskCoordinateSpace): number {
  return Math.round(radius * (space.naturalWidth / space.displayWidth));
}

/** 自然分辨率整数像素矩形 */
export interface MaskNaturalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 框图元 → 自然分辨率整数像素矩形（对角归一，两端各自换算取整，宽高为像素差） */
export function displayRectToNatural(op: MaskRectOp, space: MaskCoordinateSpace): MaskNaturalRect {
  const x1 = clamp(Math.round(Math.min(op.from.x, op.to.x) * (space.naturalWidth / space.displayWidth)), space.naturalWidth);
  const y1 = clamp(Math.round(Math.min(op.from.y, op.to.y) * (space.naturalHeight / space.displayHeight)), space.naturalHeight);
  const x2 = clamp(Math.round(Math.max(op.from.x, op.to.x) * (space.naturalWidth / space.displayWidth)), space.naturalWidth);
  const y2 = clamp(Math.round(Math.max(op.from.y, op.to.y) * (space.naturalHeight / space.displayHeight)), space.naturalHeight);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/* ============ 栅格化 ============ */

/** 把图元序列按顺序写入 sink：首条指令全图铺保留色（黑），之后涂=写白、擦=写黑（后写覆盖先写）。
 *  输出尺寸严格等于 space.naturalWidth×naturalHeight（火山要求遮罩与原图同分辨率）。 */
export function rasterizeMask(
  ops: readonly MaskOp[],
  space: MaskCoordinateSpace,
  sink: MaskRasterSink,
): void {
  sink.fillRect(0, 0, space.naturalWidth, space.naturalHeight, MASK_PIXEL_KEPT);
  for (const op of ops) {
    const value: MaskPixelValue = op.erase ? MASK_PIXEL_KEPT : MASK_PIXEL_ERASED;
    if (op.kind === 'rect') {
      const r = displayRectToNatural(op, space);
      sink.fillRect(r.x, r.y, r.width, r.height, value);
    } else if (op.points.length > 0) {
      sink.strokePath(
        op.points.map((p) => displayPointToNatural(p, space)),
        displayRadiusToNatural(op.radius, space),
        value,
      );
    }
  }
}

/* ============ 撤销 / 重做（独立小栈，不可变状态） ============ */

/** 落一笔新操作（涂/框/橡皮通用）：追加撤销栈并清空重做栈（撤销后再落新笔则旧分支不可重做） */
export function applyMaskOp(state: MaskEditState, op: MaskOp): MaskEditState {
  return { ops: [...state.ops, op], redoStack: [] };
}

/** 撤销最近一笔：弹撤销栈尾压重做栈；空栈时原样返回（不崩） */
export function undoMaskEdit(state: MaskEditState): MaskEditState {
  if (state.ops.length === 0) return state;
  return {
    ops: state.ops.slice(0, -1),
    redoStack: [...state.redoStack, state.ops[state.ops.length - 1]],
  };
}

/** 重做最近撤销的一笔：弹重做栈尾压撤销栈；空栈时原样返回（不崩） */
export function redoMaskEdit(state: MaskEditState): MaskEditState {
  if (state.redoStack.length === 0) return state;
  return {
    ops: [...state.ops, state.redoStack[state.redoStack.length - 1]],
    redoStack: state.redoStack.slice(0, -1),
  };
}

export function canUndoMaskEdit(state: MaskEditState): boolean {
  return state.ops.length > 0;
}

export function canRedoMaskEdit(state: MaskEditState): boolean {
  return state.redoStack.length > 0;
}

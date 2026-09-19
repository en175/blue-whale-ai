/* ============================================
 * 去字幕框集合编辑纯逻辑（IKGZ83，IKGZ7V 波3）：零 React/DOM 依赖，
 * 打法对齐擦除遮罩纯逻辑层 eraseMask.ts（规格 Implementation Decisions
 * 「框集合为独立纯逻辑模块（参照擦除遮罩纯逻辑打法）」）。覆盖三块能力：
 *  1. 框图元模型与撤销/重做步骤栈：框记录显示坐标对角（相对视频显示区域左上角，
 *     CSS 像素、未乘画布 zoom，拉框方向任意、换算时归一）；框落笔即固化，
 *     无活框选中态（规格故事 10「画错了撤销或重来」）；撤销/重做只作用于
 *     未发送的框编辑（与画布撤销无关的独立小栈），步骤两类——单框增删与重置整批
 *     清空（IKH3OV：重置=一键清空全部框且一步可撤销，撤销后重做可再次清空）。
 *  2. 显示坐标 → [0,1] 归一化换算：框四键 top_left_x / top_left_y /
 *     bottom_right_x / bottom_right_y（契约 VIDEO_SUBTITLE_ERASE_BOX_KEYS），
 *     官方 Location 对象语义（官方 PDF「Location 对象」节）：归一化坐标系以
 *     画面左上角为原点 (0,0)、右下角为 (1,1)，左上/右下两顶点确定矩形。
 *  3. 20 个上限判定（契约 VIDEO_SUBTITLE_ERASE_MAX_BOXES，官方 PDF
 *     erase_ratio_location 参数节「最多支持 20 个擦除框」）：拉满即拒，UI 提示。
 *
 * 接缝说明（给 CanvasPage）：state.boxes 即框渲染数据（显示坐标图元列表）；
 * 指针事件换算成显示坐标后经 applySubtitleBox 落栈；发送前
 * subtitleBoxesToPayload(boxes, 显示尺寸) 得到契约 erase_boxes 数组。
 * ============================================ */

import {
  VIDEO_SUBTITLE_ERASE_MAX_BOXES,
  type VideoSubtitleEraseEraseBox,
} from '@lib/contracts/video-subtitle-erase';

/** 显示坐标点：相对视频显示区域左上角（CSS 像素，未乘画布 zoom） */
export interface SubtitleBoxPoint {
  x: number;
  y: number;
}

/** 矩形框图元：显示坐标拖拽对角（任一方向，换算时归一）；框落笔即固化，无活框选中态 */
export interface SubtitleBoxOp {
  kind: 'box';
  from: SubtitleBoxPoint;
  to: SubtitleBoxPoint;
}

/** 框编辑步骤（IKH3OV 重置入栈）：box=单框增删（撤销/重做各作用于一个框）；
 *  reset=整批清空（ops=清空前的框集合，撤销时整批还原，重做时再次清空）。 */
export type SubtitleBoxEditStep =
  | { kind: 'box'; op: SubtitleBoxOp }
  | { kind: 'reset'; ops: readonly SubtitleBoxOp[] };

/** 框编辑状态（不可变）：boxes=当前已固化框（渲染与发送的唯一数据源）；
 *  undoStack=已应用步骤（末尾为最近一步：落框或重置）；redoStack=已撤销步骤（末尾为最近撤销）。 */
export interface SubtitleBoxEditState {
  boxes: readonly SubtitleBoxOp[];
  undoStack: readonly SubtitleBoxEditStep[];
  redoStack: readonly SubtitleBoxEditStep[];
}

/** 空编辑状态（初始/退出编辑态丢弃/发送后重置用） */
export const EMPTY_SUBTITLE_BOX_EDIT: SubtitleBoxEditState = { boxes: [], undoStack: [], redoStack: [] };

/* ============ 上限判定与撤销 / 重做（不可变小栈） ============ */

/** 还能否再拉一个框（未达 20 上限）；拉满时入口拒新框并提示 */
export function canAddSubtitleBox(state: SubtitleBoxEditState): boolean {
  return state.boxes.length < VIDEO_SUBTITLE_ERASE_MAX_BOXES;
}

/** 落一个新框：追加一条 box 步骤并清空重做栈（撤销后再落新框则旧分支不可重做）；
 *  内置两道静默守卫——已达 20 个上限时原样返回（不崩不截断，UI 经 canAddSubtitleBox
 *  先行提示）；对角重合的零面积框（单击未拖拽的误触）原样丢弃不进栈。 */
export function applySubtitleBox(state: SubtitleBoxEditState, op: SubtitleBoxOp): SubtitleBoxEditState {
  if (!canAddSubtitleBox(state)) return state;
  if (op.from.x === op.to.x && op.from.y === op.to.y) return state;
  return {
    boxes: [...state.boxes, op],
    undoStack: [...state.undoStack, { kind: 'box', op }],
    redoStack: [],
  };
}

/** 还有可清空的框（重置钮可用判定）：只看 boxes 非空，与 canUndoSubtitleBoxEdit 语义不同——
 *  重置后 boxes 为空但 undoStack 非空（仍可撤销这次重置），两者不可互换，故不复用 canUndo。 */
export function canResetSubtitleBoxEdit(state: SubtitleBoxEditState): boolean {
  return state.boxes.length > 0;
}

/** 重置：一键清空全部检测框，并作为一步可撤销操作进 undo 栈（撤销把清空前的框集合
 *  整批还原）；同时清空重做栈（重置即新分支）。无框时原样返回——没有可清空的内容
 *  就不产生空步骤，避免撤销栈被无效操作污染。 */
export function resetSubtitleBoxEdit(state: SubtitleBoxEditState): SubtitleBoxEditState {
  if (!canResetSubtitleBoxEdit(state)) return state;
  return {
    boxes: [],
    undoStack: [...state.undoStack, { kind: 'reset', ops: state.boxes }],
    redoStack: [],
  };
}

/** 撤销最近一步（落框或重置）：弹 undo 栈尾压 redo 栈；空栈时原样返回（不崩）。
 *  box 步骤去掉末尾一个框，reset 步骤把清空前的框集合整批还原。 */
export function undoSubtitleBoxEdit(state: SubtitleBoxEditState): SubtitleBoxEditState {
  const step = state.undoStack[state.undoStack.length - 1];
  if (!step) return state;
  return {
    boxes: step.kind === 'box' ? state.boxes.slice(0, -1) : step.ops,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, step],
  };
}

/** 重做最近撤销的一步：弹 redo 栈尾压 undo 栈；空栈时原样返回（不崩）。box 步骤重新落框
 *  （保留 20 上限守卫——撤销后落新框会清空重做栈，正常到不了超限态，守卫仅防御异常序列）；
 *  reset 步骤再次清空（清空恒合法，无需上限判定）。 */
export function redoSubtitleBoxEdit(state: SubtitleBoxEditState): SubtitleBoxEditState {
  const step = state.redoStack[state.redoStack.length - 1];
  if (!step) return state;
  if (step.kind === 'box' && !canAddSubtitleBox(state)) return state;
  return {
    boxes: step.kind === 'box' ? [...state.boxes, step.op] : [],
    undoStack: [...state.undoStack, step],
    redoStack: state.redoStack.slice(0, -1),
  };
}

/** 还有可撤销的步骤（落框或重置）——重置后 boxes 为空但撤销栈非空，仍可撤销 */
export function canUndoSubtitleBoxEdit(state: SubtitleBoxEditState): boolean {
  return state.undoStack.length > 0;
}

/** 还有可重做的步骤（落框或重置） */
export function canRedoSubtitleBoxEdit(state: SubtitleBoxEditState): boolean {
  return state.redoStack.length > 0;
}

/* ============ 显示坐标 → 归一化坐标换算 ============ */

/** 钳位到 [0, 1]（归一化坐标系边界） */
function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 框图元 → 契约归一化框四键（对角归一保证 top_left ≤ bottom_right，两端各自
 *  除以显示尺寸并钳位 [0,1]；不取整——归一化坐标本就是比例小数）。
 *  displayWidth/displayHeight 为视频显示区域未缩放尺寸（与框图元同一坐标系）。 */
export function displayBoxToNormalized(
  op: SubtitleBoxOp,
  displayWidth: number,
  displayHeight: number,
): VideoSubtitleEraseEraseBox {
  const safeW = displayWidth > 0 ? displayWidth : 1;
  const safeH = displayHeight > 0 ? displayHeight : 1;
  const x1 = clampUnit(Math.min(op.from.x, op.to.x) / safeW);
  const y1 = clampUnit(Math.min(op.from.y, op.to.y) / safeH);
  const x2 = clampUnit(Math.max(op.from.x, op.to.x) / safeW);
  const y2 = clampUnit(Math.max(op.from.y, op.to.y) / safeH);
  return { top_left_x: x1, top_left_y: y1, bottom_right_x: x2, bottom_right_y: y2 };
}

/** 框集合 → 契约 erase_boxes 数组（发送用；保持落笔顺序，空集合=空数组——契约空数组合法，
 *  出站不传 erase_ratio_location 键由 worker 判空承担）。 */
export function subtitleBoxesToPayload(
  boxes: readonly SubtitleBoxOp[],
  displayWidth: number,
  displayHeight: number,
): VideoSubtitleEraseEraseBox[] {
  return boxes.map((op) => displayBoxToNormalized(op, displayWidth, displayHeight));
}


import {
  VIDEO_SUBTITLE_ERASE_MAX_BOXES,
  type VideoSubtitleEraseEraseBox,
} from '@lib/contracts/video-subtitle-erase';

export interface SubtitleBoxPoint {
  x: number;
  y: number;
}

export interface SubtitleBoxOp {
  kind: 'box';
  from: SubtitleBoxPoint;
  to: SubtitleBoxPoint;
}

export type SubtitleBoxEditStep =
  | { kind: 'box'; op: SubtitleBoxOp }
  | { kind: 'reset'; ops: readonly SubtitleBoxOp[] };

export interface SubtitleBoxEditState {
  boxes: readonly SubtitleBoxOp[];
  undoStack: readonly SubtitleBoxEditStep[];
  redoStack: readonly SubtitleBoxEditStep[];
}

export const EMPTY_SUBTITLE_BOX_EDIT: SubtitleBoxEditState = { boxes: [], undoStack: [], redoStack: [] };


export function canAddSubtitleBox(state: SubtitleBoxEditState): boolean {
  return state.boxes.length < VIDEO_SUBTITLE_ERASE_MAX_BOXES;
}

export function applySubtitleBox(state: SubtitleBoxEditState, op: SubtitleBoxOp): SubtitleBoxEditState {
  if (!canAddSubtitleBox(state)) return state;
  if (op.from.x === op.to.x && op.from.y === op.to.y) return state;
  return {
    boxes: [...state.boxes, op],
    undoStack: [...state.undoStack, { kind: 'box', op }],
    redoStack: [],
  };
}

export function canResetSubtitleBoxEdit(state: SubtitleBoxEditState): boolean {
  return state.boxes.length > 0;
}

export function resetSubtitleBoxEdit(state: SubtitleBoxEditState): SubtitleBoxEditState {
  if (!canResetSubtitleBoxEdit(state)) return state;
  return {
    boxes: [],
    undoStack: [...state.undoStack, { kind: 'reset', ops: state.boxes }],
    redoStack: [],
  };
}

export function undoSubtitleBoxEdit(state: SubtitleBoxEditState): SubtitleBoxEditState {
  const step = state.undoStack[state.undoStack.length - 1];
  if (!step) return state;
  return {
    boxes: step.kind === 'box' ? state.boxes.slice(0, -1) : step.ops,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, step],
  };
}

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

export function canUndoSubtitleBoxEdit(state: SubtitleBoxEditState): boolean {
  return state.undoStack.length > 0;
}

export function canRedoSubtitleBoxEdit(state: SubtitleBoxEditState): boolean {
  return state.redoStack.length > 0;
}


function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

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

export function subtitleBoxesToPayload(
  boxes: readonly SubtitleBoxOp[],
  displayWidth: number,
  displayHeight: number,
): VideoSubtitleEraseEraseBox[] {
  return boxes.map((op) => displayBoxToNormalized(op, displayWidth, displayHeight));
}

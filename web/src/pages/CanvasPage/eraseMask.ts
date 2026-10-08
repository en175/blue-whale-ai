
export interface MaskPoint {
  x: number;
  y: number;
}

export interface MaskStrokeOp {
  kind: 'stroke';
  erase: boolean;
  points: readonly MaskPoint[];
  radius: number;
}

export interface MaskRectOp {
  kind: 'rect';
  erase: boolean;
  from: MaskPoint;
  to: MaskPoint;
}

export type MaskOp = MaskStrokeOp | MaskRectOp;

export interface MaskCoordinateSpace {
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface MaskEditState {
  ops: readonly MaskOp[];
  redoStack: readonly MaskOp[];
}

export type MaskPixelValue = 0 | 255;

export const MASK_PIXEL_ERASED = 255 as const satisfies MaskPixelValue;
export const MASK_PIXEL_KEPT = 0 as const satisfies MaskPixelValue;

export interface MaskRasterSink {
  fillRect(x: number, y: number, width: number, height: number, value: MaskPixelValue): void;
  strokePath(points: readonly MaskPoint[], radius: number, value: MaskPixelValue): void;
}

export const EMPTY_MASK_EDIT: MaskEditState = { ops: [], redoStack: [] };


function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(0, value));
}

export function displayPointToNatural(point: MaskPoint, space: MaskCoordinateSpace): MaskPoint {
  const scaleX = space.naturalWidth / space.displayWidth;
  const scaleY = space.naturalHeight / space.displayHeight;
  return {
    x: clamp(Math.round(point.x * scaleX), space.naturalWidth),
    y: clamp(Math.round(point.y * scaleY), space.naturalHeight),
  };
}

export function displayRadiusToNatural(radius: number, space: MaskCoordinateSpace): number {
  return Math.round(radius * (space.naturalWidth / space.displayWidth));
}

export interface MaskNaturalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function displayRectToNatural(op: MaskRectOp, space: MaskCoordinateSpace): MaskNaturalRect {
  const x1 = clamp(Math.round(Math.min(op.from.x, op.to.x) * (space.naturalWidth / space.displayWidth)), space.naturalWidth);
  const y1 = clamp(Math.round(Math.min(op.from.y, op.to.y) * (space.naturalHeight / space.displayHeight)), space.naturalHeight);
  const x2 = clamp(Math.round(Math.max(op.from.x, op.to.x) * (space.naturalWidth / space.displayWidth)), space.naturalWidth);
  const y2 = clamp(Math.round(Math.max(op.from.y, op.to.y) * (space.naturalHeight / space.displayHeight)), space.naturalHeight);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}


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


export function applyMaskOp(state: MaskEditState, op: MaskOp): MaskEditState {
  return { ops: [...state.ops, op], redoStack: [] };
}

export function undoMaskEdit(state: MaskEditState): MaskEditState {
  if (state.ops.length === 0) return state;
  return {
    ops: state.ops.slice(0, -1),
    redoStack: [...state.redoStack, state.ops[state.ops.length - 1]],
  };
}

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

import {
  IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS,
  IMAGE_OUTPAINT_INPUT_KEYS,
  IMAGE_OUTPAINT_SOURCE,
  IMAGE_OUTPAINT_SOURCE_LIMITS,
  imageOutpaintInputSchema,
  imageOutpaintSourceGate,
  type ImageOutpaintInput,
} from '@lib/contracts/image-outpaint';
import { type OutpaintPresetKey, OUTPAINT_PRESET_LABELS } from '@/custom/enums';

export const IMAGE_OUTPAINT_MAX_EXPAND_RATIO = IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS.max;
export const IMAGE_OUTPAINT_LONG_SIDE_LIMIT = IMAGE_OUTPAINT_SOURCE_LIMITS.maxLongSide;
export const IMAGE_OUTPAINT_FILE_SIZE_LIMIT = IMAGE_OUTPAINT_SOURCE_LIMITS.maxFileSizeBytes;

export const IMAGE_OUTPAINT_EDGE_ORIGIN = IMAGE_OUTPAINT_SOURCE;

export interface ExpandSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_EXPANDS: ExpandSides = { top: 0, right: 0, bottom: 0, left: 0 };

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}


export function outpaintGateReason(
  width: number | undefined,
  height: number | undefined,
  size: number | undefined,
): string | null {
  return imageOutpaintSourceGate(width, height, size);
}


export function maxExpandPerSide(rect: Pick<SourceRect, 'width' | 'height'>): number {
  return Math.min(rect.width, rect.height) * IMAGE_OUTPAINT_MAX_EXPAND_RATIO;
}

export function clampExpands(expands: ExpandSides, maxPerSide: number): ExpandSides {
  const clamp = (v: number) => Math.min(Math.max(v, 0), maxPerSide);
  return {
    top: clamp(expands.top),
    right: clamp(expands.right),
    bottom: clamp(expands.bottom),
    left: clamp(expands.left),
  };
}

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

export function dragExpandCorner(
  corner: 'nw' | 'ne' | 'sw' | 'se',
  rect: SourceRect,
  pointer: { x: number; y: number },
  start: ExpandSides,
  maxPerSide: number,
  shiftLock: boolean,
): ExpandSides {
  const anchorX = corner === 'nw' || corner === 'sw'
    ? rect.x + rect.width + start.right
    : rect.x - start.left;
  const anchorY = corner === 'nw' || corner === 'ne'
    ? rect.y + rect.height + start.bottom
    : rect.y - start.top;
  const wantW = corner === 'nw' || corner === 'sw' ? anchorX - pointer.x : pointer.x - anchorX;
  const wantH = corner === 'nw' || corner === 'ne' ? anchorY - pointer.y : pointer.y - anchorY;
  const horizontal: keyof ExpandSides = corner === 'nw' || corner === 'sw' ? 'left' : 'right';
  const vertical: keyof ExpandSides = corner === 'nw' || corner === 'ne' ? 'top' : 'bottom';
  const rawW = Math.max(wantW, 0);
  const rawH = Math.max(wantH, 0);
  if (!shiftLock) {
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
  const ratio0 = (rect.width + start.left + start.right) / (rect.height + start.top + start.bottom);
  const boxW = Math.min(rawW, rawH * ratio0);
  const boxH = boxW / ratio0;
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

export const OUTPAINT_PRESET_MATCH_TOLERANCE = 0.005;

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


export interface ImageOutpaintIdentity {
  sourceAssetId?: string;
  lastParams?: ImageOutpaintInput;
}

export function buildImageOutpaintInput(
  sourceAssetId: string,
  targetNodeId: string,
  ratios: { top: number; right: number; bottom: number; left: number },
): ImageOutpaintInput | null {
  const input = {
    [IMAGE_OUTPAINT_INPUT_KEYS.sourceAssetId]: sourceAssetId,
    [IMAGE_OUTPAINT_INPUT_KEYS.targetNodeId]: targetNodeId,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandTop]: ratios.top,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandBottom]: ratios.bottom,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandLeft]: ratios.left,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandRight]: ratios.right,
  };
  return imageOutpaintInputSchema.safeParse(input).success ? (input as ImageOutpaintInput) : null;
}

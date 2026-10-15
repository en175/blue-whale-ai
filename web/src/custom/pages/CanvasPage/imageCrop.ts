
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropEdge = 'top' | 'right' | 'bottom' | 'left';
export type CropCorner = 'nw' | 'ne' | 'sw' | 'se';


export type CropPresetKey = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export const CROP_PRESET_LABELS: Record<CropPresetKey, string> = {
  free: '自由',
  '1:1': '1:1',
  '4:3': '4:3',
  '3:4': '3:4',
  '16:9': '16:9',
  '9:16': '9:16',
};

export const CROP_PRESET_ORDER: CropPresetKey[] = ['free', '1:1', '4:3', '3:4', '16:9', '9:16'];

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


export function fullCropRect(bounds: CropRect): CropRect {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

export function clampCropRect(rect: CropRect, bounds: CropRect, minSide: number): CropRect {
  const width = Math.min(Math.max(rect.width, minSide), bounds.width);
  const height = Math.min(Math.max(rect.height, minSide), bounds.height);
  const x = Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.width - width);
  const y = Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.height - height);
  return { x, y, width, height };
}

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

export function dragCropCorner(
  corner: CropCorner,
  start: CropRect,
  bounds: CropRect,
  pointer: { x: number; y: number },
  minSide: number,
  lockedRatio: number | null,
): CropRect {
  const anchorX = corner === 'nw' || corner === 'sw' ? start.x + start.width : start.x;
  const anchorY = corner === 'nw' || corner === 'ne' ? start.y + start.height : start.y;
  let next: CropRect;
  if (lockedRatio == null) {
    next = {
      x: Math.min(anchorX, pointer.x),
      y: Math.min(anchorY, pointer.y),
      width: Math.abs(pointer.x - anchorX),
      height: Math.abs(pointer.y - anchorY),
    };
  } else {
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

export function moveCropRect(rect: CropRect, dx: number, dy: number, bounds: CropRect): CropRect {
  const x = Math.min(Math.max(rect.x + dx, bounds.x), bounds.x + bounds.width - rect.width);
  const y = Math.min(Math.max(rect.y + dy, bounds.y), bounds.y + bounds.height - rect.height);
  return { x, y, width: rect.width, height: rect.height };
}

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


export const IMAGE_CROP_MIN_NATURAL_SIDE = 64;

export interface CropCoordinateSpace {
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

export function minCropSideDisplay(space: CropCoordinateSpace): number {
  return IMAGE_CROP_MIN_NATURAL_SIDE * (space.displayWidth / space.naturalWidth);
}

export interface CropNaturalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(0, value));
}

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


export const IMAGE_CROP_JPEG_QUALITY = 0.92;

export interface CropFormatSource {
  mime?: string;
  src?: string;
  fileName?: string;
}

export interface CropOutputFormat {
  mime: 'image/jpeg' | 'image/png';
  quality: number;
  ext: 'jpg' | 'png';
}

function extOf(value: string | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const clean = value.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1).toLowerCase();
}

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


export const IMAGE_CROP_EDGE_ORIGIN = 'image-crop';

export interface ImageCropIdentity {
  sourceAssetId?: string;
}

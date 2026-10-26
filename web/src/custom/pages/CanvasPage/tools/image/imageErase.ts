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


export const IMAGE_ERASE_MAX_LONG_SIDE = IMAGE_ERASE_MAX_LONG_SIDE_PX;
export const IMAGE_ERASE_MAX_SHORT_SIDE = IMAGE_ERASE_MAX_SHORT_SIDE_PX;
export const IMAGE_ERASE_MIN_SIDE = IMAGE_ERASE_MIN_SIDE_PX;

export const IMAGE_ERASE_MAX_SIZE_BYTES = IMAGE_ERASE_MAX_FILE_BYTES;

const IMAGE_ERASE_SUPPORTED_FORMATS = IMAGE_ERASE_INPUT_FORMATS;

export interface ImageEraseGateSource {
  width?: number;
  height?: number;
  size?: number;
  mime?: string;
  fileName?: string;
  src?: string;
}

function extOf(value: string | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const clean = value.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1).toLowerCase();
}

export function imageEraseFormatOf(source: ImageEraseGateSource): string | null {
  if (typeof source.mime === 'string' && source.mime !== '') {
    const slash = source.mime.lastIndexOf('/');
    const subtype = (slash >= 0 ? source.mime.slice(slash + 1) : source.mime).toLowerCase();
    if (subtype !== '') return subtype;
  }
  return extOf(source.src) ?? extOf(source.fileName);
}

const SUPPORTED_FORMATS_LABEL = IMAGE_ERASE_SUPPORTED_FORMATS.map((f) => f.toUpperCase()).join(' / ');

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


export const IMAGE_ERASE_EDGE_ORIGIN = 'image-erase';

export interface ImageEraseIdentity {
  sourceAssetId?: string;
  lastInput?: ImageEraseInput;
}


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

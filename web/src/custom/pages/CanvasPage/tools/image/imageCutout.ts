
import {
  IMAGE_CUTOUT_CONTOUR_COLOR,
  IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT,
  IMAGE_CUTOUT_CONTOUR_SIZE_MIN,
  IMAGE_CUTOUT_INPUT_FORMATS,
  IMAGE_CUTOUT_MAX_FILE_BYTES,
  IMAGE_CUTOUT_OUTPUT_FORMAT,
  IMAGE_CUTOUT_SCENE_SIZE_LIMITS,
  IMAGE_CUTOUT_SCENES,
} from '@lib/contracts/image-cutout';
import type { ImageCutoutScene } from '@lib/contracts/image-cutout';


export {
  IMAGE_CUTOUT_CONTOUR_COLOR,
  IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT,
  IMAGE_CUTOUT_CONTOUR_SIZE_MIN,
  IMAGE_CUTOUT_INPUT_FORMATS,
  IMAGE_CUTOUT_MAX_FILE_BYTES,
  IMAGE_CUTOUT_OUTPUT_FORMAT,
  IMAGE_CUTOUT_SCENES,
};
export type { ImageCutoutScene };

export const IMAGE_CUTOUT_GENERAL_MAX_LONG_SIDE_PX = IMAGE_CUTOUT_SCENE_SIZE_LIMITS.general.maxLongSide;
export const IMAGE_CUTOUT_GENERAL_MAX_SHORT_SIDE_PX = IMAGE_CUTOUT_SCENE_SIZE_LIMITS.general.maxShortSide;
export const IMAGE_CUTOUT_GENERAL_MAX_PIXELS = IMAGE_CUTOUT_SCENE_SIZE_LIMITS.general.maxTotalPixels ?? Number.POSITIVE_INFINITY;

export const IMAGE_CUTOUT_SUBJECT_MAX_LONG_SIDE_PX = IMAGE_CUTOUT_SCENE_SIZE_LIMITS.human.maxLongSide;
export const IMAGE_CUTOUT_SUBJECT_MAX_SHORT_SIDE_PX = IMAGE_CUTOUT_SCENE_SIZE_LIMITS.human.maxShortSide;

export const IMAGE_CUTOUT_CONTOUR_SLIDER_MAX = 50;


export interface ImageCutoutGateSource {
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

export function imageCutoutFormatOf(source: ImageCutoutGateSource): string | null {
  if (typeof source.mime === 'string' && source.mime !== '') {
    const slash = source.mime.lastIndexOf('/');
    const subtype = (slash >= 0 ? source.mime.slice(slash + 1) : source.mime).toLowerCase();
    if (subtype !== '') return subtype;
  }
  return extOf(source.src) ?? extOf(source.fileName);
}

const SUPPORTED_FORMATS_LABEL = IMAGE_CUTOUT_INPUT_FORMATS.map((f) => f.toUpperCase()).join(' / ');

export function imageCutoutGateReason(source: ImageCutoutGateSource): string | null {
  const format = imageCutoutFormatOf(source);
  if (format !== null && !(IMAGE_CUTOUT_INPUT_FORMATS as readonly string[]).includes(format)) {
    return `${format} 格式不支持抠图（支持 ${SUPPORTED_FORMATS_LABEL}）`;
  }
  const { width, height, size } = source;
  if (typeof width === 'number' && typeof height === 'number') {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (
      longSide > IMAGE_CUTOUT_GENERAL_MAX_LONG_SIDE_PX
      || shortSide > IMAGE_CUTOUT_GENERAL_MAX_SHORT_SIDE_PX
      || width * height > IMAGE_CUTOUT_GENERAL_MAX_PIXELS
    ) {
      return `图片长边超过 ${IMAGE_CUTOUT_GENERAL_MAX_LONG_SIDE_PX} 或短边超过 ${IMAGE_CUTOUT_GENERAL_MAX_SHORT_SIDE_PX} 或总像素超过 4000 万，无法抠图`;
    }
  }
  if (typeof size === 'number' && size > IMAGE_CUTOUT_MAX_FILE_BYTES) {
    return '图片超过 30MB，无法抠图';
  }
  return null;
}

export function imageCutoutSceneGateReason(
  source: ImageCutoutGateSource,
  scene: ImageCutoutScene,
): string | null {
  if (scene === 'general') return null;
  const { width, height } = source;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  if (
    longSide > IMAGE_CUTOUT_SUBJECT_MAX_LONG_SIDE_PX
    || shortSide > IMAGE_CUTOUT_SUBJECT_MAX_SHORT_SIDE_PX
  ) {
    return `图片长边超过 ${IMAGE_CUTOUT_SUBJECT_MAX_LONG_SIDE_PX} 或短边超过 ${IMAGE_CUTOUT_SUBJECT_MAX_SHORT_SIDE_PX}，无法以当前场景抠图`;
  }
  return null;
}


export interface BuildImageCutoutRequestInput {
  sourceAssetId: string;
  targetNodeId: string;
  scene: ImageCutoutScene;
  needContour?: boolean;
  contourSize?: number;
  needCropBackground?: boolean;
}

export interface ImageCutoutGeneralRequest {
  source_asset_id: string;
  target_node_id: string;
  cutout_scene: 'general';
}

export interface ImageCutoutSubjectRequest {
  source_asset_id: string;
  target_node_id: string;
  cutout_scene: 'human' | 'product';
  need_contour: boolean;
  contour_color: typeof IMAGE_CUTOUT_CONTOUR_COLOR;
  contour_size: number;
  need_crop_background: boolean;
}

export type ImageCutoutRequest = ImageCutoutGeneralRequest | ImageCutoutSubjectRequest;

export function buildImageCutoutRequest(
  input: BuildImageCutoutRequestInput & { scene: 'human' | 'product' },
): ImageCutoutSubjectRequest;
export function buildImageCutoutRequest(
  input: BuildImageCutoutRequestInput & { scene: 'general' },
): ImageCutoutGeneralRequest;
export function buildImageCutoutRequest(input: BuildImageCutoutRequestInput): ImageCutoutRequest;
export function buildImageCutoutRequest(input: BuildImageCutoutRequestInput): ImageCutoutRequest {
  const { sourceAssetId, targetNodeId, scene } = input;
  if (scene === 'general') {
    return {
      source_asset_id: sourceAssetId,
      target_node_id: targetNodeId,
      cutout_scene: scene,
    };
  }
  const raw = typeof input.contourSize === 'number' && Number.isFinite(input.contourSize)
    ? input.contourSize
    : IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT;
  const contourSize = Math.min(IMAGE_CUTOUT_CONTOUR_SLIDER_MAX, Math.max(IMAGE_CUTOUT_CONTOUR_SIZE_MIN, raw));
  return {
    source_asset_id: sourceAssetId,
    target_node_id: targetNodeId,
    cutout_scene: scene,
    need_contour: input.needContour === true,
    contour_color: IMAGE_CUTOUT_CONTOUR_COLOR,
    contour_size: contourSize,
    need_crop_background: input.needCropBackground === true,
  };
}

export interface ImageCutoutIdentity {
  sourceAssetId?: string;
  lastInput?: ImageCutoutRequest;
}

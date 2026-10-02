import type { Node } from '@xyflow/react';
import { isApiError } from '@/api/http';
import { resolveMediaSrc } from '@/utils/remoteImageCors';
import type { UploadCompleteData } from '@/api/assets';
import { mediaContentBox, MEDIA_CONTENT_TOP_OFFSET } from './components/MediaNode/mediaContentSize';
import { fullCropRect, cropPresetRatio, inscribeCropRect, clampCropRect, minCropSideDisplay, cropOutputFormat, cropRectToNatural, type CropNaturalRect, type CropOutputFormat, type CropCoordinateSpace, type CropRect, type CropPresetKey } from './imageCrop';
import type { ToolSessionDefinition } from './toolSessionRuntime';

export interface CropState { nodeId: string; preset: CropPresetKey; rect: CropRect }
export interface CropSubmission {
  projectId: string | undefined;
  source: Node;
  src: string;
  natural: CropNaturalRect;
  format: CropOutputFormat;
}
class CropEncodingError extends Error {}

export interface CropHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  uploadFile(file: File, projectId: string | undefined): Promise<UploadCompleteData>;
  handoff(input: CropSubmission, uploaded: UploadCompleteData): void;
  warn(message: string): void;
  error(message: string): void;
}
export function cropBoundsOf(node: Node): CropRect {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const box = mediaContentBox({
    mediaType: 'image',
    width: typeof d.width === 'number' ? d.width : undefined,
    height: typeof d.height === 'number' ? d.height : undefined,
  });
  return {
    x: node.position.x,
    y: node.position.y + MEDIA_CONTENT_TOP_OFFSET,
    width: box.width,
    height: box.height,
  };
}

export function cropSpaceOf(node: Node, bounds: CropRect): CropCoordinateSpace | null {
  const d = node.data;
  if (typeof d.width !== 'number' || typeof d.height !== 'number') return null;
  return { displayWidth: bounds.width, displayHeight: bounds.height, naturalWidth: d.width, naturalHeight: d.height };
}

export function applyCropPreset(state: CropState, node: Node, preset: CropPresetKey): CropState {
  const ratio = cropPresetRatio(preset);
  const bounds = cropBoundsOf(node);
  const space = cropSpaceOf(node, bounds);
  const rect = ratio === null ? state.rect : inscribeCropRect(bounds, ratio);
  return { ...state, preset, rect: clampCropRect(rect, bounds, space ? minCropSideDisplay(space) : 0) };
}

function cropImageToFile(
  src: string,
  natural: CropNaturalRect,
  format: CropOutputFormat,
): Promise<File | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = natural.width;
    canvas.height = natural.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        ctx.drawImage(img, natural.x, natural.y, natural.width, natural.height, 0, 0, natural.width, natural.height);
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], `crop.${format.ext}`, { type: blob.type || format.mime }) : null),
          format.mime,
          format.quality,
        );
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = resolveMediaSrc(src);
  });
}

export function createCropSession(getHost: () => CropHost): ToolSessionDefinition<CropState, string, CropSubmission> {
  return {
    kind: 'crop',
    initialize(nodeId) {
      const node = getHost().getSourceNode(nodeId);
      return node?.type === 'mediaNode' ? { nodeId, preset: 'free', rect: fullCropRect(cropBoundsOf(node)) } : null;
    },
    target: (state) => state.nodeId,
    reconcile(state) {
      const node = getHost().getSourceNode(state.nodeId);
      if (!node) return state;
      const bounds = cropBoundsOf(node);
      const space = cropSpaceOf(node, bounds);
      const rect = clampCropRect(state.rect, bounds, space ? minCropSideDisplay(space) : 0);
      return rect.x === state.rect.x && rect.y === state.rect.y && rect.width === state.rect.width && rect.height === state.rect.height
        ? state : { ...state, rect };
    },
    capture(state) {
      const host = getHost();
      const node = host.getSourceNode(state.nodeId);
      const bounds = node ? cropBoundsOf(node) : null;
      const space = node && bounds ? cropSpaceOf(node, bounds) : null;
      if (!node || !bounds || !space) { host.warn('源图分辨率未知，无法裁切'); return null; }
      const src = typeof node.data.src === 'string' ? node.data.src : '';
      if (!src || src.startsWith('blob:')) { host.warn('源图不可用，无法裁切'); return null; }
      return {
        projectId: host.getProjectId() ?? undefined,
        source: { ...node, position: { ...node.position }, data: { ...node.data } },
        src, natural: cropRectToNatural(state.rect, bounds, space),
        format: cropOutputFormat({ mime: typeof node.data.mime === 'string' ? node.data.mime : undefined, src, fileName: typeof node.data.fileName === 'string' ? node.data.fileName : undefined }),
      };
    },
    async submit(input, context) {
      const host = getHost();
      const file = await cropImageToFile(input.src, input.natural, input.format);
      if (!file) throw new CropEncodingError('裁切生成失败，请重试');
      const uploaded = await host.uploadFile(file, input.projectId);
      context.close();
      host.handoff(input, uploaded);
    },
    onError(error) {
      getHost().error(isApiError(error) || error instanceof CropEncodingError ? error.message : '裁切上传失败，请重试');
    },
  };
}

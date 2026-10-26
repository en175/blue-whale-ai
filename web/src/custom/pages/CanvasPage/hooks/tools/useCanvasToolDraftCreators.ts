import type { RefObject } from 'react';
import type { Node, Viewport } from '@xyflow/react';
import type { VideoEnhanceResolution } from '@lib/contracts/video-enhance';
import { IMAGE_ENHANCE_EDGE_ORIGIN, imageEnhanceDraftPosition } from '../../tools/image/imageEnhance';
import {
  VIDEO_ENHANCE_EDGE_ORIGIN,
  videoEnhanceDraftPosition,
  videoEnhanceGateReason,
  type VideoEnhanceIdentity,
} from '../../tools/video/videoEnhance';
import {
  FRAME_INTERPOLATION_DEFAULT_FPS,
  FRAME_INTERPOLATION_EDGE_ORIGIN,
  frameInterpolationDisplayName,
  frameInterpolationDraftPosition,
  frameInterpolationGateReason,
  type FrameInterpolationFps,
  type FrameInterpolationIdentity,
} from '../../tools/video/frameInterpolation';
import { readAssetId, imageRefSourceError } from '../../media/mediaRefs';
import { hasCustomName } from '../../graph/canvasNodeUtils';
import { nodeBoxOf } from '../../graph/canvasPureNodeHelpers';
import type { CanvasToolView } from '../../tool-runtime/canvasToolSessions';

export interface CanvasToolDraftCreatorsHost {
  toolViewRef: RefObject<CanvasToolView | null>;
  mediaNodes: Node[];
  liveViewport: Viewport;
  wrapperSize: { width: number; height: number };
  currentId: string;
  submittingNodeId: string | null;
  anchoredOverlayHiddenIds: Set<string> | null;
  mediaNodesRef: RefObject<Node[]>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  createImageDraftCard: (
    position?: { x: number; y: number },
    overrides?: { fileName?: string; data?: Record<string, unknown>; nodeId?: string; skipSelect?: boolean; recordHistory?: boolean },
  ) => string;
  createVideoDraftCard: (
    seed?: { modelId?: string; ratio?: string; size?: string; duration?: number; mode?: string; generateAudio?: boolean },
    position?: { x: number; y: number },
    overrides?: { fileName?: string; data?: Record<string, unknown>; recordHistory?: boolean },
  ) => string;
  addCanvasEdge: (source: string, target: string, refRole?: undefined, marker?: Record<string, unknown>) => void;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
}

export interface CanvasToolDraftCreatorsHandles {
  handleNodeEnhanceImage: (id: string) => string | undefined;
  handleNodeVideoEnhance: (id: string) => string | undefined;
  handleVideoEnhanceParamsChange: (nodeId: string, resolution: VideoEnhanceResolution) => void;
  handleNodeFrameInterpolation: (id: string) => string | undefined;
  handleFrameInterpolationParamsChange: (nodeId: string, fps: FrameInterpolationFps) => void;
}

export function useCanvasToolDraftCreators(host: CanvasToolDraftCreatorsHost): CanvasToolDraftCreatorsHandles {
  const {
    toolViewRef,
    mediaNodes,
    liveViewport,
    wrapperSize,
    currentId,
    submittingNodeId,
    anchoredOverlayHiddenIds,
    mediaNodesRef,
    showToast,
    createImageDraftCard,
    createVideoDraftCard,
    addCanvasEdge,
    patchMediaNode,
  } = host;

  const handleNodeEnhanceImage = (id: string): string | undefined => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const err = imageRefSourceError(node);
    if (err) {
      showToast('warn', err);
      return;
    }
    const sourceData = (node.data ?? {}) as Record<string, unknown>;
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(node), {
      fileName: '高清',
      data: { imageEnhance: { sourceAssetId: readAssetId(sourceData) } },
    });
    addCanvasEdge(id, draftId, undefined, { origin: IMAGE_ENHANCE_EDGE_ORIGIN });
    return draftId;
  };
  const handleNodeVideoEnhance = (id: string): string | undefined => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const gate = videoEnhanceGateReason((node.data ?? {}) as Record<string, unknown>);
    if (gate) {
      showToast('warn', gate);
      return;
    }
    const sourceData = (node.data ?? {}) as Record<string, unknown>;
    const draftId = createVideoDraftCard(undefined, videoEnhanceDraftPosition(node), {
      fileName: 'HD',
      data: { videoEnhance: { sourceAssetId: readAssetId(sourceData) } },
    });
    addCanvasEdge(id, draftId, undefined, { origin: VIDEO_ENHANCE_EDGE_ORIGIN });
    return draftId;
  };
  const handleVideoEnhanceParamsChange = (nodeId: string, resolution: VideoEnhanceResolution) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).videoEnhance as VideoEnhanceIdentity | undefined;
    patchMediaNode(nodeId, {
      videoEnhance: { ...identity, lastParams: { resolution } },
    });
  };
  const handleNodeFrameInterpolation = (id: string): string | undefined => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    const gate = frameInterpolationGateReason((node.data ?? {}) as Record<string, unknown>);
    if (gate) {
      showToast('warn', gate);
      return;
    }
    const sourceData = (node.data ?? {}) as Record<string, unknown>;
    const fps = FRAME_INTERPOLATION_DEFAULT_FPS;
    const draftId = createVideoDraftCard(undefined, frameInterpolationDraftPosition(node), {
      fileName: frameInterpolationDisplayName(fps),
      data: {
        frameInterpolation: {
          sourceAssetId: readAssetId(sourceData),
          lastParams: { fps },
        } satisfies FrameInterpolationIdentity,
      },
    });
    addCanvasEdge(id, draftId, undefined, { origin: FRAME_INTERPOLATION_EDGE_ORIGIN });
    return draftId;
  };
  const handleFrameInterpolationParamsChange = (nodeId: string, fps: FrameInterpolationFps) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).frameInterpolation as FrameInterpolationIdentity | undefined;
    patchMediaNode(nodeId, {
      frameInterpolation: { ...identity, lastParams: { fps } },
      ...(hasCustomName(node) ? {} : { fileName: frameInterpolationDisplayName(fps) }),
    });
  };

  toolViewRef.current = {
    nodes: mediaNodes, viewport: liveViewport, size: wrapperSize, nodeBox: nodeBoxOf,
    projectId: currentId, submittingNodeId,
    dragHiddenIds: anchoredOverlayHiddenIds,
    createEnhanceDraft: (id) => handleNodeEnhanceImage(id),
    createVideoEnhanceDraft: (id) => handleNodeVideoEnhance(id),
    createFrameInterpolationDraft: (id) => handleNodeFrameInterpolation(id),
    changeVideoParams: (id, resolution) => handleVideoEnhanceParamsChange(id, resolution),
    changeFrameParams: (id, fps) => handleFrameInterpolationParamsChange(id, fps),
  };

  return {
    handleNodeEnhanceImage,
    handleNodeVideoEnhance,
    handleVideoEnhanceParamsChange,
    handleNodeFrameInterpolation,
    handleFrameInterpolationParamsChange,
  };
}

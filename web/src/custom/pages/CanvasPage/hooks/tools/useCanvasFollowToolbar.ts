import type { Node, Viewport } from '@xyflow/react';
import { computeFollowAnchor, type FollowDialogAnchor } from '../../agent/followDialog';
import { nodeBoxOf } from '../../graph/canvasPureNodeHelpers';
import { mediaCardToolbarVisible } from '../../components/MediaNode/toolbarVisibility';
import type { createCanvasToolSessions } from '../../tool-runtime/canvasToolSessions';

export function useCanvasFollowToolbar(input: {
  showImageDialog: boolean;
  imageDraftId: string | null;
  showBottomDialog: boolean;
  videoDraftId: string | null;
  showAudioDialog: boolean;
  audioDraftId: string | null;
  showTextGenDialog: boolean;
  textGenDraftId: string | null;
  mediaNodes: Node[];
  textNodes: Node[];
  assetNodes: Node[];
  wrapperSize: { width: number; height: number };
  liveViewport: Viewport;
  soloSelectedNodeId: string | null;
  hoveredAssetNodeId: string | null;
  toolSessions: ReturnType<typeof createCanvasToolSessions>;
}): {
  followAnchor: FollowDialogAnchor | null;
  selectedMediaToolbarNode: Node | null;
  enhancePanelToolbarNode: Node | null;
  soloMediaToolbarNode: Node | null;
  showSoloMediaToolbar: boolean;
  hoverAssetToolbarNode: Node | null;
  assetToolbarNode: Node | null;
} {
  const followTargetId = input.showImageDialog && input.imageDraftId
    ? input.imageDraftId
    : input.showBottomDialog && input.videoDraftId
      ? input.videoDraftId
      : input.showAudioDialog && input.audioDraftId
        ? input.audioDraftId
        : input.showTextGenDialog && input.textGenDraftId
          ? input.textGenDraftId
          : null;
  const followNode = followTargetId
    ? input.mediaNodes.find((n) => n.id === followTargetId) ?? input.textNodes.find((n) => n.id === followTargetId) ?? null
    : null;
  const followAnchor = followNode && input.wrapperSize.width > 0
    ? computeFollowAnchor({
        nodeX: followNode.position.x,
        nodeY: followNode.position.y,
        nodeWidth: nodeBoxOf(followNode).width,
        nodeHeight: nodeBoxOf(followNode).height,
        viewport: input.liveViewport,
        containerWidth: input.wrapperSize.width,
        containerHeight: input.wrapperSize.height,
      })
    : null;
  const selectedMediaToolbarNode = input.soloSelectedNodeId
    ? input.mediaNodes.find((n) => n.id === input.soloSelectedNodeId) ?? null
    : null;
  const enhancePanelToolbarNode = input.toolSessions.toolbarNode();
  const soloMediaToolbarNode = enhancePanelToolbarNode ?? selectedMediaToolbarNode;
  const showSoloMediaToolbar = soloMediaToolbarNode != null
    && mediaCardToolbarVisible(soloMediaToolbarNode.data ?? {});
  const hoverAssetToolbarNode = input.hoveredAssetNodeId
    ? input.assetNodes.find((n) => n.id === input.hoveredAssetNodeId) ?? null
    : null;
  const soloAssetToolbarNode = input.soloSelectedNodeId
    ? input.assetNodes.find((n) => n.id === input.soloSelectedNodeId) ?? null
    : null;
  const assetToolbarNode = hoverAssetToolbarNode ?? soloAssetToolbarNode;
  return {
    followAnchor,
    selectedMediaToolbarNode,
    enhancePanelToolbarNode,
    soloMediaToolbarNode,
    showSoloMediaToolbar,
    hoverAssetToolbarNode,
    assetToolbarNode,
  };
}

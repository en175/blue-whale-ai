import type { ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@xyflow/react';
import { computeFollowAnchorAbove } from '../../agent/followDialog';
import layerStyles from '../NodeFollowToolbar/index.module.css';

export interface FollowToolbarLayerProps {
  nodeId: string;
  show: boolean;
  toolbarLift?: number;
  layerRef?: Ref<HTMLDivElement>;
  onLayerPointerEnter?: () => void;
  onLayerPointerLeave?: () => void;
  children: ReactNode;
}

export default function FollowToolbarLayer({
  nodeId,
  show,
  toolbarLift,
  layerRef,
  onLayerPointerEnter,
  onLayerPointerLeave,
  children,
}: FollowToolbarLayerProps) {
  const flowDom = useStore((state) => state.domNode);
  const position = useStore((state) => state.nodeLookup.get(nodeId)?.internals?.positionAbsolute);
  const nodeWidth = useStore((state) => state.nodeLookup.get(nodeId)?.measured?.width);
  const transform = useStore((state) => state.transform);
  const containerWidth = useStore((state) => state.width);
  if (!show || !flowDom || !position || nodeWidth == null || containerWidth <= 0) return null;

  const anchor = computeFollowAnchorAbove({
    nodeX: position.x,
    nodeY: position.y,
    nodeWidth,
    viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
    containerWidth,
    toolbarLift,
  });
  const flowRect = flowDom.getBoundingClientRect();

  return createPortal(
    <div
      ref={layerRef}
      className={layerStyles.toolbarLayer}
      data-canvas-chrome
      data-gen-panel-territory
      style={{
        position: 'fixed',
        left: anchor.left + flowRect.left,
        top: anchor.top + flowRect.top,
        zIndex: 1,
      }}
      onPointerEnter={onLayerPointerEnter}
      onPointerLeave={onLayerPointerLeave}
      onMouseEnter={onLayerPointerEnter}
      onMouseLeave={onLayerPointerLeave}
    >
      {children}
    </div>,
    document.body,
  );
}

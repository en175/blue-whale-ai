import { useRef, type ReactNode } from 'react';
import { useStore } from '@xyflow/react';
import { computeFollowAnchorAbove } from '../../followDialog';
import { useSoloNodeSelected } from '../../useSoloNodeSelected';
import { shouldSuppressCanvasSelection } from '../Canvas/chromeHitGuard';
import { useOverlayWheelPassthrough } from '../Canvas/canvasWheelPassthrough';
import styles from './index.module.css';

export interface NodeFollowToolbarProps {
  nodeId: string;
  show?: boolean;
  hovered?: boolean;
  toolbarHalfWidth?: number;
  toolbarLift?: number;
  children: ReactNode;
}

export default function NodeFollowToolbar({
  nodeId,
  show = true,
  hovered = false,
  toolbarHalfWidth,
  toolbarLift,
  children,
}: NodeFollowToolbarProps) {
  const node = useStore((state) => state.nodeLookup.get(nodeId));
  const nodeSelected = useStore((state) => state.nodeLookup.get(nodeId)?.selected);
  const transform = useStore((state) => state.transform);
  const containerWidth = useStore((state) => state.width);
  const soloSelected = useSoloNodeSelected(nodeSelected);
  const layerRef = useRef<HTMLDivElement | null>(null);
  useOverlayWheelPassthrough(layerRef);

  const position = node?.internals?.positionAbsolute;
  const nodeWidth = node?.measured?.width;
  if (!show) return null;
  if (shouldSuppressCanvasSelection()) return null;
  if (!soloSelected && !hovered) return null;
  if (!position || nodeWidth == null || containerWidth <= 0) return null;

  const anchor = computeFollowAnchorAbove({
    nodeX: position.x,
    nodeY: position.y,
    nodeWidth,
    viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
    containerWidth,
    toolbarHalfWidth,
    toolbarLift,
  });

  return (
    <div
      ref={layerRef}
      className={styles.toolbarLayer}
      data-canvas-chrome
      data-gen-panel-territory
      style={{ left: anchor.left, top: anchor.top }}
    >
      {children}
    </div>
  );
}

import type { NodeChange } from '@xyflow/react';
import {
  collectSnapTargets,
  computeSnapAlignment,
  resolveNodeSize,
  type SnapGuide,
  type SnapNodeLike,
  type SnapRect,
} from './snapAlignment';

export interface SnapDragChangesOptions {
  enabled?: boolean;
  altDisabled?: boolean;
  zoom?: number;
}

export interface SnapDragChangesResult {
  changes: NodeChange[];
  guides: SnapGuide[];
}

export const EMPTY_SNAP_GUIDES: SnapGuide[] = [];

type PositionedNodeChange = Extract<NodeChange, { type: 'position' }> & {
  position: { x: number; y: number };
};

export function isPositionChangeWithPosition(change: NodeChange): change is PositionedNodeChange {
  return change.type === 'position' && change.position != null;
}

export function snapDragChanges(
  changes: NodeChange[],
  nodes: SnapNodeLike[],
  groupFrames: SnapNodeLike[],
  primaryDragId: string | null,
  draggingIds: Iterable<string>,
  options: SnapDragChangesOptions = {},
): SnapDragChangesResult {
  if (options.enabled === false || options.altDisabled === true || primaryDragId == null) {
    return { changes, guides: EMPTY_SNAP_GUIDES };
  }
  const positionChanges = changes.filter(isPositionChangeWithPosition);
  if (positionChanges.length === 0) {
    return { changes, guides: EMPTY_SNAP_GUIDES };
  }

  const primaryChange = positionChanges.find((c) => c.id === primaryDragId);
  if (!primaryChange) {
    return { changes, guides: EMPTY_SNAP_GUIDES };
  }
  const primaryNode = nodes.find((n) => n.id === primaryDragId);
  const primarySize = resolveNodeSize(primaryNode);
  if (primarySize == null) {
    return { changes, guides: EMPTY_SNAP_GUIDES };
  }
  const draggingRect: SnapRect = {
    x: primaryChange.position.x,
    y: primaryChange.position.y,
    width: primarySize.width,
    height: primarySize.height,
  };

  const dragging = new Set(draggingIds);
  for (const change of positionChanges) dragging.add(change.id);

  const targets = collectSnapTargets([...nodes, ...groupFrames], dragging);
  const { dx, dy, guides } = computeSnapAlignment(draggingRect, targets, {
    zoom: options.zoom ?? 1,
  });
  if (dx === 0 && dy === 0) {
    return { changes, guides };
  }

  const next = changes.map((change) => {
    if (!isPositionChangeWithPosition(change) || !dragging.has(change.id)) return change;
    return {
      ...change,
      position: { x: change.position.x + dx, y: change.position.y + dy },
    };
  });
  return { changes: next, guides };
}

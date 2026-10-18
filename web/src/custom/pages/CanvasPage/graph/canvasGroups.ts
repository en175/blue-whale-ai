import type { Node } from '@xyflow/react';

export interface CanvasGroup {
  id: string;
  box: GroupBBox;
  excludedIds: string[];
}

export const MIN_GROUP_MEMBERS = 2;

const UNGROUPABLE_ASSET_KINDS = new Set(['style', 'character', 'object', 'environment']);

export function selectionHasUngroupableCards(nodes: Node[]): boolean {
  return nodes.some((n) => {
    if (n.type === 'productNode') return true;
    if (n.type !== 'assetNode') return false;
    const kind = (n.data as { kind?: string } | undefined)?.kind;
    return !!kind && UNGROUPABLE_ASSET_KINDS.has(kind);
  });
}

export function selectionHasUngroupableGenNodes(nodes: Node[]): boolean {
  return nodes.some((n) => {
    const data = n.data as { draft?: boolean; genStatus?: string } | undefined;
    if (!data) return false;
    if (data.draft === true) return true;
    return data.genStatus === 'draft' || data.genStatus === 'generating';
  });
}

export const GROUP_FRAME_PADDING = 48;

export const GROUP_LAYER_STRIDE = 100;

export function groupFrameZ(stackIndex: number): number {
  return (stackIndex + 1) * GROUP_LAYER_STRIDE;
}

export function groupMemberZ(stackIndex: number): number {
  return groupFrameZ(stackIndex) + 10;
}

export function contentNodeAtFlowPoint(nodes: Node[], point: { x: number; y: number }): Node | null {
  let hit: Node | null = null;
  for (const node of nodes) {
    if (node.type === 'groupFrame') continue;
    const width = node.measured?.width ?? (typeof node.width === 'number' ? node.width : null);
    const height = node.measured?.height ?? (typeof node.height === 'number' ? node.height : null);
    const fallback = node.type === 'textNode';
    const w = width ?? (fallback ? 360 : null);
    const h = height ?? (fallback ? 292 : null);
    if (w == null || h == null) continue;
    if (
      point.x >= node.position.x
      && point.x <= node.position.x + w
      && point.y >= node.position.y
      && point.y <= node.position.y + h
    ) {
      hit = node;
    }
  }
  return hit;
}

export function bringGroupToFront(groups: CanvasGroup[], groupId: string): CanvasGroup[] {
  const index = groups.findIndex((g) => g.id === groupId);
  if (index < 0 || index === groups.length - 1) return groups;
  const next = groups.slice();
  const [group] = next.splice(index, 1);
  next.push(group);
  return next;
}

export interface GroupBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PositionRecord {
  id: string;
  x: number;
  y: number;
}

export interface PeerExclusionSnapshot {
  groupId: string;
  excludedBefore: string[];
  excludedAfter: string[];
}

export interface GroupFrameDragResult {
  groupId: string;
  oldBox: GroupBBox;
  newBox: GroupBBox;
  nodeOld: PositionRecord[];
  nodeNew: PositionRecord[];
  excludedBefore: string[];
  excludedAfter: string[];
  peerExclusions?: PeerExclusionSnapshot[];
}

export function memberBBox(nodes: Node[]): GroupBBox | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((n) => {
    const w = n.measured?.width ?? 200;
    const h = n.measured?.height ?? 120;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function groupFrameBBox(nodes: Node[]): GroupBBox | null {
  const box = memberBBox(nodes);
  if (!box) return null;
  return {
    x: box.x - GROUP_FRAME_PADDING,
    y: box.y - GROUP_FRAME_PADDING,
    w: box.w + GROUP_FRAME_PADDING * 2,
    h: box.h + GROUP_FRAME_PADDING * 2,
  };
}

export function nodePressesGroupEdge(node: Node, box: GroupBBox): boolean {
  const w = node.measured?.width ?? 200;
  const h = node.measured?.height ?? 120;
  const left = node.position.x;
  const top = node.position.y;
  const right = left + w;
  const bottom = top + h;
  const intersects =
    left <= box.x + box.w && right >= box.x && top <= box.y + box.h && bottom >= box.y;
  if (!intersects) return false;
  return left < box.x || top < box.y || right > box.x + box.w || bottom > box.y + box.h;
}

export function nodeInsideGroupBox(node: Node, box: GroupBBox): boolean {
  const w = node.measured?.width ?? 200;
  const h = node.measured?.height ?? 120;
  const cx = node.position.x + w / 2;
  const cy = node.position.y + h / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

export function membersInGroupBox(
  nodes: Node[],
  box: GroupBBox,
  excludedIds: string[] = [],
): Node[] {
  const excluded = new Set(excludedIds);
  return nodes.filter((n) => n.type !== 'groupFrame' && !excluded.has(n.id) && nodeInsideGroupBox(n, box));
}

export function isGroupMember(node: Node, group: Pick<CanvasGroup, 'box' | 'excludedIds'>): boolean {
  return !group.excludedIds.includes(node.id) && nodeInsideGroupBox(node, group.box);
}

export function isForeignGroupMember(node: Node, selfId: string, groups: CanvasGroup[]): boolean {
  return groups.some((h) => h.id !== selfId && isGroupMember(node, h));
}

export function exclusiveMembersInGroup(
  nodes: Node[],
  group: CanvasGroup,
  allGroups: CanvasGroup[],
): Node[] {
  return membersInGroupBox(nodes, group.box, group.excludedIds).filter(
    (n) => !isForeignGroupMember(n, group.id, allGroups),
  );
}

export function applyIndependentGroupDrag(
  groups: CanvasGroup[],
  nodesAfter: Node[],
  res: Pick<GroupFrameDragResult, 'groupId' | 'newBox' | 'excludedAfter' | 'nodeNew'>,
): { groups: CanvasGroup[]; peerExclusions: PeerExclusionSnapshot[] } {
  const draggedIds = new Set(res.nodeNew.map((p) => p.id));
  const byId = new Map(nodesAfter.map((n) => [n.id, n]));
  const peerExclusions: PeerExclusionSnapshot[] = [];
  const next = groups.map((g) => {
    if (g.id === res.groupId) {
      return { ...g, box: { ...res.newBox }, excludedIds: [...res.excludedAfter] };
    }
    const excluded = new Set(g.excludedIds);
    draggedIds.forEach((id) => {
      const n = byId.get(id);
      if (!n) return;
      if (nodeInsideGroupBox(n, g.box)) excluded.add(id);
      else excluded.delete(id);
    });
    const after = [...excluded];
    const changed =
      after.length !== g.excludedIds.length || after.some((id, i) => id !== g.excludedIds[i]);
    if (changed) {
      peerExclusions.push({
        groupId: g.id,
        excludedBefore: [...g.excludedIds],
        excludedAfter: after,
      });
    }
    return changed ? { ...g, excludedIds: after } : g;
  });
  return { groups: next, peerExclusions };
}

export function isolateNewGroupMembers(
  existing: CanvasGroup[],
  nodes: Node[],
  group: CanvasGroup,
  memberIds: Set<string>,
): CanvasGroup[] {
  const created: CanvasGroup = {
    ...group,
    excludedIds: nodes
      .filter((n) => !memberIds.has(n.id) && nodeInsideGroupBox(n, group.box))
      .map((n) => n.id),
  };
  const others = existing.flatMap((previous) => {
    const before = exclusiveMembersInGroup(nodes, previous, existing);
    if (!before.some((node) => memberIds.has(node.id))) return [previous];
    const remaining = before.filter((node) => !memberIds.has(node.id));
    if (remaining.length < MIN_GROUP_MEMBERS) return [];
    const box = groupFrameBBox(remaining)!;
    const remainingIds = new Set(remaining.map((node) => node.id));
    return [{
      ...previous,
      box,
      excludedIds: nodes
        .filter((node) => !remainingIds.has(node.id) && nodeInsideGroupBox(node, box))
        .map((node) => node.id),
    }];
  });
  return [...others, created];
}

export function groupToNode(group: CanvasGroup): Node {
  return {
    id: group.id,
    type: 'groupFrame',
    position: { x: group.box.x, y: group.box.y },
    data: { box: { ...group.box }, excludedIds: [...group.excludedIds] },
  };
}

export function parseGroupsFromNodes(docNodes: Node[]): {
  groups: CanvasGroup[];
  contentNodes: Node[];
} {
  const groups: CanvasGroup[] = [];
  const contentNodes: Node[] = [];
  docNodes.forEach((node) => {
    if (node.type === 'groupFrame') {
      const data = node.data as Record<string, unknown> | undefined;
      const b = data?.box as Partial<GroupBBox> | undefined;
      if (
        node.id &&
        b &&
        typeof b.x === 'number' &&
        typeof b.y === 'number' &&
        typeof b.w === 'number' &&
        typeof b.h === 'number'
      ) {
        const excludedRaw = data?.excludedIds;
        const excludedIds = Array.isArray(excludedRaw)
          ? excludedRaw.filter((v): v is string => typeof v === 'string')
          : [];
        groups.push({ id: node.id, box: { x: b.x, y: b.y, w: b.w, h: b.h }, excludedIds });
      }
    } else {
      contentNodes.push(node);
    }
  });
  return { groups, contentNodes };
}

export function applyDraggedNodesToGroups(
  groups: CanvasGroup[],
  before: Node[],
  draggedNodes: Node[],
  positions: Map<string, { x: number; y: number }>,
): CanvasGroup[] {
  if (groups.length === 0) return groups;
  const expandByGroup = new Map<string, { x: number; y: number; x2: number; y2: number }>();
  const ownerByNode = new Map<string, string>();
  const beforeById = new Map(before.map((n) => [n.id, n]));
  draggedNodes.forEach((n) => {
    const w = n.measured?.width ?? 200;
    const h = n.measured?.height ?? 120;
    const nx = n.position.x, ny = n.position.y;
    const startNode = beforeById.get(n.id) ?? n;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]!;
      const wasMember = isGroupMember(startNode, g);
      if (wasMember) {
        if (nodeInsideGroupBox(n, g.box)) {
          ownerByNode.set(n.id, g.id);
          break;
        }
        continue;
      }
      const intersects =
        nx <= g.box.x + g.box.w && nx + w >= g.box.x && ny <= g.box.y + g.box.h && ny + h >= g.box.y;
      if (!intersects) continue;
      if (nodePressesGroupEdge(n, g.box)) {
        const cur = expandByGroup.get(g.id);
        const x = Math.min(nx, cur?.x ?? g.box.x);
        const y = Math.min(ny, cur?.y ?? g.box.y);
        const x2 = Math.max(nx + w, cur?.x2 ?? g.box.x + g.box.w);
        const y2 = Math.max(ny + h, cur?.y2 ?? g.box.y + g.box.h);
        expandByGroup.set(g.id, { x, y, x2, y2 });
        ownerByNode.set(n.id, g.id);
        break;
      }
      if (nodeInsideGroupBox(n, g.box) && !g.excludedIds.includes(n.id)) {
        ownerByNode.set(n.id, g.id);
        break;
      }
    }
  });
  const pad = GROUP_FRAME_PADDING;
  const allAfter = before.map((n) => {
    const p = positions.get(n.id);
    return p ? { ...n, position: p } : n;
  });
  const boxes = new Map(
    groups.map((g) => {
      const e = expandByGroup.get(g.id);
      if (!e) return [g.id, g.box] as const;
      return [
        g.id,
        {
          x: e.x - pad,
          y: e.y - pad,
          w: e.x2 - e.x + pad * 2,
          h: e.y2 - e.y + pad * 2,
        },
      ] as const;
    }),
  );
  const nextMeta = groups.map((g) => ({ ...g, box: boxes.get(g.id) ?? g.box }));
  return nextMeta.map((g) => {
    const excluded = new Set(g.excludedIds);
    draggedNodes.forEach((n) => {
      const owner = ownerByNode.get(n.id);
      const inside = nodeInsideGroupBox(n, g.box);
      if (!inside) excluded.delete(n.id);
      else if (owner === g.id) excluded.delete(n.id);
      else excluded.add(n.id);
    });
    if (expandByGroup.has(g.id)) {
      allAfter.forEach((n) => {
        if (positions.has(n.id)) return;
        if (nodeInsideGroupBox(n, g.box) && isForeignGroupMember(n, g.id, nextMeta)) {
          excluded.add(n.id);
        }
      });
    }
    const boxChanged = expandByGroup.has(g.id);
    const excludedChanged =
      excluded.size !== g.excludedIds.length || [...excluded].some((id) => !g.excludedIds.includes(id));
    if (!boxChanged && !excludedChanged) return g;
    return { ...g, box: g.box, excludedIds: [...excluded] };
  });
}

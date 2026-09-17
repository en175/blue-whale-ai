/* ============================================
 * canvasGroups 画布成组（IKD0JT A3）：
 * 组 = 一个固定矩形 box（成组时刻由成员包围盒+留白定格，之后位置随拖动更新、
 * 尺寸不再因成员增减而变化）。成员不是冻结名单，而是「当前位于矩形内的节点」——
 * 节点被拖出框即自动脱离，拖进框即自动加入（动态成员，用户体验为"固定范围容器"）。
 * 组与组互相独立：拖组只移动本组专属成员，叠到另一组上不得带走对方成员。
 * 数组顺序即叠放层级（后创建 / 后拖动的在上）：上层组框与素材压住下层组框与素材。
 * 底框直接用 group.box 渲染，不随成员实时派生。
 * 持久化走「伪节点」：序列化为 type: 'groupFrame' 的节点混入 nodes JSON，
 * data.box 存矩形，水合时剥离还原（零后端契约变更）。
 * ============================================ */
import type { Node } from '@xyflow/react';

export interface CanvasGroup {
  id: string;
  /** 固定矩形（flow 坐标）。成组时刻由成员包围盒+留白定格；拖动整组时整体平移 */
  box: GroupBBox;
  /** 排除名单：组被拖动后覆盖到、但不算成员的节点（视觉上被组玻璃盖住）。
   *  方向性规则（用户语义）：拖节点进矩形 → 吸收为成员；拖组盖到节点上 → 节点排除。
   *  节点被再次拖动时若仍在矩形内则解除排除重新吸收。 */
  excludedIds: string[];
}

/** 组框成员最小数量（成组动作最少选中的节点数） */
export const MIN_GROUP_MEMBERS = 2;

/** 不可成组的资产卡类型：风格卡 / 角色卡 / 物体卡 / 环境卡 */
const UNGROUPABLE_ASSET_KINDS = new Set(['style', 'character', 'object', 'environment']);

/** 选区是否包含不可成组的卡片（风格卡、角色卡、物体卡、环境卡、商品卡） */
export function selectionHasUngroupableCards(nodes: Node[]): boolean {
  return nodes.some((n) => {
    if (n.type === 'productNode') return true;
    if (n.type !== 'assetNode') return false;
    const kind = (n.data as { kind?: string } | undefined)?.kind;
    return !!kind && UNGROUPABLE_ASSET_KINDS.has(kind);
  });
}

/** 选区是否包含待生成草稿或生成中节点（不可成组） */
export function selectionHasUngroupableGenNodes(nodes: Node[]): boolean {
  return nodes.some((n) => {
    const data = n.data as { draft?: boolean; genStatus?: string } | undefined;
    if (!data) return false;
    if (data.draft === true) return true;
    return data.genStatus === 'draft' || data.genStatus === 'generating';
  });
}

/** 组框外扩留白（成员包围盒 → 底框可视边距） */
export const GROUP_FRAME_PADDING = 48;

/** 每一组占用的 zIndex 间隔：组框在层底，成员在组框之上，互不与邻组交错 */
export const GROUP_LAYER_STRIDE = 100;

/** 组框节点 zIndex（stackIndex 0 起，越大越靠上） */
export function groupFrameZ(stackIndex: number): number {
  return (stackIndex + 1) * GROUP_LAYER_STRIDE;
}

/** 组成员节点 zIndex：高于本组组框，低于上一层组框 */
export function groupMemberZ(stackIndex: number): number {
  return groupFrameZ(stackIndex) + 10;
}

/** 画布坐标是否落在某张内容卡（非组框）内。多卡重叠取列表中更靠后的一张。
 *  未测量的非文本卡不猜测尺寸，避免小卡周围出现 360×292 幽灵命中区挡住拖组。 */
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

/** 把指定组移到数组末尾（视觉与命中最上层） */
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

/** 节点坐标记录（整组拖动撤销/结束回调的成员位移载体） */
export interface PositionRecord {
  id: string;
  x: number;
  y: number;
}

/** 其他组排除名单在整组拖动前后的快照（组与组互斥，撤销需一并回放） */
export interface PeerExclusionSnapshot {
  groupId: string;
  excludedBefore: string[];
  excludedAfter: string[];
}

/** 整组拖动结束上抛的数据：矩形前后 + 拖动瞬间框内成员节点的位移 + 排除名单前后 */
export interface GroupFrameDragResult {
  groupId: string;
  oldBox: GroupBBox;
  newBox: GroupBBox;
  nodeOld: PositionRecord[];
  nodeNew: PositionRecord[];
  /** 拖动开始时组的排除名单（撤销恢复用） */
  excludedBefore: string[];
  /** 拖动结束后组的排除名单：新矩形内的非本次拖动成员节点（被组盖住、不算成员） */
  excludedAfter: string[];
  /** 被本组压住/拖离的其他组排除名单变更 */
  peerExclusions?: PeerExclusionSnapshot[];
}

/** 成员节点包围盒（节点 measured 尺寸缺省按 200×120 估算） */
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

/** 组框初始矩形（成员包围盒 + 留白），仅成组瞬间用于定格 group.box */
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

/** 节点矩形是否压住组边线：与组框相交且未完全落在框内（仅此时才扩组） */
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

/** 节点是否落在组矩形内（以节点中心点判定，节点个体超宽/超高仍以中心为准） */
export function nodeInsideGroupBox(node: Node, box: GroupBBox): boolean {
  const w = node.measured?.width ?? 200;
  const h = node.measured?.height ?? 120;
  const cx = node.position.x + w / 2;
  const cy = node.position.y + h / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

/** 取一个组当前的全部成员节点（动态：按矩形判定，排除名单中的不算——组盖上去的节点不吸收） */
export function membersInGroupBox(
  nodes: Node[],
  box: GroupBBox,
  excludedIds: string[] = [],
): Node[] {
  const excluded = new Set(excludedIds);
  return nodes.filter((n) => n.type !== 'groupFrame' && !excluded.has(n.id) && nodeInsideGroupBox(n, box));
}

/** 节点是否算某组成员（落在矩形内且不在排除名单） */
export function isGroupMember(node: Node, group: Pick<CanvasGroup, 'box' | 'excludedIds'>): boolean {
  return !group.excludedIds.includes(node.id) && nodeInsideGroupBox(node, group.box);
}

/** 节点是否已是其他组的成员——组与组互相独立，这类节点不能被本组拖走或算作本组员 */
export function isForeignGroupMember(node: Node, selfId: string, groups: CanvasGroup[]): boolean {
  return groups.some((h) => h.id !== selfId && isGroupMember(node, h));
}

/** 本组独立成员：矩形内、未排除、且不属于任何其他组 */
export function exclusiveMembersInGroup(
  nodes: Node[],
  group: CanvasGroup,
  allGroups: CanvasGroup[],
): Node[] {
  return membersInGroupBox(nodes, group.box, group.excludedIds).filter(
    (n) => !isForeignGroupMember(n, group.id, allGroups),
  );
}

/** 整组拖动后同步其他组排除名单：本组带走的成员写入被压住的组，拖离则解除 */
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

/** 新建组时互斥：新组排除框内非选中节点；其他组排除本次成组成员 */
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
  const others = existing.map((h) => {
    const extra = nodes
      .filter((n) => memberIds.has(n.id) && nodeInsideGroupBox(n, h.box) && !h.excludedIds.includes(n.id))
      .map((n) => n.id);
    return extra.length === 0 ? h : { ...h, excludedIds: [...h.excludedIds, ...extra] };
  });
  return [...others, created];
}

/** 组伪节点序列化形状（随 nodes JSON 持久化；position 存矩形左上角便于离线诊断） */
export function groupToNode(group: CanvasGroup): Node {
  return {
    id: group.id,
    type: 'groupFrame',
    position: { x: group.box.x, y: group.box.y },
    data: { box: { ...group.box }, excludedIds: [...group.excludedIds] },
  };
}

/** 从水合节点列表剥离组数据：返回 [有效组, 剔除组伪节点后的内容节点]。
 *  仅接受携带合法 box 的 groupFrame；旧版「memberIds 名单」形状不再识别（本项目无存量）。 */
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
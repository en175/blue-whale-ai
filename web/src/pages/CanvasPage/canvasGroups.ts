/* ============================================
 * canvasGroups 画布成组（IKD0JT A3）：
 * 组 = 一个固定矩形 box（成组时刻由成员包围盒+留白定格，之后位置随拖动更新、
 * 尺寸不再因成员增减而变化）。成员不是冻结名单，而是「当前位于矩形内的节点」——
 * 节点被拖出框即自动脱离，拖进框即自动加入（动态成员，用户体验为"固定范围容器"）。
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

/** 组框外扩留白（成员包围盒 → 底框可视边距） */
export const GROUP_FRAME_PADDING = 24;

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
  return nodes.filter((n) => !excluded.has(n.id) && nodeInsideGroupBox(n, box));
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
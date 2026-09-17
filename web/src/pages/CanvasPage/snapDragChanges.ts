/* ============================================
 * snapDragChanges 把 T1 吸附计算接入拖拽 change 流（IKGGCT T2，纯函数）：
 * React Flow v12 受控拖拽中，每帧 onNodesChange 收到全部被拖节点的
 * position change，其 position 由「鼠标位置 - dragStart 快照偏移」计算、
 * 不读组件 state——因此吸附修正逐帧独立施加（本帧原始位置 + dx/dy），
 * 不会跨帧累积。多选拖拽时主拖卡（onNodeDragStart 的 node 参数）为对齐
 * 基准，同一批被拖节点施加同一修正量保持相对位置。
 * 组件侧（Canvas/index.tsx）只负责记录主拖卡/被拖集合/Alt 状态并接线，
 * 全部决策收敛在此，便于厚测试。零 React 运行时依赖。
 * ============================================ */
import type { NodeChange } from '@xyflow/react';
import {
  collectSnapTargets,
  computeSnapAlignment,
  type SnapGuide,
  type SnapNodeLike,
  type SnapRect,
} from './snapAlignment';

export interface SnapDragChangesOptions {
  /** 吸附总开关（含对齐线），默认 true（undefined 视为开，与 FlowCanvasProps 语义一致） */
  enabled?: boolean;
  /** Alt/Option 按住中：本帧跳过吸附与对齐线（松开即恢复，不落开关状态） */
  altDisabled?: boolean;
  /** 当前缩放（屏幕阈值换算用），默认 1 */
  zoom?: number;
}

export interface SnapDragChangesResult {
  /** 改写后的 changes（原引用透传时保持元素不变） */
  changes: NodeChange[];
  /** 本帧吸附命中的对齐线（未命中为空数组） */
  guides: SnapGuide[];
}

/** 稳定空数组：调用侧 setState 用同一引用避免无意义重渲染 */
export const EMPTY_SNAP_GUIDES: SnapGuide[] = [];

/** 本帧带坐标的 position change（dragging 收尾帧同样带 position，照常参与改写保证落点一致）。
 *  NodePositionChange.position 是可选字段，类型谓词同时收窄联合与收窄非空坐标。 */
type PositionedNodeChange = Extract<NodeChange, { type: 'position' }> & {
  position: { x: number; y: number };
};

function isPositionChangeWithPosition(change: NodeChange): change is PositionedNodeChange {
  return change.type === 'position' && change.position != null;
}

/** 对一批拖拽 position changes 施加吸附修正。
 *  nodes 为画布全部内容卡（内部 nodes 状态，含 measured 实时尺寸）；
 *  groupFrames 为组框伪节点（组尺寸在 groups[].box，由调用侧转成
 *  { position, width, height } 形状，snapAlignment.ts 不感知 groups 结构）；
 *  primaryDragId 为主拖卡 id（onNodeDragStart 的 node 参数，多选时唯一的对齐基准）；
 *  draggingIds 为本次拖拽开始时冻结的被拖集合（onNodeDragStart 的 draggedNodes），
 *  集合内的卡互不为参考块。
 *  短路（原样返回 + 空对齐线）的条件：开关关闭 / Alt 按住 / 无主拖卡 /
 *  本帧无带坐标的 position change / 主拖卡尺寸未知（measured 与 width/height 均缺）。 */
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

  // 主拖卡本帧的实时位置以 change 为准（React Flow 每帧从鼠标位移推算，早于 state 提交）；
  // 找不到主拖卡的 change（如仅剩 select/dimension 的帧）说明不是拖拽位移帧，不改写
  const primaryChange = positionChanges.find((c) => c.id === primaryDragId);
  if (!primaryChange) {
    return { changes, guides: EMPTY_SNAP_GUIDES };
  }
  const primaryNode = nodes.find((n) => n.id === primaryDragId);
  // 尺寸回退链与 collectSnapTargets 一致：measured → width/height → 无法对齐
  const width = primaryNode?.measured?.width ?? primaryNode?.width;
  const height = primaryNode?.measured?.height ?? primaryNode?.height;
  if (width == null || height == null) {
    return { changes, guides: EMPTY_SNAP_GUIDES };
  }
  const draggingRect: SnapRect = {
    x: primaryChange.position.x,
    y: primaryChange.position.y,
    width,
    height,
  };

  // 排除集合 = 拖拽开始冻结的被拖集合；并入本帧 position change 的 id 作防御
  // （正常子集关系，多拖一帧不漏），一起被拖的卡互不为参考块
  const dragging = new Set(draggingIds);
  for (const change of positionChanges) dragging.add(change.id);

  const targets = collectSnapTargets([...nodes, ...groupFrames], dragging);
  const { dx, dy, guides } = computeSnapAlignment(draggingRect, targets, {
    zoom: options.zoom ?? 1,
  });
  if (dx === 0 && dy === 0) {
    return { changes, guides };
  }

  // 同一批被拖节点的 position change 施加同一修正量：多选整组保持相对位置跟随主拖卡
  const next = changes.map((change) => {
    if (!isPositionChangeWithPosition(change) || !dragging.has(change.id)) return change;
    return {
      ...change,
      position: { x: change.position.x + dx, y: change.position.y + dy },
    };
  });
  return { changes: next, guides };
}

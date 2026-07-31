/**
 * 节点拷贝/粘贴/复制的剪贴板助手（IK5JV3 审查修复二轮）。
 *
 * 剪贴板格式：JSON 数组 [{ id, data, position, width, height }]。
 * 粘贴时解析该格式重建节点（新 id + 偏移 + 清瞬时 status）；非本格式（普通文本等）返回 []。
 * 纯函数，不碰 navigator.clipboard（读写由调用方负责，便于测试）。
 */
import type { CanvasNode } from "../model";

/** 粘贴/复制落点偏移（px），避免与原节点完全重叠。 */
export const CLONE_OFFSET = 20;

/** 序列化节点为剪贴板文本。 */
export function serializeNodesForClipboard(nodes: CanvasNode[]): string {
  return JSON.stringify(
    nodes.map((n) => ({
      id: n.id,
      data: n.data,
      position: n.position,
      width: n.width,
      height: n.height,
    })),
  );
}

/** 克隆节点：新 id + 偏移落点 + 清瞬时 status（复制/粘贴共用）。 */
export function cloneNodeWithOffset(node: CanvasNode): CanvasNode {
  return {
    ...node,
    id: crypto.randomUUID(),
    position: {
      x: node.position.x + CLONE_OFFSET,
      y: node.position.y + CLONE_OFFSET,
    },
    data: { ...node.data, status: undefined },
  };
}

/** 解析剪贴板文本为可落画布的新节点列表；非本格式或条目残缺返回 []（跳过残缺项）。 */
export function parseClipboardNodes(text: string): CanvasNode[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw) => {
    const n = raw as Partial<CanvasNode> | null;
    if (
      !n ||
      typeof n !== "object" ||
      !n.data ||
      typeof n.data !== "object" ||
      !n.position ||
      typeof n.position.x !== "number" ||
      typeof n.position.y !== "number"
    ) {
      return [];
    }
    return [cloneNodeWithOffset(n as CanvasNode)];
  });
}

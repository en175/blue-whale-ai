/* 方案卡应用到画布后：按素材身份把已有图片节点连到生成卡（media → text，textIndex）。 */
import type { Edge, Node } from '@xyflow/react';
import { readAssetId } from './mediaRefs';

export function appliedPlanAssetIds(node: Node | undefined, extraAssetIds: string[] = []): string[] {
  const data = (node?.data ?? {}) as Record<string, unknown>;
  const fromRefs = Array.isArray(data.mediaRefs)
    ? (data.mediaRefs as Array<{ assetId?: string }>).map((item) => String(item.assetId ?? ''))
    : [];
  const fromMaterials = Array.isArray(data.promptMaterials)
    ? (data.promptMaterials as Array<{ assetId?: string }>).map((item) => String(item.assetId ?? ''))
    : [];
  return [...new Set([...fromRefs, ...fromMaterials, ...extraAssetIds.map(String)].filter(Boolean))];
}

/** 丢掉应用接口误写的 text → media 方向 textIndex 边。 */
export function dropReversedTextIndexEdges(textNodeId: string, edges: Edge[]): Edge[] {
  return edges.filter((edge) => {
    if (edge.source !== textNodeId) return true;
    return (edge.data as { textIndex?: boolean } | undefined)?.textIndex !== true;
  });
}

/** 已有同 assetId 的媒体节点 → 生成卡；已存在同向边不重复建。 */
export function textIndexEdgesForAppliedPlan(
  textNodeId: string,
  assetIds: string[],
  nodes: Node[],
  edges: Edge[],
): Edge[] {
  const mediaIdByAsset = new Map<string, string>();
  for (const node of nodes) {
    if (node.type !== 'mediaNode') continue;
    const assetId = readAssetId((node.data ?? {}) as Record<string, unknown>);
    if (assetId && !mediaIdByAsset.has(assetId)) mediaIdByAsset.set(assetId, node.id);
  }
  const linked = new Set(
    edges.filter((edge) => edge.target === textNodeId).map((edge) => edge.source),
  );
  const added: Edge[] = [];
  for (const assetId of assetIds) {
    const mediaId = mediaIdByAsset.get(String(assetId));
    if (!mediaId || mediaId === textNodeId || linked.has(mediaId)) continue;
    linked.add(mediaId);
    added.push({
      id: `e-${mediaId}-${textNodeId}`,
      source: mediaId,
      target: textNodeId,
      data: { textIndex: true },
    });
  }
  return added;
}

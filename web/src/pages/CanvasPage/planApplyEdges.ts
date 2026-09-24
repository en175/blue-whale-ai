/* 方案卡应用到画布后：按素材身份把已有图片节点连到生成卡（media → text，textIndex）。 */
import type { Edge, Node } from '@xyflow/react';
import { readAssetId } from './mediaRefs';

type PlanMediaType = 'image' | 'video' | 'audio';

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

export function isMissingPlanMediaNode(node: Node): boolean {
  if (node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.assetMissing === true;
}

function planMaterialOf(textNode: Node | undefined, assetId: string): {
  url: string;
  mediaType: PlanMediaType;
  name: string;
  width?: number;
  height?: number;
} | null {
  const data = (textNode?.data ?? {}) as Record<string, unknown>;
  const refs = Array.isArray(data.mediaRefs) ? data.mediaRefs as Array<Record<string, unknown>> : [];
  const materials = Array.isArray(data.promptMaterials)
    ? data.promptMaterials as Array<Record<string, unknown>>
    : [];
  const match = [...refs, ...materials].find((item) => String(item.assetId ?? '') === assetId);
  if (!match) return null;
  const url = typeof match.url === 'string' ? match.url : '';
  if (!url || url.startsWith('blob:')) return null;
  const mediaType: PlanMediaType = match.mediaType === 'video'
    ? 'video'
    : match.mediaType === 'audio'
      ? 'audio'
      : 'image';
  const name = typeof match.name === 'string' && match.name
    ? match.name
    : typeof match.label === 'string' && match.label
      ? match.label
      : assetId;
  return {
    url,
    mediaType,
    name,
    width: typeof match.width === 'number' ? match.width : undefined,
    height: typeof match.height === 'number' ? match.height : undefined,
  };
}

function rewriteTextNodeMediaPointers(node: Node, assetId: string, mediaNodeId: string): Node {
  const data = { ...((node.data ?? {}) as Record<string, unknown>) };
  if (Array.isArray(data.mediaMentions)) {
    data.mediaMentions = (data.mediaMentions as Array<Record<string, unknown>>).map((mention) => (
      String(mention.assetId ?? '') === assetId ? { ...mention, nodeId: mediaNodeId } : mention
    ));
  }
  if (Array.isArray(data.mediaRefs)) {
    data.mediaRefs = (data.mediaRefs as Array<Record<string, unknown>>).map((ref) => (
      String(ref.assetId ?? '') === assetId ? { ...ref, nodeId: mediaNodeId } : ref
    ));
  }
  return { ...node, data };
}

/**
 * 画布上同身份素材只剩「素材已被删除」空壳时，新建可播放素材卡并改写生成卡指针。
 * 旧空壳从画布拿掉，避免资产字典补齐后同一素材复活成两张卡。
 */
export function replaceMissingPlanMediaNodes(input: {
  textNodeId: string;
  assetIds: string[];
  nodes: Node[];
  missingNodeIds: ReadonlySet<string>;
  createNodeId: () => string;
}): { nodes: Node[]; removedNodeIds: Set<string>; replaced: boolean } {
  const removedNodeIds = new Set<string>();
  let next = [...input.nodes];
  let replaced = false;
  let createdCount = 0;
  const textIndex = next.findIndex((node) => node.id === input.textNodeId);
  const textNode = textIndex >= 0 ? next[textIndex] : undefined;

  for (const assetId of input.assetIds) {
    const matching = next.filter((node) => (
      node.type === 'mediaNode' && readAssetId((node.data ?? {}) as Record<string, unknown>) === assetId
    ));
    const missingMatches = matching.filter((node) => (
      input.missingNodeIds.has(node.id) || isMissingPlanMediaNode(node)
    ));
    const usable = matching.filter((node) => !missingMatches.includes(node));
    let targetId = usable[0]?.id;
    if (!targetId) {
      const material = planMaterialOf(textNode, assetId);
      if (!material || !textNode) continue;
      targetId = input.createNodeId();
      next.push({
        id: targetId,
        type: 'mediaNode',
        position: {
          x: textNode.position.x + 420,
          y: textNode.position.y + createdCount * 300,
        },
        data: {
          assetId,
          mediaType: material.mediaType,
          src: material.url,
          fileName: material.name,
          ...(material.width !== undefined ? { width: material.width } : {}),
          ...(material.height !== undefined ? { height: material.height } : {}),
        },
      });
      createdCount += 1;
      replaced = true;
    }
    for (const node of missingMatches) removedNodeIds.add(node.id);
    if (missingMatches.length > 0) {
      next = next.filter((node) => !removedNodeIds.has(node.id));
      replaced = true;
    }
    const currentText = next.find((node) => node.id === input.textNodeId);
    if (currentText && targetId) {
      const rewritten = rewriteTextNodeMediaPointers(currentText, assetId, targetId);
      next = next.map((node) => (node.id === input.textNodeId ? rewritten : node));
    }
  }

  return { nodes: next, removedNodeIds, replaced };
}

/** 已有同 assetId 的可用媒体节点 → 生成卡；已存在同向边不重复建。 */
export function textIndexEdgesForAppliedPlan(
  textNodeId: string,
  assetIds: string[],
  nodes: Node[],
  edges: Edge[],
): Edge[] {
  const mediaIdByAsset = new Map<string, string>();
  for (const node of nodes) {
    if (node.type !== 'mediaNode' || isMissingPlanMediaNode(node)) continue;
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

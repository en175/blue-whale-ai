/* ============================================
 * mediaRefs 图片参考连线（IKDMQR）：来源有效性校验 + 连线→媒体参考推导。
 * Dock 展示与生成提交共用同一推导，保证「显示输入 = 实际任务输入」。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';

/** 图片参考来源项：nodeId 用于 Dock 移除时断开对应连线；assetId 进入 input_asset_ids */
export interface ImageMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
}

/** 图片草稿身份判定（IKDMQQ 约定）：draft 标记 + 图片媒体类型；成功转成品卡后 draft 清除 */
export function isImageDraftNode(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.draft === true && data.mediaType === 'image';
}

/** 来源节点 assetId 归一（兼容 assetId/asset_id/assetID 三形态，后端写入节点为下划线形态）；无则 undefined */
export function readAssetId(data: Record<string, unknown> | undefined): string | undefined {
  const raw = data?.assetId ?? data?.asset_id ?? data?.assetID;
  return raw == null || raw === '' ? undefined : String(raw);
}

/** 素材库 ID（Asset- 前缀），提交走 material_id，不能当本地 assets 表 id 去 link */
export function isMaterialLibraryId(id: string | number | undefined): boolean {
  return typeof id === 'string' && /^asset-/i.test(id);
}

/** 来源有效性（不含媒体类型检查，图片/视频/音频参考共用）：待生成/生成中/失败/失效/
 *  上传中/无资产的来源均不可用，返回用户可读拒绝原因；可用返回 null */
export function baseSourceError(node: NonNullable<Node>): string | null {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.genStatus === 'draft') return '待生成的草稿不能作为参考';
  if (data.genStatus === 'generating') return '生成中的卡片不能作为参考';
  if (data.genStatus === 'failed' || data.genStatus === 'cancelled') return '生成失败的卡片不能作为参考';
  if (data.assetMissing) return '素材已被删除';
  const src = typeof data.src === 'string' ? data.src : '';
  if (src.startsWith('blob:')) return '素材上传中，请稍候再选择';
  if (!src) return '素材已被删除';
  if (readAssetId(data) === undefined) return '素材未关联资产，无法作为参考';
  return null;
}

/** 来源节点能否作为图片参考：返回 null 表示可连入，否则为用户可读拒绝原因。
 *  仅接受已有有效结果的图片媒体节点；待生成/生成中/失败/失效/上传中/无资产身份均拒绝。
 *  检查顺序为既有语义（genStatus 优先于媒体类型），baseSourceError 共享末段判定。 */
export function imageRefSourceError(node: Node | undefined): string | null {
  if (!node) return '素材不存在';
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.genStatus === 'draft' || data.genStatus === 'generating' || data.genStatus === 'failed' || data.genStatus === 'cancelled') {
    return baseSourceError(node);
  }
  if (data.assetMissing) return '素材已被删除';
  const src = typeof data.src === 'string' ? data.src : '';
  if (src.startsWith('blob:')) return '素材上传中，请稍候再选择';
  if (!src) return '素材已被删除';
  if (data.mediaType !== 'image') return '图片参考仅支持图片素材';
  return baseSourceError(node);
}

/** 来源节点 id → 当前卡片名称（无名称时回落节点 id）。快照参考刷新与连线推导共用同一取值口径 */
export function cardNameOfNode(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const name = ((node.data ?? {}) as Record<string, unknown>).fileName;
  return typeof name === 'string' && name ? name : node.id;
}

/** 面板参考项 id → 画布节点 id：画布节点带入的参考项 id 形如 `node-<节点id>`；资产库/角色库
 *  素材项不做此编码。按节点身份刷新名称时统一走这里解码 */
export function localNodeIdOf(fileId: string): string | null {
  if (!fileId.startsWith('node-')) return null;
  return fileId.slice('node-'.length) || null;
}

/** 目标节点的有效图片媒体参考：连线 target=该节点，按连线顺序；仅推导当前有效来源
 * （失效/悬空来源不展示也不消费，连线本身保留待来源恢复或用户断开）；
 *  同一素材（相同 assetId）多条连线只取首条（历史画布防御，与连线时重复校验同口径）。
 *  名称恒取来源节点当前名（改名即时同步，见 IKFA8Y）。 */
export function imageMediaRefsOf(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
): ImageMediaRef[] {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  const refs: ImageMediaRef[] = [];
  const seenAssetIds = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    const source = byId.get(edge.source);
    if (!source || source.type !== 'mediaNode') continue;
    if (imageRefSourceError(source) !== null) continue;
    const data = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data)!;
    if (seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    refs.push({
      nodeId: source.id,
      url: data.src as string,
      name: cardNameOfNode(source)!,
      assetId,
    });
  }
  return refs;
}

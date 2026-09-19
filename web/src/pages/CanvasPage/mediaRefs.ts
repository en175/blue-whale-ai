/* ============================================
 * mediaRefs 图片参考连线（IKDMQR）：来源有效性校验 + 连线→媒体参考推导。
 * Dock 展示与生成提交共用同一推导，保证「显示输入 = 实际任务输入」。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';
import { IMAGE_CROP_EDGE_ORIGIN } from './imageCrop';
import { IMAGE_ENHANCE_EDGE_ORIGIN } from './imageEnhance';
import { IMAGE_ERASE_EDGE_ORIGIN } from './imageErase';
import { IMAGE_OUTPAINT_EDGE_ORIGIN } from './imageOutpaint';
import { IMAGE_CUTOUT_EDGE_ORIGIN } from '@lib/contracts/image-cutout';
import { VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN } from '@lib/contracts/video-subtitle-erase';

/** 纯视觉来源边标记集合（edge.data.origin）：这些边表达「目标卡由来源卡衍生而来」，
 *  是来源记录而非生成参考输入——参考推导跳过，源图不占参考位、不参与 @ 编号与媒体索引
 *  （高清放大 IKGOTB 前只有 image-enhance，IKGOTB 加入擦除 image-erase，IKGOR6 加入扩图
 *  image-outpaint，IKGW1S 加入裁切 image-crop，IKGXMT 加入抠图 image-cutout，IKGZ83 加入
 *  去字幕 video-subtitle-erase——首个视频系来源边，常量单源在契约，口径同 mediaExtract 来源边）。 */
const PURE_VISUAL_EDGE_ORIGINS: ReadonlySet<string> = new Set([
  IMAGE_ENHANCE_EDGE_ORIGIN,
  IMAGE_ERASE_EDGE_ORIGIN,
  IMAGE_OUTPAINT_EDGE_ORIGIN,
  IMAGE_CROP_EDGE_ORIGIN,
  IMAGE_CUTOUT_EDGE_ORIGIN,
  VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN,
]);

/** 图片参考来源项：nodeId 用于 Dock 移除时断开对应连线；assetId 进入 references[].asset_id。
 *  textNodeId（IKFM3S）：该参考由文本卡正文索引提供（锁定，不可在目标直接移除），值为来源文本卡 id。
 *  planNodeId（IKG99G）：该参考由生成卡（promptSource）经后端方案同步建素材边带入，
 *  值为来源生成卡 id（edge.data.inputSources.planNodeIds[0]，且 manual=false）。
 *  展示层据此过滤——生成卡作为整体附件，内部素材不拆项进 Dock 参考栏；参数推导仍全量。 */
export interface ImageMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
  textNodeId?: string;
  planNodeId?: string;
  mediaType?: 'image' | 'video' | 'audio';
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
 *  上传中/无资产的来源均不可用，返回用户可读拒绝原因；可用返回 null。
 *  extraCheck 在资产身份判定之前插入额外拒绝原因（供需要 genStatus 优先于媒体类型的调用方
 *  保持既有提示顺序），不需要的调用方不传。 */
export function baseSourceError(
  node: NonNullable<Node>,
  extraCheck?: (data: Record<string, unknown>) => string | null,
): string | null {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.genStatus === 'draft') return '待生成的草稿不能作为参考';
  if (data.genStatus === 'generating') return '生成中的卡片不能作为参考';
  if (data.genStatus === 'failed' || data.genStatus === 'cancelled') return '生成失败的卡片不能作为参考';
  if (data.assetMissing) return '素材已被删除';
  const src = typeof data.src === 'string' ? data.src : '';
  if (src.startsWith('blob:')) return '素材上传中，请稍候再选择';
  if (!src) return '素材已被删除';
  const extra = extraCheck?.(data);
  if (extra) return extra;
  if (readAssetId(data) === undefined) return '素材未关联资产，无法作为参考';
  return null;
}

/** 来源节点能否作为图片参考：返回 null 表示可连入，否则为用户可读拒绝原因。
 *  仅接受已有有效结果的图片媒体节点；待生成/生成中/失败/失效/上传中/无资产身份均拒绝。
 *  检查顺序为既有语义（genStatus 优先于媒体类型），媒体类型经 baseSourceError 的
 *  extraCheck 插入资产身份判定之前，与旧内联级联顺序一致。 */
export function imageRefSourceError(node: Node | undefined): string | null {
  if (!node) return '素材不存在';
  return baseSourceError(node, (data) => (data.mediaType !== 'image' ? '图片参考仅支持图片素材' : null));
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
    // 纯视觉来源边（高清/擦除/扩图/裁切）不作参考输入：源图不占参考位、不参与 @ 编号
    if (PURE_VISUAL_EDGE_ORIGINS.has((edge.data as { origin?: string } | undefined)?.origin ?? '')) continue;
    const source = byId.get(edge.source);
    if (!source || source.type !== 'mediaNode') continue;
    if (imageRefSourceError(source) !== null) continue;
    const data = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data)!;
    if (seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    // IKG99G：标记生成卡经后端方案同步建素材边带入的参考（manual=false 且 planNodeIds 非空）
    const inputSources = (edge.data as { inputSources?: { manual?: boolean; planNodeIds?: string[] } } | undefined)?.inputSources;
    const planNodeId = inputSources && inputSources.manual === false && Array.isArray(inputSources.planNodeIds) && inputSources.planNodeIds.length > 0
      ? inputSources.planNodeIds[0]
      : undefined;
    refs.push({
      nodeId: source.id,
      url: data.src as string,
      name: cardNameOfNode(source)!,
      assetId,
      planNodeId,
    });
  }
  return refs;
}

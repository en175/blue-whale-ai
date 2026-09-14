/* ============================================
 * 文本索引下游同步（IKFM3S）：契约 §1/§2/§4 的前端同源实现——
 * 目标参考 = 直接参考 ∪ 文本带入参考（纯派生），「显示输入 = 实际任务输入」；
 * 派生/合并/签名全部复用 @lib/contracts/text-index-sync（与后端共用唯一实现）。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';
import {
  IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  TEXT_INDEX_INVALID_MESSAGE,
  TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE,
  textIndexOverflowMessage,
  checkTextIndexSyncInput,
  textIndexOfTarget,
  textInputSignatureOf,
  type TargetTextIndex,
  type TextProvidedRef,
} from '@lib/contracts/text-index-sync';
import { imageMediaRefsOf, type ImageMediaRef } from './mediaRefs';

/** 图片参考缺省上限（= 后端 DEFAULT_MAX_REFERENCE_IMAGES；模型未配 features.max_reference_images
 *  时的两端同口径缺省。模型配了更小上限时由面板 features 校验与后端 400 接管）。 */
export const DEFAULT_IMAGE_REFERENCE_LIMIT = 10;

/** React Flow 节点/连线结构与契约宽松形状兼容，统一在此收窄（未知字段忽略）。 */
function canvasOf(nodes: Node[]): Parameters<typeof textIndexOfTarget>[0] {
  return nodes.map((node) => ({ id: node.id, type: node.type, data: node.data as Record<string, unknown> | undefined }));
}

/** 目标的文本索引派生（契约 §1）：文本入边逐卡解析有效身份。 */
export function imageTargetTextIndex(targetNodeId: string, edges: Edge[], nodes: Node[]): TargetTextIndex {
  return textIndexOfTarget(canvasOf(nodes), edges, targetNodeId);
}

/** 文本带入参考适配为面板参考项（nodeId = 素材来源节点，textNodeId 标记锁定来源文本卡）。 */
function toMediaRef(item: TextProvidedRef): ImageMediaRef {
  return {
    nodeId: item.sourceNodeId,
    url: item.url,
    name: item.name,
    assetId: item.assetId,
    textNodeId: item.textNodeId,
    mediaType: item.mediaType,
  };
}

/** 图片目标的合并参考（契约 §2）：直接参考在前、文本带入参考追加在后，同 assetId 去重保首见。
 *  Dock 展示与生成提交共用（提交 input_asset_ids 由面板 orderedImageRefs 从本结果派生）。 */
export function mergedImageRefsOf(targetNodeId: string, edges: Edge[], nodes: Node[]): ImageMediaRef[] {
  const direct = imageMediaRefsOf(targetNodeId, edges, nodes);
  const index = imageTargetTextIndex(targetNodeId, edges, nodes);
  const seen = new Set(direct.map((ref) => ref.assetId));
  return [...direct, ...index.refs.map(toMediaRef).filter((ref) => {
    if (seen.has(ref.assetId)) return false;
    seen.add(ref.assetId);
    return true;
  })];
}

/** 目标当前文本输入签名（契约 §4：正文/有效身份/边序参与，直接参考不参与）。 */
export function imageTargetSignature(targetNodeId: string, edges: Edge[], nodes: Node[]): string {
  return textInputSignatureOf(imageTargetTextIndex(targetNodeId, edges, nodes).inputs);
}

/** 目标是否存在文本入边（提示显示前提：来源必须是文本卡，直接媒体参考不算）。 */
export function hasTextInputs(targetNodeId: string, edges: Edge[], nodes: Node[]): boolean {
  return firstTextSourceOf(targetNodeId, edges, nodes) !== null;
}

/** 目标第一条文本入边的来源文本卡 id（徽标定位入口用；无则 null）。 */
export function firstTextSourceOf(targetNodeId: string, edges: Edge[], nodes: Node[]): string | null {
  const textIds = new Set(nodes.filter((n) => n.type === 'textNode').map((n) => n.id));
  for (const edge of edges) {
    if (edge.target === targetNodeId && textIds.has(edge.source)) return edge.source;
  }
  return null;
}

/** 「输入已更新」提示判定（契约 §4，派生不存布尔）：图片目标存在文本入边且当前签名
 *  与最近成功使用签名不一致（任务 3 范围为图片目标；视频/音频由任务 4/5 扩展）。 */
export function imageInputStale(
  targetNodeId: string,
  edges: Edge[],
  nodes: Node[],
): boolean {
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!target || target.type !== 'mediaNode') return false;
  const data = target.data as Record<string, unknown> | undefined;
  if (data?.mediaType !== 'image') return false;
  if (!hasTextInputs(targetNodeId, edges, nodes)) return false;
  if (!data) return false;
  const used = data.usedInputSignature;
  if (typeof used !== 'string') return true;
  return used !== imageTargetSignature(targetNodeId, edges, nodes);
}

/** 图片目标发送前校验（契约 §3，与业务 API 同口径）：返回 null 放行，否则为用户可读阻止原因。 */
export function imageTextIndexSendError(
  targetNodeId: string,
  edges: Edge[],
  nodes: Node[],
  maxReferences: number,
): string | null {
  const index = imageTargetTextIndex(targetNodeId, edges, nodes);
  const merged = mergedImageRefsOf(targetNodeId, edges, nodes);
  const error = checkTextIndexSyncInput({
    index,
    acceptedMediaTypes: IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
    mergedReferenceCount: merged.length,
    maxReferences,
  });
  if (!error) return null;
  if (error.kind === 'invalid_index') return TEXT_INDEX_INVALID_MESSAGE;
  if (error.kind === 'unsupported_media_type') return TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE;
  return textIndexOverflowMessage(error.max);
}

/** 成功签名回写判定（契约 §4 乱序保护）：仅当本次 jobId 更新才覆盖已存状态——
 *  旧任务成功不清除更晚编辑的提示。返回 null 表示不写。 */
export function nextUsedInputState(
  data: Record<string, unknown> | undefined,
  textInputSignature: string | null | undefined,
  jobId: number | string,
): { usedInputSignature: string; usedInputJobId: number } | null {
  if (typeof textInputSignature !== 'string' || textInputSignature.length === 0) return null;
  const usedJobId = typeof data?.usedInputJobId === 'number' ? data.usedInputJobId : 0;
  if (Number(jobId) <= usedJobId) return null;
  return { usedInputSignature: textInputSignature, usedInputJobId: Number(jobId) };
}

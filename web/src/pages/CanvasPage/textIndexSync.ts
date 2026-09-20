/* ============================================
 * 文本索引下游同步（IKFM3S/IKFM3W/IKFM41）：契约 §1/§2/§4/§10/§11 的前端同源实现——
 * 目标参考 = 直接参考 ∪ 文本带入参考（纯派生），「显示输入 = 实际任务输入」；
 * 派生/合并/签名全部复用 @lib/contracts/text-index-sync（与后端共用唯一实现）。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';
import {
  AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  TEXT_INDEX_INVALID_MESSAGE,
  TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE,
  VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE,
  textIndexOverflowMessage,
  checkAudioTextIndexSyncInput,
  checkTextIndexSyncInput,
  checkVideoTextIndexSyncInput,
  textIndexOfTarget,
  textInputSignatureOf,
  type TargetTextIndex,
  type TextProvidedRef,
} from '@lib/contracts/text-index-sync';
import { imageMediaRefsOf, type ImageMediaRef } from './mediaRefs';
import { audioMediaRefsOf, audioMergedRefsError, type AudioMediaRef } from './audioMediaRefs';
import { mergedVideoMediaRefsOf, type VideoMediaRef, type VideoMediaRefs } from './videoMediaRefs';

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
 *  Dock 展示与生成提交共用（提交 references 由面板 orderedImageRefs 从本结果派生）。 */
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

/** 「输入已更新」提示判定（契约 §4，派生不存布尔）：目标存在文本入边且当前签名
 *  与最近成功使用签名不一致。图片（任务 3）/视频（IKFM3W §10）/音频（IKFM41 §11）同一派生判定。 */
export function mediaInputStale(
  targetNodeId: string,
  edges: Edge[],
  nodes: Node[],
  mediaType: 'image' | 'video' | 'audio',
): boolean {
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!target || target.type !== 'mediaNode') return false;
  const data = target.data as Record<string, unknown> | undefined;
  if (data?.mediaType !== mediaType) return false;
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

/* ---- 视频目标（契约 §10，IKFM3W）：同一来源模型与并入/签名实现，角色恒为普通参考 ---- */

/** 视频目标的合并参考（契约 §10）：直接参考（连线 + material 合并）在前、文本带入参考
 *  追加为普通参考尾部（同 assetId 去重保首见，material 空间不参与）。Dock 展示与生成
 *  提交共用（显示输入 = 实际任务输入）。 */
export function mergedVideoRefsWithTextIndex(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
  textNodes: Node[],
): VideoMediaRefs {
  const base = mergedVideoMediaRefsOf(targetNodeId, edges, mediaNodes);
  const index = textIndexOfTarget(canvasOf([...mediaNodes, ...textNodes]), edges, targetNodeId);
  if (index.refs.length === 0) return base;
  const seen = new Set<string>(
    [base.first, base.last, ...base.reference]
      .filter((item): item is VideoMediaRef => item != null)
      .map((item) => item.assetId),
  );
  const appended: VideoMediaRef[] = [];
  for (const item of index.refs) {
    if (seen.has(item.assetId)) continue;
    seen.add(item.assetId);
    appended.push({
      nodeId: item.sourceNodeId,
      url: item.url,
      name: item.name,
      assetId: item.assetId,
      mediaType: item.mediaType,
      textNodeId: item.textNodeId,
    });
  }
  return appended.length > 0 ? { ...base, reference: [...base.reference, ...appended] } : base;
}

/** 视频目标发送前校验（契约 §10，与业务 API 同口径）：失效索引 / 首尾帧互斥阻止发送。
 *  类型能力位与分类容量与图片同构走面板 features 防线 + 后端 400 权威（前端契约校验
 *  用全集缺省，模型真实能力由面板按所选模型拦截），返回 null 放行。 */
export function videoTextIndexSendError(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
  textNodes: Node[],
): string | null {
  const index = textIndexOfTarget(canvasOf([...mediaNodes, ...textNodes]), edges, targetNodeId);
  if (index.refs.length === 0 && index.invalid.length === 0) return null;
  const direct = mergedVideoMediaRefsOf(targetNodeId, edges, mediaNodes);
  const error = checkVideoTextIndexSyncInput({
    index,
    acceptedMediaTypes: ['image', 'video', 'audio'],
    hasFrameRole: Boolean(direct.first || direct.last),
  });
  if (!error) return null;
  if (error.kind === 'invalid_index') return TEXT_INDEX_INVALID_MESSAGE;
  if (error.kind === 'frame_conflict') return VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE;
  return TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE;
}

/* ---- 音频目标（契约 §11，IKFM41）：同一来源模型与并入/签名实现，恒普通参考无角色槽 ---- */

/** 音频目标的合并参考（契约 §11）：直接参考（连线推导）在前、文本带入参考追加尾部
 *  （同 assetId 去重保首见，mediaType 保留——直接参考与文本带入均可为 audio / image）。
 *  Dock 展示与生成提交共用（显示输入 = 实际任务输入）。 */
export function mergedAudioRefsWithTextIndex(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
  textNodes: Node[],
): { refs: AudioMediaRef[]; invalid: Array<{ nodeId: string; name: string; reason: string }> } {
  const base = audioMediaRefsOf(targetNodeId, edges, mediaNodes);
  const index = textIndexOfTarget(canvasOf([...mediaNodes, ...textNodes]), edges, targetNodeId);
  if (index.refs.length === 0) return base;
  const seen = new Set(base.refs.map((ref) => ref.assetId));
  const appended: AudioMediaRef[] = [];
  for (const item of index.refs) {
    if (seen.has(item.assetId)) continue;
    seen.add(item.assetId);
    appended.push({
      nodeId: item.sourceNodeId,
      url: item.url,
      name: item.name,
      assetId: item.assetId,
      mediaType: item.mediaType === 'image' ? 'image' : 'audio',
      textNodeId: item.textNodeId,
    });
  }
  return appended.length > 0 ? { ...base, refs: [...base.refs, ...appended] } : base;
}

/** 音频目标发送前校验（契约 §11，与业务 API 同口径）：失效索引 / 不支持类型（video）
 *  / 图音频混用与分类上限均阻止发送。 */
export function audioTextIndexSendError(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
  textNodes: Node[],
): string | null {
  const index = textIndexOfTarget(canvasOf([...mediaNodes, ...textNodes]), edges, targetNodeId);
  if (index.refs.length === 0 && index.invalid.length === 0) {
    return audioMergedRefsError(audioMediaRefsOf(targetNodeId, edges, mediaNodes).refs);
  }
  const error = checkAudioTextIndexSyncInput({
    index,
    acceptedMediaTypes: AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  });
  if (error?.kind === 'invalid_index') return TEXT_INDEX_INVALID_MESSAGE;
  if (error) return TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE;
  return audioMergedRefsError(
    mergedAudioRefsWithTextIndex(targetNodeId, edges, mediaNodes, textNodes).refs,
  );
}

/* ============================================
 * audioMediaRefs 音频参考连线（IKFDFZ）：关系即连线，与图片（IKDMQR）/视频（IKDMQS）同模型。
 * 面板展示与生成提交共用同一推导，保证「显示输入 = 实际任务输入」。
 * 音频参考无角色槽（服务端契约 role 恒 reference），随连线顺序持久化（服务端零改动）。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';
import { AUDIO_TRIM_EDGE_ORIGIN } from './audioTrim';
import { MEDIA_EXTRACT_EDGE_ORIGIN } from './mediaExtract';
import { baseSourceError, cardNameOfNode, readAssetId } from './mediaRefs';
import { panelCanvasRefError } from './refSourceTypes';

/** 参考音频上限（与服务端 seed-audio 契约一致：音频 ≤3、图片 ≤1、不可混用） */
export const MAX_AUDIO_MEDIA_REFS = 3;
export const MAX_AUDIO_IMAGE_REFS = 1;

/** 音频媒体参考项：nodeId 用于面板移除时断开对应连线；assetId 进入 references[].asset_id。
 *  mediaType：直接参考与文本带入均可为 audio / image（二者不可混用，视频不接受）。
 *  textNodeId 标记锁定来源文本卡（锁定条目不渲染移除入口）。 */
export interface AudioMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
  mediaType: 'audio' | 'image';
  textNodeId?: string;
}

export function audioRefMediaTypeOf(data: Record<string, unknown>): 'audio' | 'image' | null {
  if (data.mediaType === 'image') return 'image';
  if (data.mediaType === 'audio') return 'audio';
  return null;
}

/** 面板参考项的实际媒体类型（kind 为缺省 audio 时以 mediaType 为准）。 */
export function audioRefItemMediaTypeOf(item: { mediaType?: string; kind?: string }): 'audio' | 'image' {
  if (item.mediaType === 'image' || item.kind === 'image') return 'image';
  return 'audio';
}

/** 已合并参考清单的混用/分类上限（存量边与文本带入并入后的发送防线）。 */
export function audioMergedRefsError(refs: AudioMediaRef[]): string | null {
  const audioCount = refs.filter((r) => r.mediaType !== 'image').length;
  const imageCount = refs.filter((r) => r.mediaType === 'image').length;
  if (audioCount > 0 && imageCount > 0) return '音频与图片参考不可混用';
  if (audioCount > MAX_AUDIO_MEDIA_REFS) return `参考音频最多 ${MAX_AUDIO_MEDIA_REFS} 段`;
  if (imageCount > MAX_AUDIO_IMAGE_REFS) return `参考图最多 ${MAX_AUDIO_IMAGE_REFS} 个`;
  return null;
}

/** 音频草稿身份判定（IKDMQQ 约定延伸）：draft 标记 + 音频媒体类型 */
export function isAudioDraftNode(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.draft === true && data.mediaType === 'audio';
}

/** 来源有效性：与图片/视频参考同口径（仅有效媒体结果，baseSourceError 共享）；
 *  音频参考接受图片或音频，不接受视频；类型不匹配给出用户可读拒绝原因，不静默丢弃。 */
export function audioRefSourceError(node: Node | undefined): string | null {
  if (!node) return '素材不存在';
  const data = (node.data ?? {}) as Record<string, unknown>;
  const typeErr = panelCanvasRefError('audio', data.mediaType);
  if (typeErr) return typeErr;
  return baseSourceError(node);
}

/** 目标节点的音频媒体参考：连线 target=该节点，按连线顺序；失效来源保留原因并阻止提交，
 *  连线保留待来源恢复或用户断开（与视频参考同口径）；同一素材（相同 assetId）只取首条。 */
export function audioMediaRefsOf(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
): { refs: AudioMediaRef[]; invalid: Array<{ nodeId: string; name: string; reason: string }> } {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  const refs: AudioMediaRef[] = [];
  const invalid: Array<{ nodeId: string; name: string; reason: string }> = [];
  const seenAssetIds = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    // IKFS5W：提取产物卡上的「来源边」（这段音频取自哪段视频）不是参考输入，跳过——
    // 否则该视频会被判成非法音频参考，卡住音频面板的发送。
    // IKHB08：截取产物卡的来源边（origin=audio-trim）同口径跳过——源音频是合法音频
    // 素材，不跳过会被静默列为参考占位（防参考污染，见 audioTrim.ts 常量注释）。
    const origin = (edge.data as { origin?: string } | undefined)?.origin;
    if (origin === MEDIA_EXTRACT_EDGE_ORIGIN || origin === AUDIO_TRIM_EDGE_ORIGIN) continue;
    const source = byId.get(edge.source);
    if (!source || source.type !== 'mediaNode') continue;
    const reason = audioRefSourceError(source);
    if (reason) {
      invalid.push({ nodeId: source.id, name: cardNameOfNode(source) ?? source.id, reason });
      continue;
    }
    const data = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data)!;
    if (seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    refs.push({
      nodeId: source.id,
      url: data.src as string,
      name: cardNameOfNode(source)!,
      assetId,
      mediaType: audioRefMediaTypeOf(data) ?? 'audio',
    });
  }
  return { refs, invalid };
}

/** 统一校验「向音频草稿添加媒体参考」：重复素材 / 图音频混用 / 分类上限——所有添加入口
 *  （画布选取 / @ / 面板「从画布选择」列表 / 拖线 / 资产库）必须调本函数，禁止各自复制 guard。
 *  existing 为连线推导的当前参考；extraLocalCount 为面板本地上传音频项数量（计入音频上限）。
 *  返回 null 表示可添加；否则为用户可读的拒绝原因。 */
export function checkAddAudioRef(
  assetId: string | undefined,
  existing: AudioMediaRef[],
  extraLocalCount = 0,
  incomingType: 'audio' | 'image' = 'audio',
): string | null {
  if (assetId && existing.some((r) => r.assetId === assetId)) return '重复的素材已跳过';
  const existingAudioCount = existing.filter((r) => r.mediaType !== 'image').length + extraLocalCount;
  const existingImageCount = existing.filter((r) => r.mediaType === 'image').length;
  if (incomingType === 'image' && existingAudioCount > 0) return '音频与图片参考不可混用';
  if (incomingType === 'audio' && existingImageCount > 0) return '音频与图片参考不可混用';
  if (incomingType === 'audio' && existingAudioCount >= MAX_AUDIO_MEDIA_REFS) {
    return `参考音频最多 ${MAX_AUDIO_MEDIA_REFS} 段`;
  }
  if (incomingType === 'image' && existingImageCount >= MAX_AUDIO_IMAGE_REFS) {
    return `参考图最多 ${MAX_AUDIO_IMAGE_REFS} 个`;
  }
  return null;
}

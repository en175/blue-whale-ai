/* ============================================
 * audioMediaRefs 音频参考连线（IKFDFZ）：关系即连线，与图片（IKDMQR）/视频（IKDMQS）同模型。
 * 面板展示与生成提交共用同一推导，保证「显示输入 = 实际任务输入」。
 * 音频参考无角色槽（服务端契约 role 恒 reference），随连线顺序持久化（服务端零改动）。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';
import { cardNameOfNode, readAssetId } from './mediaRefs';

/** 参考音频上限（与服务端 seed-audio 契约一致：音频 ≤3、图片 ≤1、不可混用；
 *  前端音频面板不提供图片入口——后端图片能力不等于新增入口） */
export const MAX_AUDIO_MEDIA_REFS = 3;

/** 音频媒体参考项：nodeId 用于面板移除时断开对应连线；assetId 进入 references[].asset_id */
export interface AudioMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
}

/** 音频草稿身份判定（IKDMQQ 约定延伸）：draft 标记 + 音频媒体类型 */
export function isAudioDraftNode(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.draft === true && data.mediaType === 'audio';
}

/** 来源有效性：与图片/视频参考同口径（仅有效媒体结果）；音频参考仅接受音频素材——
 *  服务端契约允许单图片参考，但音频面板不提供图片入口（画布选取/@/面板列表/拖线均不放行），
 *  非音频来源给出用户可读拒绝原因，不静默丢弃。 */
export function audioRefSourceError(node: Node | undefined): string | null {
  if (!node) return '素材不存在';
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.genStatus === 'draft') return '待生成的草稿不能作为参考';
  if (data.genStatus === 'generating') return '生成中的卡片不能作为参考';
  if (data.genStatus === 'failed' || data.genStatus === 'cancelled') return '生成失败的卡片不能作为参考';
  if (data.assetMissing) return '素材已被删除';
  const src = typeof data.src === 'string' ? data.src : '';
  if (src.startsWith('blob:')) return '素材上传中，请稍候再选择';
  if (!src) return '素材已被删除';
  if (data.mediaType !== 'audio') return '音频参考仅支持音频素材';
  if (readAssetId(data) === undefined) return '素材未关联资产，无法作为参考';
  return null;
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
    });
  }
  return { refs, invalid };
}

/** 统一校验「向音频草稿添加参考音频」：重复素材 / 超上限——所有添加入口（画布选取 / @ /
 *  面板「从画布选择」列表 / 拖线）必须调本函数，禁止各自复制 guard。
 *  existing 为连线推导的当前参考；extraLocalCount 为面板本地上传项数量（共同计入上限）。
 *  返回 null 表示可添加；否则为用户可读的拒绝原因。 */
export function checkAddAudioRef(
  assetId: string | undefined,
  existing: AudioMediaRef[],
  extraLocalCount = 0,
): string | null {
  if (assetId && existing.some((r) => r.assetId === assetId)) return '重复的素材已跳过';
  if (existing.length + extraLocalCount >= MAX_AUDIO_MEDIA_REFS) {
    return `参考音频最多 ${MAX_AUDIO_MEDIA_REFS} 段`;
  }
  return null;
}

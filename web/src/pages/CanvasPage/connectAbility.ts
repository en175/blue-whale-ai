/* 连线创作能力集：素材能连哪种生成节点、组交集如何投影到菜单 */
import type { Edge, Node } from '@xyflow/react';

export type ConnectGenKind = 'image' | 'video' | 'text' | 'audio';

export type ConnectSourceKind = 'image' | 'video' | 'audio' | 'text';

/** 图片/视频/文本生成仍按素材能力集交集；音频生成单独按组内介质组合判定 */
type AbilityGenKind = Exclude<ConnectGenKind, 'audio'>;

const ABILITY: Record<ConnectSourceKind, ReadonlySet<AbilityGenKind>> = {
  image: new Set(['image', 'video', 'text']),
  video: new Set(['video', 'text']),
  audio: new Set(['video']),
  text: new Set(['image', 'video', 'text']),
};

function dataOf(node: Node): Record<string, unknown> {
  return (node.data ?? {}) as Record<string, unknown>;
}

/** 空壳 / 生成中 / 待生成 / 失败草稿不能当上游素材 */
export function isConnectableSource(node: Node | undefined): boolean {
  if (!node) return false;
  if (sourceKindOf(node) == null) return false;
  return true;
}

export function sourceKindOf(node: Node | undefined): ConnectSourceKind | null {
  if (!node) return null;
  const d = dataOf(node);
  if (d.emptyShell === true) return null;
  if (node.type === 'textNode') {
    if (d.textGen === true) {
      const html = typeof d.html === 'string' ? d.html : '';
      const text = typeof d.text === 'string' ? d.text : '';
      const plain = html.replace(/<[^>]+>/g, '').trim() || text.trim();
      return plain ? 'text' : null;
    }
    return 'text';
  }
  if (d.draft === true || d.genStatus === 'draft' || d.genStatus === 'generating') return null;
  if (node.type !== 'mediaNode') return null;
  if (d.assetMissing === true) return null;
  const src = typeof d.src === 'string' ? d.src : '';
  if (!src || src.startsWith('blob:')) return null;
  if (d.mediaType === 'image' || d.mediaType === 'video' || d.mediaType === 'audio') return d.mediaType;
  return null;
}

/** 媒体生成宿主：草稿、生成中/失败，以及带 jobId 的成品生成卡（上传素材卡不算） */
function isMediaGenHost(d: Record<string, unknown>): boolean {
  if (d.draft === true) return true;
  const status = d.genStatus;
  if (status === 'draft' || status === 'generating' || status === 'failed' || status === 'cancelled') return true;
  const jobId = d.jobId;
  return typeof jobId === 'string' || typeof jobId === 'number';
}

/** 目标是否为生成节点（待生成 / 生成中 / 成品生成卡 / 文本生成宿主） */
export function genKindOf(node: Node | undefined): ConnectGenKind | null {
  if (!node) return null;
  const d = dataOf(node);
  if (node.type === 'textNode' && d.textGen === true) return 'text';
  if (node.type !== 'mediaNode') return null;
  if (!isMediaGenHost(d)) return null;
  if (d.mediaType === 'video') return 'video';
  if (d.mediaType === 'image') return 'image';
  if (d.mediaType === 'audio') return 'audio';
  return null;
}

/** 音频生成是否可选：纯图置灰（音频面板不提供图片入口）；纯音频可选（IKFDFZ 音频参考
 *  走画布连线，参考音频是音频生成的核心输入）；图+视频、音频+图、音频+视频、三者混合可选
 *  （多选成员逐个判定，图片成员仍被拒）；文本卡作为创作上下文连入音频面板（IKFCKS），含文本的组合可选 */
export function isAudioGenEnabled(sourceKinds: ConnectSourceKind[]): boolean {
  const hasImage = sourceKinds.includes('image');
  const hasVideo = sourceKinds.includes('video');
  const hasAudio = sourceKinds.includes('audio');
  const hasText = sourceKinds.includes('text');
  if (hasAudio) return true;
  if (hasVideo && hasImage) return true;
  if (hasText) return true;
  return false;
}

export function availableGenKinds(sourceNodes: Node[]): Set<ConnectGenKind> {
  const kinds: ConnectSourceKind[] = [];
  for (const node of sourceNodes) {
    const kind = sourceKindOf(node);
    if (!kind) continue;
    kinds.push(kind);
  }
  if (kinds.length === 0) return new Set();
  let acc: Set<AbilityGenKind> | null = null;
  for (const kind of kinds) {
    const set = ABILITY[kind];
    if (acc == null) {
      acc = new Set<AbilityGenKind>(set);
    } else {
      const next = new Set<AbilityGenKind>();
      for (const item of acc) {
        if (set.has(item)) next.add(item);
      }
      acc = next;
    }
  }
  const result = new Set<ConnectGenKind>(acc ?? []);
  if (isAudioGenEnabled(kinds)) result.add('audio');
  // 组内任一素材合规未通过：视频生成参考能力失效（不可挂边、菜单置灰）
  if (sourceNodes.some((node) => dataOf(node).complianceFailed === true)) {
    result.delete('video');
  }
  return result;
}

export function canConnectSourcesToGen(sourceNodes: Node[], targetKind: ConnectGenKind): boolean {
  return availableGenKinds(sourceNodes).has(targetKind);
}

/** 从 target 沿出边能否走到 source（再加 source→target 会成环） */
export function wouldCreateCycle(sourceId: string, targetId: string, edges: Edge[]): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }
  const stack = [targetId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === sourceId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of outgoing.get(id) ?? []) stack.push(next);
  }
  return false;
}

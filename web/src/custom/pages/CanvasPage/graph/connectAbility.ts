import type { Edge, Node } from '@xyflow/react';
import { type ConnectGenKind } from '@/custom/enums';

export type ConnectSourceKind = 'image' | 'video' | 'audio' | 'text';

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

function isMediaGenHost(d: Record<string, unknown>): boolean {
  if (d.draft === true) return true;
  const status = d.genStatus;
  if (status === 'draft' || status === 'generating' || status === 'failed' || status === 'cancelled') return true;
  const jobId = d.jobId;
  return typeof jobId === 'string' || typeof jobId === 'number';
}

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

export function isAudioGenEnabled(sourceKinds: ConnectSourceKind[]): boolean {
  const hasImage = sourceKinds.includes('image');
  const hasVideo = sourceKinds.includes('video');
  const hasAudio = sourceKinds.includes('audio');
  if (hasVideo) return false;
  if (hasImage && hasAudio) return false;
  return true;
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
  if (sourceNodes.some((node) => dataOf(node).complianceFailed === true)) {
    result.delete('video');
  }
  return result;
}

export function canConnectSourcesToGen(sourceNodes: Node[], targetKind: ConnectGenKind): boolean {
  return availableGenKinds(sourceNodes).has(targetKind);
}

const SOURCE_KIND_OF_GEN: Record<ConnectGenKind, ConnectSourceKind> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'text',
};

export function availableGenKindsAsTarget(target: Node | undefined): Set<ConnectGenKind> {
  if (!target) return new Set();
  const data = dataOf(target);
  if (data.emptyShell === true || data.genStatus === 'generating') return new Set();
  const targetKind = genKindOf(target);
  if (!targetKind) {
    if (target.type === 'textNode' || target.type === 'assetCardNode' || target.type === 'productNode') {
      return new Set<ConnectGenKind>(['image', 'video', 'text']);
    }
    return new Set();
  }
  const kinds: ConnectGenKind[] = ['image', 'video', 'audio', 'text'];
  return new Set(
    kinds.filter((kind) => {
      if (ABILITY[SOURCE_KIND_OF_GEN[kind]].has(targetKind as AbilityGenKind)) return true;
      return kind === 'audio' && targetKind === 'video' && isAudioGenEnabled([SOURCE_KIND_OF_GEN.audio]);
    }),
  );
}

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

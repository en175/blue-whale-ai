import type { Edge, Node } from '@xyflow/react';
import { isApiError } from '@/shared/api/http';
import type { AssetRecord } from '@/custom/api/assets';
import {
  promptBindingList,
  promptBindingsSchema,
  type PromptBinding,
} from '@lib/contracts/prompt-target';
import { promptMentionSchema, validPromptMentions } from '@lib/contracts/prompt-preview';
import { extractTextNodeText } from '@lib/core/text-node-content';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { readAssetId } from './mediaRefs';
import { planBindingsCoveredBy } from './canvasNodeUtils';
import { asVideoRefMediaType, readRefRole, type VideoMediaRef, type VideoRefRole } from './videoMediaRefs';
import { imageEnhanceDraftPosition } from './imageEnhance';
import { fetchRemoteMedia } from './fetchRemoteMedia';
import type { SpawnBox } from './draftSpawn';
import { isConnectableSource, sourceKindOf } from './connectAbility';
import type { AtMentionItem } from './atMention';
import type { CanvasPickItem } from './components/AudioDialog';
import type { GenerationCardBlock } from '@/custom/api/agentSessions';

export const nodeBoxOf = (n: Node): SpawnBox => {
  const d = (n.data ?? {}) as Record<string, unknown>;
  if (n.type === 'mediaNode') {
    const box = mediaContentBox({
      mediaType: d.mediaType as 'image' | 'video' | 'audio' | undefined,
      width: typeof d.width === 'number' ? d.width : undefined,
      height: typeof d.height === 'number' ? d.height : undefined,
      ratio: d.targetRatio as string | undefined,
    });
    return { x: n.position.x, y: n.position.y, width: box.width, height: box.height + 44 };
  }
  return { x: n.position.x, y: n.position.y, width: 320, height: 340 };
};

export const readRecoveryErrorReason = (e: unknown): string | null => {
  if (!isApiError(e)) return null;
  const reason = (e.data as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' ? reason : null;
};

export const videoFreeRefItemOf = (node: Node): VideoMediaRef => {
  const data = (node.data ?? {}) as Record<string, unknown>;
  return {
    nodeId: node.id,
    url: String(data.src ?? ''),
    name: typeof data.fileName === 'string' && data.fileName ? data.fileName : node.id,
    assetId: String(readAssetId(data)),
    mediaType: asVideoRefMediaType(data.mediaType),
  };
};

export const assetDisplayName = (asset: AssetRecord): string => {
  try {
    const last = new URL(asset.url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : `资产-${asset.id}`;
  } catch {
    return `资产-${asset.id}`;
  }
};

export const imageToolTargetBesideSource = (source: Node, fileName: string, targetNodeId: string) => {
  const position = imageEnhanceDraftPosition(source);
  const d = (source.data ?? {}) as Record<string, unknown>;
  const width = typeof d.width === 'number' && d.width > 0 ? Math.round(d.width) : 320;
  const height = typeof d.height === 'number' && d.height > 0 ? Math.round(d.height) : 320;
  return {
    targetNodeId,
    seedTarget: { role: 'result-placeholder' as const, x: position.x, y: position.y, width, height, name: fileName },
    seedSources: [{
      node_id: source.id,
      x: Math.round(source.position.x),
      y: Math.round(source.position.y),
      width,
      height,
      name: typeof d.fileName === 'string' ? d.fileName : '',
    }],
  };
};

export const fetchUrlAsFile = async (url: string, name: string, _type: string): Promise<File | null> => {
  try {
    const res = await fetchRemoteMedia(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || _type || 'image/png';
    return new File([blob], name, { type: mimeType });
  } catch {
    return null;
  }
};

export const planReferenceErrorFor = (
  targetId: string | undefined,
  availableIds: string[],
  edges: Edge[],
  textNodes: Node[],
): string | undefined => {
  if (!targetId) return undefined;
  for (const edge of edges.filter((e) => e.target === targetId)) {
    const plan = textNodes.find((n) => n.id === edge.source && n.data.promptSource);
    if (!plan || (plan.data.promptMentions === undefined && edge.data?.promptReference === undefined)) continue;
    const text = extractTextNodeText(plan.data);
    const mentions = promptMentionSchema.array().safeParse(plan.data.promptMentions ?? []);
    if (!mentions.success || !validPromptMentions(text, mentions.data)) return '方案正文素材索引无效，请修正方案';
    const bindings = promptBindingList(mentions.data);
    const confirmed = promptBindingsSchema.safeParse((edge.data?.promptReference as { bindings?: unknown } | undefined)?.bindings ?? (bindings.length === 0 ? [] : undefined));
    const label = (confirmed.success ? confirmed.data : bindings).map((b: PromptBinding) => `#${b.index}`).join('、');
    if (!confirmed.success || !planBindingsCoveredBy(bindings, confirmed.data)) return `方案索引 ${label} 素材待同步，请先同步素材到目标`;
    const missing = bindings.filter((b) => !availableIds.includes(b.assetId));
    if (missing.length) return `方案索引 ${missing.map((b) => `#${b.index}`).join('、')} 素材缺失，请恢复连线或修正方案`;
  }
  return undefined;
};

export const pendingPlanSyncsOf = (
  targetId: string | undefined,
  edges: Edge[],
  textNodes: Node[],
): { nodeId: string; title: string; bindings: PromptBinding[] }[] =>
  edges
    .filter((edge) => edge.target === targetId)
    .flatMap((edge) => {
      const node = textNodes.find((n) => n.id === edge.source && n.data.promptSource);
      if (!node) return [];
      const mentions = promptMentionSchema.array().safeParse(node.data.promptMentions ?? []);
      if (!mentions.success || !validPromptMentions(extractTextNodeText(node.data), mentions.data)) return [];
      const bindings = promptBindingList(mentions.data);
      const confirmed = promptBindingsSchema.safeParse((edge.data?.promptReference as { bindings?: unknown } | undefined)?.bindings ?? (bindings.length ? undefined : []));
      return confirmed.success && planBindingsCoveredBy(bindings, confirmed.data)
        ? []
        : [{ nodeId: node.id, title: String(node.data.title || '方案'), bindings }];
    });

export const pickMarkedIdsFor = (
  session: string | boolean | null | undefined,
  active: boolean,
  edges: Edge[],
  textNodes: Node[],
  role?: VideoRefRole,
): string[] => {
  if (!active || typeof session !== 'string') return [];
  const textIds = new Set(textNodes.map((n) => n.id));
  return edges
    .filter((e) => e.target === session && !textIds.has(e.source) && (role === undefined || readRefRole(e) === role))
    .map((e) => e.source);
};

export const complianceBlockedIds = (mediaNodes: Node[]): string[] =>
  mediaNodes
    .filter((n) => ((n.data ?? {}) as Record<string, unknown>).complianceFailed === true)
    .map((n) => n.id);

export const canvasMediaOf = (mediaNodes: Node[]): CanvasPickItem[] =>
  mediaNodes
    .filter((n) => n.data?.src)
    .map((n) => ({
      id: n.id,
      assetId: readAssetId(n.data),
      src: n.data.src as string,
      name: (n.data.fileName as string) || n.id,
      mediaType: (n.data.mediaType as 'image' | 'video' | 'audio') ?? 'image',
    }));

export const atMentionItemsOf = (mediaNodes: Node[], textNodes: Node[]): AtMentionItem[] => {
  const items: AtMentionItem[] = [];
  for (const node of mediaNodes) {
    if (!isConnectableSource(node)) continue;
    const kind = sourceKindOf(node);
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') continue;
    const data = (node.data ?? {}) as Record<string, unknown>;
    items.push({
      id: node.id,
      kind,
      name: typeof data.fileName === 'string' && data.fileName
        ? data.fileName
        : kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频',
      thumbUrl: typeof data.src === 'string' ? data.src : undefined,
      assetId: readAssetId(data),
    });
  }
  for (const node of textNodes) {
    if (!isConnectableSource(node)) continue;
    const data = (node.data ?? {}) as Record<string, unknown>;
    items.push({
      id: node.id,
      kind: 'text',
      name: typeof data.title === 'string' && data.title ? data.title : '文本节点',
      searchText: extractTextNodeText(data),
    });
  }
  return items;
};

export const appliedCardIdsOf = (textNodes: Node[]): Set<string> =>
  new Set(textNodes.flatMap(node => {
    const source = node.data.promptSource as GenerationCardBlock['source'];
    return source ? [`${source.revisionId}#${source.shotNo}`] : [];
  }));

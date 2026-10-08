import { z } from "zod";


export const MEDIA_MENTION_LIMITS = { nodeId: 128, name: 200, url: 2048 } as const;

export const TEXT_INDEX_EDGE_MARKER = "textIndex" as const;

export const mediaMentionSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  nodeId: z.string().min(1).max(MEDIA_MENTION_LIMITS.nodeId),
  assetId: z.string().regex(/^[1-9][0-9]*$/),
}).strict();
export type MediaMention = z.infer<typeof mediaMentionSchema>;

export const mediaRefSchema = z.object({
  nodeId: z.string().min(1).max(MEDIA_MENTION_LIMITS.nodeId),
  assetId: z.string().regex(/^[1-9][0-9]*$/),
  mediaType: z.enum(["image", "video", "audio"]),
  name: z.string().min(1).max(MEDIA_MENTION_LIMITS.name),
  url: z.string().min(1).max(MEDIA_MENTION_LIMITS.url),
}).strict();
export type MediaRef = z.infer<typeof mediaRefSchema>;
export type MediaMentionType = MediaRef["mediaType"];

export const MEDIA_TYPE_LABEL: Record<MediaMentionType, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

export function validMediaMentions(text: string, mentions: MediaMention[]): boolean {
  let end = 0;
  const identities = new Map<string, string>();
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (mention.start < end || mention.end <= mention.start || mention.end > text.length) return false;
    const previous = identities.get(mention.nodeId);
    if (previous && previous !== mention.assetId) return false;
    identities.set(mention.nodeId, mention.assetId);
    end = mention.end;
  }
  return true;
}

export function mediaRefsCoverMentions(mentions: MediaMention[], refs: MediaRef[]): boolean {
  const identities = new Map<string, string>();
  for (const mention of mentions) {
    const previous = identities.get(mention.nodeId);
    if (previous && previous !== mention.assetId) return false;
    identities.set(mention.nodeId, mention.assetId);
  }
  if (refs.length !== identities.size) return false;
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.nodeId) || identities.get(ref.nodeId) !== ref.assetId) return false;
    seen.add(ref.nodeId);
  }
  return true;
}

export function mediaAndPromptMentionsDisjoint(
  media: readonly MediaMention[],
  bindings: ReadonlyArray<Pick<MediaMention, "start" | "end" | "assetId">>,
): boolean {
  const combined = [...media, ...bindings].sort((a, b) => a.start - b.start || a.end - b.end);
  let coveredEnd = 0;
  let coveredKey = "";
  let coveredAssetId = "";
  for (const range of combined) {
    const key = `${range.start}-${range.end}`;
    if (key === coveredKey) {
      if (range.assetId === coveredAssetId) continue;
      return false;
    }
    if (range.start < coveredEnd) return false;
    coveredEnd = range.end;
    coveredKey = key;
    coveredAssetId = range.assetId;
  }
  return true;
}

export function invalidMediaMentionLabel(name: string): string {
  return `已失效：${name}`;
}

export function deriveMediaMentionLabels(
  mentions: MediaMention[],
  refs: MediaRef[],
  isValid: (nodeId: string) => boolean,
): Map<string, string> {
  const refsByNode = new Map(refs.map(ref => [ref.nodeId, ref]));
  const counters: Record<MediaMentionType, number> = { image: 0, video: 0, audio: 0 };
  const labels = new Map<string, string>();
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (labels.has(mention.nodeId)) continue;
    const ref = refsByNode.get(mention.nodeId);
    if (!ref || !isValid(mention.nodeId)) {
      labels.set(mention.nodeId, invalidMediaMentionLabel(ref?.name ?? "未知素材"));
      continue;
    }
    counters[ref.mediaType] += 1;
    labels.set(mention.nodeId, `${MEDIA_TYPE_LABEL[ref.mediaType]}${counters[ref.mediaType]}`);
  }
  return labels;
}

export function imageMentionSendToken(assetId: string): string {
  return `&${assetId}&`;
}

export function replaceImageMentionsWithAssetTokens(
  text: string,
  mentions: readonly MediaMention[],
  isImage: (mention: MediaMention) => boolean,
): string {
  let result = text;
  for (const mention of [...mentions].sort((a, b) => b.start - a.start)) {
    if (!isImage(mention)) continue;
    if (mention.start < 0 || mention.end > result.length || mention.end <= mention.start) continue;
    result = result.slice(0, mention.start) + imageMentionSendToken(mention.assetId) + result.slice(mention.end);
  }
  return result;
}

export function deriveMediaMentionLabelsInOrder(
  identities: Array<Pick<MediaMention, "nodeId" | "assetId">>,
  refs: MediaRef[],
  isValid: (nodeId: string) => boolean,
): Map<string, string> {
  return deriveMediaMentionLabels(
    identities.map((identity, index) => ({ start: index, end: index + 1, nodeId: identity.nodeId, assetId: identity.assetId })),
    refs,
    isValid,
  );
}

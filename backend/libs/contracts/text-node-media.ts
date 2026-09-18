import { z } from "zod";

/* 文本卡正文媒体索引契约 v1（IKFM3Q）：docs/specs/2026-09-14-ikfm3q-text-node-media-index-contract.md
   身份 = (nodeId, assetId) 显式绑定；编号与有效/失效状态全部由（节点, 连线）派生，不持久化；
   mediaRefs 是展示快照且必须精确覆盖 mediaMentions 引用的身份（无隐藏附件列表）。 */

export const MEDIA_MENTION_LIMITS = { nodeId: 128, name: 200, url: 2048 } as const;

/** 关系线标记：有效索引对应的媒体 → 文本卡连线在 edge.data 携带该键（契约 §4）。 */
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

/** 区间不重叠、不越界；同一 nodeId 的全部区间恒同 assetId（身份一致性）。 */
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

/** refs 精确覆盖 mentions 引用的身份：每个身份恰好一条 ref 且 assetId 一致；不允许未被引用的 ref。 */
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

export function invalidMediaMentionLabel(name: string): string {
  return `已失效：${name}`;
}

/** 派生显示标签（契约 §2/§3）：有效标签按正文首次出现顺序、分类型连续编号（同身份复用）；
 *  失效标签显示「已失效：name」。编号不持久化，渲染与序列化共用本函数保证同源。 */
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

/** 提交给模型的图片标签：视觉仍是「图片N」，正文里写成 &素材id& */
export function imageMentionSendToken(assetId: string): string {
  return `&${assetId}&`;
}

/** 把正文里的图片 @ 区间替换为 &素材id&（从后往前改，避免位移） */
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

/** 按给定出现顺序派生显示标签（编辑器 DOM 顺序场景；语义与 deriveMediaMentionLabels 一致）。 */
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

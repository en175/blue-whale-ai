import { z } from "zod";

export const previewSourceSchema = z.object({
  sessionId: z.string().min(1).max(128),
  revisionId: z.string().min(1).max(128),
  shotNo: z.number().int().positive(),
}).strict();
export const applyPreviewSchema = z.object({
  source: previewSourceSchema,
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
}).strict();
export type PromptPreviewSource = z.infer<typeof previewSourceSchema>;

export const promptMentionSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  index: z.number().int().positive(),
  assetId: z.string().regex(/^[1-9][0-9]*$/),
}).strict();
export type PromptMention = z.infer<typeof promptMentionSchema>;
export interface PromptMaterial {
  assetId: string;
  mediaType: "image" | "video" | "audio";
}
export interface PromptPreviewContent {
  title: string;
  text: string;
  promptMentions?: PromptMention[];
  promptMaterials?: PromptMaterial[];
  promptOriginalTitle?: string;
}

/** Positions are editable; identity and the fixed index must remain in the trusted set. */
export function validPromptMentions(text: string, mentions: PromptMention[]): boolean {
  let end = 0;
  const identities = new Map<number, string>();
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (mention.start < end || mention.end <= mention.start || mention.end > text.length) return false;
    const previous = identities.get(mention.index);
    if (previous && previous !== mention.assetId) return false;
    identities.set(mention.index, mention.assetId);
    end = mention.end;
  }
  return true;
}

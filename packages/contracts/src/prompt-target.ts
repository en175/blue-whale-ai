import { z } from "zod";
import { promptMentionSchema, type PromptMention } from "./prompt-preview.js";

export const promptReferenceRequestSchema = z.object({
  planNodeId: z.string().min(1).max(128),
  targetNodeId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  modelId: z.string().min(1).optional(),
}).strict();

export const promptBindingsSchema = z.array(promptMentionSchema.pick({ index: true, assetId: true }));
export type PromptBinding = z.infer<typeof promptBindingsSchema>[number];
export function promptBindingList(mentions: PromptMention[]): PromptBinding[] {
  return [...new Map(mentions.map(m => [m.index, { index: m.index, assetId: m.assetId }])).values()].sort((a, b) => a.index - b.index);
}

export interface PromptInputSources { manual: boolean; planNodeIds: string[] }

export const promptPlanSnapshotSchema = z.object({
  canvasVersion: z.number().int().nonnegative(),
  plans: z.array(z.object({ nodeId: z.string(), text: z.string(), mentions: z.array(promptMentionSchema) })),
  images: z.array(z.object({ assetId: z.string().regex(/^[1-9][0-9]*$/), url: z.string().url() })),
  providerPrompt: z.string().min(1),
});
export type PromptPlanSnapshot = z.infer<typeof promptPlanSnapshotSchema>;

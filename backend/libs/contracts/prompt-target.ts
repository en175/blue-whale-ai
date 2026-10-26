import { z } from "zod";
import { promptMentionSchema, type PromptMention } from "./prompt-preview.js";
import type { CanvasEdge } from "./canvas-edges.js";

export const promptBindingsSchema = z.array(promptMentionSchema.pick({ index: true, assetId: true }));

export type PromptBinding = z.infer<typeof promptBindingsSchema>[number];
export function promptBindingList(mentions: PromptMention[]): PromptBinding[] {
  return [...new Map(mentions.map(m => [m.index, { index: m.index, assetId: m.assetId }])).values()].sort((a, b) => a.index - b.index);
}

export interface PromptInputSources { manual: boolean; planNodeIds: string[] }

export function releaseRemovedPromptSources<T extends CanvasEdge>(before: T[], after: T[]): T[] {
  const removed = before.filter(edge => edge.data?.promptReference !== undefined
    && !after.some(next => next.source === edge.source && next.target === edge.target));
  if (!removed.length) return after;
  return after.flatMap(edge => {
    const sources = edge.data?.inputSources as PromptInputSources | undefined;
    if (!sources || !Array.isArray(sources.planNodeIds)) return [edge];
    const planNodeIds = sources.planNodeIds.filter(id => !removed.some(plan => plan.source === id && plan.target === edge.target));
    if (planNodeIds.length === sources.planNodeIds.length) return [edge];
    if (!sources.manual && !planNodeIds.length) return [];
    return [{ ...edge, data: { ...edge.data, inputSources: { manual: sources.manual, planNodeIds } } }];
  });
}

export const promptPlanSnapshotSchema = z.object({
  canvasVersion: z.number().int().nonnegative(),
  plans: z.array(z.object({ nodeId: z.string(), text: z.string(), mentions: z.array(promptMentionSchema) })),
  images: z.array(z.object({ assetId: z.string().regex(/^[1-9][0-9]*$/), url: z.string().url() })),
  videoReferences: z.array(z.object({
    assetId: z.string().regex(/^[1-9][0-9]*$/).optional(),
    materialId: z.string().min(1).optional(),
    type: z.enum(["image", "video", "audio"]),
    role: z.enum(["reference", "first_frame", "last_frame"]),
    url: z.string().url(),
    providerUrl: z.string().url(),
  }).refine(ref => Boolean(ref.assetId) !== Boolean(ref.materialId), "Exactly one media identity is required")).optional(),
});
export type PromptPlanSnapshot = z.infer<typeof promptPlanSnapshotSchema>;

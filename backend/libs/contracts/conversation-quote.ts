import { z } from "zod";
import { previewSourceSchema } from "./prompt-preview.js";
import { PROMPT_TEXT_LIMITS as limits } from "./prompt-text-limits.js";

export const CONVERSATION_QUOTE_LIST_LIMIT = 100;

export const conversationQuoteCreateSchema = z.object({
  nodeId: z.string().min(1).max(128),
  title: z.string().max(limits.title),
  text: z.string().min(1).max(limits.text),
  source: previewSourceSchema.nullish(),
}).strict();

export type ConversationQuoteCreate = z.infer<typeof conversationQuoteCreateSchema>;

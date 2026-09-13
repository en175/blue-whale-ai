import { z } from "zod";
import { previewSourceSchema } from "./prompt-preview.js";
import { PROMPT_TEXT_LIMITS as limits } from "./prompt-text-limits.js";

/** 对话引用批量回读单次 id 数上限（IKDLQJ）。 */
export const CONVERSATION_QUOTE_LIST_LIMIT = 100;

/** 对话引用快照创建请求（IKDLQJ）：正文为点击「添加到对话」当刻的画布内存正文，服务端只校验形状与限长。 */
export const conversationQuoteCreateSchema = z.object({
  nodeId: z.string().min(1).max(128),
  // 无标题节点（普通文本节点、生成卡）允许空串，不落假标题
  title: z.string().max(limits.title),
  text: z.string().min(1).max(limits.text),
  source: previewSourceSchema.nullish(),
}).strict();

export type ConversationQuoteCreate = z.infer<typeof conversationQuoteCreateSchema>;

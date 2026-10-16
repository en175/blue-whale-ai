import type { SessionContentBlock } from '@/custom/api/agentSessions';
import type { ConversationQuote } from '@/custom/api/canvas';
import { PROMPT_TEXT_LIMITS } from '@lib/contracts/prompt-text-limits';
import { previewSourceSchema, type PromptPreviewSource } from '@lib/contracts/prompt-preview';


export const QUOTE_TEXT_LIMIT = PROMPT_TEXT_LIMITS.text;

export interface QuoteConversationInput {
  nodeId: string;
  title: string;
  text: string;
  source?: PromptPreviewSource | null;
  ts: number;
  extraBlocks?: SessionContentBlock[];
}

export function readPromptSource(value: unknown): PromptPreviewSource | null {
  const parsed = previewSourceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

import { extractTextNodeText as readText } from '@lib/core/text-node-content';
export function extractTextNodeText(data: Record<string, unknown> | undefined): string {
  const text = readText(data);
  return text.trim() ? text : '';
}

export function quoteChipLabel(title: string, text: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  return text.length > 10 ? `${text.slice(0, 10)}…` : text;
}

export function textQuoteBlock(input: {
  nodeId: string;
  chipId: string;
  label: string;
  quote: ConversationQuote;
}): SessionContentBlock {
  return {
    type: 'text',
    name: input.label,
    node_id: input.nodeId,
    source: 'node',
    resource_type: '文本引用',
    chip_id: input.chipId,
    resource_id: input.quote.quoteId,
    quote_id: input.quote.quoteId,
    display_label: input.label,
    resource_text: input.quote.text,
    ...(input.quote.source ? { prompt_source: input.quote.source } : {}),
  };
}

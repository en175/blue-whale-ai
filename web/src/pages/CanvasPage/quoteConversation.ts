import type { SessionContentBlock } from '@/api/agentSessions';
import type { ConversationQuote } from '@/api/canvas';
import { PROMPT_TEXT_LIMITS } from '../../../../packages/contracts/src/prompt-text-limits';
import { previewSourceSchema, type PromptPreviewSource } from '../../../../packages/contracts/src/prompt-preview';

/**
 * 添加到对话的文本引用快照（IKDLQJ，契约 docs/specs/2026-09-07-ikdlqj-conversation-quote-contract.md）。
 *
 * 捕获的是点击当刻的正文与来源，不是旧卡片版本指针；快照由服务端冻结持久化，
 * 引用后继续编辑或删除来源节点都不改写已发送内容。
 */

/** 引用正文上限：与保存侧同一份限长契约（UTF-16 code units）。 */
export const QUOTE_TEXT_LIMIT = PROMPT_TEXT_LIMITS.text;

/** 「添加到对话」捕获输入：正文为点击当刻的画布内存正文；extraBlocks 为生成卡显式挂载的素材引用。 */
export interface QuoteConversationInput {
  nodeId: string;
  title: string;
  text: string;
  source?: PromptPreviewSource | null;
  ts: number;
  extraBlocks?: SessionContentBlock[];
}

/** 读取节点的预览来源（IKDLQE 三件套）；形状不符按无来源处理，不伪造。 */
export function readPromptSource(value: unknown): PromptPreviewSource | null {
  const parsed = previewSourceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 文本节点正文提取：`data.text` 是纯文本权威正文；旧 HTML 节点提取时把换行边界还原为 \n，不吞换行、不压缩连续空行。 */
export function extractTextNodeText(data: Record<string, unknown> | undefined): string {
  const d = data ?? {};
  if (typeof d.text === 'string') return d.text.trim().length > 0 ? d.text : '';
  const html = typeof d.html === 'string' ? d.html : '';
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** 引用胶囊标签：节点标题优先，否则正文前 10 字；不再是整段正文。 */
export function quoteChipLabel(title: string, text: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  return text.length > 10 ? `${text.slice(0, 10)}…` : text;
}

/** 引用块：身份是服务端快照 quoteId（resource_id），正文快照随块走（resource_text）。 */
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

import type { SessionContentBlock, SessionMessage } from '@/custom/api/agentSessions';
import type { ChatMessage } from './useAgentSession';

export const textOf = (blocks: SessionMessage['content'] | undefined): string =>
  (blocks ?? [])
    .map((b) => (b?.type !== 'reasoning' && typeof b?.text === 'string' ? b.text : ''))
    .join('');

function visualLabel(block: SessionContentBlock): string {
  const label = block.display_label || (block.media_type === 'video' ? '视频' : '图片');
  return block.media_type === 'video' && !label.startsWith('[视频]') ? `[视频] ${label}` : label;
}

function isVisualMention(block: SessionContentBlock): boolean {
  if (block.media_type === 'audio' || block.type === 'audio') return false;
  if (block.type === 'text' || block.type === 'card' || block.type === 'thinking' || block.type === 'skill_ref') {
    return false;
  }
  if (block.type === 'asset_ref') return Boolean(block.asset_id);
  if (block.type === 'image' || block.type === 'video') return true;
  if (block.type === 'resource_ref') {
    return block.media_type === 'image' || block.media_type === 'video' || Boolean(block.asset_id);
  }
  return block.media_type === 'image' || block.media_type === 'video';
}

function isQuoteMention(block: SessionContentBlock): boolean {
  return block.type === 'resource_ref' && (block.resource_type === 'text_quote' || Boolean(block.quote_id));
}

function quoteMentionId(block: SessionContentBlock): string | undefined {
  return block.quote_id || block.resource_id || block.node_id;
}

export function chipsFromContent(blocks: SessionContentBlock[] | undefined): ChatMessage['chips'] {
  const chips: NonNullable<ChatMessage['chips']> = [];
  const seen = new Set<string>();
  for (const block of blocks ?? []) {
    if (isQuoteMention(block)) {
      const id = quoteMentionId(block);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      chips.push({ id, label: block.display_label || '文本引用' });
      continue;
    }
    if (!isVisualMention(block)) continue;
    const id = block.asset_id || block.resource_id || block.node_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    chips.push({ id, label: visualLabel(block) });
  }
  return chips.length > 0 ? chips : undefined;
}

export function collectMissingQuoteIds(messages: ChatMessage[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks ?? []) {
      if (!isQuoteMention(block)) continue;
      if (typeof block.resource_text === 'string' && block.resource_text.length > 0) continue;
      const id = quoteMentionId(block);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

export function patchQuoteTexts(
  messages: ChatMessage[],
  quotes: { quoteId: string; text: string }[],
): ChatMessage[] {
  const byId = new Map(quotes.map((quote) => [quote.quoteId, quote.text]));
  if (byId.size === 0) return messages;
  return messages.map((message) => {
    const blocks = message.blocks;
    if (!blocks?.some((block) => isQuoteMention(block) && !block.resource_text && byId.has(quoteMentionId(block) ?? ''))) {
      return message;
    }
    return {
      ...message,
      blocks: blocks.map((block) => {
        if (!isQuoteMention(block) || block.resource_text) return block;
        const text = byId.get(quoteMentionId(block) ?? '');
        return text ? { ...block, resource_text: text } : block;
      }),
    };
  });
}

export function projectMessage(m: SessionMessage): ChatMessage {
  const blocks = m.content ?? [];
  return {
    id: m.message_id,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: textOf(m.content),
    blocks,
    sequence_no: m.sequence,
    inputBatchId: m.input_batch_id ?? null,
    ...(m.source_run_id ? { sourceRunId: m.source_run_id } : {}),
    ...(m.role === 'user' ? { chips: chipsFromContent(blocks) } : {}),
  };
}

export function mergeConfirmedUser(prev: ChatMessage[], msg: SessionMessage): ChatMessage[] {
  const content = textOf(msg.content);
  const idx = prev.findIndex((m) => m.id === msg.message_id);
  if (idx >= 0) return prev;
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i].optimistic && prev[i].role === 'user') {
      const next = [...prev];
      const optimistic = prev[i];
      next[i] = {
        id: msg.message_id,
        role: 'user',
        content,
        sequence_no: msg.sequence,
        inputBatchId: msg.input_batch_id ?? null,
        skill_ref: optimistic.skill_ref,
        resource_ref: optimistic.resource_ref,
        chips: optimistic.chips?.length ? optimistic.chips : chipsFromContent(msg.content),
        blocks:
          optimistic.blocks && optimistic.blocks.length > 0 ? optimistic.blocks : (msg.content ?? []),
      };
      return next;
    }
  }
  return [
    ...prev,
    {
      id: msg.message_id,
      role: 'user' as const,
      content,
      sequence_no: msg.sequence,
      inputBatchId: msg.input_batch_id ?? null,
      blocks: msg.content ?? [],
      chips: chipsFromContent(msg.content),
    },
  ];
}

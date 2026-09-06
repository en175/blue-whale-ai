import type { SessionContentBlock, SessionMessage } from '@/api/agentSessions';
import type { ChatMessage } from './useAgentSession';

/** content 块数组拼为纯文本 */
export const textOf = (blocks: SessionMessage['content'] | undefined): string =>
  (blocks ?? [])
    .map((b) => (typeof b?.text === 'string' ? b.text : ''))
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

/**
 * 从落库的 content 部件还原 @ 提及胶囊。
 *
 * chips 是前端渲染态，快照不会原样送回来；身份在 `asset_ref` / `resource_ref` 里。
 * 不还原的话，刷新或切历史会话后 @ 图片会从对话里消失（IKBCV3）。
 */
export function chipsFromContent(blocks: SessionContentBlock[] | undefined): ChatMessage['chips'] {
  const chips: NonNullable<ChatMessage['chips']> = [];
  const seen = new Set<string>();
  for (const block of blocks ?? []) {
    if (!isVisualMention(block)) continue;
    const id = block.asset_id || block.resource_id || block.node_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    chips.push({ id, label: visualLabel(block) });
  }
  return chips.length > 0 ? chips : undefined;
}

/** 快照消息 → UI 消息 */
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

/**
 * 用服务端回执替换乐观用户气泡，但必须留下本地携带的提及块。
 *
 * 回执的 text 投影不含缩略图；若丢掉 `blocks` / `chips`，发送成功的瞬间图就从对话框消失（IKBCV3）。
 */
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
        // 批次 id 只有回执才有：它是这条消息进哪一轮的依据（IKDK5I）。
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

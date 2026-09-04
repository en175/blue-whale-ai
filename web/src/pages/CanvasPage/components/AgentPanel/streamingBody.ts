/**
 * 把流式正文按工具调用断成有序的片段。
 *
 * 服务端在消息落库时已经这么做过一次（`message-parts.ts` 的 `bodyParts`，IKD79E），但那要等
 * 消息从服务端回来。等待过程中前端拿到的是一整块累积文本，交错要到最后才「啪」地出现——而
 * 「先说一句、再动手、再说一句」恰恰是等待时才有用的东西。
 *
 * 顺序信息其实一直都在：`run.activity` 事件带 `tool` 时，正是正文该断开的时刻，且服务端保证
 * 它排在此前所有 delta 之后。断点记的是**缓冲**长度，而传进来的 `text` 是**已露出**的前缀，
 * 所以还没打到的断点自然不会提前跳出来。
 */
export type StreamingBodyPiece =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; summary: string };

export interface StreamToolCall {
  tool: string;
  summary: string;
  /** 这次调用发生时，累积缓冲里已有的字数。 */
  at: number;
}

export function splitStreamingBody(
  text: string,
  toolCalls: readonly StreamToolCall[],
): StreamingBodyPiece[] {
  if (toolCalls.length === 0) return [{ type: 'text', text }];

  const pieces: StreamingBodyPiece[] = [];
  let cursor = 0;
  for (const call of toolCalls) {
    // 还没打到这里：后面的断点更靠后，一并跳过。
    if (call.at > text.length) break;
    const chunk = text.slice(cursor, call.at);
    if (chunk.trim()) pieces.push({ type: 'text', text: chunk });
    pieces.push({ type: 'tool_call', tool: call.tool, summary: call.summary });
    cursor = call.at;
  }
  const tail = text.slice(cursor);
  if (tail.trim()) pieces.push({ type: 'text', text: tail });

  // 一段正文都没有（比如调用发生在第一个字之前，而后续还没写出来）时，不要返回一个空数组
  // 之外还把原文丢掉——工具行照常显示，正文等它自己长出来。
  return pieces.length > 0 ? pieces : [{ type: 'text', text }];
}

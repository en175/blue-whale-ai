/* ============================================
 * events 公共工具：SSE 响应解析（fetch + ReadableStream）
 * EventSource 不支持自定义请求头（Authorization），统一改用 fetch 读取流
 * 事件块以空行分隔，块内 event:/data:/id: 行解析为 SseEvent
 * ============================================ */

/** SSE 事件（未携带 event: 行时类型默认 message；未携带 id: 时 id 为空串） */
export interface SseEvent {
  /** 事件类型 */
  type: string;
  /** 事件游标（id 行，重连 after 携带） */
  id: string;
  /** data 行 JSON 解析结果，失败时为原始字符串 */
  data: unknown;
}

/**
 * 逐块读取 SSE 响应并派发事件，流正常结束（服务端关闭）时抛错由调用方走重连
 * 请求被 abort 时同样抛 AbortError，调用方按 signal.aborted 判断是否静默
 */
export async function readSseResponse(
  res: Response,
  onEvent: (ev: SseEvent) => void,
): Promise<void> {
  if (!res.body) throw new Error('SSE 响应无流体');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  /** 派发一个完整事件块（event:/data:/id: 行，兼容 \r\n 与多行 data） */
  const dispatch = (block: string) => {
    let type = 'message';
    let id = '';
    const dataLines: string[] = [];
    block.split(/\r?\n/).forEach((line) => {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      else if (line.startsWith('id:')) id = line.slice(3).trim();
    });
    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* 非 JSON data 保留原始字符串 */
    }
    onEvent({ type, id, data });
  };

  // 按空行切分事件块（帧边界兼容 \r\n）；跨 chunk 的半块留在 buffer
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach((b) => {
      if (b.trim()) dispatch(b);
    });
  }
  throw new Error('SSE 流结束');
}

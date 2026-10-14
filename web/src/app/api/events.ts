
export interface SseEvent {
  type: string;
  id: string;
  data: unknown;
}

export async function readSseResponse(
  res: Response,
  onEvent: (ev: SseEvent) => void,
  onActivity?: () => void,
): Promise<void> {
  if (!res.body) throw new Error('SSE 响应无流体');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
    }
    // eslint-disable-next-line no-console
    console.log(`[SSE raw] type=${type} id=${id}`, raw.length > 200 ? raw.slice(0, 200) + '...' : raw);
    // eslint-disable-next-line no-console
    console.log(`[SSE parsed] type=${type}`, data); 
    onEvent({ type, id, data });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity?.();
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach((b) => {
      if (b.trim()) dispatch(b);
    });
  }
  throw new Error('SSE 流结束');
}

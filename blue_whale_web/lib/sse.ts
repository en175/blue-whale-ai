/**
 * sse —— SSE（Server-Sent Events）帧解析。
 *
 * 从 ReadableStream 的 reader 增量读取，按 SSE 帧格式（RFC）切帧：
 * - 帧分隔：空行（\n\n 或 \r\n\r\n）
 * - 字段行：`field: value`，本解析器只关心 `data:`（默认 message 通道）
 * - 多 `data:` 行：同帧内用 \n 拼接成一个事件 data
 * - 注释行：`:` 开头（心跳），忽略
 * - 跨 chunk 断帧：buffer 累积，仅完整帧触发解析
 * - 尾部残帧：流结束时未以空行结束的内容丢弃（SSE 语义：未结束事件不派发）
 *
 * 纯流解析，无网络/鉴权耦合，可单测。供 fetch streaming 版 streamJob 使用。
 */

export type SseReader = ReadableStreamDefaultReader<Uint8Array>;

/** 帧结束：连续两个行结束符（\n\n / \r\n\r\n / \r\r 等）。 */
const FRAME_END = /\r?\n(\r?\n)+/;

/**
 * 持续读取 SSE 流，每收到一个完整事件（data 拼接后）回调 onEvent。
 * reader done（流结束）时返回；reader.read() 抛错（如 abort）时向上抛。
 */
export async function readSseStream(
  reader: SseReader,
  onEvent: (data: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  const flushCompleteFrames = (): void => {
    let match: RegExpMatchArray | null;
    while ((match = buffer.match(FRAME_END))) {
      const frame = buffer.slice(0, match.index!);
      buffer = buffer.slice(match.index! + match[0].length);
      const data = parseFrameData(frame);
      if (data !== null) onEvent(data);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flushCompleteFrames();
  }
  // flush decoder 残留字节到 buffer
  buffer += decoder.decode();
  // 尾部残帧（无空行结束）：SSE 语义不派发，丢弃
}

/**
 * 解析单帧，返回所有 data: 行拼接的字符串（\n 连接）。
 * 无 data 行（纯 event/id/注释）→ 返回 null（不派发）。
 * 冒号后最多去一个前导空格（SSE 规范）。
 */
function parseFrameData(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue; // 注释 / 心跳
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    // 其他 field（event/id/retry）本解析器不处理
  }
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

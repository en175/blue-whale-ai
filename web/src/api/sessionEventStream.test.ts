// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeSessionEvents, type SseEvent } from './agentSessions';

/**
 * IKA2V3：中间层掐流却不给 EOF 时，reader 既不 resolve 也不 reject，
 * 前端仅靠「流结束」回调永远等不到重连，界面停在「处理中」直到用户手动刷新。
 * 这里用一条只发一次事件、随后永久静默的流钉住空闲看门狗的行为。
 */

/** agent 心跳为 15s，看门狗阈值 40s；取 45s 确保跨过阈值 */
const PAST_IDLE_TIMEOUT_MS = 45_000;

function sseChunk(id: string, type: string): Uint8Array {
  return new TextEncoder().encode(`id: ${id}\nevent: ${type}\ndata: {}\n\n`);
}

/** 一条发完首个事件后永久静默的流；abort 时才 error（对齐 fetch 的真实行为） */
function silentStreamResponse(signal: AbortSignal | undefined, firstEventId: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseChunk(firstEventId, 'run.started'));
      signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), {
        once: true,
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** 重连后的流：补发一个事件后继续保持连接（不关闭，避免测试里触发下一轮重连） */
function reconnectedStreamResponse(signal: AbortSignal | undefined, eventId: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseChunk(eventId, 'run.completed'));
      signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), {
        once: true,
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** 让所有已就绪的微任务跑完（流读取是微任务驱动的，单个 await 不够） */
async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('会话事件流空闲看门狗（IKA2V3）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('连接静默超过阈值时自动断开并带游标重连', async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      return urls.length === 1
        ? silentStreamResponse(init?.signal ?? undefined, 'evtcur_1')
        : reconnectedStreamResponse(init?.signal ?? undefined, 'evtcur_2');
    });
    vi.stubGlobal('fetch', fetchMock);

    const seen: SseEvent[] = [];
    const unsubscribe = subscribeSessionEvents('p1', 's1', '', (ev) => seen.push(ev));

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen.map((e) => e.type)).toEqual(['run.started']);

    // 静默跨过看门狗阈值 → 断开当前尝试
    await vi.advanceTimersByTimeAsync(PAST_IDLE_TIMEOUT_MS);
    await flush();
    // 退避重连（基准 1s，收到过数据所以退避已归零，1.5s 足够覆盖抖动）
    await vi.advanceTimersByTimeAsync(1_500);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 重连必须接续游标，否则会重复回放或丢事件
    expect(urls[1]).toContain(`after=${encodeURIComponent('evtcur_1')}`);
    expect(seen.map((e) => e.type)).toEqual(['run.started', 'run.completed']);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(1_000);
  });
});

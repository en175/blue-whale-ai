// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseEvent, SessionSnapshot } from '@/api/agentSessions';
import { useAgentSession } from './useAgentSession';

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchSessionSnapshot: vi.fn(),
  sendSessionMessage: vi.fn(),
  cancelSessionRun: vi.fn(),
  retrySessionRun: vi.fn(),
  fetchRequirementUnderstandings: vi.fn(),
  confirmRequirementUnderstanding: vi.fn(),
  correctRequirementUnderstanding: vi.fn(),
  subscribeSessionEvents: vi.fn(),
}));

vi.mock('@/api/agentSessions', () => mocks);

type HookValue = ReturnType<typeof useAgentSession>;
let latest: HookValue;
let root: Root;
let container: HTMLDivElement;
let eventHandlers: ((event: SseEvent) => void)[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshot(sessionId: string, message: string): SessionSnapshot {
  return {
    session: { session_id: sessionId, phase: 'open' },
    messages: message
      ? [
          {
            message_id: `a-${sessionId}`,
            sequence: 1,
            role: 'assistant',
            content: [{ type: 'text', text: message }],
          },
        ]
      : [],
    event_cursor: `cursor-${sessionId}`,
  };
}

function Harness() {
  latest = useAgentSession('project-1');
  return null;
}

async function renderHookHarness() {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
}

/** 受控动画帧：匀速露出按帧推进，测试要能一帧一帧走，否则只能靠等真实时间。 */
let frames: FrameRequestCallback[];
let clockMs: number;

/** 走 n 帧，每帧推进 16ms。 */
async function runFrames(n: number) {
  for (let i = 0; i < n; i += 1) {
    const pending = frames;
    frames = [];
    if (pending.length === 0) return;
    clockMs += 16;
    await act(async () => {
      for (const frame of pending) frame(clockMs);
    });
  }
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  eventHandlers = [];
  frames = [];
  clockMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
  vi.clearAllMocks();
  mocks.listSessions.mockResolvedValue({ items: [{ session_id: 'session-1' }] });
  mocks.createSession.mockResolvedValue({ session_id: 'created-session' });
  mocks.deleteSession.mockResolvedValue({});
  mocks.sendSessionMessage.mockResolvedValue({});
  mocks.cancelSessionRun.mockResolvedValue({});
  mocks.retrySessionRun.mockResolvedValue({});
  mocks.fetchRequirementUnderstandings.mockResolvedValue({ items: [] });
  mocks.confirmRequirementUnderstanding.mockResolvedValue({});
  mocks.correctRequirementUnderstanding.mockResolvedValue({});
  mocks.subscribeSessionEvents.mockImplementation(
    (_projectId: string, _sessionId: string, _cursor: string, handler: (event: SseEvent) => void) => {
      eventHandlers.push(handler);
      return vi.fn();
    },
  );
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useAgentSession 流式吐字节奏', () => {
  // 模型不是逐字吐的：实测尾部每 ~200ms 到一条 delta、每条约 40 个中文字。
  // 照单渲染就是一句一句往外蹦，所以显示要和接收解耦。
  const sentence = '这是一整句一次到达的中文回复，长度接近实测的一条 delta。';

  async function deliver(text: string) {
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'assistant.delta',
        id: `delta-${text.length}`,
        data: { run_id: 'run-1', payload: { stream_id: 'assistant_run_run-1', text } },
      });
    });
  }

  it('一条 delta 到达时不会整句直接刷出来', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await deliver(sentence);

    expect(latest.streamingText).toBe('');
    await runFrames(1);
    expect(latest.streamingText.length).toBeGreaterThan(0);
    expect(latest.streamingText.length).toBeLessThan(sentence.length);
  });

  it('露出的始终是收到文本的前缀，逐帧变长', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await deliver(sentence);
    const lengths: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      await runFrames(1);
      expect(sentence.startsWith(latest.streamingText)).toBe(true);
      lengths.push(latest.streamingText.length);
    }

    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
    expect(lengths.at(-1)).toBeGreaterThan(lengths[0]!);
  });

  it('最终会追平，一个字都不少', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await deliver(sentence);
    await runFrames(200);

    expect(latest.streamingText).toBe(sentence);
  });

  it('终态固化的是收到的全部文本，不是画面上已经露出的那一段', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await deliver(sentence);
    await runFrames(1);
    // 动画还没播完就到了终态：动画是表现，文本是事实，少存一个字都是丢数据。
    expect(latest.streamingText.length).toBeLessThan(sentence.length);

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.completed',
        id: 'completed-1',
        data: { run_id: 'run-1', payload: { run: { run_id: 'run-1', status: 'completed' } } },
      });
    });

    expect(latest.messages.at(-1)?.content).toBe(sentence);
    expect(latest.streamingText).toBe('');
  });
});

describe('useAgentSession concurrency guards', () => {
  it('discards an old snapshot that resolves after switching sessions', async () => {
    const oldSnapshot = deferred<SessionSnapshot>();
    mocks.fetchSessionSnapshot.mockImplementation((_projectId: string, sessionId: string) =>
      sessionId === 'session-1' ? oldSnapshot.promise : Promise.resolve(snapshot(sessionId, 'new session')),
    );
    await renderHookHarness();
    await vi.waitFor(() => expect(mocks.fetchSessionSnapshot).toHaveBeenCalledWith('project-1', 'session-1'));

    await act(async () => {
      latest.switchSession('session-2');
    });
    await vi.waitFor(() => expect(latest.messages[0]?.content).toBe('new session'));

    await act(async () => {
      oldSnapshot.resolve(snapshot('session-1', 'stale session'));
      await oldSnapshot.promise;
    });

    expect(latest.sessionId).toBe('session-2');
    expect(latest.messages.map((message) => message.content)).toEqual(['new session']);
  });

  it('submits a confirmation only once while the first request is pending', async () => {
    const confirmation = deferred<unknown>();
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'please confirm'));
    mocks.confirmRequirementUnderstanding.mockReturnValue(confirmation.promise);
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'requirement_understanding.proposed.v1',
        id: 'event-1',
        data: {
          payload: {
            understanding: {
              understanding_id: 'understanding-1',
              version: 1,
              proposed_summary: 'summary',
              status: 'awaiting_confirmation',
            },
          },
        },
      });
    });

    act(() => {
      void latest.confirmUnderstanding();
      void latest.confirmUnderstanding();
    });

    expect(mocks.confirmRequirementUnderstanding).toHaveBeenCalledOnce();
    expect(latest.confirmationPending).toBe(true);

    await act(async () => {
      confirmation.resolve({});
      await confirmation.promise;
    });
    expect(latest.confirmationPending).toBe(false);
  });

  it('rejects an empty correction with a visible error', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'please confirm'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'requirement_understanding.proposed.v1',
        id: 'event-1',
        data: {
          payload: {
            understanding: {
              understanding_id: 'understanding-1',
              version: 1,
              proposed_summary: 'summary',
              status: 'awaiting_confirmation',
            },
          },
        },
      });
    });

    await act(async () => {
      await latest.correctUnderstanding('   ');
    });

    expect(mocks.correctRequirementUnderstanding).not.toHaveBeenCalled();
    expect(latest.confirmError).toBe('请输入修改后的需求理解');
  });

  it('uses the message acknowledgement run when SSE state events are delayed', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.sendSessionMessage.mockResolvedValue({ run: { run_id: 'run-from-ack', status: 'queued' } });
    await renderHookHarness();
    await vi.waitFor(() => expect(latest.sessionId).toBe('session-1'));

    await act(async () => {
      expect(await latest.sendMessage('start')).toBe(true);
    });

    expect(latest.runningRunId).toBe('run-from-ack');
  });

  it('does not let an older list response roll back a session.updated title', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    const oldList = deferred<{ items: { session_id: string; title: null }[] }>();
    mocks.listSessions.mockReturnValueOnce(oldList.promise);

    act(() => latest.refreshSessions());
    await vi.waitFor(() => expect(mocks.listSessions).toHaveBeenCalledTimes(2));
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'session.updated',
        id: 'event-title',
        data: { payload: { session: { session_id: 'session-1', title: 'generated title' } } },
      });
    });
    await act(async () => {
      oldList.resolve({ items: [{ session_id: 'session-1', title: null }] });
      await oldList.promise;
    });

    expect(latest.sessions[0]?.title).toBe('generated title');
  });

  it('ignores queued events from the previous session after a switch', async () => {
    mocks.fetchSessionSnapshot.mockImplementation((_projectId: string, sessionId: string) =>
      Promise.resolve(snapshot(sessionId, sessionId)),
    );
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBe(1));
    const oldHandler = eventHandlers[0]!;

    await act(async () => {
      latest.switchSession('session-2');
    });
    await vi.waitFor(() => expect(latest.sessionId).toBe('session-2'));
    await act(async () => {
      oldHandler({
        type: 'assistant.delta',
        id: 'late-old-event',
        data: { run_id: 'old-run', payload: { text: 'stale delta' } },
      });
    });

    expect(latest.streamingText).toBe('');
    expect(latest.runningRunId).toBeNull();
  });

  it('shows payment_required as an actionable blocked state instead of processing', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.payment_required',
        id: 'payment-event',
        data: {
          run_id: 'run-payment',
          payload: {
            run: { run_id: 'run-payment', status: 'payment_required' },
            reason: { code: 'insufficient_balance', message: '余额不足，充值后可继续本次任务。' },
          },
        },
      });
    });

    expect(latest.agentPhase).toBe('payment_required');
    expect(latest.paymentRequiredMessage).toBe('余额不足，充值后可继续本次任务。');
    expect(latest.streaming).toBe(false);
    expect(latest.runningRunId).toBe('run-payment');
  });
});

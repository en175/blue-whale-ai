// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseEvent, SessionSnapshot } from '@/api/agentSessions';
import { ApiError } from '@/api/http';
import { useAgentSession } from './useAgentSession';

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchSessionSnapshot: vi.fn(),
  sendSessionMessage: vi.fn(),
  cancelSession: vi.fn(),
  cancelSessionRun: vi.fn(),
  retrySessionRun: vi.fn(),
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

describe('useAgentSession 思考过程归属', () => {
  async function runTurnWithThinking() {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.activity',
        id: 'a1',
        data: { run_id: 'run-1', payload: { stage: 'preparing_prompt_card', summary: '正在编排分镜与提示词' } },
      });
    });
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'assistant.delta',
        id: 'd1',
        data: { run_id: 'run-1', payload: { stream_id: 'assistant_run_run-1', text: '这是回复正文' } },
      });
    });
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.completed',
        id: 'c1',
        data: { run_id: 'run-1', payload: { run: { run_id: 'run-1', status: 'completed' } } },
      });
    });
  }

  it('模型的思考原文流进思考区，且不混进正文（IKA3M6）', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    for (const [id, text] of [
      ['r1', '先确认画幅——'],
      ['r2', '横版和竖版差别很大'],
    ]) {
      await act(async () => {
        eventHandlers.at(-1)?.({
          type: 'assistant.reasoning.delta',
          id,
          data: { run_id: 'run-1', payload: { stream_id: 'reasoning_run-1', text } },
        });
      });
    }

    // 拼接成一段连续的原文——它是流式吐出来的，不是一条条步骤。
    expect(latest.reasoningText).toBe('先确认画幅——横版和竖版差别很大');
    // 而且没有污染正文：思考不是回答。
    expect(latest.streamingText).toBe('');
    expect(latest.thinkingSteps).toEqual([]);
  });

  it('终态时思考原文随消息一起固化，运行中的思考区清空', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'assistant.reasoning.delta',
        id: 'r1',
        data: { run_id: 'run-1', payload: { stream_id: 'reasoning_run-1', text: '我拿不准要不要问画幅' } },
      });
    });
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'assistant.delta',
        id: 'd1',
        data: { run_id: 'run-1', payload: { stream_id: 'assistant_run_run-1', text: '这张图用在哪儿？' } },
      });
    });
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.completed',
        id: 'c1',
        data: { run_id: 'run-1', payload: { run: { run_id: 'run-1', status: 'completed' } } },
      });
    });

    expect(latest.messages.at(-1)!.blocks).toEqual([
      { type: 'thinking', thinking: { steps: [], reasoning: '我拿不准要不要问画幅' } },
      { type: 'text', text: '这张图用在哪儿？' },
    ]);
    expect(latest.reasoningText).toBe('');
  });

  it('终态时思考固化进那条助手消息、位于正文之前，全局思考区清空', async () => {
    await runTurnWithThinking();

    const message = latest.messages.at(-1)!;
    // 顺序即约定：思考块在正文块之前——思考在回复上方，不在对话末尾。
    expect(message.blocks).toEqual([
      { type: 'thinking', thinking: { steps: ['正在编排分镜与提示词'] } },
      { type: 'text', text: '这是回复正文' },
    ]);
    expect(latest.thinkingSteps).toEqual([]);
  });

  it('终态后到达的最终思考链替换消息内的块，而不是缀到对话末尾', async () => {
    await runTurnWithThinking();

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'reasoning_trace.updated.v1',
        id: 'r1',
        data: {
          run_id: 'run-1',
          payload: { reasoning_trace: { steps: [{ summary: '识别意图：生图' }, { summary: '进入生图工作流' }] } },
        },
      });
    });

    const message = latest.messages.at(-1)!;
    expect(message.blocks?.[0]).toEqual({
      type: 'thinking',
      thinking: { steps: ['识别意图：生图', '进入生图工作流'] },
    });
    // 全局区保持空：最终链属于那条消息，不是悬在对话末尾的公共块。
    expect(latest.thinkingSteps).toEqual([]);
  });

  it('服务端正式消息替换流式气泡时，思考块不被抹掉', async () => {
    await runTurnWithThinking();

    // run.completed 携带的正式 assistant_message：只有 text 块，没有 thinking。
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.completed',
        id: 'c2',
        data: {
          run_id: 'run-1',
          payload: {
            run: { run_id: 'run-1', status: 'completed' },
            assistant_message: {
              message_id: 'msg-server-1',
              session_id: 'session-1',
              sequence: 2,
              role: 'assistant',
              source_run_id: 'run-1',
              content: [{ type: 'text', text: '这是回复正文' }],
            },
          },
        },
      });
    });

    const message = latest.messages.find((m) => m.id === 'msg-server-1')!;
    expect(message.blocks?.[0]?.type).toBe('thinking');
    expect(message.blocks?.some((b) => b.type === 'text')).toBe(true);
  });
});

describe('useAgentSession 产卡逐版预览', () => {
  async function sendPartial(payload: unknown) {
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'prompt_card.partial.v1',
        id: `partial-${JSON.stringify(payload).length}`,
        data: { run_id: 'run-1', payload: { card_id: 'card-1', payload } },
      });
    });
  }

  it('每一版都替换成最新快照，卡看起来在长', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await sendPartial({ overview: '夏日' });
    expect(latest.partialCard).toEqual({ cardId: 'card-1', overview: '夏日', shots: [] });

    await sendPartial({ overview: '夏日海边小镇', shots: [{ title: '全景', prompt_text: 'A warm' }] });
    expect(latest.partialCard).toEqual({
      cardId: 'card-1',
      overview: '夏日海边小镇',
      shots: [{ title: '全景', promptText: 'A warm' }],
    });
  });

  it('终态一到就撤掉，半成品不许留在屏幕上让人以为能用', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    await sendPartial({ overview: '写到一半' });
    expect(latest.partialCard).not.toBeNull();

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.completed',
        id: 'completed-1',
        data: { run_id: 'run-1', payload: { run: { run_id: 'run-1', status: 'completed' } } },
      });
    });

    expect(latest.partialCard).toBeNull();
  });

  it('畸形的半成品不会掀翻事件处理，后面的事件照常到达', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    // 未经校验的模型中间产物：类型全是错的。
    await sendPartial({ overview: { nested: true }, shots: 'not-an-array' });
    expect(latest.partialCard).toBeNull();

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.activity',
        id: 'activity-1',
        data: { run_id: 'run-1', payload: { stage: 'preparing_prompt_card', summary: '正在校验生成卡' } },
      });
    });
    expect(latest.thinkingSteps.at(-1)).toBe('正在校验生成卡');
  });
});

describe('useAgentSession 会话列表更新', () => {
  it('标题更新的会话不在本地列表时补进去，而不是丢掉', async () => {
    // 刚创建的会话往往还没进列表（列表是上一次拉的）。此前用 map，这条更新直接消失，
    // 头部标题会一直停在「新对话」。
    mocks.listSessions.mockResolvedValue({ items: [] });
    mocks.createSession.mockResolvedValue({ session_id: 'session-new' });
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-new', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    expect(latest.sessions).toEqual([]);

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'session.updated',
        id: 'su-1',
        data: {
          payload: { session: { session_id: 'session-new', title: '夏日海边小镇插画' } },
        },
      });
    });

    expect(latest.sessions.map((s) => s.session_id)).toContain('session-new');
    expect(latest.sessions.find((s) => s.session_id === 'session-new')?.title).toBe('夏日海边小镇插画');
  });

  it('已在列表里的会话按字段合并，不丢其他字段', async () => {
    mocks.listSessions.mockResolvedValue({ items: [{ session_id: 'session-1', title: '新对话', phase: 'open' }] });
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(latest.sessions.length).toBe(1));

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'session.updated',
        id: 'su-2',
        data: { payload: { session: { session_id: 'session-1', title: '夏日海边小镇插画' } } },
      });
    });

    const updated = latest.sessions.find((s) => s.session_id === 'session-1')!;
    expect(updated.title).toBe('夏日海边小镇插画');
    expect(updated.phase).toBe('open');
    expect(latest.sessions.length).toBe(1);
  });
});

describe('useAgentSession 会话自举', () => {
  it('初始化失败后再发送会当场补建会话，而不是永远卡在「会话正在初始化」', async () => {
    // 挂载时列表请求失败 → sessionId 留在 null，这正是死胡同的起点。
    mocks.listSessions.mockRejectedValueOnce(new Error('network down'));
    await renderHookHarness();
    await vi.waitFor(() => expect(mocks.listSessions).toHaveBeenCalled());
    expect(latest.sessionId).toBeNull();

    // 网络恢复后用户再发一次：应当自己把会话建起来并把消息发出去。
    mocks.listSessions.mockResolvedValue({ items: [{ session_id: 'session-1' }] });
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    let sent = false;
    await act(async () => {
      sent = await latest.sendMessage('帮我生成一张插画');
    });

    expect(sent).toBe(true);
    expect(latest.sessionId).toBe('session-1');
    expect(mocks.sendSessionMessage).toHaveBeenCalledWith(
      'project-1',
      'session-1',
      '帮我生成一张插画',
      expect.anything(),
    );
    expect(latest.sendError).toBeNull();
  });

  it('补建也失败时给出可操作的提示，并保留输入', async () => {
    mocks.listSessions.mockRejectedValue(new Error('network down'));
    await renderHookHarness();
    await vi.waitFor(() => expect(mocks.listSessions).toHaveBeenCalled());

    let sent = true;
    await act(async () => {
      sent = await latest.sendMessage('帮我生成一张插画');
    });

    expect(sent).toBe(false);
    expect(latest.sendError).toContain('输入内容已保留');
    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
  });

  it('已有会话时不会多建一个', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(latest.sessionId).toBe('session-1'));
    mocks.createSession.mockClear();

    await act(async () => {
      await latest.sendMessage('帮我生成一张插画');
    });

    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe('useAgentSession 运行计时', () => {
  it('提交那一刻就开表，不等 Run 排队、不等模型吐字', async () => {
    const pending = deferred<unknown>();
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.sendSessionMessage.mockReturnValue(pending.promise);
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    expect(latest.turnStartedAt).toBeNull();
    await act(async () => {
      void latest.sendMessage('帮我生成一张插画');
    });

    // 请求还悬着，一个事件都没回来——状态行存在的全部意义就是这段时间也要有秒数。
    expect(latest.turnStartedAt).not.toBeNull();
    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
  });

  // 刷新或切回旧会话时，这一轮早就结束了，不会再有任何事件把起点补回来。而用户回看一个
  // 会话时想知道的恰恰是「上一轮花了多久」，这份账一直躺在快照的 latest_terminal_run 里。
  it('刷新后从快照把上一轮的账立回来，而不是让状态行整条消失', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue({
      ...snapshot('session-1', 'ready'),
      latest_terminal_run: {
        run_id: 'run-done',
        status: 'completed',
        created_at: '2026-08-23T02:00:00.000Z',
        finished_at: '2026-08-23T02:04:11.000Z',
        token_usage: { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 340, reasoning_tokens: 0 },
      },
    });
    await renderHookHarness();
    await vi.waitFor(() => expect(latest.turnStartedAt).not.toBeNull());

    // 起点取 created_at 而不是 started_at：状态行量的是用户等了多久，排队那段也算。
    expect(latest.turnStartedAt).toBe(Date.parse('2026-08-23T02:00:00.000Z'));
    expect(latest.turnOutcome?.outcome).toBe('completed');
    expect(latest.turnOutcome?.finishedAt).toBe(Date.parse('2026-08-23T02:04:11.000Z'));
    expect(latest.turnOutcome?.tokenUsage?.output_tokens).toBe(340);
  });

  // 没有时间就没有耗时。宁可不显示，也不要显示一个算错的数——那比空着更难发现。
  it('快照里的历史轮次没有时间时不显示状态行', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue({
      ...snapshot('session-1', 'ready'),
      latest_terminal_run: { run_id: 'run-old', status: 'completed' },
    });
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    expect(latest.turnStartedAt).toBeNull();
    expect(latest.turnOutcome).toBeNull();
  });

  it('提交失败就停表，不能让计时器对着一个不存在的运行一直走', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.sendSessionMessage.mockRejectedValue(new Error('network down'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await act(async () => {
      await latest.sendMessage('帮我生成一张插画');
    });

    // 请求没发出去，这一轮从未开始，所以是清空而不是报终局——屏幕并不沉默，sendError 在说话。
    expect(latest.turnStartedAt).toBeNull();
    expect(latest.turnOutcome).toBeNull();
    expect(latest.sendError).not.toBeNull();
  });

  /**
   * 回执回来时 Run 已经是终态（幂等命中、或排队即失败）。这一轮确实结束了，但它**发生过**，
   * 所以要按终态报账。此前这里把起点和终局一起清掉，结果是用户发了一句话，屏幕上什么都没有。
   */
  /**
   * IKACCL。停止本轮走会话级取消，所以它在「消息已发出、runId 还没回来」的那几秒也必须能发出去。
   * 此前 stopRun 的守卫要求 runningRef 有值，那几秒里按了没有任何反应。
   */
  it('停止本轮不要求先拿到 runId，发出去就能取消', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    const pending = deferred<unknown>();
    mocks.sendSessionMessage.mockReturnValue(pending.promise);
    mocks.cancelSession.mockResolvedValue({});
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await act(async () => {
      void latest.sendMessage('帮我生成一张插画');
    });
    // 请求还在途中：runId 尚未回来，但用户已经在等了。
    expect(latest.runningRunId).toBeNull();
    expect(latest.streaming).toBe(true);

    await act(async () => {
      latest.stopRun();
    });

    expect(mocks.cancelSession).toHaveBeenCalledWith('project-1', 'session-1');
    expect(mocks.cancelSessionRun).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
  });

  /**
   * 取消失败时不许把界面清成「已停止」。
   *
   * 原来的写法正是这样，于是取消请求打在 404 上的样子和成功一模一样——按钮变回箭头、
   * 界面说停了、后端那一轮照跑。取消路径写错这么久没被发现，就是因为这里替它圆了场。
   */
  it('停止失败时说出来，而不是把界面清成已停止', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.cancelSession.mockRejectedValue(new Error('404 route not found'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await act(async () => {
      eventHandlers.at(-1)?.({
        id: 'e-run-started',
        type: 'run.started',
        data: { run_id: 'run-live', run: { run_id: 'run-live', status: 'running' } },
      } as never);
    });
    expect(latest.runningRunId).toBe('run-live');

    await act(async () => {
      latest.stopRun();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(latest.chatError).toBeTruthy());
    // 权威在事件流：没收到终态就还在跑，本地不能替它宣布停了。
    // （`streaming` 由发送侧置位，run.started 不动它，所以这里看的是 runningRunId。）
    expect(latest.runningRunId).toBe('run-live');
  });

  it('回执直接是终态时报终局，而不是让状态行整条消失', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.sendSessionMessage.mockResolvedValue({ run: { run_id: 'run-already-done', status: 'failed' } });
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await act(async () => {
      await latest.sendMessage('帮我生成一张插画');
    });

    expect(latest.turnStartedAt).not.toBeNull();
    expect(latest.turnOutcome?.outcome).toBe('failed');
    expect(latest.turnOutcome?.finishedAt).toBeGreaterThan(0);
  });

  it('回执直接是 stopped 时算「已取消」，不给用户失败的语气', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.sendSessionMessage.mockResolvedValue({ run: { run_id: 'run-stopped', status: 'stopped' } });
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    await act(async () => {
      await latest.sendMessage('帮我生成一张插画');
    });

    expect(latest.turnOutcome?.outcome).toBe('cancelled');
  });

  /**
   * 终态停表的机制在 IKA4PG 变了。原来靠清空 turnStartedAt，状态行随之消失；现在状态行要
   * 留下来报这一轮的账，起点必须保住，改由 turnOutcome.finishedAt 冻结耗时。
   *
   * 表停没停这件事本身没变，所以这条测试跟着换的是断言的对象，不是断言的意图。
   */
  it('终态停表：保住起点，用终态时刻冻结耗时', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    await act(async () => {
      await latest.sendMessage('帮我生成一张插画');
    });
    expect(latest.turnStartedAt).not.toBeNull();
    expect(latest.turnOutcome).toBeNull();

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.completed',
        id: 'completed-1',
        data: {
          run_id: 'run-1',
          payload: {
            run: {
              run_id: 'run-1',
              status: 'completed',
              token_usage: {
                input_tokens: 30_000,
                cached_input_tokens: 28_500,
                output_tokens: 412,
                reasoning_tokens: null,
              },
              context_capacity: {
                used_input_tokens: 30_000,
                configured_max_tokens: 120_000,
                ratio: 0.25,
                compaction_state: 'none',
              },
            },
          },
        },
      });
    });

    // 起点保留，否则状态行没有基准可算耗时。
    expect(latest.turnStartedAt).not.toBeNull();
    expect(latest.turnOutcome?.outcome).toBe('completed');
    expect(latest.turnOutcome?.finishedAt).toBeGreaterThan(0);
    // 服务端送来的真实用量要能穿过来，状态行才能把流式期间的估算值换掉（IKACDN）。
    expect(latest.turnOutcome?.tokenUsage?.output_tokens).toBe(412);
    expect(latest.turnOutcome?.tokenUsage?.reasoning_tokens).toBeNull();
    expect(latest.turnOutcome?.contextCapacity?.ratio).toBe(0.25);
  });

  it('取消与失败各自记成对应的终局，不都算作完成', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    await act(async () => {
      await latest.sendMessage('帮我生成一张插画');
    });

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.cancelled',
        id: 'cancelled-1',
        data: { run_id: 'run-1', payload: { run: { run_id: 'run-1', status: 'cancelled' } } },
      });
    });
    expect(latest.turnOutcome?.outcome).toBe('cancelled');

    await act(async () => {
      await latest.sendMessage('再来一张');
    });
    // 新一轮开始就把上一轮的账清掉，否则状态行会拿旧结果冒充这一轮。
    expect(latest.turnOutcome).toBeNull();

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.failed',
        id: 'failed-1',
        data: { run_id: 'run-2', payload: { run: { run_id: 'run-2', status: 'failed' } } },
      });
    });
    expect(latest.turnOutcome?.outcome).toBe('failed');
  });

  it('刷新重连时用事件自己的服务端时间，不从零重数', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));

    // 重放的 run.queued 带着它原本的服务端时间：用户已经等了两分钟，不该看到 "0s"。
    const queuedAt = '2026-08-20T15:00:00.000Z';
    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.queued',
        id: 'queued-1',
        data: { run_id: 'run-1', occurred_at: queuedAt, payload: { run: { run_id: 'run-1', status: 'queued' } } },
      });
    });

    expect(latest.turnStartedAt).toBe(Date.parse(queuedAt));
  });

  it('本地已经开过表就不被事件覆盖，提交到排队之间的等待要算进去', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    await act(async () => {
      await latest.sendMessage('帮我生成一张插画');
    });
    const localStart = latest.turnStartedAt;

    await act(async () => {
      eventHandlers.at(-1)?.({
        type: 'run.queued',
        id: 'queued-1',
        data: {
          run_id: 'run-1',
          occurred_at: '2026-08-20T15:00:00.000Z',
          payload: { run: { run_id: 'run-1', status: 'queued' } },
        },
      });
    });

    expect(latest.turnStartedAt).toBe(localStart);
  });
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

  it('surfaces payment_required as an actionable blocked state', async () => {
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

    expect(latest.paymentRequiredMessage).toBe('余额不足，充值后可继续本次任务。');
    expect(latest.streaming).toBe(false);
    expect(latest.runningRunId).toBe('run-payment');
  });
});

/**
 * IKA3TB。生成卡事件是 run.completed 之后才发的加法事件（服务端先 publish 终态，再异步写这条），
 * 实测相差 ~24ms。原实现只在 run.completed 分支里回查、且条件是「revision_committed 已经到过」，
 * 于是实时链路上永远回查不到，卡片要切会话或刷新才出现。
 */
describe('useAgentSession 生成卡水合', () => {
  const cardSnapshot = (): SessionSnapshot => ({
    session: { session_id: 'session-1', phase: 'open' },
    messages: [
      {
        message_id: 'a-1',
        sequence: 1,
        role: 'assistant',
        content: [{ type: 'text', text: '已产卡' }],
        source_run_id: 'run-1',
      },
    ],
    prompt_cards: [
      {
        card_id: 'card-1',
        active_revision: {
          revision_number: 1,
          authoring_run_id: 'run-1',
          payload: {
            overview: '夏日海边小镇',
            shots: [{ shot_no: 1, title: '全景', visual: '午后高光', prompt_text: 'seaside town' }],
          },
        },
      },
    ],
    event_cursor: 'cursor-1',
  } as unknown as SessionSnapshot);

  async function replay(order: 'committed-last' | 'committed-first') {
    // 首次水合（连接会话）时卡片还没提交，只有回查那一次才带卡片——否则挂载时就挂上了，
    // 测试根本走不到回查那条路，去掉修复也照样绿。
    const withCard = cardSnapshot();
    const withoutCard = { ...withCard, prompt_cards: [] } as unknown as SessionSnapshot;
    mocks.fetchSessionSnapshot.mockResolvedValueOnce(withoutCard).mockResolvedValue(withCard);
    await renderHookHarness();
    await vi.waitFor(() => expect(eventHandlers.length).toBeGreaterThan(0));
    const emit = (event: SseEvent) => eventHandlers.at(-1)?.(event);
    const completed: SseEvent = {
      type: 'run.completed',
      data: { run_id: 'run-1', payload: { run: { run_id: 'run-1' } } },
    } as unknown as SseEvent;
    const committed: SseEvent = {
      type: 'prompt_card.revision_committed.v1',
      data: { run_id: 'run-1', payload: { card_id: 'card-1', revision: 1 } },
    } as unknown as SseEvent;
    await act(async () => {
      if (order === 'committed-first') {
        emit(committed);
        emit(completed);
      } else {
        emit(completed);
        emit(committed);
      }
    });
  }

  const cardBlocks = () =>
    latest.messages.flatMap((m) => (m.blocks ?? []).filter((b) => b.type === 'card'));

  it('生成卡事件晚于 run.completed 到达时仍然挂上卡片', async () => {
    await replay('committed-last');
    await vi.waitFor(() => expect(cardBlocks()).toHaveLength(1));
  });

  it('生成卡事件早于 run.completed 到达时同样挂上卡片', async () => {
    await replay('committed-first');
    await vi.waitFor(() => expect(cardBlocks()).toHaveLength(1));
  });
});

/** IKAFQ6：删除失败过去只 console.warn，用户看到的是「点了什么都没发生」。 */
describe('useAgentSession 删除会话', () => {
  it('删除失败时把原因挂到那一行上，不再静默', async () => {
    mocks.listSessions.mockResolvedValue({ items: [{ session_id: 'session-1' }, { session_id: 'session-2' }] });
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.deleteSession.mockRejectedValue(new ApiError(409, '会话正在运行中', 'session_busy'));
    await renderHookHarness();
    await vi.waitFor(() => expect(latest.sessionId).toBe('session-1'));

    await act(async () => {
      latest.deleteSession('session-2');
    });

    await vi.waitFor(() => expect(latest.deleteError).not.toBeNull());
    expect(latest.deleteError).toEqual({ sessionId: 'session-2', message: '删除失败：会话正在运行中' });
    // 会话没被移出列表——它其实还在
    expect(latest.sessions.map((s) => s.session_id)).toContain('session-2');
  });

  it('重试同一行时先清掉上一次的错误，避免旧提示挂着不走', async () => {
    mocks.listSessions.mockResolvedValue({ items: [{ session_id: 'session-1' }, { session_id: 'session-2' }] });
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.deleteSession.mockRejectedValueOnce(new ApiError(500, '上游炸了', 'internal_error'));
    await renderHookHarness();
    await vi.waitFor(() => expect(latest.sessionId).toBe('session-1'));

    await act(async () => {
      latest.deleteSession('session-2');
    });
    await vi.waitFor(() => expect(latest.deleteError?.sessionId).toBe('session-2'));

    mocks.deleteSession.mockResolvedValue({});
    mocks.listSessions.mockResolvedValue({ items: [{ session_id: 'session-1' }] });
    await act(async () => {
      latest.deleteSession('session-2');
    });

    await vi.waitFor(() => expect(latest.deleteError).toBeNull());
    await vi.waitFor(() => expect(latest.sessions.map((s) => s.session_id)).toEqual(['session-1']));
  });

  it('dismissDeleteError 收起提示', async () => {
    mocks.listSessions.mockResolvedValue({ items: [{ session_id: 'session-1' }, { session_id: 'session-2' }] });
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot('session-1', 'ready'));
    mocks.deleteSession.mockRejectedValue(new ApiError(500, 'x', 'internal_error'));
    await renderHookHarness();
    await vi.waitFor(() => expect(latest.sessionId).toBe('session-1'));

    await act(async () => {
      latest.deleteSession('session-2');
    });
    await vi.waitFor(() => expect(latest.deleteError).not.toBeNull());

    await act(async () => {
      latest.dismissDeleteError();
    });
    expect(latest.deleteError).toBeNull();
  });
});

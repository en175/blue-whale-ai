/**
 * 对话面时间线的回归（IKDK5I / IKDK5K / IKDK5L / IKDK5M）。
 *
 * 夹具是 2026-09-06 在测试站录下的一条五轮会话（第一轮带图读素材，其余纯文本），逐条喂给
 * `reduceSessionEvent`，断言 `buildTurns` 的形状。此后改渲染逻辑不必再对着测试站截图。
 */
import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/agent-session-replay-20260906.json';
import type { SessionMessage, SessionRun } from '@/api/agentSessions';
import {
  EMPTY_SESSION_STATE,
  accountOfRun,
  applyLiveEvent,
  buildTurns,
  formatDuration,
  itemsFromBlocks,
  itemsFromLive,
  reduceSessionEvent,
  startLiveRun,
  toolLabel,
  type SessionState,
  type TimelineEvent,
  type TimelineItem,
  type Turn,
} from './sessionTimeline';

const events = fixture.events as TimelineEvent[];
const snapshotMessages = fixture.snapshot_messages as SessionMessage[];

function replay(list: readonly TimelineEvent[], from: SessionState = EMPTY_SESSION_STATE): SessionState {
  return list.reduce((state, ev) => reduceSessionEvent(state, ev, 0), from);
}

function turnsOf(state: SessionState): Turn[] {
  return buildTurns(state.messages, state.live, state.accounts);
}

function itemsOf(turn: Turn, revealed = ''): TimelineItem[] {
  if (turn.assistant) return itemsFromBlocks(turn.assistant.blocks ?? [], turn.assistant.content);
  if (turn.live) return itemsFromLive(turn.live, revealed);
  return [];
}

const kinds = (items: TimelineItem[]) => items.map((i) => i.kind);

/** 事件流里第 n 个满足条件的事件的下标（含），用来把重放停在中途。 */
function indexOf(pred: (ev: TimelineEvent) => boolean, nth = 1): number {
  let seen = 0;
  for (let i = 0; i < events.length; i++) {
    if (pred(events[i]) && ++seen === nth) return i;
  }
  throw new Error('fixture 里没有这条事件');
}

const payloadOf = (ev: TimelineEvent) => (ev.data as { payload: Record<string, unknown> }).payload;

describe('夹具重放：五轮会话', () => {
  const state = replay(events);
  const turns = turnsOf(state);

  it('五轮，每轮一问一答，回答挂在自己的问题下面', () => {
    expect(turns).toHaveLength(5);
    for (const turn of turns) {
      expect(turn.user).toHaveLength(1);
      expect(turn.assistant).not.toBeNull();
      expect(turn.assistant!.inputBatchId).toBe(turn.user[0].inputBatchId);
      expect(turn.live).toBeNull();
    }
    // 与 GET /messages 一致：同一批次的问答成对，顺序同序号。
    const expected = snapshotMessages.filter((m) => m.role === 'user').map((m) => m.input_batch_id);
    expect(turns.map((t) => t.batchId)).toEqual(expected);
    expect(turns.map((t) => t.assistant!.id)).toEqual(
      snapshotMessages.filter((m) => m.role === 'assistant').map((m) => m.message_id),
    );
  });

  it('读图轮：思考 → 短句 → 工具（已完成，两条子步骤）→ 正文', () => {
    const items = itemsOf(turns[0]);
    expect(kinds(items)).toEqual(['reasoning', 'text', 'tool', 'text']);
    expect(items[1]).toEqual({ kind: 'text', text: '我先把这张图读一下。' });
    const tool = items[2];
    if (tool.kind !== 'tool') throw new Error('第三项应是工具行');
    expect(tool.status).toBe('completed');
    expect(tool.summary).toBe('正在读取图片');
    expect(toolLabel(tool.summary, tool.status)).toBe('已读取图片');
    expect(tool.elapsedMs).toBe(10416 - 1956);
    expect(tool.substeps.map((s) => [s.summary, s.status, s.elapsedMs])).toEqual([
      ['正在打开素材文件', 'completed', 2201 - 1959],
      ['正在读取_smoke.jpg（图片 400×400）', 'completed', 10386 - 2216],
    ]);
    // 工具自己的进度不再重复出现在思考块里：同一事实只画一次。
    const reasoning = items[0];
    if (reasoning.kind !== 'reasoning') throw new Error('第一项应是思考');
    expect(reasoning.steps).toEqual(['正在理解创作需求', '正在根据生成结果整理回复']);
    expect(reasoning.reasoning.length).toBeGreaterThan(0);
  });

  it('纯文本轮：思考 → 正文，没有工具行', () => {
    for (const turn of turns.slice(1)) {
      expect(kinds(itemsOf(turn))).toEqual(['reasoning', 'text']);
    }
  });

  it('每轮都有账：完成、有耗时、有真实 token', () => {
    for (const turn of turns) {
      expect(turn.account).not.toBeNull();
      expect(turn.account!.outcome).toBe('completed');
      expect(turn.account!.seconds).toBeGreaterThan(0);
      expect(turn.account!.tokenUsage?.output_tokens).toBeGreaterThan(0);
    }
    expect(turns[0].account!.seconds).toBe(17);
    expect(state.runningRunId).toBeNull();
    expect(state.failedRunId).toBeNull();
  });
});

describe('夹具重放：读图轮进行中的形状', () => {
  const started = indexOf((ev) => ev.type === 'tool.activity' && payloadOf(ev).status === 'started');
  const completed = indexOf((ev) => ev.type === 'tool.activity' && payloadOf(ev).status === 'completed');

  it('工具开始：短句已在，工具行转圈，正文还没有', () => {
    const state = replay(events.slice(0, started + 1));
    const turns = turnsOf(state);
    expect(turns).toHaveLength(1);
    const live = turns[0].live!;
    expect(live.runId).toBe(state.runningRunId);
    expect(live.batchId).toBe(turns[0].user[0].inputBatchId);
    const items = itemsOf(turns[0], live.text);
    expect(kinds(items)).toEqual(['reasoning', 'text', 'tool']);
    const tool = items[2];
    if (tool.kind !== 'tool') throw new Error('应是工具行');
    expect(tool.status).toBe('running');
    expect(tool.startedAt).toBeGreaterThan(0);
    expect(tool.substeps).toEqual([]);
    // 状态行拿到的是最近一个活动。
    expect(live.lastActivity).toBe('正在读取图片');
  });

  it('工具期间报的活动是它的子步骤：上一条结束、这一条开始', () => {
    const secondSubstep = indexOf((ev) => ev.type === 'run.activity' && payloadOf(ev).summary === '正在读取_smoke.jpg（图片 400×400）');
    const state = replay(events.slice(0, secondSubstep + 1));
    const [turn] = turnsOf(state);
    const tool = itemsOf(turn, turn.live!.text)[2];
    if (tool.kind !== 'tool') throw new Error('应是工具行');
    expect(tool.status).toBe('running');
    expect(tool.substeps.map((s) => [s.summary, s.status])).toEqual([
      ['正在打开素材文件', 'completed'],
      ['正在读取_smoke.jpg（图片 400×400）', 'running'],
    ]);
    expect(tool.substeps[0].elapsedMs).toBeGreaterThan(0);
    // 子步骤不进思考块。
    expect(turn.live!.steps).toEqual(['正在理解创作需求']);
    expect(turn.live!.lastActivity).toBe('正在读取_smoke.jpg（图片 400×400）');
  });

  it('工具结束：翻成已完成，带服务端报的耗时，子步骤全部收口', () => {
    const state = replay(events.slice(0, completed + 1));
    const [turn] = turnsOf(state);
    const tool = itemsOf(turn, turn.live!.text)[2];
    if (tool.kind !== 'tool') throw new Error('应是工具行');
    expect(tool.status).toBe('completed');
    expect(tool.elapsedMs).toBe(8460);
    expect(tool.substeps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('打字动画没追上断点时，工具行不提前跳出来', () => {
    const state = replay(events.slice(0, completed + 1));
    const [turn] = turnsOf(state);
    expect(kinds(itemsOf(turn, '我先把'))).toEqual(['reasoning', 'text']);
  });

  it('终态：进行中的那份让位给服务端消息，账记在这一轮上', () => {
    const done = indexOf((ev) => ev.type === 'run.completed');
    const state = replay(events.slice(0, done + 1));
    const [turn] = turnsOf(state);
    expect(turn.live).toBeNull();
    expect(turn.assistant?.sourceRunId).toBe(turn.runId);
    expect(turn.account?.outcome).toBe('completed');
    expect(state.runningRunId).toBeNull();
    // 终态链随后到达：只改思考块里的轮级步骤。
    const traced = reduceSessionEvent(state, events[done + 1], 0);
    expect(events[done + 1].type).toBe('reasoning_trace.updated.v1');
    const items = itemsOf(turnsOf(traced)[0]);
    expect(kinds(items)).toEqual(['reasoning', 'text', 'tool', 'text']);
  });
});

/* ---- 合成事件：夹具里没有的分支 ---- */

const T0 = Date.parse('2026-09-06T06:00:00.000Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function accepted(seq: number, batch: string, runId: string | null, text: string, at = 0): TimelineEvent {
  return {
    type: 'message.accepted',
    data: {
      occurred_at: iso(at),
      run_id: runId,
      payload: {
        message: { message_id: `msg_${seq}`, sequence: seq, role: 'user', content: [{ type: 'text', text }], input_batch_id: batch },
        scheduling: runId ? { state: 'run_created', input_batch_id: batch, run_id: runId } : { state: 'queued_behind_active_run', input_batch_id: batch },
      },
    },
  };
}

function runEvent(type: string, runId: string, batch: string, at: number, extra: Record<string, unknown> = {}): TimelineEvent {
  const status = type.slice('run.'.length);
  const { run: runExtra, ...payloadExtra } = extra;
  return {
    type,
    data: {
      occurred_at: iso(at),
      run_id: runId,
      payload: {
        run: { run_id: runId, input_batch_id: batch, status, created_at: iso(0), finished_at: null, ...(runExtra as object) },
        ...payloadExtra,
      },
    },
  };
}

function activity(runId: string, summary: string, at: number, tool?: string): TimelineEvent {
  return { type: 'run.activity', data: { occurred_at: iso(at), run_id: runId, payload: { stage: 'x', summary, ...(tool ? { tool } : {}) } } };
}

function delta(runId: string, text: string, at: number): TimelineEvent {
  return { type: 'assistant.delta', data: { occurred_at: iso(at), run_id: runId, payload: { stream_id: `assistant_run_${runId}`, text } } };
}

function assistantMessage(seq: number, batch: string, runId: string, text: string): SessionMessage {
  return { message_id: `msg_${seq}`, sequence: seq, role: 'assistant', content: [{ type: 'text', text }], input_batch_id: batch, source_run_id: runId };
}

describe('错位（IKDK5I）：运行中再发一句', () => {
  it('第二句的序号比第一轮的回答小，回答仍然挂在第一句下面', () => {
    const state = replay([
      accepted(1, 'A', 'run1', '第一句'),
      runEvent('run.started', 'run1', 'A', 10),
      delta('run1', '回答一', 500),
      accepted(2, 'B', null, '第二句', 800), // 排在 run1 后面：序号 2 比回答的 3 小
    ]);
    let turns = turnsOf(state);
    expect(turns.map((t) => [t.user.map((u) => u.content), t.assistant?.content ?? null, t.live !== null])).toEqual([
      [['第一句'], null, true],
      [['第二句'], null, false],
    ]);
    const done = reduceSessionEvent(
      state,
      runEvent('run.completed', 'run1', 'A', 2000, { assistant_message: assistantMessage(3, 'A', 'run1', '回答一') }),
      0,
    );
    turns = turnsOf(done);
    expect(turns.map((t) => [t.user[0].content, t.assistant?.content ?? null])).toEqual([
      ['第一句', '回答一'],
      ['第二句', null],
    ]);
    // 第二轮跑起来：它的进行中回答挂在第二句下面，而不是列表最后的全局区。
    const second = replay(
      [runEvent('run.started', 'run2', 'B', 2100), delta('run2', '回答二', 2500)],
      done,
    );
    turns = turnsOf(second);
    expect(turns[1].live?.text).toBe('回答二');
    expect(turns[0].live).toBeNull();
  });

  it('没有批次 id 的老数据退回按顺序配对', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: '问一', sequence_no: 1 },
      { id: 'a1', role: 'assistant' as const, content: '答一', sequence_no: 2 },
      { id: 'u2', role: 'user' as const, content: '问二', sequence_no: 3 },
      { id: 'a2', role: 'assistant' as const, content: '答二', sequence_no: 4 },
    ];
    expect(buildTurns(messages, null, {}).map((t) => [t.user[0].content, t.assistant?.content])).toEqual([
      ['问一', '答一'],
      ['问二', '答二'],
    ]);
  });
});

describe('终态兜底（铁律一）：有开始就有结束', () => {
  const base = [
    accepted(1, 'A', 'run1', '读一下'),
    runEvent('run.started', 'run1', 'A', 10),
    delta('run1', '我先读一下。', 500),
    activity('run1', '正在读取图片', 600, 'read_asset'),
    activity('run1', '正在打开素材文件', 650),
  ];

  it('失败：工具行与子步骤翻成失败，正文丢弃，思考与账留在这一轮', () => {
    const state = replay([
      ...base,
      runEvent('run.failed', 'run1', 'A', 3000, { run: { failure: { code: 'upstream_error', message: '模型调用失败，请重试' } } }),
    ]);
    const [turn] = turnsOf(state);
    expect(turn.assistant).toBeNull();
    expect(turn.live?.ended).toBe(true);
    expect(turn.live?.text).toBe('');
    const [call] = turn.live!.toolCalls;
    expect(call.status).toBe('failed');
    expect(call.substeps[0].endedAt).not.toBeNull();
    expect(turn.account).toMatchObject({ outcome: 'failed', failureText: '模型调用失败，请重试', seconds: 3 });
    expect(state.failedRunId).toBe('run1');
    expect(state.runningRunId).toBeNull();
    // 失败后什么都不画正文：条目只剩思考（没有原话与步骤时连思考也没有）。
    expect(kinds(itemsOf(turn, ''))).toEqual([]);
  });

  it('取消：已流出的字固化成本地回答，形状与服务端一致；服务端消息随后按 run_id 替换', () => {
    const cancelled = replay([...base, runEvent('run.cancelled', 'run1', 'A', 3000)]);
    let [turn] = turnsOf(cancelled);
    expect(turn.live).toBeNull();
    expect(turn.assistant?.id).toBe('as-run1');
    expect(turn.assistant?.inputBatchId).toBe('A');
    const items = itemsOf(turn);
    expect(kinds(items)).toEqual(['text', 'tool']);
    expect(items[0]).toEqual({ kind: 'text', text: '我先读一下。' });
    if (items[1].kind !== 'tool') throw new Error('应是工具行');
    // 取消不是失败也不是完成：还在跑的调用按「已停止」收口。
    expect(items[1].status).toBe('cancelled');
    expect(toolLabel(items[1].summary, items[1].status)).toBe('已停止读取图片');
    expect(items[1].substeps).toHaveLength(1);
    expect(turn.account?.outcome).toBe('cancelled');

    // 服务端为取消落库的正式消息到了：替换本地那份，不出现第二条。
    const replaced = reduceSessionEvent(
      cancelled,
      {
        type: 'run.cancelled',
        data: { occurred_at: iso(3001), run_id: 'run1', payload: { run: { run_id: 'run1', status: 'cancelled' }, assistant_message: assistantMessage(2, 'A', 'run1', '我先读一下。') } },
      },
      0,
    );
    [turn] = turnsOf(replaced);
    expect(replaced.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(turn.assistant?.id).toBe('msg_2');
  });

  it('终态之后迟到的增量不再改动任何东西', () => {
    const state = replay([...base, runEvent('run.completed', 'run1', 'A', 3000)]);
    expect(reduceSessionEvent(state, delta('run1', '迟到的字', 3100), 0)).toBe(state);
    expect(reduceSessionEvent(state, activity('run1', '正在读取图片', 3100, 'read_asset'), 0)).toBe(state);
  });
});

describe('条目投影', () => {
  it('老记录的 tool_call 没有状态字段：消息既然落库了，那次调用就按已完成画', () => {
    const items = itemsFromBlocks(
      [
        { type: 'text', text: '我先看看。' },
        { type: 'tool_call', tool: 'read_asset', summary: '正在读取视频' },
        { type: 'text', text: '看完了。' },
      ],
      '',
    );
    expect(kinds(items)).toEqual(['text', 'tool', 'text']);
    expect(items[1]).toMatchObject({ status: 'completed', elapsedMs: null, substeps: [] });
  });

  it('只有正文的老消息回退成一段正文', () => {
    expect(itemsFromBlocks([], '你好')).toEqual([{ kind: 'text', text: '你好' }]);
  });

  it('思考块为空时不产生思考条目', () => {
    expect(itemsFromBlocks([{ type: 'thinking', thinking: { steps: [] } }, { type: 'text', text: '好' }], '')).toEqual([
      { kind: 'text', text: '好' },
    ]);
  });

  it('被门挡下的调用：已跳过', () => {
    const items = itemsFromBlocks(
      [{ type: 'tool_call', tool: 'workflow-prompt-card-authoring', summary: '正在编排分镜与提示词', status: 'rejected', started_ms: 10, ended_ms: 12 }],
      '',
    );
    if (items[0].kind !== 'tool') throw new Error('应是工具行');
    expect(toolLabel(items[0].summary, items[0].status)).toBe('已跳过编排分镜与提示词');
  });
});

describe('文案', () => {
  it('工具行按状态换时态，不出现「调用」「工具」', () => {
    expect(toolLabel('正在读取图片', 'running')).toBe('正在读取图片');
    expect(toolLabel('正在读取图片', 'completed')).toBe('已读取图片');
    expect(toolLabel('正在读取图片', 'failed')).toBe('读取图片失败');
    expect(toolLabel('正在查阅创作方法', 'rejected')).toBe('已跳过查阅创作方法');
  });

  it('耗时：一秒内保留一位小数，一分钟以上带分', () => {
    // 5 毫秒的 freeze 曾被渲染成「0s」，读起来像没执行（IKCPQ1 D4）。
    expect(formatDuration(5)).toBe('<0.1s');
    expect(formatDuration(49)).toBe('<0.1s');
    expect(formatDuration(50)).toBe('0.1s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(242)).toBe('0.2s');
    expect(formatDuration(8460)).toBe('8.5s');
    expect(formatDuration(10416)).toBe('10s');
    expect(formatDuration(62_000)).toBe('1m 2s');
    expect(formatDuration(120_000)).toBe('2m');
  });
});

describe('applyLiveEvent 的幂等', () => {
  it('同一处重复上报的工具开始只记一条；不相关事件返回同一引用', () => {
    let live = startLiveRun('run1', 'A', T0);
    live = applyLiveEvent(live, activity('run1', '正在读取图片', 100, 'read_asset'), 0);
    const again = applyLiveEvent(live, { type: 'tool.activity', data: { occurred_at: iso(101), run_id: 'run1', payload: { tool: 'read_asset', status: 'started', summary: '正在读取图片' } } }, 0);
    expect(again.toolCalls).toHaveLength(1);
    expect(applyLiveEvent(again, { type: 'session.updated', data: {} }, 0)).toBe(again);
  });

  it('没有开始的结束没有地方可挂：丢弃', () => {
    const live = startLiveRun('run1', 'A', T0);
    const next = applyLiveEvent(live, { type: 'tool.activity', data: { payload: { tool: 'read_asset', status: 'completed', summary: '正在读取图片', elapsed_ms: 5 } } }, 0);
    expect(next).toBe(live);
  });
});

describe('账', () => {
  it('失败后刷新：没有回答也没有进行中的 Run，账按批次找回来', () => {
    const run: SessionRun = {
      run_id: 'run9',
      input_batch_id: 'Z',
      status: 'failed',
      created_at: iso(0),
      finished_at: iso(4000),
      failure: { code: 'x', message: '余额不足' },
    };
    const state = reduceSessionEvent(
      EMPTY_SESSION_STATE,
      { type: 'run.failed', data: { occurred_at: iso(4000), run_id: 'run9', payload: { run } } },
      0,
    );
    const turns = buildTurns([{ id: 'u', role: 'user', content: '问', sequence_no: 1, inputBatchId: 'Z' }], null, state.accounts);
    expect(turns[0].account).toMatchObject({ outcome: 'failed', seconds: 4, failureText: '余额不足' });
    expect(turns[0].runId).toBe('run9');
  });
});

// IKEV0V：聊天里改卡没改成时，那一轮是 completed，失败只写在 prompt_card_failure 里。
describe('accountOfRun · prompt_card_failure', () => {
  const run = {
    run_id: 'r1',
    status: 'completed',
    created_at: '2026-09-11T00:00:00.000Z',
    finished_at: '2026-09-11T00:00:05.000Z',
    prompt_card_failure: { code: 'invalid_prompt_card', message: '这次没能写出生成卡，请重试或补充需求。' },
  };

  it('完成的轮带着改卡失败的那句话', () => {
    expect(accountOfRun(run)?.cardFailureText).toBe('这次没能写出生成卡，请重试或补充需求。');
  });

  it('失败的轮不看它：整轮失败有自己的说明', () => {
    expect(accountOfRun({ ...run, status: 'failed' })?.cardFailureText).toBeNull();
  });

  it('没有改卡失败就是 null', () => {
    expect(accountOfRun({ ...run, prompt_card_failure: null })?.cardFailureText).toBeNull();
  });
});

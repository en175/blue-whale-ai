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
  phasesOf,
  processItemElapsedMs,
  reduceSessionEvent,
  showsTurnFooter,
  startLiveRun,
  toolLabel,
  type SessionState,
  type TimelineEvent,
  type ProcessItem,
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
    // 思考落在它发生的位置，是一段 thought；轮级步骤不再画成顶上的「思考过程」块（IKFLB9）。
    expect(kinds(items)).toEqual(['thought', 'text', 'tool']);
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
    expect(kinds(itemsOf(turn, '我先把'))).toEqual(['thought', 'text']);
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

  /**
   * IKHV7G 本地真机：上游过载重试用尽，run 落 failed，对话里「都按推荐来」下面一片空——没有失败那句话，
   * 也没有「重新回答」，只剩状态行「上一轮未完成」；刷新之后两样才出现。失败的轮为了留思考与工具行
   * 回看，`live` 保留着（ended），而轮尾那一行的条件是「没有 live」，于是实时画面里永远不给。
   */
  it('失败的轮实时就给轮尾那一行，不必等刷新', () => {
    const state = replay([
      ...base,
      runEvent('run.failed', 'run1', 'A', 3000, {
        run: { failure: { code: 'upstream_unavailable', message: '模型服务暂时不可用，请稍后重试。', retryable: true } },
      }),
    ]);
    const [turn] = turnsOf(state);
    expect(turn.live?.ended).toBe(true);
    expect(showsTurnFooter(turn)).toBe(true);
  });

  it('还在跑的轮不给轮尾：账还没结', () => {
    const [turn] = turnsOf(replay(base));
    expect(showsTurnFooter(turn)).toBe(false);
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

function reasoningDelta(runId: string, text: string, at: number): TimelineEvent {
  return { type: 'assistant.reasoning.delta', data: { occurred_at: iso(at), run_id: runId, payload: { stream_id: `reasoning_${runId}`, text } } };
}

describe('思考段与等待行（IKFLB9）', () => {
  it('进行中：每一段思考落在它发生的位置，被正文或工具行打断就结束、记下时长', () => {
    let live = startLiveRun('run1', 'A', T0);
    for (const ev of [
      reasoningDelta('run1', '先看图。', 100),
      reasoningDelta('run1', '再想构图。', 1_100),
      delta('run1', '我先读一下。', 2_000),
      activity('run1', '正在读取图片', 2_100, 'read_asset'),
      { type: 'tool.activity', data: { occurred_at: iso(2_300), run_id: 'run1', payload: { tool: 'read_asset', status: 'completed', summary: '正在读取图片', elapsed_ms: 200 } } },
      reasoningDelta('run1', '图里是一只猫。', 5_000),
    ]) {
      live = applyLiveEvent(live, ev, 0);
    }

    const items = itemsFromLive(live, live.text);
    expect(kinds(items)).toEqual(['thought', 'text', 'tool', 'thought']);
    expect(items[0]).toMatchObject({ kind: 'thought', text: '先看图。再想构图。', running: false, elapsedMs: 1_900 });
    expect(items[3]).toMatchObject({ kind: 'thought', text: '图里是一只猫。', running: true, elapsedMs: null });
  });

  it('本地固化的消息与服务端同形：思考段按顺序成块，思考过程块里不再带原话', () => {
    const state = replay([
      runEvent('run.started', 'run1', 'A', 0),
      reasoningDelta('run1', '想。', 100),
      delta('run1', '好。', 1_000),
      runEvent('run.cancelled', 'run1', 'A', 2_000),
    ]);
    const blocks = state.messages.find((m) => m.sourceRunId === 'run1')?.blocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['reasoning', 'text']);
    expect(blocks[0]).toMatchObject({ text: '想。', started_ms: 100, ended_ms: 1_000 });
  });

  it('落库消息：思考段与等待行按顺序画，一秒以内的等待不画，顶上的思考过程块不再画', () => {
    const items = itemsFromBlocks(
      [
        { type: 'thinking', thinking: { steps: ['正在理解创作需求'] } },
        { type: 'reasoning', text: '先想构图。', started_ms: 0, ended_ms: 57_600 },
        { type: 'tool_call', tool: 'skill_read', summary: '正在查阅对应的创作方法', status: 'ok', started_ms: 57_600, ended_ms: 57_604, calls: 3 },
        { type: 'waiting', summary: '正在根据生成结果整理回复', started_ms: 57_604, ended_ms: 57_900 },
        { type: 'reasoning', text: '', started_ms: 57_900, ended_ms: 60_000 },
        { type: 'waiting', summary: '正在根据生成结果整理回复', started_ms: 60_000, ended_ms: 62_100 },
        { type: 'text', text: '卡写好了。' },
      ],
      '卡写好了。',
    );

    expect(kinds(items)).toEqual(['thought', 'tool', 'thought', 'waiting', 'text']);
    expect(items[1]).toMatchObject({ kind: 'tool', calls: 3 });
    expect(items[2]).toMatchObject({ kind: 'thought', text: '', elapsedMs: 2_100 });
    expect(items[3]).toEqual({ kind: 'waiting', summary: '正在根据生成结果整理回复', elapsedMs: 2_100 });
  });

  it('老记录没有思考段：思考过程块照旧画，原话还在里面', () => {
    const items = itemsFromBlocks(
      [{ type: 'thinking', thinking: { steps: ['正在理解创作需求'], reasoning: '老的原话' } }, { type: 'text', text: '好' }],
      '好',
    );
    expect(items[0]).toMatchObject({ kind: 'reasoning', reasoning: '老的原话' });
  });
});

describe('过程按阶段分组（IKFLB9 定稿）', () => {
  const thought = (elapsedMs: number, text = '想'): ProcessItem => ({ kind: 'thought', text, running: false, startedAt: null, elapsedMs });
  const waiting = (summary: string, elapsedMs: number): ProcessItem => ({ kind: 'waiting', summary, elapsedMs });
  const tool = (summary: string, elapsedMs: number): ProcessItem => ({ kind: 'tool', tool: 't', summary, status: 'completed', startedAt: null, elapsedMs, substeps: [], calls: 1 });

  it('工具行自成一段，名字是它做的事；两头连续的思考与等待各合成一段', () => {
    const phases = phasesOf([
      waiting('正在等待模型响应', 9_800),
      thought(5_200),
      waiting('正在等待模型响应', 4_100),
      tool('正在查阅对应的创作方法', 30),
      thought(2_500),
    ]);
    expect(phases.map((p) => p.name)).toEqual(['理解需求', '查阅对应的创作方法', '整理回复']);
    expect(phases.map((p) => p.items.length)).toEqual([3, 1, 1]);
    expect(phases.map((p) => p.items.reduce((acc, i) => acc + processItemElapsedMs(i, 0), 0))).toEqual([19_100, 30, 2_500]);
  });

  it('段里有带名字的等待就用它命名：那是服务端在那段时间打的标记', () => {
    const phases = phasesOf([
      waiting('正在取出这次要用的创作方法', 2_900),
      thought(8_400),
      tool('正在查阅对应的创作方法', 300),
      waiting('正在根据生成结果整理回复', 2_000),
      thought(36_700),
      tool('正在写分镜与提示词', 2_200),
      waiting('正在根据生成结果整理回复', 2_300),
    ]);
    expect(phases.map((p) => p.name)).toEqual(['取出这次要用的创作方法', '查阅对应的创作方法', '根据生成结果整理回复', '写分镜与提示词', '根据生成结果整理回复']);
  });

  it('进行中的思考按现在现算', () => {
    const running: ProcessItem = { kind: 'thought', text: '', running: true, startedAt: 1_000, elapsedMs: null };
    expect(processItemElapsedMs(running, 4_500)).toBe(3_500);
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

  it('卡没写出来时按码查能不能重试：模型写错了能，素材不可用、没定媒介不能', () => {
    expect(accountOfRun(run)?.cardFailureRetryable).toBe(true);
    for (const code of ['asset_binding_unavailable', 'target_media_unresolved']) {
      expect(accountOfRun({ ...run, prompt_card_failure: { code, message: '…' } })?.cardFailureRetryable).toBe(false);
    }
  });
});

/**
 * 方案卡（IKF3KE）。
 *
 * 此前前端**故意**不为需求理解渲染任何东西（IKAI14 拆掉了旧 UI，确认由模型在对话里判断）。
 * 确认权回到用户手里之后，它必须有数据、有位置：没有可点的东西，首卡就永远出不来。
 */
describe('方案卡的事件与归位', () => {
  const version = (n: number, status: 'awaiting_confirmation' | 'accepted' | 'superseded', runId = 'run-1') => ({
    understanding_id: 'und_1',
    version: n,
    session_id: 's1',
    proposed_by_run_id: runId,
    target_media: 'video' as const,
    proposed_summary: `第 ${n} 版`,
    status,
  });

  const event = (type: string, understanding: ReturnType<typeof version>) =>
    ({ type, data: { payload: { understanding } } }) as never;

  it('提出：落进状态，等着用户点', () => {
    const next = reduceSessionEvent(EMPTY_SESSION_STATE, event('requirement_understanding.proposed.v1', version(1, 'awaiting_confirmation')));
    expect(next.understandings).toHaveLength(1);
    expect(next.understandings[0].status).toBe('awaiting_confirmation');
  });

  it('接纳：就地更新同一版，不再多出一张卡', () => {
    const proposed = reduceSessionEvent(EMPTY_SESSION_STATE, event('requirement_understanding.proposed.v1', version(1, 'awaiting_confirmation')));
    const accepted = reduceSessionEvent(proposed, event('requirement_understanding.accepted.v1', version(1, 'accepted')));
    expect(accepted.understandings).toHaveLength(1);
    expect(accepted.understandings[0].status).toBe('accepted');
  });

  it('作废：同上，那一版留着但不再等人点', () => {
    const proposed = reduceSessionEvent(EMPTY_SESSION_STATE, event('requirement_understanding.proposed.v1', version(1, 'awaiting_confirmation')));
    const voided = reduceSessionEvent(proposed, event('requirement_understanding.voided.v1', version(1, 'superseded')));
    expect(voided.understandings[0].status).toBe('superseded');
  });

  it('重提一版：上一版不再是待确认——同时最多一张卡在等人点', () => {
    const first = reduceSessionEvent(EMPTY_SESSION_STATE, event('requirement_understanding.proposed.v1', version(1, 'awaiting_confirmation')));
    const second = reduceSessionEvent(first, event('requirement_understanding.proposed.v1', version(2, 'awaiting_confirmation')));
    expect(second.understandings.map((u) => u.status)).toEqual(['superseded', 'awaiting_confirmation']);
  });

  it('挂回提出它的那一轮，而不是统统堆在最后', () => {
    const messages = [
      { id: 'm1', role: 'user', content: '做条短视频', sequence_no: 1, inputBatchId: 'b1' },
      { id: 'm2', role: 'assistant', content: '你看一下方案', sequence_no: 2, inputBatchId: 'b1', sourceRunId: 'run-1' },
      { id: 'm3', role: 'user', content: '确认方案卡', sequence_no: 3, inputBatchId: 'b2' },
      { id: 'm4', role: 'assistant', content: '卡写好了', sequence_no: 4, inputBatchId: 'b2', sourceRunId: 'run-2' },
    ] as never;
    const turns = buildTurns(messages, null, {}, [version(1, 'accepted', 'run-1')]);
    expect(turns).toHaveLength(2);
    expect(turns[0].solutionCards.map((u) => u.version)).toEqual([1]);
    expect(turns[1].solutionCards).toEqual([]);
  });
});

function rewind(runId: string, keepChars: number, at: number, fromDeltaIndex = 0): TimelineEvent {
  return {
    type: 'assistant.rewind.v1',
    data: {
      occurred_at: iso(at),
      run_id: runId,
      payload: {
        stream_id: `assistant_${runId}`,
        keep_chars: keepChars,
        from_delta_index: fromDeltaIndex,
        reason: 'transport_resumed',
      },
    },
  };
}

/**
 * 断线续跑把已经上屏的半句话收回来（IKHCJ2 3c）。
 *
 * Agent 到模型网关的连接断掉时，服务端从上一个步骤边界接着跑。断掉的那一步如果已经说出口
 * 半句话，模型重说时不会一字不差——不擦掉旧的，用户看到的就是「半句话 + 另一个开头」。
 *
 * 这一组用例盯两件事：擦得干净，以及**擦得幂等**。SSE 是至少一次投递，重连重放会把同一条
 * 擦除指令再放一遍；正因为它带的是绝对长度而不是增量，重放才不会多砍一刀。
 */
describe('断线续跑的擦除（IKHCJ2）', () => {
  it('把正文截回边界，后面重说的话接在截口上', () => {
    let live = startLiveRun('run1', 'A', T0);
    for (const ev of [
      delta('run1', '这条片子', 100),
      delta('run1', '我先从画面节奏', 200),
      rewind('run1', 4, 300),
      delta('run1', '我想先定调性。', 400),
    ]) {
      live = applyLiveEvent(live, ev, 0);
    }
    expect(live.text).toBe('这条片子我想先定调性。');
  });

  it('同一条擦除指令到两次，结果一样——它带的是绝对长度，不是增量', () => {
    let live = startLiveRun('run1', 'A', T0);
    for (const ev of [delta('run1', '这条片子我先从画面', 100), rewind('run1', 4, 200), rewind('run1', 4, 210)]) {
      live = applyLiveEvent(live, ev, 0);
    }
    expect(live.text).toBe('这条片子');
  });

  /** 连断两次：第二条擦除指令要连第一次重说的话一起擦掉，所以两条的 keep_chars 相同。 */
  it('连断两次：每次都擦回同一个边界', () => {
    let live = startLiveRun('run1', 'A', T0);
    for (const ev of [
      delta('run1', '这条片子', 100),
      delta('run1', '第一次说的', 200),
      rewind('run1', 4, 300),
      delta('run1', '第二次说的', 400),
      rewind('run1', 4, 500),
      delta('run1', '第三次说的。', 600),
    ]) {
      live = applyLiveEvent(live, ev, 0);
    }
    expect(live.text).toBe('这条片子第三次说的。');
  });

  it('思考不擦：模型重想一遍的代价远小于整轮失败，思考区里留着断线前那一段', () => {
    let live = startLiveRun('run1', 'A', T0);
    for (const ev of [
      reasoningDelta('run1', '先确认画幅。', 100),
      delta('run1', '我先从画面', 200),
      rewind('run1', 0, 300),
    ]) {
      live = applyLiveEvent(live, ev, 0);
    }
    expect(live.text).toBe('');
    expect(live.reasonings.map((r) => r.text)).toEqual(['先确认画幅。']);
  });

  /**
   * 工具行与思考段用正文偏移挂在正文上。擦掉一段正文之后，挂在截口之外的条目会指向一个不
   * 存在的位置——那会让它们在时间线上排到正文后面去，或者干脆排不出来。
   */
  it('挂在被擦掉那段上的工具行跟着回到截口，不会指向不存在的位置', () => {
    let live = startLiveRun('run1', 'A', T0);
    for (const ev of [
      delta('run1', '这条片子', 100),
      delta('run1', '我先查一下方法。', 200),
      activity('run1', '正在查阅对应的创作方法', 300, 'skill_read'),
      rewind('run1', 4, 400),
    ]) {
      live = applyLiveEvent(live, ev, 0);
    }
    expect(live.text).toBe('这条片子');
    expect(live.toolCalls.every((c) => c.at <= live.text.length)).toBe(true);
  });

  it('要保留的比现有的还多：当没这回事——迟到的擦除指令不该凭空造出字来', () => {
    let live = startLiveRun('run1', 'A', T0);
    live = applyLiveEvent(live, delta('run1', '这条片子', 100), 0);
    const before = live;
    live = applyLiveEvent(live, rewind('run1', 99, 200), 0);
    expect(live).toBe(before);
  });

  it('跑完了就不再接擦除指令——终态那条正式消息已经是退回之后的', () => {
    let live = startLiveRun('run1', 'A', T0);
    live = applyLiveEvent(live, delta('run1', '这条片子', 100), 0);
    live = { ...live, ended: true };
    expect(applyLiveEvent(live, rewind('run1', 0, 200), 0).text).toBe('这条片子');
  });
});

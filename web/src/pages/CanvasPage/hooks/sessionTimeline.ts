/**
 * 对话面的时间线模型（IKDK5I / IKDK5K / IKDK5L）。
 *
 * 屏幕上只有一种东西：**轮**。一轮 = 一批用户输入 + 回答它的那个 Run + 这个 Run 按发生顺序
 * 产出的条目。历史轮由快照里的消息投影出来，进行中的轮由事件流增量拼出来，渲染函数不区分
 * 两者——这正是「实时块不再是列表尾部的全局区」的意思。
 *
 * 此前的三个 bug 都是同一个根：消息按序号平铺，思考块与流式正文固定挂在整个列表之后。
 * 运行中再发一句话，它的序号比正在生成的回答小，于是回答落到了它下面（错位一格）；工具行
 * 只有「开始」没有「结束」，于是永远进行时；模板句、原话、工具进度全塞进一个块，于是分不清
 * 谁在想、谁在做。
 *
 * 这个文件是纯函数：不碰 React、不碰网络，事件进、状态出。夹具回归（IKDK5M）就是把测试站
 * 录下的事件逐条喂进来，断言 `buildTurns` 的形状。
 */
import type {
  AskedQuestion,
  GenerationCardBlock,
  RequirementUnderstanding,
  SessionContentBlock,
  SessionMessage,
  SessionRun,
} from '@/api/agentSessions';
import { mergeConfirmedUser as mergeUserMessage, textOf } from './userMessageProjection';
import type { PartialCardPreview } from './partialCardPreview';
import { toPartialCardPreview } from './partialCardPreview';
import {
  parseRunContextCapacity,
  parseRunTokenUsage,
  type RunContextCapacity,
  type RunOutcome,
  type RunTokenUsage,
} from './runStatusLine';
import type { ChatMessage } from './useAgentSession';

/* ============ Run 状态 → 终局 ============ */

/**
 * Run 状态这一个字符串域的唯一分类表。
 *
 * 三个来源写法各不相同：事件流按事件名给（`run.cancelled`），发送回执与快照按 `run.status`
 * 给（`cancelled`）。全部落到这一张表，加一种终态只改这里。
 *
 * `stopped` 归入「已取消」：那是用户自己按的停止，不该看到失败的语气。
 * `outcome_unknown` 归入失败：对用户而言「不知道」和「失败」一样需要重试。
 */
const RUN_STATUS_OUTCOME: Readonly<Record<string, RunOutcome>> = {
  completed: 'completed',
  succeeded: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  stopped: 'cancelled',
  failed: 'failed',
  outcome_unknown: 'failed',
};

/** 这个状态是否已经是终态。表里有就是终态——表本身就是终态清单。 */
export function isTerminalStatus(status: string): boolean {
  return Object.hasOwn(RUN_STATUS_OUTCOME, status);
}

/** run 状态 → 终局。表外的状态一律按失败处理：认不出的终态和「不知道」一样需要重试入口。 */
export function terminalOutcomeOf(status: string): RunOutcome {
  return RUN_STATUS_OUTCOME[status] ?? 'failed';
}

/** ISO 时间 → 毫秒时间戳；缺失或不可解析返回 null。 */
export function msOf(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/* ============ 进行中的一轮 ============ */

/**
 * 一次工具调用的状态。`running` 是唯一的非终态；服务端契约里的 ok 在这里叫 completed。
 * `cancelled` 只在本地出现：用户按停止时还在跑的调用——既没完成也不是失败。
 */
export type ToolStatus = 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled';

export interface LiveSubstep {
  summary: string;
  startedAt: number;
  endedAt: number | null;
}

export interface LiveToolCall {
  /** 与思考段共用的到达序号：两者按它排先后（IKFLB9）。 */
  seq: number;
  tool: string;
  /** 服务端模板句，进行时态（「正在读取图片」）。展示时按状态换时态，见 {@link toolLabel}。 */
  summary: string;
  /** 这次调用发生时正文缓冲里已有的字数：正文在这里断开。 */
  at: number;
  status: ToolStatus;
  startedAt: number;
  endedAt: number | null;
  /** 服务端报的耗时；没有就用起止时刻差。 */
  elapsedMs: number | null;
  /** 调用期间报的子步骤（读素材的「打开素材文件」「读取 xxx」）。 */
  substeps: LiveSubstep[];
}

/**
 * 进行中的一段思考（IKFLB9）。思考不再是整轮一块、固定排在最前：模型「想 → 说 → 调工具 → 再想」，
 * 每一段想都落在它发生的位置上。`at` 是它开始时正文缓冲里已有的字数，正文在这里断开。
 */
export interface LiveReasoning {
  seq: number;
  at: number;
  text: string;
  startedAt: number;
  endedAt: number | null;
}

/**
 * 进行中的那一轮。所有增量都落在这里：思考原话、活动步骤、工具调用、正文缓冲、半成品卡。
 *
 * `text` 是收到的**全部**正文，是事实来源；画面上露出多少由打字动画决定，不在这里。
 */
export interface LiveRun {
  runId: string;
  /** 这个 Run 回答的输入批次。有它才能把进行中的回答挂到自己的问题下面。 */
  batchId: string | null;
  startedAt: number;
  /** 轮级步骤：不在任何工具调用期间报的活动（「正在理解创作需求」）。 */
  steps: string[];
  /** 最近一个活动节点，不分级别。输入框上方的状态行用它。 */
  lastActivity: string | null;
  /** 按发生顺序的各段思考。 */
  reasonings: LiveReasoning[];
  text: string;
  toolCalls: LiveToolCall[];
  /** 下一个思考段或工具行的到达序号。 */
  seq: number;
  partialCard: PartialCardPreview | null;
  /** 终态之后仍留在屏幕上（失败、计费门）：不再接收增量，工具全部收口。 */
  ended: boolean;
}

export function startLiveRun(runId: string, batchId: string | null, startedAt: number): LiveRun {
  return {
    runId,
    batchId,
    startedAt,
    steps: [],
    lastActivity: null,
    reasonings: [],
    text: '',
    toolCalls: [],
    seq: 0,
    partialCard: null,
    ended: false,
  };
}

/** 事件流里的一条（`SseEvent` 的 type + 解析后的 data）。 */
export interface TimelineEvent {
  type: string;
  data: unknown;
}

function envelope(ev: TimelineEvent): { data: Record<string, unknown>; payload: Record<string, unknown>; at: number | null } {
  const data = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
  const payload = (data.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<string, unknown>;
  return { data, payload, at: msOf(data.occurred_at) };
}

/**
 * 事件里的 run_id。信封上的 `run_id` 是权威；流式事件另在 `payload.stream_id` 里带一份
 * （`assistant_<run_id>` / `reasoning_<run_id>`，run_id 自己以 `run_` 开头，所以看起来是
 * `assistant_run_…`），只在信封缺失时才从它剥。此前按 `assistant_run_` 剥会把 run_id 的前缀
 * 一起剥掉，于是流式事件与 run.started 认不出是同一个 Run。
 */
export function runIdOf(ev: TimelineEvent): string {
  const { data, payload } = envelope(ev);
  const run = payload.run as Record<string, unknown> | undefined;
  const direct = str(run?.run_id ?? data.run_id);
  if (direct) return direct;
  const streamId = str(payload.stream_id);
  for (const prefix of ['assistant_', 'reasoning_']) {
    if (streamId.startsWith(prefix)) return streamId.slice(prefix.length);
  }
  return '';
}

function lastRunning(live: LiveRun): LiveToolCall | null {
  const last = live.toolCalls[live.toolCalls.length - 1];
  return last && last.status === 'running' ? last : null;
}

function replaceLast<T>(list: readonly T[], next: T): T[] {
  return [...list.slice(0, -1), next];
}

/** 还开着的那段思考到此结束：正文或工具行来了，模型不在想了。 */
function endReasoning(reasonings: readonly LiveReasoning[], when: number): LiveReasoning[] {
  const last = reasonings[reasonings.length - 1];
  return last && last.endedAt === null ? replaceLast(reasonings, { ...last, endedAt: when }) : [...reasonings];
}

/** 一个步骤不该同时出现在两处：进了工具行的子步骤，就不再进思考块。 */
function isToolFact(live: Pick<LiveRun, 'toolCalls'>, summary: string): boolean {
  return live.toolCalls.some((c) => c.summary === summary || c.substeps.some((s) => s.summary === summary));
}

/**
 * 把一条事件合进进行中的那一轮。返回同一个引用表示这条事件与它无关。
 *
 * 不处理 Run 的开始与终态：那两件事牵涉消息列表与账本，由调用方（hook）编排，
 * 这里只管一轮之内的增量。
 */
export function applyLiveEvent(live: LiveRun, ev: TimelineEvent, now: number = Date.now()): LiveRun {
  const { payload, at } = envelope(ev);
  const when = at ?? now;
  const t = ev.type;

  if (t === 'reasoning_trace.updated.v1') {
    // 终态权威链，run.completed 之后到达——所以它是唯一一条**结束之后**还要接的增量。
    // 只接管轮级步骤那一半：工具行与子步骤已经有自己的终态，原话只来自 delta。
    const trace = (payload.reasoning_trace ?? {}) as { steps?: unknown };
    if (!Array.isArray(trace.steps)) return live;
    const steps = trace.steps
      .map((s) => (typeof s === 'string' ? s : str((s as { summary?: unknown })?.summary)))
      .filter((s) => s && !isToolFact(live, s));
    return { ...live, steps };
  }

  if (live.ended) return live;

  if (t === 'run.activity') {
    const summary = str(payload.summary);
    if (!summary) return live;
    const tool = str(payload.tool);
    const next: LiveRun = { ...live, lastActivity: summary };
    if (tool) {
      // 带 `tool` 的活动是一次可见的工具调用：正文在这里断开，一条工具行从这里开始。
      // 同一处重复上报不再记一条——落库那一路的段落合并也是这个规则。
      const last = lastRunning(live);
      if (last && last.tool === tool && last.at === live.text.length) return next;
      next.toolCalls = [
        ...live.toolCalls,
        { seq: live.seq, tool, summary, at: live.text.length, status: 'running', startedAt: when, endedAt: null, elapsedMs: null, substeps: [] },
      ];
      next.reasonings = endReasoning(live.reasonings, when);
      next.seq = live.seq + 1;
      return next;
    }
    const running = lastRunning(live);
    if (running) {
      // 工具调用期间报的活动是它的子步骤：上一条子步骤到此结束，这一条开始。
      const substeps = running.substeps.map((s, i) =>
        i === running.substeps.length - 1 && s.endedAt === null ? { ...s, endedAt: when } : s,
      );
      if (substeps[substeps.length - 1]?.summary === summary) return next;
      next.toolCalls = replaceLast(live.toolCalls, {
        ...running,
        substeps: [...substeps, { summary, startedAt: when, endedAt: null }],
      });
      return next;
    }
    if (live.steps[live.steps.length - 1] === summary) return next;
    next.steps = [...live.steps, summary];
    return next;
  }

  if (t === 'tool.activity') {
    const tool = str(payload.tool);
    const status = str(payload.status);
    const summary = str(payload.summary);
    if (!tool) return live;
    if (status === 'started') {
      // 通常紧跟在带 tool 的 run.activity 之后，那一行已经开了；没开（老服务端不发 activity）就在这里开。
      const last = lastRunning(live);
      if (last && last.tool === tool) return live;
      return {
        ...live,
        toolCalls: [
          ...live.toolCalls,
          { seq: live.seq, tool, summary: summary || tool, at: live.text.length, status: 'running', startedAt: when, endedAt: null, elapsedMs: null, substeps: [] },
        ],
        reasonings: endReasoning(live.reasonings, when),
        seq: live.seq + 1,
      };
    }
    const terminal: ToolStatus | null =
      status === 'completed' || status === 'ok' ? 'completed' : status === 'failed' ? 'failed' : status === 'rejected' ? 'rejected' : null;
    if (!terminal) return live;
    // 关掉最近一条还在跑的同名调用。找不到就丢弃：一条没有开始的结束没有地方可挂。
    for (let i = live.toolCalls.length - 1; i >= 0; i--) {
      const call = live.toolCalls[i];
      if (call.tool !== tool || call.status !== 'running') continue;
      const elapsed = typeof payload.elapsed_ms === 'number' && Number.isFinite(payload.elapsed_ms) ? payload.elapsed_ms : null;
      const toolCalls = [...live.toolCalls];
      toolCalls[i] = {
        ...call,
        status: terminal,
        endedAt: when,
        elapsedMs: elapsed,
        substeps: call.substeps.map((s) => (s.endedAt === null ? { ...s, endedAt: when } : s)),
      };
      return { ...live, toolCalls };
    }
    return live;
  }

  if (t === 'assistant.delta') {
    const text = str(payload.text);
    return text ? { ...live, text: live.text + text, reasonings: endReasoning(live.reasonings, when) } : live;
  }

  /**
   * 断线续跑：把已经上屏的正文截回第 `keep_chars` 个字（IKHCJ2）。
   *
   * Agent 到模型网关的连接断掉时，服务端从上一个步骤边界接着跑。断掉的那一步如果已经说出口
   * 半句话，模型重说时不会一字不差——不擦掉旧的，用户看到的就是「半句话 + 另一个开头」。
   *
   * **它带的是绝对长度，所以重复执行是安全的**：SSE 至少一次投递，重连重放会把同一条指令
   * 再放一遍，而「截到第 N 个字」放几遍都是同一个结果。
   *
   * 思考不擦：模型重想一遍的代价远小于整轮失败，那一段留在思考区里。这是服务端知情的取舍，
   * 不是这里漏了。
   */
  if (t === 'assistant.rewind.v1') {
    const keep = typeof payload.keep_chars === 'number' ? payload.keep_chars : null;
    // 要保留的比现有的还多，就当没这回事：一条迟到的指令不该凭空造出字来，也不该改任何东西。
    if (keep === null || keep < 0 || keep >= live.text.length) return live;
    return {
      ...live,
      text: live.text.slice(0, keep),
      // 工具行与思考段用正文偏移挂在正文上。挂在截口之外的跟着回到截口，否则它们会指向一个
      // 不存在的位置，在时间线上排到正文后面去。
      toolCalls: live.toolCalls.map((c) => (c.at > keep ? { ...c, at: keep } : c)),
      reasonings: live.reasonings.map((r) => (r.at > keep ? { ...r, at: keep } : r)),
    };
  }

  if (t === 'assistant.reasoning.delta') {
    const chunk = str(payload.text);
    if (!chunk) return live;
    const last = live.reasonings[live.reasonings.length - 1];
    if (last && last.endedAt === null) {
      return { ...live, reasonings: replaceLast(live.reasonings, { ...last, text: last.text + chunk }) };
    }
    return {
      ...live,
      reasonings: [...live.reasonings, { seq: live.seq, at: live.text.length, text: chunk, startedAt: when, endedAt: null }],
      seq: live.seq + 1,
    };
  }

  if (t === 'prompt_card.partial.v1') {
    const preview = toPartialCardPreview(payload.card_id, payload.payload);
    return preview ? { ...live, partialCard: preview } : live;
  }

  return live;
}

/**
 * Run 到了终态：所有还在跑的条目都要收口（铁律一：有开始就有结束）。
 * 服务端保证成对发，这里是兜底，不是常态。
 */
export function closeLiveRun(live: LiveRun, outcome: RunOutcome, endedAt: number): LiveRun {
  const forced: ToolStatus = outcome;
  const toolCalls = live.toolCalls.map((c) =>
    c.status === 'running'
      ? { ...c, status: forced, endedAt, substeps: c.substeps.map((s) => (s.endedAt === null ? { ...s, endedAt } : s)) }
      : c,
  );
  return { ...live, toolCalls, reasonings: endReasoning(live.reasonings, endedAt), partialCard: null, ended: true };
}

/** 工具行与思考段按到达顺序排好（IKFLB9）：正文在每一个断点处切开。 */
type LiveBreak = { kind: 'tool'; call: LiveToolCall } | { kind: 'reasoning'; reasoning: LiveReasoning };

function liveBreaks(live: LiveRun): LiveBreak[] {
  return [
    ...live.toolCalls.map((call): LiveBreak => ({ kind: 'tool', call })),
    ...live.reasonings.map((reasoning): LiveBreak => ({ kind: 'reasoning', reasoning })),
  ].sort((a, b) => (a.kind === 'tool' ? a.call.seq : a.reasoning.seq) - (b.kind === 'tool' ? b.call.seq : b.reasoning.seq));
}

const breakAt = (item: LiveBreak): number => (item.kind === 'tool' ? item.call.at : item.reasoning.at);

/* ============ 进行中的一轮 → 消息部件（本地固化） ============ */

/**
 * 把进行中的一轮固化成与服务端同形的消息部件：思考块在前，正文按工具调用断开。
 *
 * 服务端的正式消息随终态事件一起到，几乎总会立刻替换掉这一份；它存在的意义是取消的那一路
 * （用户按了停止，已经流出的字不该消失）以及服务端消息迟到的那几十毫秒里屏幕不跳。
 * 形状与服务端一致，渲染函数才能只认一种输入。
 */
export function blocksFromLive(live: LiveRun): SessionContentBlock[] {
  const blocks: SessionContentBlock[] = [];
  if (live.steps.length > 0) blocks.push({ type: 'thinking', thinking: { steps: live.steps } });
  let cursor = 0;
  for (const item of liveBreaks(live)) {
    const chunk = live.text.slice(cursor, breakAt(item));
    if (chunk.trim()) blocks.push({ type: 'text', text: chunk });
    cursor = Math.max(cursor, breakAt(item));
    if (item.kind === 'reasoning') {
      const { reasoning } = item;
      blocks.push({
        type: 'reasoning',
        text: reasoning.text,
        started_ms: reasoning.startedAt - live.startedAt,
        ended_ms: (reasoning.endedAt ?? reasoning.startedAt) - live.startedAt,
      });
      continue;
    }
    const { call } = item;
    blocks.push({
      type: 'tool_call',
      tool: call.tool,
      summary: call.summary,
      status: call.status === 'completed' || call.status === 'running' ? 'ok' : call.status,
      started_ms: call.startedAt - live.startedAt,
      ended_ms: call.endedAt === null ? null : call.endedAt - live.startedAt,
      substeps: call.substeps.map((s, i) => ({
        id: `local:${i}`,
        summary: s.summary,
        started_ms: s.startedAt - live.startedAt,
        ended_ms: s.endedAt === null ? null : s.endedAt - live.startedAt,
      })),
    });
  }
  const tail = live.text.slice(cursor);
  if (tail.trim()) blocks.push({ type: 'text', text: tail });
  return blocks;
}

/* ============ 条目 ============ */

export interface TimelineSubstep {
  summary: string;
  status: ToolStatus;
  elapsedMs: number | null;
}

/**
 * 一轮里的条目。`reasoning`（轮级步骤与老记录整块的思考）、`thought`（它在想的一段）、`tool`（它在做）、
 * `waiting`（两段之间它在等什么）、`text`（它在说）、`card`（它交付了）。
 * 「思考 → 短句 → 工具 → 等待 → 思考 → 短句」是这个数组按顺序渲染的自然结果，不需要为交替感单独写逻辑。
 */
export type TimelineItem =
  | { kind: 'reasoning'; steps: string[]; reasoning: string; live: boolean }
  | {
      /** 模型的一段思考，落在它发生的位置（IKFLB9）。 */
      kind: 'thought';
      text: string;
      running: boolean;
      /** 进行中用它读秒；结束后用 elapsedMs。 */
      startedAt: number | null;
      elapsedMs: number | null;
    }
  | {
      kind: 'tool';
      tool: string;
      summary: string;
      status: ToolStatus;
      /** 进行中用它读秒；结束后用 elapsedMs。 */
      startedAt: number | null;
      elapsedMs: number | null;
      substeps: TimelineSubstep[];
      /** 并发合成这一行的调用次数；一次时为 1。 */
      calls: number;
    }
  | {
      /** 两段之间没有输出的时间（IKFLB9），只在落库之后才有。 */
      kind: 'waiting';
      summary: string;
      elapsedMs: number;
    }
  | { kind: 'text'; text: string; questions?: AskedQuestion[] }
  | { kind: 'card'; card: GenerationCardBlock }
  | { kind: 'card_preview'; preview: PartialCardPreview };

function toolStatusOfPart(status: unknown, endedMs: unknown): ToolStatus {
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return status;
  // 老记录没有状态字段：消息既然已经落库，那次调用早就结束了。
  if (status === 'ok' || status === undefined) return endedMs === null ? 'running' : 'completed';
  return 'completed';
}

function elapsedOf(started: unknown, ended: unknown): number | null {
  if (typeof started !== 'number' || typeof ended !== 'number') return null;
  return Math.max(0, ended - started);
}

/**
 * 落库消息的部件 → 条目。
 *
 * 思考块里与工具行重复的步骤（工具自己的摘要、它的子步骤）不再出现在思考里——同一事实只画一次。
 */
/**
 * 短于它的等待不画：一两百毫秒的调度间隔画成一行只是噪音。服务端早已把 300ms 以内的缝并进相邻的段，
 * 能落到这里的等待至少那么长；一秒以内的仍然不值得占一行。
 */
export const MIN_VISIBLE_WAITING_MS = 1000;

export function itemsFromBlocks(blocks: readonly SessionContentBlock[], fallbackText: string): TimelineItem[] {
  const toolFacts = new Set<string>();
  for (const b of blocks) {
    if (b.type !== 'tool_call') continue;
    if (b.summary) toolFacts.add(b.summary);
    for (const s of b.substeps ?? []) toolFacts.add(s.summary);
  }
  const items: TimelineItem[] = [];
  // 有了按顺序的思考段与等待行（IKFLB9），顶上那块「思考过程」就不再画：它剩下的只有轮级模板句
  // （「识别意图」「正在理解创作需求」），而那段时间已经由等待行和各段自己说清楚了。老记录没有
  // 这两种段，照旧画——那些轮的思考原话只在那一块里。
  const timed = blocks.some((b) => b.type === 'reasoning' || b.type === 'waiting');
  for (const b of blocks) {
    if (b.type === 'thinking') {
      if (timed) continue;
      const steps = (b.thinking?.steps ?? []).filter((s) => s && !toolFacts.has(s));
      const reasoning = b.thinking?.reasoning ?? '';
      if (steps.length > 0 || reasoning) items.push({ kind: 'reasoning', steps, reasoning, live: false });
      continue;
    }
    if (b.type === 'reasoning') {
      items.push({ kind: 'thought', text: b.text ?? '', running: false, startedAt: null, elapsedMs: elapsedOf(b.started_ms, b.ended_ms) });
      continue;
    }
    if (b.type === 'waiting' && b.summary) {
      const elapsed = elapsedOf(b.started_ms, b.ended_ms) ?? 0;
      if (elapsed >= MIN_VISIBLE_WAITING_MS) items.push({ kind: 'waiting', summary: b.summary, elapsedMs: elapsed });
      continue;
    }
    if (b.type === 'tool_call' && b.summary) {
      const status = toolStatusOfPart(b.status, b.ended_ms);
      items.push({
        kind: 'tool',
        tool: b.tool ?? '',
        summary: b.summary,
        status,
        startedAt: null,
        elapsedMs: elapsedOf(b.started_ms, b.ended_ms),
        substeps: (b.substeps ?? []).map((s) => ({
          summary: s.summary,
          status: s.ended_ms === null ? status : 'completed',
          elapsedMs: elapsedOf(s.started_ms, s.ended_ms),
        })),
        calls: b.calls ?? 1,
      });
      continue;
    }
    if (b.type === 'card' && b.card) {
      items.push({ kind: 'card', card: b.card });
      continue;
    }
    if (b.type === 'text' && b.text) items.push({ kind: 'text', text: b.text, ...(b.questions?.length ? { questions: b.questions } : {}) });
    // run_actions 不再渲染（IKCPQ1）：它是同一次调用的另一份落库视图，工具行已经画过了。
  }
  if (items.length === 0 && fallbackText) items.push({ kind: 'text', text: fallbackText });
  return items;
}

/**
 * 进行中的一轮 → 条目。`revealedText` 是打字动画已露出的前缀：断点记的是缓冲长度，
 * 所以还没打到的工具行不会提前跳出来。
 */
export function itemsFromLive(live: LiveRun, revealedText: string): TimelineItem[] {
  // 进行中不再画「思考过程」块（IKFLB9）：在想的时候就是一段思考，在等的时候输入框上方的状态行
  // 说着在等什么（`lastActivity`）。轮级步骤仍然收着——老服务端的轮次落库时只有它。
  const items: TimelineItem[] = [];
  let cursor = 0;
  for (const item of liveBreaks(live)) {
    const at = breakAt(item);
    if (at > revealedText.length) break;
    const chunk = revealedText.slice(cursor, at);
    if (chunk.trim()) items.push({ kind: 'text', text: chunk });
    cursor = Math.max(cursor, at);
    if (item.kind === 'reasoning') {
      const { reasoning } = item;
      items.push({
        kind: 'thought',
        text: reasoning.text,
        running: reasoning.endedAt === null && !live.ended,
        startedAt: reasoning.startedAt,
        elapsedMs: reasoning.endedAt === null ? null : reasoning.endedAt - reasoning.startedAt,
      });
      continue;
    }
    const { call } = item;
    items.push({
      kind: 'tool',
      tool: call.tool,
      summary: call.summary,
      status: call.status,
      startedAt: call.startedAt,
      elapsedMs: call.elapsedMs ?? (call.endedAt === null ? null : call.endedAt - call.startedAt),
      substeps: call.substeps.map((s) => ({
        summary: s.summary,
        status: s.endedAt === null ? 'running' : 'completed',
        elapsedMs: s.endedAt === null ? null : s.endedAt - s.startedAt,
      })),
      calls: 1,
    });
  }
  const tail = revealedText.slice(cursor);
  if (tail.trim()) items.push({ kind: 'text', text: tail });
  if (live.partialCard) items.push({ kind: 'card_preview', preview: live.partialCard });
  return items;
}

/* ============ 过程组（IKFLB9 定稿） ============ */

/**
 * 条目里属于「过程」的那几种：思考、工具、等待，以及老记录整块的思考。正文与卡不在其中——但**写正文的那段时间**
 * 在（`writing`）：一轮 27s 里模型把回复一个字一个字打出来花了 7s，这 7s 不在任何思考、工具、等待段里，
 * 不记上头上「已处理 27s」就和里面各段加不起来（项目 607 第一轮）。落库的正文部件不带时刻，所以它是用
 * 这一轮的总时长减去其余各段算出来的，只在落库之后有。
 */
export type TimelineProcessItem = Extract<TimelineItem, { kind: 'reasoning' | 'thought' | 'tool' | 'waiting' }>;
export type ProcessItem = TimelineProcessItem | { kind: 'writing'; elapsedMs: number };

/** 短于它的差额不单独成一段：那是几百毫秒的调度间隔，不是在写回复。 */
export const MIN_WRITING_MS = 500;

/**
 * 头上的总时长减去各段之和，剩下的就是写回复的时间（加上零星几百毫秒的调度缝）。
 * 没有总时长（还在跑）或差额太小就不补。
 */
export function withWriting(items: readonly ProcessItem[], totalMs: number | null): ProcessItem[] {
  if (totalMs === null) return [...items];
  const summed = items.reduce((acc, item) => acc + processItemElapsedMs(item, 0), 0);
  const rest = totalMs - summed;
  if (rest < MIN_WRITING_MS) return [...items];
  return [...items, { kind: 'writing', elapsedMs: rest }];
}

export function isProcessItem(item: TimelineItem): item is TimelineProcessItem {
  return item.kind === 'reasoning' || item.kind === 'thought' || item.kind === 'tool' || item.kind === 'waiting';
}

/**
 * 一轮的过程按「阶段」分组。用户读到的是「它做了几件事」，不是十几行碎片。
 *
 * 分法：每个工具行自成一个阶段，名字就是它做的事（「查阅对应的创作方法」）；工具行之间连续的思考、等待
 * 合成一个阶段，名字取其中第一条有名字的等待（「取出这次要用的创作方法」「整理创作方案」——那是服务端在
 * 那段时间打的标记）；一条都没有时，第一段叫「理解需求」，后面的叫「整理回复」。
 */
export interface ProcessPhase {
  name: string;
  items: ProcessItem[];
}

const DEFAULT_WAITING_SUMMARY = '正在等待模型响应';

export function phasesOf(items: readonly ProcessItem[]): ProcessPhase[] {
  const phases: ProcessPhase[] = [];
  let open: ProcessPhase | null = null;
  let nonToolCount = 0;
  for (const item of items) {
    if (item.kind === 'tool') {
      phases.push({ name: stripProgressive(item.summary), items: [item] });
      open = null;
      continue;
    }
    if (item.kind === 'writing') {
      phases.push({ name: '写回复', items: [item] });
      open = null;
      continue;
    }
    if (!open) {
      open = { name: nonToolCount === 0 ? '理解需求' : '整理回复', items: [] };
      nonToolCount += 1;
      phases.push(open);
    }
    if (item.kind === 'waiting' && item.summary !== DEFAULT_WAITING_SUMMARY && open.items.every((i) => i.kind !== 'waiting' || i.summary === DEFAULT_WAITING_SUMMARY)) {
      open.name = stripProgressive(item.summary);
    }
    open.items.push(item);
  }
  return phases;
}

/** 一条过程条目还在跑吗。 */
export function processItemRunning(item: ProcessItem): boolean {
  if (item.kind === 'writing') return false;
  if (item.kind === 'thought') return item.running;
  if (item.kind === 'tool') return item.status === 'running';
  if (item.kind === 'reasoning') return item.live;
  return false;
}

/**
 * 一条过程条目的耗时，进行中的按 `now` 现算。老记录整块的思考没有时长，算 0。
 * 落库的段落首尾相接（服务端补过缝），所以把它们加起来就是这一段过程的总长。
 */
export function processItemElapsedMs(item: ProcessItem, now: number): number {
  if (item.kind === 'reasoning') return 0;
  if (item.kind === 'waiting' || item.kind === 'writing') return item.elapsedMs;
  if (item.elapsedMs !== null) return item.elapsedMs;
  if (item.startedAt !== null && processItemRunning(item)) return Math.max(0, now - item.startedAt);
  return 0;
}

/* ============ 文案 ============ */

/** 「正在读取图片」→ 「读取图片」。模板句都以「正在」开头；不以它开头的原样返回。 */
function stripProgressive(summary: string): string {
  return summary.startsWith('正在') ? summary.slice(2) : summary;
}

/**
 * 工具行的文案随状态换时态：正在读取图片 → 已读取图片 / 读取图片失败 / 已跳过读取图片。
 *
 * 刻意不出现「调用」「工具」和工具名：用户关心的是做了什么事，不是用什么机制做的。
 */
export function toolLabel(summary: string, status: ToolStatus): string {
  const base = stripProgressive(summary);
  switch (status) {
    case 'running':
      return summary;
    case 'completed':
      return `已${base}`;
    case 'failed':
      return `${base}失败`;
    case 'rejected':
      return `已跳过${base}`;
    case 'cancelled':
      return `已停止${base}`;
  }
}

/** 已结束的步骤翻成过去式：思考块里落库的「正在理解创作需求」读起来不该还在进行。 */
export function settledStepLabel(summary: string): string {
  return summary.startsWith('正在') ? `已${summary.slice(2)}` : summary;
}

/**
 * `<0.1s` / `0.4s` / `10.4s` / `1m 2s`。一秒以内保留一位小数，否则「打开素材文件 0s」像没做。
 *
 * 一位小数在 50 毫秒以下又四舍五入回 0，「0s」重新出现在一条真跑过的步骤上——产卡工作流的
 * freeze 本机量到 5 毫秒，界面上就是「已固定本次创作的上下文 0s」，测试把它记成了缺陷
 * （IKCPQ1 D4）。快到读不出秒数不等于没发生，所以这一段说「不到 0.1 秒」，不说「0 秒」。
 * 真正的 0（服务端没给耗时）由调用方不显示这一栏来表达，不走这里。
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (ms > 0 && seconds < 0.05) return '<0.1s';
  if (seconds < 60) return `${seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/* ============ 账 ============ */

/** 一轮结束后的账（IKDK5L）：挂在那一轮尾部，不再常驻输入框上方。 */
export interface TurnAccount {
  /** 这笔账所属的输入批次。失败的轮没有回答消息，只能靠它把账挂回问题下面。 */
  batchId: string | null;
  outcome: RunOutcome;
  /** 从提交到结束的秒数；两端时间缺一就是 null——宁可不显示，也不显示一个算错的耗时。 */
  seconds: number | null;
  /** 结束的时刻（毫秒时间戳）：输入框上方那一行要说「21:37 完成」。 */
  finishedAt: number | null;
  tokenUsage: RunTokenUsage | null;
  contextCapacity: RunContextCapacity | null;
  /** 失败时后端的那句人话。 */
  failureText: string | null;
  /**
   * 这次失败再试一次有没有用（IKHCJ2 第 5 项）。服务端说了算，缺这个字段时按**可以重试**算：
   * 少给一次机会，用户就只能重开会话；多给一次，最坏也只是再失败一次。
   */
  failureRetryable: boolean;
  /**
   * 这一轮完成了、但要写的生成卡没写出来时，后端的那句人话（IKEV0V）。只在聊天里改卡时出现：
   * 那一轮照常 completed，侧边栏还挂着上一版。不写出来，用户会把旧卡当成这次改出来的。
   */
  cardFailureText: string | null;
  /**
   * 这次没写出卡，再发一遍有没有用。按码查 agent 的失败码表（`docs/blueprint/agent-failure-codes-v1.md`
   * 的「可重试」一列）——那张表写明「是否可重试不在线上传输，客户端按码查」。素材不可用、没定做图
   * 还是视频这类，得用户先做点什么，给「再试一次」只会让他白按一次。
   */
  cardFailureRetryable: boolean;
}

/**
 * 生成卡没写出来时，重发一遍也没用的那几个码（agent 失败码表里「可重试：否」、会出现在
 * `prompt_card_failure` 上的）。表里新增这类码时同步加在这里。
 */
const NON_RETRYABLE_CARD_FAILURES: ReadonlySet<string> = new Set([
  'asset_binding_unavailable',
  'target_media_unresolved',
  'understanding_not_confirmed',
  'requirement_incomplete',
]);

/**
 * 一条已经结束的 Run → 账。起点取 `created_at`（用户等待是从提交开始算的，排队、记忆投影、
 * 领券都在 `started_at` 之前），终点取 `finished_at`，缺了就用调用方给的兜底时刻（事件到达时刻）。
 * 还没结束的 Run 返回 null。
 */
export function accountOfRun(run: SessionRun, fallbackFinishedAt: number | null = null): TurnAccount | null {
  if (!isTerminalStatus(run.status)) return null;
  const startedAt = msOf(run.created_at) ?? msOf(run.started_at);
  const finishedAt = msOf(run.finished_at) ?? fallbackFinishedAt;
  return {
    batchId: run.input_batch_id ?? null,
    outcome: terminalOutcomeOf(run.status),
    seconds: startedAt === null || finishedAt === null ? null : Math.max(0, Math.round((finishedAt - startedAt) / 1000)),
    finishedAt,
    tokenUsage: parseRunTokenUsage(run.token_usage),
    contextCapacity: parseRunContextCapacity(run.context_capacity),
    failureText: run.failure?.message || null,
    failureRetryable: run.failure?.retryable !== false,
    cardFailureText: run.status === 'completed' ? run.prompt_card_failure?.message || null : null,
    cardFailureRetryable: !NON_RETRYABLE_CARD_FAILURES.has(run.prompt_card_failure?.code ?? ''),
  };
}

/* ============ 轮 ============ */

export interface Turn {
  /** 稳定的 React key：批次 id，没有就用第一条消息的 id。 */
  key: string;
  batchId: string | null;
  /** 这一轮的用户输入。同一批次可以有多条（排队期间连发的话）。 */
  user: ChatMessage[];
  /** 落库的回答。 */
  assistant: ChatMessage | null;
  /** 进行中的回答。与 assistant 互斥：服务端消息一到，进行中的那份就让位。 */
  live: LiveRun | null;
  runId: string | null;
  account: TurnAccount | null;
  /**
   * 这一轮提出的方案卡，旧的在前（IKF3KE）。
   *
   * 按提出它的那一轮归位，和生成卡同一个做法：用户往回翻时，卡就在当时那段对话下面，而不是
   * 统统堆在最后。被确认或作废的版本照样留着（置灰），否则历史读起来会缺一块。
   */
  solutionCards: RequirementUnderstanding[];
}

/**
 * 消息 + 进行中的一轮 + 账本 → 轮。
 *
 * 归组靠 `input_batch_id`：回答带着它所答的批次 id，无论序号如何交错，都能挂回自己的问题下面。
 * 没有批次 id 的（乐观气泡、老数据）退回按顺序归组：回答挂到它前面最近一个还没有回答的问题上。
 */
export function buildTurns(
  messages: readonly ChatMessage[],
  live: LiveRun | null,
  accounts: Readonly<Record<string, TurnAccount>>,
  understandings: readonly RequirementUnderstanding[] = [],
): Turn[] {
  const ordered = [...messages].sort((a, b) => a.sequence_no - b.sequence_no);
  const turns: Turn[] = [];
  const byBatch = new Map<string, Turn>();

  const newTurn = (batchId: string | null, key: string): Turn => {
    const turn: Turn = {
      key,
      batchId,
      user: [],
      assistant: null,
      live: null,
      runId: null,
      account: null,
      solutionCards: [],
    };
    turns.push(turn);
    if (batchId) byBatch.set(batchId, turn);
    return turn;
  };

  for (const m of ordered) {
    const batchId = m.inputBatchId ?? null;
    if (m.role === 'user') {
      const existing = batchId ? byBatch.get(batchId) : undefined;
      if (existing && existing.assistant === null) {
        existing.user.push(m);
        continue;
      }
      // 批次 id 缺失时（乐观气泡、老数据）无从判断是不是一批，保守地每条自成一轮。
      newTurn(batchId, batchId ?? m.id).user.push(m);
      continue;
    }
    // 助手消息：先按批次找，再退回「前面最近一个没有回答的问题」，最后单独成轮（不该发生）。
    let target = batchId ? byBatch.get(batchId) : undefined;
    if (!target) {
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].assistant === null && turns[i].user.length > 0) {
          target = turns[i];
          break;
        }
      }
    }
    if (!target) target = newTurn(null, m.id);
    if (target.assistant) {
      // 同一批次两条回答（重试后两次都成功）：后一条自成一轮，别把前一条盖掉。
      target = newTurn(null, m.id);
    }
    target.assistant = m;
    target.runId = m.sourceRunId ?? null;
  }

  if (live) {
    let target = live.batchId ? byBatch.get(live.batchId) : undefined;
    if (target && target.assistant && target.runId !== live.runId) target = undefined;
    if (!target) {
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].assistant === null && turns[i].user.length > 0) {
          target = turns[i];
          break;
        }
      }
    }
    if (!target) target = newTurn(live.batchId, `live:${live.runId}`);
    // 服务端消息已经到了就以它为准，进行中的那份只在它到之前顶着。
    if (target.assistant === null) {
      target.live = live;
      target.runId = live.runId;
    }
  }

  for (const turn of turns) {
    if (turn.runId) {
      turn.account = accounts[turn.runId] ?? null;
      continue;
    }
    // 没有回答也没有进行中的 Run（失败、取消后刷新）：按批次把最后一笔账找回来，
    // 用户回看时才知道这一轮是怎么结束的。
    if (turn.batchId) {
      for (const [runId, account] of Object.entries(accounts)) {
        if (account.batchId !== turn.batchId) continue;
        turn.account = account;
        turn.runId = runId;
      }
    }
  }
  // 方案卡挂回提出它的那一轮。提出它的 Run 已经不在时间线上（很旧的会话）就挂到最后一轮，
  // 总比不显示好——那张卡也许正等着用户点。
  const byVersion = [...understandings].sort((a, b) => a.version - b.version);
  for (const understanding of byVersion) {
    const owner =
      turns.find(turn => turn.runId === understanding.proposed_by_run_id) ?? turns[turns.length - 1] ?? null;
    if (owner) owner.solutionCards.push(understanding);
  }
  return turns;
}

/**
 * 这一轮底下要不要挂轮尾那一行（失败那句话、「重新回答」、已取消……）。
 *
 * 看的是「这一轮结束了没有」，不是「还有没有 live」：失败的轮为了让思考与已收口的工具行留在屏幕上
 * 回看，`live` 保留着（`ended: true`）直到下一轮开始。此前条件写的是 `!turn.live`，于是失败的轮在
 * 实时画面里永远没有这一行，刷新之后才出现——用户看到的是对话停在自己那句话下面、什么都点不了
 * （IKHV7G 本地真机：上游过载重试用尽之后）。
 */
export function showsTurnFooter(turn: Pick<Turn, 'account' | 'live'>): boolean {
  return turn.account !== null && (turn.live === null || turn.live.ended);
}

/* ============ 会话状态机（纯函数） ============ */

/**
 * 事件流能改动的那部分会话状态。hook 里其余的东西（打字动画、状态行计时、错误横幅、订阅）
 * 是表现与副作用，不在这里。这一层是纯的，夹具回归（IKDK5M）就是对它逐条喂事件。
 */
export interface SessionState {
  messages: ChatMessage[];
  /** 方案卡的全部版本（IKF3KE）。快照水合一次，之后由事件增量更新。 */
  understandings: RequirementUnderstanding[];
  live: LiveRun | null;
  accounts: Record<string, TurnAccount>;
  runningRunId: string | null;
  failedRunId: string | null;
  /** 已观察到终态的 Run，防迟到的增量或 REST 回执把它重新标成运行中。 */
  terminalRunIds: ReadonlySet<string>;
}

export const EMPTY_SESSION_STATE: SessionState = {
  messages: [],
  understandings: [],
  live: null,
  accounts: {},
  runningRunId: null,
  failedRunId: null,
  terminalRunIds: new Set(),
};

/** 把一条服务端消息（快照 / 事件内嵌）投影成 UI 消息。 */
function projectServerMessage(msg: SessionMessage): ChatMessage {
  const blocks = msg.content ?? [];
  return {
    id: msg.message_id,
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: textOf(blocks),
    blocks,
    sequence_no: msg.sequence,
    inputBatchId: msg.input_batch_id ?? null,
    ...(msg.source_run_id ? { sourceRunId: msg.source_run_id } : {}),
  };
}

/**
 * upsert 助手消息。幂等键两个：message_id，其次 source_run_id——本地固化的那份
 * （`as-<runId>`）由服务端同一个 Run 的正式消息替换。**不按正文相等判重**（铁律三）：
 * 正文被 trim 或分段就漂。
 */
export function upsertAssistantMessage(messages: readonly ChatMessage[], msg: SessionMessage): ChatMessage[] {
  const incoming = projectServerMessage(msg);
  const blocks = incoming.blocks ?? [];
  // 来件不带思考块时（老 Run 没有落库的原话、或投影还没跟上），把本地已有的保在最前面，
  // 别让整体替换把终态时刚固化进消息的思考抹掉。
  const keepThinking = (existing: ChatMessage): SessionContentBlock[] => {
    if (blocks.some((b) => b.type === 'thinking')) return blocks;
    const prior = existing.blocks?.filter((b) => b.type === 'thinking') ?? [];
    return prior.length > 0 ? [...prior, ...blocks] : blocks;
  };
  let idx = messages.findIndex((m) => m.id === msg.message_id);
  if (idx < 0 && msg.source_run_id) {
    idx = messages.findIndex((m) => m.role === 'assistant' && m.sourceRunId === msg.source_run_id);
  }
  if (idx < 0) return [...messages, incoming];
  const next = [...messages];
  const existing = next[idx];
  next[idx] = {
    ...existing,
    ...incoming,
    content: incoming.content || existing.content,
    blocks: keepThinking(existing),
  };
  return next;
}

/**
 * 把终态链写回落库消息的思考块。只接管 `steps` 那一半：模型原话的唯一来源是
 * assistant.reasoning.delta，终态链里没有它，整体替换会把刚固化的原话抹成 undefined（IKAI16）。
 */
function replaceThinkingSteps(message: ChatMessage, steps: string[]): ChatMessage {
  const blocks = message.blocks ?? [];
  const priorReasoning = blocks.find((b) => b.type === 'thinking')?.thinking?.reasoning;
  // 思考段（type: 'reasoning'）是正文时间线的一部分，留在 rest 里原位不动（IKFLB9）。
  const rest = blocks.filter((b) => b.type !== 'thinking');
  const body = rest.length > 0 ? rest : message.content ? [{ type: 'text', text: message.content }] : [];
  return {
    ...message,
    blocks: [{ type: 'thinking', thinking: { steps, ...(priorReasoning ? { reasoning: priorReasoning } : {}) } }, ...body],
  };
}

/** 进行中的一轮本地固化成助手消息（形状与服务端一致，见 blocksFromLive）。 */
function localAssistantMessage(closed: LiveRun): ChatMessage {
  return {
    id: `as-${closed.runId}`,
    role: 'assistant',
    content: closed.text,
    blocks: blocksFromLive(closed),
    sequence_no: Number.MAX_SAFE_INTEGER,
    inputBatchId: closed.batchId,
    sourceRunId: closed.runId,
  };
}

/** 事件名 → Run 状态词：`run.completed` → `completed`。 */
const TERMINAL_EVENT_STATUS: Readonly<Record<string, string>> = {
  'run.completed': 'completed',
  'run.failed': 'failed',
  'run.cancelled': 'cancelled',
  'run.stopped': 'stopped',
  'run.outcome_unknown': 'outcome_unknown',
};

const LIVE_INCREMENT_EVENTS = new Set([
  'run.activity',
  'tool.activity',
  'assistant.reasoning.delta',
  'assistant.delta',
  // 断线续跑的擦除（IKHCJ2）：它改的是同一份进行中的正文，和 delta 走同一条路。
  'assistant.rewind.v1',
  'prompt_card.partial.v1',
]);

/**
 * 一条会话事件 → 下一份会话状态。返回同一个引用表示这条事件不改数据。
 *
 * 这里只做数据；副作用（打字动画、状态行、刷新会话列表、回查生成卡）由 hook 在这之后按
 * 事件类型自己做。
 */
export function reduceSessionEvent(state: SessionState, ev: TimelineEvent, now: number = Date.now()): SessionState {
  const { data, payload, at } = envelope(ev);
  const when = at ?? now;
  const t = ev.type;

  /* ---- 方案卡的提出、接纳与作废（IKF3KE） ----
   * 三条事件带的都是同一份版本记录，按 (understanding_id, version) 就地更新，没有就追加。
   * 此前前端**故意**不为需求理解渲染任何东西（IKAI14 拆掉了旧 UI，确认由模型在对话里判断）。
   * 现在确认权回到用户手里，它必须有形态：不然用户没有可点的东西，首卡永远出不来。 */
  if (
    t === 'requirement_understanding.proposed.v1' ||
    t === 'requirement_understanding.accepted.v1' ||
    t === 'requirement_understanding.voided.v1'
  ) {
    const understanding = payload.understanding as RequirementUnderstanding | undefined;
    if (!understanding?.understanding_id) return state;
    const rest = state.understandings.filter(
      one => !(one.understanding_id === understanding.understanding_id && one.version === understanding.version),
    );
    // 一个会话同时最多一版待确认：这一版一落，之前那些待确认的就不再等用户了。
    const settled = rest.map(one =>
      one.understanding_id === understanding.understanding_id &&
      one.version !== understanding.version &&
      one.status === 'awaiting_confirmation'
        ? { ...one, status: 'superseded' as const }
        : one,
    );
    return { ...state, understandings: [...settled, understanding].sort((a, b) => a.version - b.version) };
  }

  /* ---- 用户消息确认：替换乐观气泡；调度到了 Run 就进入运行态 ---- */
  if (t === 'message.accepted') {
    const msg = payload.message as SessionMessage | undefined;
    const runId = str((payload.scheduling as Record<string, unknown> | undefined)?.run_id ?? data.run_id);
    let next: SessionState = state;
    if (msg?.message_id) next = { ...next, messages: mergeUserMessage(next.messages, msg) };
    if (runId && !state.terminalRunIds.has(runId)) {
      next = { ...next, runningRunId: runId, failedRunId: null };
    }
    return next;
  }

  /* ---- 新一轮开始：进行中的那一轮从这里立起来；上一轮留下的残影让位 ---- */
  if (t === 'run.queued' || t === 'run.started') {
    const run = payload.run as Record<string, unknown> | undefined;
    const runId = str(run?.run_id ?? data.run_id);
    if (!runId || state.terminalRunIds.has(runId)) return state;
    const batchId = str(run?.input_batch_id) || null;
    const current = state.live;
    const live =
      current && current.runId === runId
        ? current.batchId === null && batchId
          ? { ...current, batchId }
          : current
        : startLiveRun(runId, batchId, when);
    return {
      ...state,
      live,
      runningRunId: runId,
      failedRunId: state.failedRunId === runId ? null : state.failedRunId,
    };
  }

  /* ---- 一轮之内的增量 ---- */
  if (LIVE_INCREMENT_EVENTS.has(t)) {
    const runId = runIdOf(ev);
    if (!runId || state.terminalRunIds.has(runId)) return state;
    // 重连后增量可能先于 run.started 到达：先把这一轮立起来，批次随后由 run.started 补。
    const current = state.live && state.live.runId === runId ? state.live : startLiveRun(runId, null, when);
    const live = applyLiveEvent(current, ev, when);
    if (live === state.live) return state;
    return { ...state, live, runningRunId: state.runningRunId ?? runId };
  }

  /* ---- 思考过程终态链（run.completed 之后到达） ---- */
  if (t === 'reasoning_trace.updated.v1') {
    const runId = str(data.run_id);
    if (!runId) return state;
    if (state.live && state.live.runId === runId) {
      const live = applyLiveEvent(state.live, ev, when);
      return live === state.live ? state : { ...state, live };
    }
    const trace = (payload.reasoning_trace ?? {}) as { steps?: unknown };
    const steps = Array.isArray(trace.steps)
      ? trace.steps.map((s) => (typeof s === 'string' ? s : str((s as { summary?: unknown })?.summary))).filter(Boolean)
      : [];
    if (steps.length === 0) return state;
    const idx = state.messages.findIndex((m) => m.role === 'assistant' && m.sourceRunId === runId);
    if (idx < 0) return state;
    const messages = [...state.messages];
    messages[idx] = replaceThinkingSteps(messages[idx], steps);
    return { ...state, messages };
  }

  /* ---- 计费门暂停：不是终态。正文丢弃，思考留着，等用户处理 ---- */
  if (t === 'run.payment_required') {
    const run = (payload.run ?? {}) as Record<string, unknown>;
    const runId = str(run.run_id ?? data.run_id);
    const live = state.live ? { ...closeLiveRun(state.live, 'failed', when), text: '' } : null;
    return { ...state, live, runningRunId: runId || null };
  }

  /* ---- 运行终态 ---- */
  const status = TERMINAL_EVENT_STATUS[t];
  if (status) {
    const runView = payload.run as SessionRun | undefined;
    const runId = str(runView?.run_id ?? data.run_id);
    const outcome = terminalOutcomeOf(status);
    const terminalRunIds = new Set(state.terminalRunIds);
    if (runId) terminalRunIds.add(runId);
    let messages = state.messages;
    let live = state.live;
    if (live && live.runId === runId) {
      const closed = closeLiveRun(live, outcome, when);
      if (outcome === 'failed') {
        // 服务端没有为失败的轮落库，本地留下的正文刷新后就是对不上的幻影；思考与已收口的
        // 工具行留在屏幕上供回看，直到下一轮开始。
        live = { ...closed, text: '' };
      } else {
        // completed 与 cancelled 一样固化（IKBRZV BUG-08）：用户点停止时已经流出的字不消失。
        // 空缓冲不生消息——没流出任何字的取消不该留下一条空回复。
        if (closed.text.trim() && !messages.some((m) => m.role === 'assistant' && m.sourceRunId === runId)) {
          messages = [...messages, localAssistantMessage(closed)];
        }
        live = null;
      }
    }
    const assistantMsg = payload.assistant_message as SessionMessage | undefined;
    if (assistantMsg?.message_id) messages = upsertAssistantMessage(messages, assistantMsg);
    // 这一轮的账挂到轮尾（IKDK5L）。状态以事件名为准——视图里的 status 与事件名偶有出入。
    const account = runId ? accountOfRun({ ...(runView ?? {}), run_id: runId, status }, when) : null;
    return {
      ...state,
      messages,
      live,
      accounts: account && runId ? { ...state.accounts, [runId]: account } : state.accounts,
      runningRunId: state.runningRunId === runId ? null : state.runningRunId,
      failedRunId: outcome === 'failed' ? runId || null : state.failedRunId === runId ? null : state.failedRunId,
      terminalRunIds,
    };
  }

  return state;
}

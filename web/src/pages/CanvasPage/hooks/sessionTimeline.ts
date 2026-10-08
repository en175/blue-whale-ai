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


const RUN_STATUS_OUTCOME: Readonly<Record<string, RunOutcome>> = {
  completed: 'completed',
  succeeded: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  stopped: 'cancelled',
  failed: 'failed',
  outcome_unknown: 'failed',
};

export function isTerminalStatus(status: string): boolean {
  return Object.hasOwn(RUN_STATUS_OUTCOME, status);
}

export function terminalOutcomeOf(status: string): RunOutcome {
  return RUN_STATUS_OUTCOME[status] ?? 'failed';
}

export function msOf(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');


export type ToolStatus = 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled';

export interface LiveSubstep {
  summary: string;
  startedAt: number;
  endedAt: number | null;
}

export interface LiveToolCall {
  seq: number;
  tool: string;
  summary: string;
  at: number;
  status: ToolStatus;
  startedAt: number;
  endedAt: number | null;
  elapsedMs: number | null;
  substeps: LiveSubstep[];
}

export interface LiveReasoning {
  seq: number;
  at: number;
  text: string;
  startedAt: number;
  endedAt: number | null;
}

export interface LiveRun {
  runId: string;
  batchId: string | null;
  startedAt: number;
  steps: string[];
  lastActivity: string | null;
  reasonings: LiveReasoning[];
  text: string;
  toolCalls: LiveToolCall[];
  seq: number;
  partialCard: PartialCardPreview | null;
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

export interface TimelineEvent {
  type: string;
  data: unknown;
}

function envelope(ev: TimelineEvent): { data: Record<string, unknown>; payload: Record<string, unknown>; at: number | null } {
  const data = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
  const payload = (data.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<string, unknown>;
  return { data, payload, at: msOf(data.occurred_at) };
}

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

function endReasoning(reasonings: readonly LiveReasoning[], when: number): LiveReasoning[] {
  const last = reasonings[reasonings.length - 1];
  return last && last.endedAt === null ? replaceLast(reasonings, { ...last, endedAt: when }) : [...reasonings];
}

function isToolFact(live: Pick<LiveRun, 'toolCalls'>, summary: string): boolean {
  return live.toolCalls.some((c) => c.summary === summary || c.substeps.some((s) => s.summary === summary));
}

export function applyLiveEvent(live: LiveRun, ev: TimelineEvent, now: number = Date.now()): LiveRun {
  const { payload, at } = envelope(ev);
  const when = at ?? now;
  const t = ev.type;

  if (t === 'reasoning_trace.updated.v1') {
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

  if (t === 'assistant.rewind.v1') {
    const keep = typeof payload.keep_chars === 'number' ? payload.keep_chars : null;
    if (keep === null || keep < 0 || keep >= live.text.length) return live;
    return {
      ...live,
      text: live.text.slice(0, keep),
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

export function closeLiveRun(live: LiveRun, outcome: RunOutcome, endedAt: number): LiveRun {
  const forced: ToolStatus = outcome;
  const toolCalls = live.toolCalls.map((c) =>
    c.status === 'running'
      ? { ...c, status: forced, endedAt, substeps: c.substeps.map((s) => (s.endedAt === null ? { ...s, endedAt } : s)) }
      : c,
  );
  return { ...live, toolCalls, reasonings: endReasoning(live.reasonings, endedAt), partialCard: null, ended: true };
}

type LiveBreak = { kind: 'tool'; call: LiveToolCall } | { kind: 'reasoning'; reasoning: LiveReasoning };

function liveBreaks(live: LiveRun): LiveBreak[] {
  return [
    ...live.toolCalls.map((call): LiveBreak => ({ kind: 'tool', call })),
    ...live.reasonings.map((reasoning): LiveBreak => ({ kind: 'reasoning', reasoning })),
  ].sort((a, b) => (a.kind === 'tool' ? a.call.seq : a.reasoning.seq) - (b.kind === 'tool' ? b.call.seq : b.reasoning.seq));
}

const breakAt = (item: LiveBreak): number => (item.kind === 'tool' ? item.call.at : item.reasoning.at);


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


export interface TimelineSubstep {
  summary: string;
  status: ToolStatus;
  elapsedMs: number | null;
}

export type TimelineItem =
  | { kind: 'reasoning'; steps: string[]; reasoning: string; live: boolean }
  | {
      kind: 'thought';
      text: string;
      running: boolean;
      startedAt: number | null;
      elapsedMs: number | null;
    }
  | {
      kind: 'tool';
      tool: string;
      summary: string;
      status: ToolStatus;
      startedAt: number | null;
      elapsedMs: number | null;
      substeps: TimelineSubstep[];
      calls: number;
    }
  | {
      kind: 'waiting';
      summary: string;
      elapsedMs: number;
    }
  | { kind: 'text'; text: string; questions?: AskedQuestion[] }
  | { kind: 'card'; card: GenerationCardBlock }
  | { kind: 'card_preview'; preview: PartialCardPreview };

function toolStatusOfPart(status: unknown, endedMs: unknown): ToolStatus {
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return status;
  if (status === 'ok' || status === undefined) return endedMs === null ? 'running' : 'completed';
  return 'completed';
}

function elapsedOf(started: unknown, ended: unknown): number | null {
  if (typeof started !== 'number' || typeof ended !== 'number') return null;
  return Math.max(0, ended - started);
}

export const MIN_VISIBLE_WAITING_MS = 1000;

export function itemsFromBlocks(blocks: readonly SessionContentBlock[], fallbackText: string): TimelineItem[] {
  const toolFacts = new Set<string>();
  for (const b of blocks) {
    if (b.type !== 'tool_call') continue;
    if (b.summary) toolFacts.add(b.summary);
    for (const s of b.substeps ?? []) toolFacts.add(s.summary);
  }
  const items: TimelineItem[] = [];
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
  }
  if (items.length === 0 && fallbackText) items.push({ kind: 'text', text: fallbackText });
  return items;
}

export function itemsFromLive(live: LiveRun, revealedText: string): TimelineItem[] {
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


export type TimelineProcessItem = Extract<TimelineItem, { kind: 'reasoning' | 'thought' | 'tool' | 'waiting' }>;
export type ProcessItem = TimelineProcessItem | { kind: 'writing'; elapsedMs: number };

export const MIN_WRITING_MS = 500;

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

export function processItemRunning(item: ProcessItem): boolean {
  if (item.kind === 'writing') return false;
  if (item.kind === 'thought') return item.running;
  if (item.kind === 'tool') return item.status === 'running';
  if (item.kind === 'reasoning') return item.live;
  return false;
}

export function processItemElapsedMs(item: ProcessItem, now: number): number {
  if (item.kind === 'reasoning') return 0;
  if (item.kind === 'waiting' || item.kind === 'writing') return item.elapsedMs;
  if (item.elapsedMs !== null) return item.elapsedMs;
  if (item.startedAt !== null && processItemRunning(item)) return Math.max(0, now - item.startedAt);
  return 0;
}


function stripProgressive(summary: string): string {
  return summary.startsWith('正在') ? summary.slice(2) : summary;
}

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

export function settledStepLabel(summary: string): string {
  return summary.startsWith('正在') ? `已${summary.slice(2)}` : summary;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (ms > 0 && seconds < 0.05) return '<0.1s';
  if (seconds < 60) return `${seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}


export interface TurnAccount {
  batchId: string | null;
  outcome: RunOutcome;
  seconds: number | null;
  finishedAt: number | null;
  tokenUsage: RunTokenUsage | null;
  contextCapacity: RunContextCapacity | null;
  failureText: string | null;
  failureRetryable: boolean;
  cardFailureText: string | null;
  cardFailureRetryable: boolean;
}

const NON_RETRYABLE_CARD_FAILURES: ReadonlySet<string> = new Set([
  'asset_binding_unavailable',
  'target_media_unresolved',
  'understanding_not_confirmed',
  'requirement_incomplete',
]);

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


export interface Turn {
  key: string;
  batchId: string | null;
  user: ChatMessage[];
  assistant: ChatMessage | null;
  live: LiveRun | null;
  runId: string | null;
  account: TurnAccount | null;
  solutionCards: RequirementUnderstanding[];
}

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
      newTurn(batchId, batchId ?? m.id).user.push(m);
      continue;
    }
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
    if (turn.batchId) {
      for (const [runId, account] of Object.entries(accounts)) {
        if (account.batchId !== turn.batchId) continue;
        turn.account = account;
        turn.runId = runId;
      }
    }
  }
  const byVersion = [...understandings].sort((a, b) => a.version - b.version);
  for (const understanding of byVersion) {
    const owner =
      turns.find(turn => turn.runId === understanding.proposed_by_run_id) ?? turns[turns.length - 1] ?? null;
    if (owner) owner.solutionCards.push(understanding);
  }
  return turns;
}

export function showsTurnFooter(turn: Pick<Turn, 'account' | 'live'>): boolean {
  return turn.account !== null && (turn.live === null || turn.live.ended);
}


export interface SessionState {
  messages: ChatMessage[];
  understandings: RequirementUnderstanding[];
  live: LiveRun | null;
  accounts: Record<string, TurnAccount>;
  runningRunId: string | null;
  failedRunId: string | null;
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

export function upsertAssistantMessage(messages: readonly ChatMessage[], msg: SessionMessage): ChatMessage[] {
  const incoming = projectServerMessage(msg);
  const blocks = incoming.blocks ?? [];
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

function replaceThinkingSteps(message: ChatMessage, steps: string[]): ChatMessage {
  const blocks = message.blocks ?? [];
  const priorReasoning = blocks.find((b) => b.type === 'thinking')?.thinking?.reasoning;
  const rest = blocks.filter((b) => b.type !== 'thinking');
  const body = rest.length > 0 ? rest : message.content ? [{ type: 'text', text: message.content }] : [];
  return {
    ...message,
    blocks: [{ type: 'thinking', thinking: { steps, ...(priorReasoning ? { reasoning: priorReasoning } : {}) } }, ...body],
  };
}

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
  'assistant.rewind.v1',
  'prompt_card.partial.v1',
]);

export function reduceSessionEvent(state: SessionState, ev: TimelineEvent, now: number = Date.now()): SessionState {
  const { data, payload, at } = envelope(ev);
  const when = at ?? now;
  const t = ev.type;

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
    const settled = rest.map(one =>
      one.understanding_id === understanding.understanding_id &&
      one.version !== understanding.version &&
      one.status === 'awaiting_confirmation'
        ? { ...one, status: 'superseded' as const }
        : one,
    );
    return { ...state, understandings: [...settled, understanding].sort((a, b) => a.version - b.version) };
  }

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

  if (LIVE_INCREMENT_EVENTS.has(t)) {
    const runId = runIdOf(ev);
    if (!runId || state.terminalRunIds.has(runId)) return state;
    const current = state.live && state.live.runId === runId ? state.live : startLiveRun(runId, null, when);
    const live = applyLiveEvent(current, ev, when);
    if (live === state.live) return state;
    return { ...state, live, runningRunId: state.runningRunId ?? runId };
  }

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

  if (t === 'run.payment_required') {
    const run = (payload.run ?? {}) as Record<string, unknown>;
    const runId = str(run.run_id ?? data.run_id);
    const live = state.live ? { ...closeLiveRun(state.live, 'failed', when), text: '' } : null;
    return { ...state, live, runningRunId: runId || null };
  }

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
        live = { ...closed, text: '' };
      } else {
        if (closed.text.trim() && !messages.some((m) => m.role === 'assistant' && m.sourceRunId === runId)) {
          messages = [...messages, localAssistantMessage(closed)];
        }
        live = null;
      }
    }
    const assistantMsg = payload.assistant_message as SessionMessage | undefined;
    if (assistantMsg?.message_id) messages = upsertAssistantMessage(messages, assistantMsg);
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

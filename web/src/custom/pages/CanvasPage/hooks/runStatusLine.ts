
export type RunPhase = 'dispatching' | 'working' | 'completed' | 'cancelled' | 'failed';

export type RunOutcome = 'completed' | 'cancelled' | 'failed';

export interface RunTokenUsage {
  input_tokens: number;
  cached_input_tokens: number | null;
  output_tokens: number;
  reasoning_tokens: number | null;
}

export interface RunContextCapacity {
  used_input_tokens: number;
  configured_max_tokens: number;
  ratio: number;
  compaction_state: 'none' | 'compacted';
}

export interface RunStatusInput {
  activeSince: number | null;
  now: number;
  activity: string | null;
  hasRunId: boolean;
  outcome: RunOutcome | null;
  failureText: string | null;
  finishedAt: number | null;
  streamedText: string;
  estimatedOutputTokensAtFinish: number | null;
  tokenUsage: RunTokenUsage | null;
  contextCapacity: RunContextCapacity | null;
}

export interface RunStatusTokens {
  output: number;
  estimated: boolean;
}

export interface RunStatusContext {
  usedTokens: number;
  maxTokens: number;
  ratio: number;
  compacted: boolean;
}

export interface RunStatus {
  phase: RunPhase;
  label: string;
  seconds: number | null;
  tone: 'working' | 'done' | 'error';
  settled: boolean;
  tokens: RunStatusTokens | null;
  context: RunStatusContext | null;
}

const INITIAL_LABEL = '正在思考';
const DISPATCHING_LABEL = '正在提交';

const TERMINAL_LABEL: Record<RunOutcome, string> = {
  completed: '已完成',
  cancelled: '已取消',
  failed: '未能完成',
};

const TERMINAL_TONE: Record<RunOutcome, RunStatus['tone']> = {
  completed: 'done',
  cancelled: 'done',
  failed: 'error',
};

export function estimateOutputTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x2e80 && code <= 0x9fff) cjk += 1;
    else if (code >= 0xf900 && code <= 0xfaff) cjk += 1;
    else rest += 1;
  }
  return cjk + Math.ceil(rest / 4);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseRunTokenUsage(value: unknown): RunTokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const input = finiteNumber(raw.input_tokens);
  const output = finiteNumber(raw.output_tokens);
  if (input === null || output === null) return null;
  return {
    input_tokens: input,
    cached_input_tokens: finiteNumber(raw.cached_input_tokens),
    output_tokens: output,
    reasoning_tokens: finiteNumber(raw.reasoning_tokens),
  };
}

export function parseRunContextCapacity(value: unknown): RunContextCapacity | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const used = finiteNumber(raw.used_input_tokens);
  const max = finiteNumber(raw.configured_max_tokens);
  const ratio = finiteNumber(raw.ratio);
  if (used === null || max === null || ratio === null || max <= 0) return null;
  return {
    used_input_tokens: used,
    configured_max_tokens: max,
    ratio,
    compaction_state: raw.compaction_state === 'compacted' ? 'compacted' : 'none',
  };
}

function contextOf(capacity: RunContextCapacity | null): RunStatusContext | null {
  if (!capacity) return null;
  return {
    usedTokens: capacity.used_input_tokens,
    maxTokens: capacity.configured_max_tokens,
    ratio: Math.min(1, Math.max(0, capacity.ratio)),
    compacted: capacity.compaction_state === 'compacted',
  };
}

function tokensOf(input: RunStatusInput): RunStatusTokens | null {
  if (input.tokenUsage) return { output: input.tokenUsage.output_tokens, estimated: false };
  if (input.streamedText.length > 0) return { output: estimateOutputTokens(input.streamedText), estimated: true };
  const frozen = input.estimatedOutputTokensAtFinish;
  if (frozen !== null && frozen > 0) return { output: frozen, estimated: true };
  return null;
}

export function deriveRunStatus(input: RunStatusInput): RunStatus | null {
  const { activeSince, now, activity, hasRunId, outcome, finishedAt } = input;
  if (activeSince === null) return null;

  const until = outcome !== null ? finishedAt : now;
  const seconds = until === null ? null : Math.max(0, Math.floor((until - activeSince) / 1000));
  const tokens = tokensOf(input);
  const context = contextOf(input.contextCapacity);

  const common = { seconds, tokens, context };

  if (outcome !== null) {
    return {
      ...common,
      phase: outcome,
      label: (outcome === 'failed' && input.failureText) || TERMINAL_LABEL[outcome],
      tone: TERMINAL_TONE[outcome],
      settled: true,
    };
  }

  if (!hasRunId) {
    return { ...common, phase: 'dispatching', label: DISPATCHING_LABEL, tone: 'working', settled: false };
  }

  return {
    ...common,
    phase: 'working',
    label: activity ?? INITIAL_LABEL,
    tone: 'working',
    settled: false,
  };
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  const k = value / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

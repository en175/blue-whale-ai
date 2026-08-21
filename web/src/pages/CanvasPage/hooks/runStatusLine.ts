/**
 * 输入框上方那条常驻状态行：现在在做什么、等了多久、这一轮花了多少。
 *
 * 用户提交后屏幕会有几十秒没有正文。这几十秒里模型一直在干活，但"在干活"和"已经挂了"
 * 在屏幕上长得一模一样，而这才是真正让人受不了的地方——慢是可以接受的，沉默不行。
 *
 * 这条状态行的定位是**地板**：它不依赖模型吐出任何东西，不依赖产卡成功，也不依赖
 * 事件流还活着。只要这一轮开始了，它就必须在屏幕上，并且秒数一直在走。上面那些更好看
 * 的东西（思考链、卡片逐段长出来）都可能失效，这条不能。
 *
 * IKA4PG 把它从"运行中出现、结束就消失"改成常驻多态：回答结束后它留下来报账
 * （耗时与 token），下一轮开始才被替换。判断一次运行是不是卡死，靠的就是"秒数还在走吗、
 * token 还在变吗"这两个信号，所以两者都必须持续可见。
 */

/** 一轮运行走到的阶段。终态三种分开，因为用户对它们的反应完全不同。 */
export type RunPhase = 'dispatching' | 'working' | 'stalled' | 'completed' | 'cancelled' | 'failed';

/** 服务端报的终局。`outcome_unknown` 归入 failed：对用户而言"不知道"和"失败"一样需要重试。 */
export type RunOutcome = 'completed' | 'cancelled' | 'failed';

/** 真实用量，终态由服务端送来（IKACDN）。 */
export interface RunTokenUsage {
  input_tokens: number;
  cached_input_tokens: number | null;
  output_tokens: number;
  reasoning_tokens: number | null;
}

/** 上下文窗口占用，随 run.completed 送达。 */
export interface RunContextCapacity {
  used_input_tokens: number;
  configured_max_tokens: number;
  ratio: number;
  compaction_state: 'none' | 'compacted';
}

export interface RunStatusInput {
  /** 本轮开始的时刻（毫秒时间戳）。null 表示这一轮还没开始过。 */
  activeSince: number | null;
  /** 当前时间（毫秒时间戳）。由调用方按秒推进，便于测试。 */
  now: number;
  /** 最近一个可见节点的描述（来自 run.activity）；还没有任何节点时为 null。 */
  activity: string | null;
  /** 长时间没有任何新进展。 */
  stalled: boolean;
  /** 已经拿到 runId。没拿到说明还在派发途中，此时秒数已经在走了。 */
  hasRunId: boolean;
  /** 本轮的终局；null 表示还在跑。 */
  outcome: RunOutcome | null;
  /** 终态发生的时刻。终态后秒数必须冻在这里，不能继续走。 */
  finishedAt: number | null;
  /** 流式期间已收到的正文。按它估算输出 token。 */
  streamedText: string;
  /** 终态的真实用量；有它就不再用估算值。 */
  tokenUsage: RunTokenUsage | null;
  /** 上下文占用；null 表示本轮没报。 */
  contextCapacity: RunContextCapacity | null;
}

export interface RunStatusTokens {
  /** 输出 token 数。 */
  output: number;
  /** true 表示这是按字符数估的，不是服务端给的真实值。 */
  estimated: boolean;
}

export interface RunStatusContext {
  usedTokens: number;
  maxTokens: number;
  /** [0,1]。 */
  ratio: number;
  /** 本轮为了塞下上下文压缩过历史。 */
  compacted: boolean;
}

export interface RunStatus {
  phase: RunPhase;
  label: string;
  seconds: number;
  tone: 'working' | 'stalled' | 'done' | 'error';
  /** 终态为 true：此时展示的是这一轮的账，不是进度。 */
  settled: boolean;
  /** 一个都没有时为 null，UI 据此不渲染 token 那一段。 */
  tokens: RunStatusTokens | null;
  context: RunStatusContext | null;
}

/** 还没有收到任何节点时的说法。不编造具体动作，只说明确实在跑。 */
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

/**
 * 按字符数估算输出 token。
 *
 * 模型流只在 finish 那一刻报 usage，中途没有增量，所以流式期间没有真实数字可用
 * （已核实，见 IKACDN）。这里估一个：CJK 按一字一 token，其余按四字符一 token——
 * 常见分词器的粗略比例。
 *
 * 数字是估的，但这一段的作用本就是**活性信号**：用户要判断的是"它还在动吗"，不是
 * "到底几个 token"。终态一到就换成服务端的真实值。
 */
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

/**
 * 服务端送来的字段的入口校验。
 *
 * 这两个契约都定义在 agent 仓，本仓无从验证，所以这里**不信任形状**：真实数据是经 BFF
 * 代理过来的一段 JSON，字段少一个、类型换一种，前端都不会有任何编译期提示。
 *
 * 形状不对就整段当「没报」，而不是让坏值往下走。裸 `as` 的代价是具体的：
 * `formatTokens(undefined)` 会输出 `"NaNk"`，`Math.max(0, undefined)` 会让上下文条
 * 渲染成「上下文 NaN%」——一个缺失的 token 段用户看得懂，一个 NaN 看不懂。
 */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseRunTokenUsage(value: unknown): RunTokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const input = finiteNumber(raw.input_tokens);
  const output = finiteNumber(raw.output_tokens);
  // 这两项是这段展示的主体，任一缺失就没什么可报的了。
  if (input === null || output === null) return null;
  return {
    input_tokens: input,
    // cached / reasoning 允许为 null，且 null 与 0 含义不同（未上报 vs 未命中），
    // 所以校验失败时也落到 null，不能兜成 0——那会让 KV cache 诊断得出相反结论。
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
  // max 为 0 会让分母失去意义，占用条画不出来，一并当没报。
  if (used === null || max === null || ratio === null || max <= 0) return null;
  return {
    used_input_tokens: used,
    configured_max_tokens: max,
    ratio,
    // 未知取值一律按「没压缩过」处理：误报压缩过比漏报更容易让人误判上下文状况。
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
  // 真实值优先。它只在终态才有，一旦有了就不该再让估算值把它盖掉。
  if (input.tokenUsage) return { output: input.tokenUsage.output_tokens, estimated: false };
  if (input.streamedText.length > 0) return { output: estimateOutputTokens(input.streamedText), estimated: true };
  return null;
}

export function deriveRunStatus(input: RunStatusInput): RunStatus | null {
  const { activeSince, now, activity, stalled, hasRunId, outcome, finishedAt } = input;
  // 从来没跑过才什么都不显示。跑完了要留下来报账，那正是 IKA4PG 要的。
  if (activeSince === null) return null;

  // 终态后秒数冻结。没有 finishedAt（比如刷新后从快照恢复）就退回当前时间，宁可数字略大，
  // 也不要让一条已经结束的状态行继续读秒——那看起来像还在跑。
  const until = outcome !== null ? (finishedAt ?? now) : now;
  // 起点可能来自事件里的服务端时间，和浏览器时钟未必一致；时钟偏差不该让计时器倒着走。
  const seconds = Math.max(0, Math.floor((until - activeSince) / 1000));
  const tokens = tokensOf(input);
  const context = contextOf(input.contextCapacity);

  if (outcome !== null) {
    return {
      phase: outcome,
      label: TERMINAL_LABEL[outcome],
      seconds,
      tone: TERMINAL_TONE[outcome],
      settled: true,
      tokens,
      context,
    };
  }

  // 还没拿到 runId：请求在途，此时既没有节点也没有正文，但表已经在走了，不能空着。
  if (!hasRunId) {
    return {
      phase: 'dispatching',
      label: DISPATCHING_LABEL,
      seconds,
      tone: 'working',
      settled: false,
      tokens,
      context,
    };
  }

  return {
    phase: stalled ? 'stalled' : 'working',
    label: activity ?? INITIAL_LABEL,
    seconds,
    // stalled 时 UI 换一种语气，但**不会**因此隐藏状态行。
    tone: stalled ? 'stalled' : 'working',
    settled: false,
    tokens,
    context,
  };
}

/** `51s` / `2m 56s`。秒数不补零，跟 Claude Code 那条状态行一致。 */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** `412` / `5.7k`。数字要能一眼看出在变，所以千位以下不缩写。 */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  const k = value / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

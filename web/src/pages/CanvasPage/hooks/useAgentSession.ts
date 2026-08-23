/* ============================================
 * useAgentSession 钩子：画布 Agent 对话状态机（session 维度）
 * 项目维度 /api/projects/:id/conversation 服务只接纳消息不执行 Run（worker 缺失），
 * 会话维度 /api/agent/v1/projects/:id/sessions 为唯一能产出助手回复的服务：
 * - 进入页面：列表取最近会话（无则创建）→ 快照水合消息历史 → 从 event_cursor 订阅事件流
 * - message.accepted → 确认用户消息；run.queued/started → 运行态
 * - assistant.delta → 流式文本投影；run.completed → 助手消息固化
 * - run.failed → 重试；取消运行走 runs/:runId/cancel
 * ============================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceReveal, hasPendingReveal } from './streamPacing';
import { toPartialCardPreview, type PartialCardPreview } from './partialCardPreview';
import {
  listSessions,
  createSession,
  deleteSession,
  fetchSessionSnapshot,
  sendSessionMessage,
  cancelSession,
  cancelSessionRun,
  retrySessionRun,
  subscribeSessionEvents,
  type SessionMessage,
  type SessionRecord,
  type SessionRun,
  type SessionContentBlock,
  type SseEvent,
  type PromptCardRecord,
} from '@/api/agentSessions';
import { cardsFromRevision } from '@/api/promptCardMapping';
import { isApiError } from '@/api/http';
import { estimateOutputTokens, parseRunContextCapacity, parseRunTokenUsage } from './runStatusLine';
import type { RunContextCapacity, RunOutcome, RunTokenUsage } from './runStatusLine';

/** 一轮结束后的结账信息，供常驻状态行报账（IKA4PG）。 */
export interface TurnOutcome {
  outcome: RunOutcome;
  /** 终态时刻。从快照恢复的历史轮次可能没有（Run 异常终止时 finished_at 为空），
   *  此时状态行退回当前时间：数字略大，但好过让一条已结束的状态行继续读秒。 */
  finishedAt: number | null;
  tokenUsage: RunTokenUsage | null;
  contextCapacity: RunContextCapacity | null;
  /** 结束那一刻按已收到正文估的输出 token。真实用量到达前由它顶着，见 runStatusLine。 */
  estimatedOutputTokens: number | null;
}

/** 数据源：真实 /api/agent/v1（经 BFF 代理到独立 agent 服务）。本地开发需起 backend:3100 + agent + SSH 隧道，见 bw-test-env。 */
const api = {
  listSessions,
  createSession,
  deleteSession,
  fetchSessionSnapshot,
  sendSessionMessage,
  cancelSession,
  cancelSessionRun,
  retrySessionRun,
  subscribeSessionEvents,
};

/** 对话消息（UI 模型） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 结构化内容块（思考过程/需求理解/追问/生成卡），无结构化时为空数组 */
  blocks?: SessionContentBlock[];
  /** 服务端事件序号（排序依据；本地乐观气泡为最大值） */
  sequence_no: number;
  /** 产出这条消息的 Run；生成卡按它对回自己的助手消息 */
  sourceRunId?: string;
  /** 本地乐观上屏、尚未被服务端事件确认 */
  optimistic?: boolean;
}

/**
 * Run 状态这一个字符串域的唯一分类表。
 *
 * 三个来源写法各不相同：事件流按事件名给（`run.cancelled`），发送回执与快照按 `run.status`
 * 给（`cancelled`）。全部落到这一张表，加一种终态只改这里。
 *
 * `stopped` 归入「已取消」：那是用户自己按的停止，不该看到失败的语气。
 * `outcome_unknown` 归入失败：对用户而言「不知道」和「失败」一样需要重试。
 *
 * 此前这套判断散在四处——这张表、一个 if 链、外加两份写死的
 * `['failed','outcome_unknown'].includes(...)`（审查 W·S15）。
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
function isTerminalStatus(status: string): boolean {
  return Object.hasOwn(RUN_STATUS_OUTCOME, status);
}

/**
 * run 状态 → 状态行终局。
 *
 * 表外的状态一律按失败处理：认不出的终态对用户的意义和「不知道」一样，都需要重试入口。
 */
function terminalOutcomeOf(status: string): RunOutcome {
  return RUN_STATUS_OUTCOME[status] ?? 'failed';
}

/**
 * 这一轮是否需要给用户一个重试入口。
 *
 * 只对终态成立——还在跑的时候谈不上重试。此前两处写的是
 * `['failed','outcome_unknown'].includes(status)`，靠调用点恰好都在终态分支里才没出错。
 */
function needsRetry(status: string): boolean {
  return isTerminalStatus(status) && terminalOutcomeOf(status) === 'failed';
}

/** ISO 时间 → 毫秒时间戳；缺失或不可解析返回 null（调用方自己决定怎么兜底）。 */
function msOf(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 把快照里那条已经结束的 Run 翻成状态行要的「上一轮的账」。
 *
 * 起点取 `created_at` 而不是 `started_at`：状态行量的是**用户等了多久**，而排队、记忆投影、
 * 领券这些都发生在 `started_at` 之前，用后者会把这段等待抹掉。没有起点就返回 null——
 * 宁可不显示，也不要显示一个算错的耗时。
 */
function parseSettledTurn(run: SessionRun): { startedAt: number; outcome: TurnOutcome } | null {
  const startedAt = msOf(run.created_at) ?? msOf(run.started_at);
  if (startedAt === null) return null;
  return {
    startedAt,
    outcome: {
      outcome: terminalOutcomeOf(run.status),
      finishedAt: msOf(run.finished_at),
      tokenUsage: parseRunTokenUsage(run.token_usage),
      contextCapacity: parseRunContextCapacity(run.context_capacity),
      // 正文早已固化成消息，流式缓冲是空的：这里没有可估的东西，也不该去估。
      // 真实用量缺失时状态行自己会把 token 那一段省掉。
      estimatedOutputTokens: null,
    },
  };
}

/**
 * 删除已经报过错的哨兵。
 *
 * 用它把「删除本身失败」和「删完之后的善后失败」分成两条 catch——两者对用户是不同的话，
 * 前者「删除失败，可以重试」，后者「已经删掉了，只是没连上」。
 */
const DELETE_ALREADY_REPORTED = Symbol('delete-already-reported');

/** 运行中无产出事件的兜底提示阈值（毫秒）：超过该时长仍无 delta/思考/终态，提示用户可诊断信息，不无限「处理中」 */
const LONG_RUN_HINT_MS = 60_000;

/** 字段安全转字符串 */
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

/** content 块数组拼为纯文本 */
const textOf = (blocks: SessionMessage['content'] | undefined): string =>
  (blocks ?? [])
    .map((b) => (typeof b?.text === 'string' ? b.text : ''))
    .join('');

/**
 * 把生成卡挂到产出它的那条助手消息上。
 *
 * 卡片正文不在消息里——agent 的助手消息只有正文文字，卡片走 prompt_cards。用 authoring_run_id
 * 对上消息的 source_run_id，把卡片块接在该消息的块尾；对不上就挂到最后一条助手消息，避免
 * 用户明明看到"已出卡"却什么都没有。
 */
function attachCards(messages: ChatMessage[], records: PromptCardRecord[] | undefined): ChatMessage[] {
  const withCards = (records ?? []).filter((r) => r.active_revision?.payload?.shots?.length);
  if (withCards.length === 0) return messages;

  const next = [...messages];
  for (const record of withCards) {
    const cards = cardsFromRevision(record);
    if (cards.length === 0) continue;
    const blocks: SessionContentBlock[] = cards.map((card) => ({ type: 'card', card }));
    const runId = record.active_revision?.authoring_run_id;
    let idx = runId ? next.findIndex((m) => m.role === 'assistant' && m.sourceRunId === runId) : -1;
    if (idx < 0) idx = next.map((m) => m.role).lastIndexOf('assistant');
    if (idx < 0) continue;
    // 幂等：同一批次可能因重连再次水合，**只替换这一批**，别把别的批次一起抹掉（审查 W·A7）。
    //
    // 此前这里剥的是全部 card 块。配上下面那个 lastIndexOf 兜底——没有匹配到
    // authoring_run_id 的记录统统解析到同一个下标——两批卡片进来只有后一批留下。
    // 让重挂载安全的那个幂等过滤，正好也是让多批附加有损的原因。
    //
    // cardId 是 `${revision_id}#${shot_no}`，前缀就是这一批的身份：按前缀剥，
    // 剥掉的恰好是自己上一次挂的那些。
    const revisionId = record.active_revision?.revision_id;
    const mine = revisionId ? `${revisionId}#` : null;
    const kept = (next[idx]!.blocks ?? []).filter(
      (b) => b.type !== 'card' || (mine !== null && !(b.card?.cardId ?? '').startsWith(mine)),
    );
    next[idx] = { ...next[idx]!, blocks: [...kept, ...blocks] };
  }
  return next;
}

/** 快照消息 → UI 消息 */
const projectMessage = (m: SessionMessage): ChatMessage => ({
  id: m.message_id,
  role: m.role === 'user' ? 'user' : 'assistant',
  content: textOf(m.content),
  blocks: m.content ?? [],
  sequence_no: m.sequence,
  ...(m.source_run_id ? { sourceRunId: m.source_run_id } : {}),
});

/**
 * 画布 Agent 对话钩子（session 维度）
 * @param projectId 当前项目ID（空串时不初始化）
 */
export function useAgentSession(projectId: string) {
  /** 正式对话消息（快照水合 + 事件投影） */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** 当前会话ID */
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** 当前项目下的历史会话列表（新→旧，供历史会话下拉使用） */
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  /** 删除失败的那一行 + 原因：错误就显示在那一行上，下拉不关闭，用户能原地重试 */
  const [deleteError, setDeleteError] = useState<{ sessionId: string; message: string } | null>(null);
  /** 当前会话的事件订阅取消函数（切换会话时先解绑旧的，防串话） */
  const unsubRef = useRef<(() => void) | null>(null);
  /** 流式文本（assistant.delta 累积投影） */
  const [streamingText, setStreamingText] = useState('');
  /** 流式进行中（发送成功到运行终态之间） */
  const [streaming, setStreaming] = useState(false);
  /** 当前运行中的 Run ID */
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  /** 最近失败的 Run ID（供重试） */
  const [failedRunId, setFailedRunId] = useState<string | null>(null);
  /** 当前运行中的思考过程步骤（run.activity 流式累积）。只属于进行中的一轮：
   * 终态时整个搬进那条助手消息的 thinking 块——思考属于某一轮回复，不是对话级的悬浮物。 */
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const thinkingStepsRef = useRef<string[]>([]);
  thinkingStepsRef.current = thinkingSteps;
  /**
   * 模型自己的思考原文（assistant.reasoning.delta 累积）。
   *
   * 和上面那些步骤是两回事：那些是服务端选的模板，这是模型自己的话。分开存也分开渲染，
   * 因为它们的可信度不一样——模板是我们的承诺，思考是模型随口说的，混在一起看不出区别。
   *
   * 它存在的理由是首字之前那段空白：实测中位轮次要 8.4 秒才出第一个字，而那段时间里模型
   * 一直在思考。丢帧是合法的（服务端尽力而为），所以这里只做追加，不做完整性校验。
   */
  const [reasoningText, setReasoningText] = useState('');
  const reasoningTextRef = useRef('');
  reasoningTextRef.current = reasoningText;
  /**
   * 本轮开始的时刻。状态行的地板：提交那一刻就打点，不等 run.queued、不等模型吐字，
   * 这样"提交后什么都没有"的那几秒也有秒数在走。见 runStatusLine.ts。
   */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  /**
   * 上一轮的结账信息（IKA4PG）。终态到达时填，下一轮开始时清。
   *
   * 状态行不再随终态消失，而是留下来报这一轮的账，所以「跑完了」这件事必须有地方记：
   * turnStartedAt 一旦置空，状态行就没有起点可算了。
   */
  const [turnOutcome, setTurnOutcome] = useState<TurnOutcome | null>(null);
  /**
   * 起点与终局是同一件事的两半——「本轮的账」——所以对它们的改动一律走下面三个动作，
   * 不再各自裸调 setter。
   *
   * 理由是具体的：这两个状态此前在六处成对出现，其中一处只清了起点，结果是发送失败后
   * 上一轮的终局残留在屏幕上；另一处两个都清了，结果是回执直接终态时状态行整条消失。
   * 两个 bug 是同一种形状——改了一半。做成原子动作后这种写法就写不出来了。
   */
  /**
   * `turnOutcome` 的同步镜像。
   *
   * 事件处理器要判断「上一轮的账还挂着吗」，而它的依赖数组里没有 turnOutcome（挂进去会让
   * 整个处理器每轮重建）。ref 在下面几个原子动作里**同步**更新——不用 useEffect 同步，
   * 因为终态事件与紧随其后的新一轮开始事件之间可能没有一次渲染，effect 太晚。
   */
  const turnOutcomeRef = useRef<TurnOutcome | null>(null);
  const beginTurn = useCallback(() => {
    setTurnStartedAt(Date.now());
    turnOutcomeRef.current = null;
    setTurnOutcome(null);
  }, []);
  /** 本轮结束，留下这一轮的账。刻意不动 turnStartedAt：没有起点就算不出耗时。 */
  const settleTurn = useCallback((outcome: TurnOutcome) => {
    turnOutcomeRef.current = outcome;
    setTurnOutcome(outcome);
  }, []);
  /**
   * 新一轮的开始事件到达（`run.queued` / `run.started`）。
   *
   * 两种情形，必须分开处理——此前只做了前一种，于是有了审查 W·A1：
   *
   * 1. **本轮已经开表**（sendMessage 走的路）：什么都不做。本地打的点更早（提交那一刻），
   *    不该被服务端的排队时间往后推。
   * 2. **上一轮的终局还挂在屏幕上，却来了新一轮的开始**：重试、自动排队的下一轮、
   *    另一个标签页发起的 run——这三条路都不经过 sendMessage，因此谁都没清过 turnOutcome。
   *    结果是整轮显示上一轮的判决（「未能完成 12s」），秒数和 token 双双冻结，
   *    而这个文件的 docblock 说这条状态行是**活性信号**，绝不能死掉。
   *    此时用服务端时间重新起表——本地没有提交时刻可用。
   */
  const adoptTurnStart = useCallback((at: number) => {
    if (turnOutcomeRef.current !== null) {
      turnOutcomeRef.current = null;
      setTurnOutcome(null);
      setTurnStartedAt(at);
      return;
    }
    setTurnStartedAt((cur) => cur ?? at);
  }, []);
  /**
   * 从历史里把已经结束的那一轮重新立起来（刷新 / 切回一个旧会话）。
   *
   * 起点与终局此前是纯内存态：切会话被 `clearTurn` 抹掉，刷新则只有**还活着**的运行能靠
   * `run.queued` 事件补回起点——已经跑完的那一轮不会再发事件，于是状态行整条消失。
   * 而用户回看一个会话时想知道的恰恰是"上一轮花了多久、多少 token"，这份账本来就在
   * 快照的 `latest_terminal_run` 里躺着。
   *
   * 只在没有起点时生效：活着的运行由事件流负责，历史不该把它盖掉。
   */
  const adoptSettledTurn = useCallback((startedAt: number, outcome: TurnOutcome) => {
    setTurnStartedAt((cur) => {
      if (cur !== null) return cur;
      turnOutcomeRef.current = outcome;
      setTurnOutcome(outcome);
      return startedAt;
    });
  }, []);
  /** 这一轮当作没发生过（未开始、被计费门接管、或整个会话被换掉）。 */
  const clearTurn = useCallback(() => {
    setTurnStartedAt(null);
    turnOutcomeRef.current = null;
    setTurnOutcome(null);
  }, []);
  /** 正在写入的生成卡预览（prompt_card.partial.v1）。只用于展示，终态卡片到达即让位。 */
  const [partialCard, setPartialCard] = useState<PartialCardPreview | null>(null);
  /** 运行活跃但长期无产出事件（delta/思考步）的兜底提示标志：超阈值仍无终态时给用户可诊断信息，不无限「处理中」 */
  const [longRunning, setLongRunning] = useState(false);
  /** 产出事件计数：每次 delta 文本/思考步到达 +1，用于重置兜底计时（有进度就不提示） */
  const [progressTick, setProgressTick] = useState(0);
  /** 「新对话」失败提示：创建/连接新会话失败时展示，成功/切换后清除（不静默吞掉） */
  const [chatError, setChatError] = useState<string | null>(null);
  /** 重试接口不可用标志（后端 404 时置位：重试按钮禁用并说明原因，不做静默降级；新 run/新消息清除） */
  const [retryUnavailable, setRetryUnavailable] = useState(false);
  /** 消息提交失败（含 capability/payment 阻断）的用户可见提示 */
  const [sendError, setSendError] = useState<string | null>(null);
  /** Run 在计费门暂停时的可操作提示；保留 runningRunId 以允许取消，不再显示“处理中” */
  const [paymentRequiredMessage, setPaymentRequiredMessage] = useState<string | null>(null);

  /** 流式累积缓冲：收到的全部文本，永远是事实来源；显示多少由 revealedRef 决定 */
  const accRef = useRef('');
  /** 已露出的字数（小数）：模型一次给一整句，按帧匀速露出才像在打字，见 streamPacing.ts */
  const revealedRef = useRef(0);
  /** 匀速露出的动画帧句柄 */
  const revealFrameRef = useRef<number | null>(null);
  /** 上一帧时间戳，用来算帧间隔 */
  const revealLastAtRef = useRef(0);
  /** 当前流式交付对应的 run_id（delta stream_id 为 assistant_run_<id>） */
  const streamRunRef = useRef('');
  /** 运行态/流式态镜像（供回调内同步判断，避免闭包旧值） */
  const runningRef = useRef<string | null>(null);
  runningRef.current = runningRunId;
  const streamingRef = useRef(false);
  streamingRef.current = streaming;
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  /** 每次连接/复位递增；所有异步快照、水合和创建回调只允许当前代写入状态。 */
  const connectionEpochRef = useRef(0);
  /** 历史列表请求代次；session.updated 会使更早的列表响应失效，避免标题回滚。 */
  const sessionsEpochRef = useRef(0);
  /** 已观察到终态的 Run，防 REST ack 晚于 SSE 终态时把它重新标成运行中。 */
  const terminalRunIdsRef = useRef<Set<string>>(new Set());
  /** 本轮提交过生成卡的 Run：revision_committed 先到、run.completed 后到，用它串起两个事件 */
  const cardRunsRef = useRef<Set<string>>(new Set());

  /** 运行兜底计时：run 活跃且 LONG_RUN_HINT_MS 内无任何产出/终态事件 → 置 longRunning 提示（有 delta/思考即重置） */
  useEffect(() => {
    if (!runningRunId && !streaming) {
      setLongRunning(false);
      return;
    }
    setLongRunning(false);
    const t = window.setTimeout(() => setLongRunning(true), LONG_RUN_HINT_MS);
    return () => window.clearTimeout(t);
  }, [runningRunId, streaming, progressTick]);

  /** upsert 助手消息（按 message_id 幂等；与流式固化内容重复时合并） */
  const upsertAssistant = useCallback((msg: SessionMessage) => {
    const content = textOf(msg.content);
    const blocks = msg.content ?? [];
    // 服务端正式消息不带 thinking 块（思考链走 reasoning_trace）。整体替换 blocks 会把
    // 终态时刚固化进消息的思考抹掉，所以本地已有而来件没有时，把它保在最前面。
    const keepThinking = (existing: ChatMessage | undefined): SessionContentBlock[] => {
      if (blocks.some((b) => b.type === 'thinking')) return blocks;
      const prior = existing?.blocks?.filter((b) => b.type === 'thinking') ?? [];
      return prior.length > 0 ? [...prior, ...blocks] : blocks;
    };
    const runLink = msg.source_run_id ? { sourceRunId: msg.source_run_id } : {};
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.message_id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          content: content || next[idx].content,
          blocks: keepThinking(next[idx]),
          sequence_no: msg.sequence,
          ...runLink,
        };
        return next;
      }
      // 与流式固化的助手消息内容一致 → 替换其 id（避免重复气泡）
      const dupIdx = content ? prev.findIndex((m) => m.role === 'assistant' && m.content === content) : -1;
      if (dupIdx >= 0) {
        const next = [...prev];
        next[dupIdx] = {
          ...next[dupIdx],
          id: msg.message_id,
          blocks: keepThinking(next[dupIdx]),
          sequence_no: msg.sequence,
          ...runLink,
        };
        return next;
      }
      return [
        ...prev,
        { id: msg.message_id, role: 'assistant' as const, content, blocks, sequence_no: msg.sequence, ...runLink },
      ];
    });
  }, []);

  /** 确认用户消息：替换乐观气泡（无 client 关联字段，兜底最近一条乐观用户消息） */
  const confirmUser = useCallback((msg: SessionMessage) => {
    const content = textOf(msg.content);
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.message_id);
      if (idx >= 0) return prev; // 幂等
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].optimistic && prev[i].role === 'user') {
          const next = [...prev];
          next[i] = { id: msg.message_id, role: 'user', content, sequence_no: msg.sequence };
          return next;
        }
      }
      return [...prev, { id: msg.message_id, role: 'user' as const, content, sequence_no: msg.sequence }];
    });
  }, []);

  /** 停掉匀速露出的循环（终态、丢弃、切会话都要停，否则会对着空缓冲空转） */
  const stopReveal = useCallback(() => {
    if (revealFrameRef.current !== null) {
      cancelAnimationFrame(revealFrameRef.current);
      revealFrameRef.current = null;
    }
  }, []);

  /**
   * 按帧把缓冲里的文本匀速露出来。模型一次给一整句（实测每 ~200ms 一条、每条约 40 字），
   * 直接渲染就是一句一句往外蹦；这里只改显示节奏，不改也不丢任何文本。
   */
  const pumpReveal = useCallback(() => {
    if (revealFrameRef.current !== null) return;
    revealLastAtRef.current = performance.now();
    const step = () => {
      revealFrameRef.current = null;
      const now = performance.now();
      const elapsedMs = now - revealLastAtRef.current;
      revealLastAtRef.current = now;
      revealedRef.current = advanceReveal({
        revealed: revealedRef.current,
        received: accRef.current.length,
        elapsedMs,
        done: false,
      });
      setStreamingText(accRef.current.slice(0, Math.floor(revealedRef.current)));
      if (hasPendingReveal(revealedRef.current, accRef.current.length)) {
        revealFrameRef.current = requestAnimationFrame(step);
      }
    };
    revealFrameRef.current = requestAnimationFrame(step);
  }, []);

  /** 卸载时收掉动画帧，避免在已销毁的组件上 setState */
  useEffect(() => stopReveal, [stopReveal]);

  /** 固化流式缓冲为助手消息（运行终态时调用；与后续 assistant_message 按内容去重） */
  const settleStream = useCallback((runId: string) => {
    // 固化的是缓冲里的全部文本，不是画面上已经露出的部分：
    // 动画是表现，文本是事实，不能因为没播完就少存一段。
    const text = accRef.current;
    stopReveal();
    revealedRef.current = 0;
    accRef.current = '';
    setStreamingText('');
    streamingRef.current = false;
    setStreaming(false);
    if (!text.trim()) return;
    // 思考随消息走：固化成消息里的第一个块（正文之前），全局思考区随即清空。
    // 不这么做的话，回复一进 messages，全局思考块就落到它下面去了——正是被反复报过的那个观感。
    const steps = thinkingStepsRef.current;
    const reasoning = reasoningTextRef.current;
    setMessages((prev) => {
      if (prev.some((m) => m.role === 'assistant' && (m.content === text || m.id.includes(runId)))) {
        return prev;
      }
      const blocks: SessionContentBlock[] =
        steps.length > 0 || reasoning
          ? [
              { type: 'thinking', thinking: { steps, ...(reasoning ? { reasoning } : {}) } },
              { type: 'text', text },
            ]
          : [];
      return [
        ...prev,
        {
          id: `as-${runId}`,
          role: 'assistant' as const,
          content: text,
          blocks,
          sequence_no: Number.MAX_SAFE_INTEGER,
          sourceRunId: runId,
        },
      ];
    });
    if (steps.length > 0) setThinkingSteps([]);
    if (reasoning) setReasoningText('');
  }, [stopReveal]);

  /** 失败/取消/不确定终态不能把 provisional delta 固化成正式助手消息。 */
  const discardStream = useCallback(() => {
    stopReveal();
    revealedRef.current = 0;
    accRef.current = '';
    streamRunRef.current = '';
    streamingRef.current = false;
    setStreamingText('');
    setStreaming(false);
  }, [stopReveal]);

  /** 刷新历史会话列表（供下拉展示；新对话/切换后重拉一次即可，不做轮询） */
  const refreshSessions = useCallback(() => {
    if (!projectId) return;
    const epoch = sessionsEpochRef.current + 1;
    sessionsEpochRef.current = epoch;
    api.listSessions(projectId)
      .then(({ items }) => {
        if (sessionsEpochRef.current === epoch) setSessions(items ?? []);
      })
      .catch((e) => console.warn('获取历史会话列表失败:', e));
  }, [projectId]);

  /** 事件状态机：session SSE 事件 → 消息/运行态/流式文本 */
  const handleEvent = useCallback(
    (ev: SseEvent) => {
      const data = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
      const payload = (data.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<
        string,
        unknown
      >;
      const t = ev.type;

      /**
       * 回查快照，把本轮提交的生成卡挂到消息上。
       *
       * 定义在 handleEvent 内而不是提成 useCallback：这个文件的 hook 数量一变，热更新就会撞上
       * React 的 hook 顺序检查、整个面板白屏，要硬刷新才能恢复。这里不需要跨渲染稳定，普通函数够用。
       */
      const hydrateCards = async () => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        try {
          const snap = await api.fetchSessionSnapshot(projectId, sid);
          if (sessionIdRef.current !== sid) return; // 期间切走了会话，丢弃
          setMessages((prev) => attachCards(prev, snap.prompt_cards));
        } catch (e) {
          console.warn('回查生成卡失败:', e);
        }
      };

      if (t === 'stream.ready') return;

      /* ---- 思考过程流式更新（可折叠展示） ---- */
      if (t === 'reasoning_trace.updated.v1') {
        // 终态权威（V3 加法事件，run.completed 之后到达）：payload.reasoning_trace.steps 是
        // {kind, summary} 结构；旧实现读 payload.steps（不存在）导致思考链永远为空。
        const trace = (payload.reasoning_trace ?? {}) as { steps?: unknown };
        const steps = Array.isArray(trace.steps)
          ? trace.steps
              .map((s) => (typeof s === 'string' ? s : str((s as { summary?: unknown })?.summary)))
              .filter(Boolean)
          : [];
        if (steps.length === 0) return;
        const traceRunId = str(data.run_id);
        if (traceRunId && terminalRunIdsRef.current.has(traceRunId)) {
          // Run 已终态：思考已固化在那条助手消息里，最终链替换消息内的块。
          // 写回全局区会让它缀在整个对话末尾——思考必须待在它所属的回复上方。
          setMessages((prev) => {
            const idx = prev.findIndex(
              (m) => m.role === 'assistant' && (m.sourceRunId === traceRunId || m.id.includes(traceRunId)),
            );
            if (idx < 0) return prev;
            const target = prev[idx];
            const rest = (target.blocks ?? []).filter((b) => b.type !== 'thinking');
            const body = rest.length > 0 ? rest : target.content ? [{ type: 'text', text: target.content }] : [];
            const next = [...prev];
            next[idx] = { ...target, blocks: [{ type: 'thinking', thinking: { steps } }, ...body] };
            return next;
          });
        } else {
          setThinkingSteps(steps);
        }
        setProgressTick((p) => p + 1);
        return;
      }

      /* ---- 产卡过程中的逐版预览（prompt_card.partial.v1，加法事件；IKA3GF） ----
       * payload.payload 是模型正在写、尚未校验的对象：字段会缺、类型会不对。映射函数是全函数，
       * 任何形状都不会抛。能落到画布上的卡片只有终态那一张，这里纯展示。 */
      if (t === 'prompt_card.partial.v1') {
        const preview = toPartialCardPreview(payload.card_id, payload.payload);
        if (preview) {
          setPartialCard(preview);
          setProgressTick((p) => p + 1);
        }
        return;
      }

      /* ---- 模型自己的思考原文（assistant.reasoning.delta，IKA3M6）：填掉首字之前那段空白 ---- */
      if (t === 'assistant.reasoning.delta') {
        const chunk = str(payload.text);
        if (!chunk) return;
        setReasoningText((prev) => prev + chunk);
        setProgressTick((p) => p + 1);
        return;
      }

      /* ---- 运行中渐进思考（run.activity：W2 U7 实时思考面，payload {stage,summary,progress}） ---- */
      if (t === 'run.activity') {
        const summary = str(payload.summary);
        if (!summary) return;
        setThinkingSteps((prev) => (prev[prev.length - 1] === summary ? prev : [...prev, summary]));
        setProgressTick((p) => p + 1);
        return;
      }

      /* ---- 需求理解的提出与接纳：不再有 UI 形态（IKAI14） ----
       * `requirement_understanding.proposed.v1` / `.accepted.v1` 两条事件服务端仍然发，前端
       * **故意**不为它们渲染任何东西。这里原先长着一张带「确认需求理解 / 修改」按钮的确认卡，
       * 那是实现时自己长出来的，不是需求——最初的设想就是普通自然语言交互，竞品也没有这一步。
       *
       * 而且那张卡是坏的：它调的 `ui_action` 通道在 Run 之外，服务端只落库、开门、发事件，
       * 不调度下一轮，所以点完确认卡片收起、然后什么都不发生。另外两条通道（自然语言白名单、
       * 模型自判工具）都发生在 Run 内部，确认完同一轮就产卡——本来就是对的那两条。
       *
       * 现在理解摘要只走正文：模型本来就把它写在回复里。后端那道「没确认不产卡」的拦截仍然在，
       * 它拦的是「需求真的不够时别按假设产卡」，与有没有按钮无关。
       *
       * 要恢复 UI 的话请先回到 IKAI14 看这个决定的前因，不要因为「事件没人处理」就加回来。 */

      /* ---- 用户消息确认 ---- */
      if (t === 'message.accepted') {
        const msg = payload.message as SessionMessage | undefined;
        if (msg?.message_id) confirmUser(msg);
        const runId = str((payload.scheduling as Record<string, unknown> | undefined)?.run_id ?? data.run_id);
        if (runId) {
          setFailedRunId(null);
          runningRef.current = runId;
          setRunningRunId(runId);
          setRetryUnavailable(false);
          setPaymentRequiredMessage(null);
          setSendError(null);
        }
        return;
      }

      /* ---- 运行态 ---- */
      if (t === 'run.queued' || t === 'run.started') {
        const runId = str((payload.run as Record<string, unknown> | undefined)?.run_id ?? data.run_id);
        if (!runId) return;
        setFailedRunId((cur) => (cur === runId ? null : cur));
        // 刷新或重连后本地没有提交时刻，用事件自己的服务端时间补上，
        // 否则重进页面秒数会从 0 重新数，等了两分钟的用户看到"3s"。
        const queuedAt = Date.parse(str(data.occurred_at));
        adoptTurnStart(Number.isNaN(queuedAt) ? Date.now() : queuedAt);
        runningRef.current = runId;
        setRunningRunId(runId);
        // 新一轮开始：清掉上一轮思考，等 run.activity 事件重建（含自动排队的下一轮）
        setThinkingSteps([]);
        setReasoningText('');
        setPartialCard(null);
        setRetryUnavailable(false);
        setPaymentRequiredMessage(null);
        return;
      }

      /* ---- 助手流式增量（payload.text 为增量片段） ---- */
      if (t === 'assistant.delta') {
        const text = str(payload.text);
        if (!text) return;
        setProgressTick((p) => p + 1);
        const streamId = str(payload.stream_id);
        const runId = streamId.startsWith('assistant_run_')
          ? streamId.slice('assistant_run_'.length)
          : str(data.run_id);
        if (runId && runningRef.current === null && !terminalRunIdsRef.current.has(runId)) {
          runningRef.current = runId;
          setRunningRunId(runId);
        }
        // 新交付开始：复位缓冲
        if (streamRunRef.current !== runId) {
          streamRunRef.current = runId;
          accRef.current = '';
          revealedRef.current = 0;
        }
        accRef.current += text;
        pumpReveal();
        return;
      }

      /* ---- 计费门暂停：不是运行中，也不是可自动恢复的终态；明确提示并保留取消入口 ---- */
      if (t === 'run.payment_required') {
        const run = (payload.run ?? {}) as Record<string, unknown>;
        const reason = (payload.reason ?? {}) as Record<string, unknown>;
        const runId = str(run.run_id ?? data.run_id);
        discardStream();
        // 计费门是暂停不是终态，且下方 paymentRequiredMessage 会给出明确说明与处理入口。
        // 让状态行继续读秒会显得还在跑，报终局又不属实，因此这一段交给那条提示独占。
        clearTurn();
        setPartialCard(null);
        runningRef.current = runId || null;
        setRunningRunId(runId || null);
        setPaymentRequiredMessage(str(reason.message) || '运行授权或余额不足，请处理后继续，或取消本次运行。');
        return;
      }

      /* ---- 运行终态 ---- */
      if (
        t === 'run.completed' ||
        t === 'run.failed' ||
        t === 'run.cancelled' ||
        t === 'run.stopped' ||
        t === 'run.outcome_unknown'
      ) {
        const run = (payload.run ?? {}) as Record<string, unknown>;
        const runId = str(run.run_id ?? data.run_id);
        if (runId) terminalRunIdsRef.current.add(runId);
        // turnStartedAt 刻意保留：状态行结束后要留下来报这一轮的账（耗时与 token），清掉它
        // 就没有起点可算了。下一轮 sendMessage 会重新置位。
        settleTurn({
          outcome: terminalOutcomeOf(t.slice('run.'.length)),
          finishedAt: Date.now(),
          tokenUsage: parseRunTokenUsage(run.token_usage),
          contextCapacity: parseRunContextCapacity(run.context_capacity),
          // 必须赶在 settleStream/discardStream 之前取：它们下一行就把正文清空了。
          // 取 accRef 而不是 streamingText——前者是收到的全部，后者只是逐字动画已经露出的部分。
          estimatedOutputTokens: estimateOutputTokens(accRef.current),
        });
        // 终态一到就撤掉预览：这一刻起权威是校验过的卡片，让半成品留在屏幕上只会让人误以为能用。
        setPartialCard(null);
        if (t === 'run.completed') settleStream(runId);
        else discardStream();
        // completed 路径：settleStream 已把思考固化进助手消息并清空全局区；终态后到达的
        // reasoning_trace.updated.v1 直接更新消息内的块。非 completed 终态没有消息可挂，
        // 全局思考保留到下一轮 run.queued/started，供回看
        if (t === 'run.failed' || t === 'run.outcome_unknown') {
          setFailedRunId(runId || null);
        }
        setPaymentRequiredMessage(null);
        setRunningRunId((cur) => {
          const next = cur === runId ? null : cur;
          runningRef.current = next;
          return next;
        });
        const assistantMsg = payload.assistant_message as SessionMessage | undefined;
        if (assistantMsg?.message_id) upsertAssistant(assistantMsg);
        // 会话标题由 agent 服务异步生成（title_generation_failed 时保持 null）：run 终态后
        // 刷新一次历史会话列表，让自动标题/失败兜底无需重开下拉即可在下拉里可见
        refreshSessions();
        // 本轮提交过生成卡：正文只在快照里，事件带的是引用，必须回查一次再挂上去。
        // 只有 revision_committed 先到时才走这里；它后到的情况由它自己那个分支补。
        if (runId && cardRunsRef.current.has(runId)) {
          cardRunsRef.current.delete(runId);
          void hydrateCards();
        }
        return;
      }

      /* ---- 生成卡已提交：只带 card_id / revision 引用，正文要回查快照 ----
       *
       * 这个事件是 run.completed 之后才发出的加法事件（服务端先 publish 终态，再 track 一个
       * 异步任务写这条），实测两者相差 ~24ms。所以「等 run.completed 再回查」这条路在实时链路上
       * 永远走不到：终态到达时这个 Set 还是空的，回查不触发，卡片只能靠切会话或刷新才出现。
       * 两个方向都要接：终态已经过了就立刻回查，没过就记下来交给终态分支。 */
      if (t === 'prompt_card.revision_committed.v1') {
        const runId = str(data.run_id);
        if (!runId) return;
        if (terminalRunIdsRef.current.has(runId)) void hydrateCards();
        else cardRunsRef.current.add(runId);
        return;
      }

      /* ---- 会话更新（标题异步生成完成等）：就地刷新历史列表里该会话的标题/阶段 ---- */
      if (t === 'session.updated') {
        const s = (payload.session ?? null) as SessionRecord | null;
        if (s?.session_id) {
          sessionsEpochRef.current += 1;
          // upsert 而不是 map：刚创建的会话往往还没进本地列表（列表是上一次拉的），
          // 只 map 的话这条标题更新直接丢掉——头部标题会一直停在「新对话」。
          setSessions((prev) => {
            const idx = prev.findIndex((item) => item.session_id === s.session_id);
            if (idx < 0) return [s, ...prev];
            const next = [...prev];
            next[idx] = { ...next[idx], ...s };
            return next;
          });
        }
        return;
      }
    },
    [confirmUser, discardStream, pumpReveal, refreshSessions, settleStream, upsertAssistant, projectId, adoptTurnStart, settleTurn, clearTurn],
  );

  /** 复位本地对话态（切换会话/新对话） */
  const resetLocal = useCallback(() => {
    connectionEpochRef.current += 1;
    sessionsEpochRef.current += 1;
    unsubRef.current?.();
    unsubRef.current = null;
    stopReveal();
    revealedRef.current = 0;
    accRef.current = '';
    streamRunRef.current = '';
    cardRunsRef.current.clear();
    setMessages([]);
    setStreamingText('');
    setStreaming(false);
    setRunningRunId(null);
    runningRef.current = null;
    setFailedRunId(null);
    clearTurn();
    setThinkingSteps([]);
    setReasoningText('');
    setPartialCard(null);
    setChatError(null);
    setRetryUnavailable(false);
    setSendError(null);
    setPaymentRequiredMessage(null);
    terminalRunIdsRef.current.clear();
  }, [stopReveal, clearTurn]);

  /** 连接到指定会话：水合快照 + 订阅事件流（先解绑旧订阅，防止串话到上一个会话） */
  const connectSession = useCallback(
    async (session: { session_id: string }) => {
      const epoch = connectionEpochRef.current + 1;
      connectionEpochRef.current = epoch;
      unsubRef.current?.();
      unsubRef.current = null;
      const previousSessionId = sessionIdRef.current;
      sessionIdRef.current = session.session_id;
      setSessionId(session.session_id);
      let snap: Awaited<ReturnType<typeof api.fetchSessionSnapshot>>;
      try {
        snap = await api.fetchSessionSnapshot(projectId, session.session_id);
      } catch (e) {
        // 快照失败必须把会话 id 退回去（审查 W·A2）。
        //
        // 这个 id 是 `ensureSession` 的短路条件：留着它，用户关掉错误横幅继续发消息时
        // ensureSession 会直接返回，POST 也会成功、乐观气泡照常出现、streaming 置真——
        // **而 SSE 处理器根本没挂上**（抛出发生在 subscribeSessionEvents 之前）。
        // 于是没有 delta、没有终态，永远等不到回复，只能等 60 秒的兜底提示。
        // 退回去之后，下一次发送会重新走完整的连接流程，一次网络抖动不再是死局。
        if (connectionEpochRef.current === epoch && sessionIdRef.current === session.session_id) {
          sessionIdRef.current = previousSessionId;
          setSessionId(previousSessionId);
        }
        throw e;
      }
      if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return false;
      // 历史会话里已提交的生成卡同样要还原，否则刷新一次卡就没了
      setMessages(attachCards((snap.messages ?? []).map(projectMessage), snap.prompt_cards));
      setChatError(null);
      // 已经是终态的 active_run 归到「上一轮的账」那条路去（审查 W·A4）。
      //
      // 此前这里是 `if (active_run) {…} else if (latest_terminal_run) {…}`：active_run 存在
      // 但已终态时，内层三个分支一个都不匹配，外层的 else if 又被跳过——**重试按钮和状态行
      // 同时消失**，而那正是这段代码要恢复的两样东西。下面那行 `!isTerminalStatus(...)` 说明
      // 作者认为这种情况可达，只是没给它出路。
      const liveRun =
        snap.active_run?.run_id && !isTerminalStatus(snap.active_run.status) ? snap.active_run : null;
      const settledRun = liveRun
        ? null
        : (snap.active_run?.run_id && isTerminalStatus(snap.active_run.status)
            ? snap.active_run
            : snap.latest_terminal_run) ?? null;
      if (liveRun?.run_id) {
        if (liveRun.status === 'payment_required') {
          setRunningRunId(liveRun.run_id);
          runningRef.current = liveRun.run_id;
          setStreaming(false);
          setPaymentRequiredMessage(
            liveRun.failure?.message || '运行授权或余额不足，请处理后继续，或取消本次运行。',
          );
        } else {
          setRunningRunId(liveRun.run_id);
          runningRef.current = liveRun.run_id;
          setStreaming(true);
        }
      } else if (settledRun?.run_id) {
        if (needsRetry(settledRun.status)) {
          setFailedRunId(settledRun.run_id);
        }
        // 上一轮的账：起点用入队时刻（用户等待是从提交开始算的，不是从模型开始跑算的），
        // 终局用运行状态。两端时间缺一不可——没有起点就算不出耗时，没有终点秒数会一直走，
        // 一条早已结束的状态行看起来像还在跑。
        const settled = parseSettledTurn(settledRun);
        if (settled) adoptSettledTurn(settled.startedAt, settled.outcome);
      }
      if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return false;
      unsubRef.current = api.subscribeSessionEvents(
        projectId,
        session.session_id,
        snap.event_cursor ?? '',
        (event) => {
          if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return;
          handleEvent(event);
        },
      );
      return true;
    },
    [projectId, handleEvent, adoptSettledTurn],
  );

  /**
   * 确保当前有一个已连接的会话，没有就现建一个。
   *
   * 初始化只在挂载时跑一次，失败就把 sessionId 永久留在 null——用户此后每次发送
   * 都只能得到「会话正在初始化」，既不会自愈也没有重试入口，是个死胡同。
   * 发送前先走这里，让一次网络抖动不再毁掉整个面板。
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!projectId) return null;
    const { items } = await api.listSessions(projectId);
    const session = items?.[0] ?? (await api.createSession(projectId));
    if (!session?.session_id) return null;
    await connectSession(session);
    return sessionIdRef.current;
  }, [projectId, connectSession]);

  /** 初始化：列表取最近会话（无则创建）→ 连接会话 */
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    resetLocal();
    setSessionId(null);

    (async () => {
      try {
        const sessionsEpoch = sessionsEpochRef.current + 1;
        sessionsEpochRef.current = sessionsEpoch;
        const { items } = await api.listSessions(projectId);
        if (!alive) return;
        if (sessionsEpochRef.current === sessionsEpoch) setSessions(items ?? []);
        const session = items?.[0] ?? (await api.createSession(projectId));
        if (!alive || !session?.session_id) return;
        await connectSession(session);
      } catch (e) {
        if (alive) {
          console.warn('Agent 会话初始化失败:', e);
          setChatError('会话初始化失败，请稍后重试');
        }
      }
    })();

    return () => {
      alive = false;
      connectionEpochRef.current += 1;
      unsubRef.current?.();
      unsubRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, resetLocal]);

  /** 切换到历史会话（下拉选择） */
  const switchSession = useCallback(
    (targetId: string) => {
      if (!projectId || targetId === sessionIdRef.current) return;
      resetLocal();
      connectSession({ session_id: targetId }).catch((e) => {
        console.warn('切换会话失败:', e);
        setChatError('切换会话失败，请稍后重试');
      });
    },
    [projectId, resetLocal, connectSession],
  );

  /**
   * 删除历史会话（下拉「删除」二次确认后调用）。
   *
   * 删的是当前会话则回退到列表中下一个，全删光则新建一个。
   * 失败必须让用户看见：只 console.warn 的话，界面上就是「点了什么都没发生」。
   */
  const deleteSessionById = useCallback(
    (targetId: string) => {
      if (!projectId) return;
      setDeleteError((prev) => (prev?.sessionId === targetId ? null : prev));
      api.deleteSession(projectId, targetId)
        .catch((e) => {
          // 只有**删除本身**失败才报「删除失败」（审查 W·A6）。
          //
          // 此前 .catch 罩住了整个 .then 体，连同后面的 listSessions / createSession /
          // connectSession。删成功但重连失败时，resetLocal() 已经把面板清空了，用户却看到
          // 一条红色「删除失败」钉在一个**已经不存在的会话**行上，然后去重试一个必然 404
          // 的删除。善后失败是另一回事，走 chatError 那条路说「会话已删除，但重新连接失败」。
          console.warn('删除会话失败:', e);
          setDeleteError({
            sessionId: targetId,
            message: isApiError(e) ? `删除失败：${e.message}` : '删除失败，请重试',
          });
          throw DELETE_ALREADY_REPORTED;
        })
        .then(async () => {
          const sessionsEpoch = sessionsEpochRef.current + 1;
          sessionsEpochRef.current = sessionsEpoch;
          const { items } = await api.listSessions(projectId);
          if (sessionsEpochRef.current === sessionsEpoch) setSessions(items ?? []);
          if (targetId !== sessionIdRef.current) return;
          resetLocal();
          const next = items?.[0] ?? (await api.createSession(projectId));
          await connectSession(next);
        })
        .catch((e) => {
          if (e === DELETE_ALREADY_REPORTED) return;
          // 删除成功了，善后没成功。别把这说成删除失败——那会把用户送去重试一个 404。
          console.warn('删除后重新连接失败:', e);
          setChatError('会话已删除，但重新连接失败，请刷新页面');
        });
    },
    [projectId, resetLocal, connectSession],
  );

  /** 关掉某个会话行上的删除错误（用户重试或收起菜单时） */
  const dismissDeleteError = useCallback(() => setDeleteError(null), []);

  /** 发送消息：乐观上屏 + POST 提交（回复经事件流 assistant.delta 投影） */
  const sendMessage = useCallback(
    async (content: string, forcedSkillId?: string): Promise<boolean> => {
      const text = content.trim();
      if (!text) return false;
      if (!projectId) return false;
      // 会话没建起来（初始化失败、或还没跑完）就当场补一个，而不是把用户堵在门外。
      let sid = sessionIdRef.current;
      if (!sid) {
        try {
          sid = await ensureSession();
        } catch (e) {
          console.warn('会话自举失败:', e);
          sid = null;
        }
        if (!sid) {
          setSendError('会话建立失败，请检查网络后重试；输入内容已保留。');
          return false;
        }
        setSendError(null);
      }
      if (runningRef.current !== null || streamingRef.current) return false;
      const optimisticId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setSendError(null);
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          role: 'user' as const,
          content: text,
          sequence_no: Number.MAX_SAFE_INTEGER,
          optimistic: true,
        },
      ]);
      streamingRef.current = true;
      setStreaming(true);
      // 提交即开表。请求还没发出去、Run 还没排上队，用户也已经在等了，这段时间必须算进去。
      beginTurn();
      try {
        const connectionEpoch = connectionEpochRef.current;
        const ack = await api.sendSessionMessage(projectId, sid, text, { forcedCreativeSkillId: forcedSkillId });
        if (connectionEpochRef.current !== connectionEpoch || sessionIdRef.current !== sid) return true;
        if (ack.message?.message_id) confirmUser(ack.message);
        const run = ack.run;
        if (run?.run_id && !terminalRunIdsRef.current.has(run.run_id)) {
          if (run.status === 'payment_required') {
            streamingRef.current = false;
            setStreaming(false);
            // 与 SSE 那条 payment_required 路径保持一致（审查 W·A8）。
            // 那边的理由写在原处：计费门是暂停不是终态，让状态行继续读秒会显得还在跑，
            // 报终局又不属实，所以这一段交给下面的 paymentRequiredMessage 独占。
            // 同一件事走两条路进来，不该一条清表一条不清。
            clearTurn();
            runningRef.current = run.run_id;
            setRunningRunId(run.run_id);
            setPaymentRequiredMessage(
              run.failure?.message || '运行授权或余额不足，请处理后继续，或取消本次运行。',
            );
          } else if (isTerminalStatus(run.status)) {
            terminalRunIdsRef.current.add(run.run_id);
            streamingRef.current = false;
            setStreaming(false);
            // 回执回来时 Run 已经是终态（幂等命中、或排队即失败）：这仍然是一轮结束，
            // 该按终态报账，而不是把状态行整条抹掉。清掉起点等于让刚提交的那一轮
            // 在屏幕上凭空消失——用户看到的是自己发了一句话然后什么都没发生。
            settleTurn({
              outcome: terminalOutcomeOf(run.status),
              finishedAt: Date.now(),
              // 回执的 SessionRun 上没有这些字段，真实数字随后由事件流补。
              tokenUsage: null,
              contextCapacity: null,
              estimatedOutputTokens: null,
            });
            runningRef.current = null;
            setRunningRunId(null);
            if (needsRetry(run.status)) setFailedRunId(run.run_id);
          } else {
            runningRef.current = run.run_id;
            setRunningRunId(run.run_id);
          }
        }
        return true;
      } catch (e) {
        console.warn('Agent 消息发送失败:', e);
        streamingRef.current = false;
        setStreaming(false);
        // 这里刻意清空而不是写终局：请求就没发出去，这一轮从未开始，乐观消息也回滚了。
        // 屏幕并不沉默——下面的 sendError 会明确说发送失败且输入已保留，此时再挂一条
        // 「未能完成 0s」只是把同一件事说两遍。「地板」要托的是静默，不是已有提示的场合。
        clearTurn();
        setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
        if (isApiError(e) && e.code === 'capability_required') {
          setSendError('当前环境未配置 Agent 运行能力券，请联系管理员配置后重试；输入内容已保留。');
        } else if (isApiError(e) && (e.status === 402 || e.code === 'payment_required')) {
          setSendError('余额或运行授权不足，请处理后重试；输入内容已保留。');
        } else {
          setSendError(`消息发送失败：${e instanceof Error ? e.message : '请稍后重试'}；输入内容已保留。`);
        }
        return false;
      }
    },
    [confirmUser, projectId, ensureSession, beginTurn, settleTurn, clearTurn],
  );

  /**
   * 停止本轮回答（IKACCL）。
   *
   * 走会话级取消，不需要 runId——从点发送到拿到 runId 之间正是用户最想按取消的几秒，
   * 而那几秒里 runId 还不存在。守卫因此只要求会话在，不要求 Run 在。
   */
  const stopRun = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!projectId || !sid) return;
    setChatError(null);
    api.cancelSession(projectId, sid).catch((e) => {
      console.warn('停止 Agent 运行失败:', e);
      // 刻意**不**把本地状态清成「已停止」。
      //
      // 原来的写法在失败分支里清了 runningRunId 与 streaming，于是取消请求失败的样子和成功
      // 一模一样：按钮变回箭头，界面说停了，而后端那一轮还在跑。取消的路径写错打在 404 上
      // 整整这么久没被发现，正是因为这里替它圆了场。
      //
      // 这一轮到底停没停，权威在事件流：真停了会有终态事件，没停就该继续显示在跑。
      // 本地能做的只有把失败说出来。
      setChatError('停止失败，这一轮可能仍在运行；可稍后重试或刷新页面。');
    });
  }, [projectId]);

  /** 重试失败运行（仅 failed 可重试） */
  const retryRun = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!projectId || !sid || failedRunId === null) return;
    api.retrySessionRun(projectId, failedRunId)
      .then(() => {
        setFailedRunId(null);
        setStreaming(true);
      })
      .catch((e) => {
        if (isApiError(e) && e.status === 404) {
          // 后端未部署重试接口：不静默降级，保留失败态并禁用重试按钮（用户可见原因）
          setRetryUnavailable(true);
          return;
        }
        console.warn('重试 Agent 运行失败:', e);
      });
  }, [projectId, failedRunId]);

  /** 开启新对话：先解绑旧会话事件订阅，再创建新会话 + 重新订阅事件流
   * （否则 createSession 网络往返窗口内，旧会话迟到的消息事件会把刚清空的消息流重新填满） */
  const resetChat = useCallback(() => {
    if (!projectId) return;
    resetLocal();
    const resetEpoch = connectionEpochRef.current;
    setChatError(null);
    sessionIdRef.current = null;
    setSessionId(null);
    api.createSession(projectId)
      .then((session) => {
        if (connectionEpochRef.current !== resetEpoch || !session?.session_id) return false;
        return connectSession(session);
      })
      .then((connected) => {
        if (connected) refreshSessions();
      })
      .catch((e) => {
        console.warn('创建新会话失败:', e);
        setChatError('新会话创建失败，请稍后重试');
      });
  }, [projectId, resetLocal, connectSession, refreshSessions]);

  /** SSE/ack 长时间缺失时由用户主动重拉快照并重建订阅，避免无 Run ID 的假取消按钮。 */
  const reconnectSession = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!projectId || !sid) return;
    resetLocal();
    connectSession({ session_id: sid }).catch((e) => {
      console.warn('重新连接会话失败:', e);
      setChatError('重新连接失败，请稍后重试');
    });
  }, [projectId, resetLocal, connectSession]);

  return {
    messages,
    sessionId,
    sessions,
    streamingText,
    streaming,
    runningRunId,
    failedRunId,
    thinkingSteps,
    reasoningText,
    turnStartedAt,
    turnOutcome,
    partialCard,
    longRunning,
    chatError,
    retryUnavailable,
    sendError,
    paymentRequiredMessage,
    sendMessage,
    stopRun,
    retryRun,
    resetChat,
    reconnectSession,
    switchSession,
    deleteSession: deleteSessionById,
    deleteError,
    dismissDeleteError,
    refreshSessions,
  };
}

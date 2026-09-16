/* ============================================
 * useAgentSession 钩子：画布 Agent 对话状态机（session 维度）
 * 项目维度 /api/projects/:id/conversation 服务只接纳消息不执行 Run（worker 缺失），
 * 会话维度 /api/agent/v1/projects/:id/sessions 为唯一能产出助手回复的服务：
 * - 进入页面：列表取最近会话（无则创建）→ 快照水合消息历史 → 从 event_cursor 订阅事件流
 * - 事件流里能改数据的那部分全部交给纯函数 `reduceSessionEvent`（sessionTimeline.ts）：
 *   消息、进行中的一轮、每轮的账、运行态。这里只做副作用：打字动画、状态行计时、
 *   刷新会话列表、回查生成卡、错误横幅。
 * - 取消运行走 sessions/:sid/cancel；失败可重试
 *
 * 对外只交付 `turns[]`（IKDK5I）：一轮 = 一批用户输入 + 回答它的 Run + 按序条目。历史轮由
 * 快照投影，进行中的轮由事件流拼接，渲染函数不区分两者。
 * ============================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { advanceReveal, hasPendingReveal } from './streamPacing';
import {
  listSessions,
  createSession,
  deleteSession,
  fetchSessionSnapshot,
  listSessionRuns,
  sendSessionMessage,
  setSessionCreativeSkills,
  cancelSession,
  cancelSessionRun,
  retrySessionRun,
  subscribeSessionEvents,
  fetchPromptCardRevisions,
  confirmSolutionCard,
  voidSolutionCard,
  type SessionRecord,
  type SessionRun,
  type SessionContentBlock,
  type SseEvent,
  type PromptCardRecord,
  type PromptCardRevision,
  type GenerationCardBlock,
} from '@/api/agentSessions';
import { cardsFromRevision, cardsOfRevision, taskLabelsOf } from '@/api/promptCardMapping';
import { isApiError } from '@/api/http';
import { blockIfQuotaInsufficient, openRechargeForQuotaError } from '@/utils/quotaGate';
import { estimateOutputTokens, parseRunContextCapacity, parseRunTokenUsage } from './runStatusLine';
import type { RunContextCapacity, RunOutcome, RunTokenUsage } from './runStatusLine';
import { collectMissingQuoteIds, mergeConfirmedUser, patchQuoteTexts, projectMessage } from './userMessageProjection';
import { listConversationQuotes } from '@/api/canvas';
import {
  EMPTY_SESSION_STATE,
  accountOfRun,
  buildTurns,
  isTerminalStatus,
  msOf,
  reduceSessionEvent,
  startLiveRun,
  terminalOutcomeOf,
  type SessionState,
} from './sessionTimeline';

/** 一轮结束后的结账信息（IKA4PG）。 */
export interface TurnOutcome {
  outcome: RunOutcome;
  /** 终态时刻。从快照恢复的历史轮次可能没有（Run 异常终止时 finished_at 为空）。 */
  finishedAt: number | null;
  tokenUsage: RunTokenUsage | null;
  contextCapacity: RunContextCapacity | null;
  /** 结束那一刻按已收到正文估的输出 token。真实用量到达前由它顶着，见 runStatusLine。 */
  estimatedOutputTokens: number | null;
  /** 失败时后端的那句人话（run.failure.message）。 */
  failureText: string | null;
}

/** 数据源：真实 /api/agent/v1（经 BFF 代理到独立 agent 服务）。本地开发需起 backend:3100 + agent + SSH 隧道，见 bw-test-env。 */
const api = {
  listSessions,
  createSession,
  deleteSession,
  fetchSessionSnapshot,
  listSessionRuns,
  sendSessionMessage,
  cancelSession,
  cancelSessionRun,
  retrySessionRun,
  setSessionCreativeSkills,
  subscribeSessionEvents,
  fetchPromptCardRevisions,
};

/** 对话消息（UI 模型） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 结构化内容块（思考过程/工具调用/生成卡），无结构化时为空数组 */
  blocks?: SessionContentBlock[];
  /** 服务端事件序号（排序依据；本地乐观气泡为最大值） */
  sequence_no: number;
  /**
   * 这条消息所属的输入批次（IKDK5C）。用户消息是它进哪一批，助手消息是它**回答**哪一批。
   * 轮的归组只认它，不认序号——运行中再发一句，序号会比正在生成的回答小。
   */
  inputBatchId?: string | null;
  /** 产出这条消息的 Run；生成卡按它对回自己的助手消息 */
  sourceRunId?: string;
  /** 本地乐观上屏、尚未被服务端事件确认 */
  optimistic?: boolean;
  /** 用户消息携带的技能引用（用于气泡渲染） */
  skill_ref?: import('@/api/agentSessions').OutboundSkillRef;
  /** 用户消息携带的媒体资源引用（用于气泡渲染 chip） */
  resource_ref?: import('@/api/agentSessions').SessionContentBlock[];
  /** 输入框中 @ 的卡片气泡（与输入框展示一致，仅用于渲染） */
  chips?: { id: string; label: string }[];
}

/** 这一轮是否需要给用户一个重试入口。只对终态成立——还在跑的时候谈不上重试。 */
function needsRetry(status: string): boolean {
  return isTerminalStatus(status) && terminalOutcomeOf(status) === 'failed';
}

/**
 * 把快照里那条已经结束的 Run 翻成「上一轮的账」。
 *
 * 起点取 `created_at` 而不是 `started_at`：量的是**用户等了多久**，排队、记忆投影、领券都发生在
 * `started_at` 之前。没有起点就返回 null——宁可不显示，也不要显示一个算错的耗时。
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
      estimatedOutputTokens: null,
      failureText: run.failure?.message || null,
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

/** 字段安全转字符串 */
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

/**
 * 已经拿到正文的修订版，按 revision_id（IKEV0V）。修订一旦提交就不会再变，所以放模块级、跨会话
 * 共用。刻意不用 useRef：这个文件的 hook 数量一变，热更新就会撞上 React 的 hook 顺序检查
 * （见 hydrateCards 的注释）。
 */
const revisionCache = new Map<string, PromptCardRevision>();

/**
 * 把这组卡里还没拿到正文的历史版本取回来，放进 revisionCache。有新取回的返回 true，调用方据此
 * 重挂一次卡。当前生效的那一版不用取：快照里带着正文，attachCards 挂它时顺手缓存了。
 */
async function loadRevisionHistory(
  projectId: string,
  sessionId: string,
  records: PromptCardRecord[] | undefined,
): Promise<boolean> {
  const missing = (records ?? []).flatMap((record) =>
    (record.revisions ?? [])
      .map((summary) => summary.revision_id)
      .filter((id) => id !== record.active_revision_id && !revisionCache.has(id)),
  );
  if (missing.length === 0) return false;
  const revisions = await api.fetchPromptCardRevisions(projectId, sessionId, missing);
  for (const revision of revisions) revisionCache.set(revision.revision_id, revision);
  return revisions.length > 0;
}

/**
 * 把一个修订版的卡挂到写它的那一轮消息尾部。
 *
 * 幂等：同一批次可能因重连再次水合，**只替换这一批**，别把别的批次一起抹掉（审查 W·A7）。
 * cardId 是 `${revision_id}#${shot_no}`，前缀就是这一批的身份：按前缀剥，剥掉的恰好是自己上一次
 * 挂的那些。
 */
function placeCards(
  messages: ChatMessage[],
  cards: GenerationCardBlock[],
  revisionId: string,
  runId: string | undefined,
  fallbackToLastAssistant: boolean,
): ChatMessage[] {
  if (cards.length === 0) return messages;
  let idx = runId ? messages.findIndex((m) => m.role === 'assistant' && m.sourceRunId === runId) : -1;
  if (idx < 0 && fallbackToLastAssistant) idx = messages.map((m) => m.role).lastIndexOf('assistant');
  if (idx < 0) return messages;
  const next = [...messages];
  const mine = `${revisionId}#`;
  const kept = (next[idx]!.blocks ?? []).filter((b) => b.type !== 'card' || !(b.card?.cardId ?? '').startsWith(mine));
  const blocks: SessionContentBlock[] = cards.map((card) => ({ type: 'card', card }));
  next[idx] = { ...next[idx]!, blocks: [...kept, ...blocks] };
  return next;
}

/**
 * 把生成卡挂到产出它的那条助手消息上。
 *
 * 卡片正文不在消息里——agent 的助手消息只有正文文字，卡片走 prompt_cards。用 authoring_run_id
 * 对上消息的 source_run_id，把卡片块接在该消息的块尾。
 *
 * - **当前生效的那一版**：对不上就挂到最后一条助手消息，避免用户明明看到"已出卡"却什么都没有。
 * - **历史版本**（IKEV0V）：改过卡之后，上一版留在写它的那一轮下面——PRD 要求旧卡保留在对话历史中、
 *   刷新后仍可查看。正文要先由 loadRevisionHistory 取回；还没取回的先不挂。**对不上就不挂**：
 *   兜底挂到最后一条，正是「旧卡被当成这次的结果」。
 */
export function attachCards(
  messages: ChatMessage[],
  records: PromptCardRecord[] | undefined,
  /** 已取回正文的修订版。只有测试会传；运行时用模块级那一份。 */
  cache: Map<string, PromptCardRevision> = revisionCache,
  /** 会话里每件事的标签（IKG793）：另开的一件事的卡头上标「承接自上一张」。见 `taskLabelsOf`。 */
  taskLabels: ReadonlyMap<string, string> = new Map(),
): ChatMessage[] {
  let next = messages;
  // 一个会话可以有多组卡（IKG78T）：每组按自己的 authoring_run_id 挂到写它的那一轮，卡 id 里带修订号，互不覆盖。
  for (const record of records ?? []) {
    const sessionId = record.session_id ?? '';
    const taskLabel = taskLabels.get(record.task_id ?? `und_${sessionId}`);
    for (const summary of record.revisions ?? []) {
      if (summary.revision_id === record.active_revision_id) continue;
      const revision = cache.get(summary.revision_id);
      if (!revision) continue;
      next = placeCards(next, cardsOfRevision(sessionId, revision, taskLabel), revision.revision_id, summary.authoring_run_id, false);
    }
    const active = record.active_revision;
    if (!active?.payload?.shots?.length) continue;
    // 它下一次改卡后就成了历史版本，先缓存，到时候不必再取一遍。
    cache.set(active.revision_id, active);
    next = placeCards(next, cardsFromRevision(record, taskLabel), active.revision_id, active.authoring_run_id, true);
  }
  return next;
}

/**
 * 画布 Agent 对话钩子（session 维度）
 * @param projectId 当前项目ID（空串时不初始化）
 */
/**
 * @param agentModel 当前选中的 Agent 模型 id（IKE0II）。随每条消息发给 agent：带了就载入会话、
 *   之后一直生效，并冻到那一轮的 Run 上。空串表示模型列表还没加载完，此时不发这个字段，
 *   agent 按会话已选的、再按服务端 `AGENT_MODEL` 回落——与这个字段存在之前的行为逐字一致。
 */
export function useAgentSession(projectId: string, agentModel?: string) {
  /**
   * 事件流能改动的那部分状态：消息、进行中的一轮、每轮的账、运行态（sessionTimeline.ts）。
   *
   * 一份 state 加一份同步镜像 ref。事件处理器、动画帧、发送回执都要在渲染之间读到最新值，
   * 而它们此前各自持有一个 ref（accRef / thinkingStepsRef / runningRef / terminalRunIdsRef…），
   * 改一处漏一处。所有改动都走 `commit`。
   */
  const [session, setSession] = useState<SessionState>(EMPTY_SESSION_STATE);
  const sessionRef = useRef<SessionState>(EMPTY_SESSION_STATE);
  /**
   * 走 ref 而不是把 `agentModel` 放进 `sendMessage` 的依赖：`sendMessage` 被下游当作稳定引用
   * 用（发送按钮、快捷键、外部注入都挂着它），让它随下拉选择重建，会把那些 memo 一起打散。
   * 发送那一刻读 ref，拿到的就是用户此刻看见的那个模型。
   */
  const agentModelRef = useRef<string | undefined>(agentModel);
  agentModelRef.current = agentModel;
  const commit = useCallback((update: (prev: SessionState) => SessionState) => {
    const next = update(sessionRef.current);
    if (next === sessionRef.current) return;
    sessionRef.current = next;
    setSession(next);
  }, []);
  /** 当前会话ID */
  const [sessionId, setSessionId] = useState<string | null>(null);
  /**
   * 会话已载入的创作套路，以及会话当前的 etag（0028）。
   *
   * 一起放：改这排胶囊要带 If-Match，而 etag 每次会话变化都会变。分开存会出现「id 是新的、
   * etag 是旧的」，PUT 直接 412——那是一个只在多改几次之后才现形的 bug。
   */
  const [activeSkills, setActiveSkills] = useState<{ ids: string[]; etag: string | null }>({
    ids: [],
    etag: null,
  });
  /** 当前项目下的历史会话列表（新→旧，供历史会话下拉使用） */
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  /**
   * 同一份列表的 ref 镜像。删除要带这条会话自己的 etag（If-Match 乐观锁），而删除的回调
   * 不该因为列表变化就重建——它挂在下拉的每一行上。`session.updated` 会把新 etag 写回
   * 列表，这里读到的因此总是最新的那个。
   */
  const sessionsRef = useRef<SessionRecord[]>([]);
  sessionsRef.current = sessions;
  /** 删除失败的那一行 + 原因：错误就显示在那一行上，下拉不关闭，用户能原地重试 */
  const [deleteError, setDeleteError] = useState<{ sessionId: string; message: string } | null>(null);
  /** 当前会话的事件订阅取消函数（切换会话时先解绑旧的，防串话） */
  const unsubRef = useRef<(() => void) | null>(null);
  /** 打字动画已露出的正文前缀。缓冲在 live.text 里，这只是表现。 */
  const [streamingText, setStreamingText] = useState('');
  /** 流式进行中（发送成功到运行终态之间） */
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  streamingRef.current = streaming;
  /**
   * 本轮开始的时刻。状态行的地板：提交那一刻就打点，不等 run.queued、不等模型吐字，
   * 这样"提交后什么都没有"的那几秒也有秒数在走。见 runStatusLine.ts。
   */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  /**
   * 上一轮的结账信息。终态到达时填，下一轮开始时清。
   *
   * IKDK5L 之后状态行只在运行中显示，账挂到轮尾；这个值仍然要记——它是「这一轮结束了」
   * 这件事本身：状态行靠它判断该不该收起，积分查询靠它知道该刷新了。
   */
  const [turnOutcome, setTurnOutcome] = useState<TurnOutcome | null>(null);
  const turnOutcomeRef = useRef<TurnOutcome | null>(null);
  const beginTurn = useCallback(() => {
    setTurnStartedAt(Date.now());
    turnOutcomeRef.current = null;
    setTurnOutcome(null);
  }, []);
  /** 本轮结束。刻意不动 turnStartedAt：没有起点就算不出耗时。 */
  const settleTurn = useCallback((outcome: TurnOutcome) => {
    turnOutcomeRef.current = outcome;
    setTurnOutcome(outcome);
  }, []);
  /**
   * 新一轮的开始事件到达（`run.queued` / `run.started`）。
   *
   * 1. **本轮已经开表**（sendMessage 走的路）：什么都不做。本地打的点更早（提交那一刻）。
   * 2. **上一轮的终局还挂着，却来了新一轮的开始**：重试、自动排队的下一轮、另一个标签页
   *    发起的 run——都不经过 sendMessage。此时用服务端时间重新起表。
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
  /** 从历史里把已经结束的那一轮重新立起来（刷新 / 切回一个旧会话）。只在没有起点时生效。 */
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
  /** 「新对话」失败提示：创建/连接新会话失败时展示，成功/切换后清除（不静默吞掉） */
  const [chatError, setChatError] = useState<string | null>(null);
  /** 重试接口不可用标志（后端 404 时置位：重试按钮禁用并说明原因，不做静默降级；新 run/新消息清除） */
  const [retryUnavailable, setRetryUnavailable] = useState(false);
  /** 消息提交失败（含 capability/payment 阻断）的用户可见提示 */
  const [sendError, setSendError] = useState<string | null>(null);
  /** Run 在计费门暂停时的可操作提示；保留 runningRunId 以允许取消，不再显示“处理中” */
  const [paymentRequiredMessage, setPaymentRequiredMessage] = useState<string | null>(null);

  /** 已露出的字数（小数）：模型一次给一整句，按帧匀速露出才像在打字，见 streamPacing.ts */
  const revealedRef = useRef(0);
  /** 匀速露出的动画帧句柄 */
  const revealFrameRef = useRef<number | null>(null);
  /** 上一帧时间戳，用来算帧间隔 */
  const revealLastAtRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  /** 每次连接/复位递增；所有异步快照、水合和创建回调只允许当前代写入状态。 */
  const connectionEpochRef = useRef(0);
  /** 历史列表请求代次；session.updated 会使更早的列表响应失效，避免标题回滚。 */
  const sessionsEpochRef = useRef(0);
  /** 本轮提交过生成卡的 Run：revision_committed 先到、run.completed 后到，用它串起两个事件 */
  const cardRunsRef = useRef<Set<string>>(new Set());

  /** 记一笔账（快照里的 Run、Run 列表、发送回执）。事件流里的终态由 reducer 自己记。 */
  const recordAccount = useCallback(
    (run: SessionRun | null | undefined, fallbackFinishedAt: number | null = null) => {
      if (!run?.run_id) return;
      const account = accountOfRun(run, fallbackFinishedAt);
      if (!account) return;
      commit((prev) => ({ ...prev, accounts: { ...prev.accounts, [run.run_id]: account } }));
    },
    [commit],
  );

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
      const buffer = sessionRef.current.live?.text ?? '';
      const now = performance.now();
      const elapsedMs = now - revealLastAtRef.current;
      revealLastAtRef.current = now;
      revealedRef.current = advanceReveal({
        revealed: revealedRef.current,
        received: buffer.length,
        elapsedMs,
        done: false,
      });
      setStreamingText(buffer.slice(0, Math.floor(revealedRef.current)));
      if (hasPendingReveal(revealedRef.current, buffer.length)) {
        revealFrameRef.current = requestAnimationFrame(step);
      }
    };
    revealFrameRef.current = requestAnimationFrame(step);
  }, []);

  /** 卸载时收掉动画帧，避免在已销毁的组件上 setState */
  useEffect(() => stopReveal, [stopReveal]);

  /** 一轮结束（任何终态、计费门）：动画停、露出的前缀清零、流式态收起。数据由 reducer 管。 */
  const endStreaming = useCallback(() => {
    stopReveal();
    revealedRef.current = 0;
    setStreamingText('');
    streamingRef.current = false;
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

  /**
   * 事件状态机：数据交给 `reduceSessionEvent`，这里按事件类型补副作用。
   */
  const handleEvent = useCallback(
    (ev: SseEvent) => {
      const data = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
      const payload = (data.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<
        string,
        unknown
      >;
      const t = ev.type;
      const occurredAt = msOf(data.occurred_at) ?? Date.now();

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
          const labels = taskLabelsOf(snap.requirement_understandings);
          commit((prev) => ({ ...prev, messages: attachCards(prev.messages, snap.prompt_cards, undefined, labels) }));
          // 历史版本的正文另取，取回来再挂一次（IKEV0V）。当前这一版已经在上面挂好了，这一步失败不影响它。
          if (await loadRevisionHistory(projectId, sid, snap.prompt_cards)) {
            if (sessionIdRef.current !== sid) return;
            commit((prev) => ({ ...prev, messages: attachCards(prev.messages, snap.prompt_cards, undefined, labels) }));
          }
        } catch (e) {
          console.warn('回查生成卡失败:', e);
        }
      };

      if (t === 'stream.ready') return;

      const before = sessionRef.current;
      // 终态前先把正文估个 token：reducer 下一步就把缓冲清了。
      const bufferedText = before.live?.text ?? '';
      commit((prev) => reduceSessionEvent(prev, ev, occurredAt));
      const after = sessionRef.current;

      /* ---- 正文长了：让打字动画跟上 ---- */
      if (t === 'assistant.delta' && (after.live?.text ?? '') !== bufferedText) {
        pumpReveal();
        return;
      }

      /* ---- 按轮动作台账（run_actions.updated.v1）不再消费（IKCPQ1 / IKDK5K） ----
       * 它是同一次工具调用的另一份落库视图；工具行已经由 tool.activity 与 tool_call 部件
       * 画出终态与耗时，再挂一份台账就是同一事实画两次。服务端仍然发，这里不接。 */

      /* ---- 需求理解的提出与接纳：不再有 UI 形态（IKAI14） ----
       * `requirement_understanding.proposed.v1` / `.accepted.v1` 服务端仍然发，前端**故意**不为
       * 它们渲染任何东西。理解摘要只走正文，确认由模型在对话里判断。要恢复 UI 先回 IKAI14。 */

      if (t === 'message.accepted') {
        if (after.runningRunId && after.runningRunId !== before.runningRunId) {
          setRetryUnavailable(false);
          setPaymentRequiredMessage(null);
          setSendError(null);
        }
        return;
      }

      if (t === 'run.queued' || t === 'run.started') {
        if (!after.live) return;
        // 刷新或重连后本地没有提交时刻，用事件自己的服务端时间补上，
        // 否则重进页面秒数会从 0 重新数，等了两分钟的用户看到"3s"。
        adoptTurnStart(occurredAt);
        setRetryUnavailable(false);
        setPaymentRequiredMessage(null);
        return;
      }

      /* ---- 计费门暂停：不是运行中，也不是可自动恢复的终态；明确提示并保留取消入口 ---- */
      if (t === 'run.payment_required') {
        const reason = (payload.reason ?? {}) as Record<string, unknown>;
        endStreaming();
        // 计费门是暂停不是终态，且下方 paymentRequiredMessage 会给出明确说明与处理入口。
        // 让状态行继续读秒会显得还在跑，报终局又不属实，因此这一段交给那条提示独占。
        clearTurn();
        setPaymentRequiredMessage(str(reason.message) || '运行授权或余额不足，请处理后继续，或取消本次运行。');
        blockIfQuotaInsufficient();
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
        // turnStartedAt 刻意保留：积分查询与状态行收起都要知道「这一轮结束了」。
        settleTurn({
          outcome: terminalOutcomeOf(t.slice('run.'.length)),
          finishedAt: Date.now(),
          tokenUsage: parseRunTokenUsage(run.token_usage),
          contextCapacity: parseRunContextCapacity(run.context_capacity),
          estimatedOutputTokens: estimateOutputTokens(bufferedText),
          failureText: str((run.failure as Record<string, unknown> | undefined)?.message) || null,
        });
        endStreaming();
        setPaymentRequiredMessage(null);
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
       * 这个事件是 run.completed 之后才发出的加法事件（实测两者相差 ~24ms）。
       * 两个方向都要接：终态已经过了就立刻回查，没过就记下来交给终态分支。 */
      if (t === 'prompt_card.revision_committed.v1') {
        const runId = str(data.run_id);
        if (!runId) return;
        if (after.terminalRunIds.has(runId)) void hydrateCards();
        else cardRunsRef.current.add(runId);
        return;
      }

      /* ---- 会话更新（标题异步生成完成等）：就地刷新历史列表里该会话的标题/阶段 ---- */
      if (t === 'session.updated') {
        const s = (payload.session ?? null) as SessionRecord | null;
        if (s?.session_id) {
          // 胶囊与 etag 跟着会话走。同一个会话在另一个标签页里被改过，这里也就跟着变了。
          if (s.session_id === sessionIdRef.current) {
            setActiveSkills({ ids: s.active_creative_skill_ids ?? [], etag: s.etag ?? null });
          }
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
    [commit, endStreaming, pumpReveal, refreshSessions, projectId, adoptTurnStart, settleTurn, clearTurn],
  );

  /** 复位本地对话态（切换会话/新对话） */
  const resetLocal = useCallback(() => {
    connectionEpochRef.current += 1;
    sessionsEpochRef.current += 1;
    unsubRef.current?.();
    unsubRef.current = null;
    stopReveal();
    revealedRef.current = 0;
    cardRunsRef.current.clear();
    // 新开对话不带套路：这正是「会话级」的另一半——载入只在这一个会话里有效（0028）。
    setActiveSkills({ ids: [], etag: null });
    commit(() => EMPTY_SESSION_STATE);
    setStreamingText('');
    setStreaming(false);
    clearTurn();
    setChatError(null);
    setRetryUnavailable(false);
    setSendError(null);
    setPaymentRequiredMessage(null);
  }, [stopReveal, clearTurn, commit]);

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
        // 快照失败必须把会话 id 退回去（审查 W·A2）：留着它，ensureSession 会短路，
        // 用户继续发消息时 POST 成功、乐观气泡照常出现，**而 SSE 处理器根本没挂上**。
        if (connectionEpochRef.current === epoch && sessionIdRef.current === session.session_id) {
          sessionIdRef.current = previousSessionId;
          setSessionId(previousSessionId);
        }
        throw e;
      }
      if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return false;
      // 已经是终态的 active_run 归到「上一轮的账」那条路去（审查 W·A4）。
      const liveRun =
        snap.active_run?.run_id && !isTerminalStatus(snap.active_run.status) ? snap.active_run : null;
      const settledRun = liveRun
        ? null
        : (snap.active_run?.run_id && isTerminalStatus(snap.active_run.status)
            ? snap.active_run
            : snap.latest_terminal_run) ?? null;
      const accounts: SessionState['accounts'] = {};
      for (const run of [snap.active_run, snap.latest_terminal_run]) {
        const account = run?.run_id ? accountOfRun(run) : null;
        if (account && run?.run_id) accounts[run.run_id] = account;
      }
      // 历史会话里已提交的生成卡同样要还原，否则刷新一次卡就没了
      const restoredMessages = attachCards(
        (snap.messages ?? []).map(projectMessage),
        snap.prompt_cards,
        undefined,
        taskLabelsOf(snap.requirement_understandings),
      );
      commit(() => ({
        ...EMPTY_SESSION_STATE,
        messages: restoredMessages,
        // 刷新之后那张待确认的方案卡还要在、按钮还要能点（IKF3KE）。
        understandings: snap.requirement_understandings ?? [],
        accounts,
        runningRunId: liveRun?.run_id ?? null,
        failedRunId: settledRun?.run_id && needsRetry(settledRun.status) ? settledRun.run_id : null,
        // 正在跑的那一轮从这里立起来；它的思考与正文随后由事件流补。
        live:
          liveRun?.run_id && liveRun.status !== 'payment_required'
            ? startLiveRun(
                liveRun.run_id,
                liveRun.input_batch_id ?? null,
                msOf(liveRun.created_at) ?? msOf(liveRun.started_at) ?? Date.now(),
              )
            : null,
      }));
      // 刷新之后那排胶囊还在：这是会话级载入相对「前端自己记着」的全部意义（0028）。
      setActiveSkills({
        ids: snap.session?.active_creative_skill_ids ?? [],
        etag: snap.session?.etag ?? null,
      });
      setChatError(null);
      // IKDLQJ：历史消息里的文本引用若缺正文（agent 未 round-trip resource_text），按 quoteId 回读补齐，
      // 引用事实在刷新后仍可完整回读；失败只少正文悬浮内容，不影响对话本身。
      const missingQuoteIds = collectMissingQuoteIds(restoredMessages);
      if (missingQuoteIds.length > 0) {
        listConversationQuotes(projectId, missingQuoteIds)
          .then(({ items }) => {
            if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return;
            commit((prev) => ({ ...prev, messages: patchQuoteTexts(prev.messages, items) }));
          })
          .catch((e) => console.warn('回读对话引用快照失败:', e));
      }
      // IKEV0V：改过卡的会话，之前的版本要挂回各自那一轮。快照只带当前那一版的正文，历史版本另取；
      // 失败只少几张旧卡，当前那一版已经挂好了。
      loadRevisionHistory(projectId, session.session_id, snap.prompt_cards)
        .then((changed) => {
          if (!changed || connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return;
          commit((prev) => ({
            ...prev,
            messages: attachCards(prev.messages, snap.prompt_cards, undefined, taskLabelsOf(snap.requirement_understandings)),
          }));
        })
        .catch((e) => console.warn('取回历史生成卡失败:', e));
      if (liveRun?.run_id) {
        if (liveRun.status === 'payment_required') {
          setStreaming(false);
          setPaymentRequiredMessage(
            liveRun.failure?.message || '运行授权或余额不足，请处理后继续，或取消本次运行。',
          );
        } else {
          setStreaming(true);
        }
      } else if (settledRun?.run_id) {
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
      // 历史轮的账（IKDK5L）：快照只带最后两条 Run，其余从 Run 列表补。拉不到就少几行小字，不影响对话。
      api.listSessionRuns(projectId, session.session_id)
        .then(({ items }) => {
          if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return;
          for (const run of items ?? []) recordAccount(run);
        })
        .catch((e) => console.warn('获取会话运行记录失败:', e));
      return true;
    },
    [projectId, handleEvent, adoptSettledTurn, recordAccount, commit],
  );

  /**
   * 确保当前有一个已连接的会话，没有就现建一个。
   *
   * 初始化只在挂载时跑一次，失败就把 sessionId 永久留在 null——用户此后每次发送
   * 都只能得到「会话正在初始化」。发送前先走这里，让一次网络抖动不再毁掉整个面板。
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
      // 删哪条就用哪条的 etag：列表里每条会话都带着自己的那个，不必为此多打一次请求。
      // 列表里没有（刚建还没进列表之类）时传 undefined，deleteSession 自己回去读一次。
      const etag = sessionsRef.current.find((s) => s.session_id === targetId)?.etag;
      api.deleteSession(projectId, targetId, etag)
        .catch((e) => {
          // 只有**删除本身**失败才报「删除失败」（审查 W·A6）。善后失败是另一回事，
          // 走 chatError 那条路说「会话已删除，但重新连接失败」。
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
    async (
      content: import('@/api/agentSessions').SessionContentBlock[],
      forcedSkillId?: string,
      resourceRef?: import('@/api/agentSessions').SessionContentBlock[],
      skillName?: string,
      userText?: string,
      chips?: { id: string; label: string }[],
    ): Promise<boolean> => {
      const textBlocks = content
        .filter((b) => b.type === 'text' && !b.quote_id)
        .filter((b) => (b.text ?? '').trim().length > 0);
      // 没有显式传入就从 content 里捞非文本块，调用方少传一个参数也不会把胶囊漏掉。
      const finalResourceRef = resourceRef ?? content.filter((b) => b.type !== 'text' || b.quote_id);
      // 纯附件消息是合法的：上传一张图、一个字不打就发，是用户对附件做的第一个动作（IKAL46）。
      if (textBlocks.length === 0 && finalResourceRef.length === 0) return false;
      if (!projectId) return false;
      if (blockIfQuotaInsufficient()) return false;
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
      if (sessionRef.current.runningRunId !== null || streamingRef.current) return false;
      const optimisticId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setSendError(null);
      // 乐观上屏：用户侧气泡显示**用户实际输入的文字**（不含 chip prompt），胶囊各自单独渲染。
      const skillRef = forcedSkillId ? { skill_id: forcedSkillId, name: skillName ?? '' } : undefined;
      commit((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: optimisticId,
            role: 'user' as const,
            content: userText ?? '',
            // 乐观气泡也带上素材引用（IKAL46）：否则图要等服务端回执才出现，看着像「发完就没了」。
            blocks: finalResourceRef,
            sequence_no: Number.MAX_SAFE_INTEGER,
            inputBatchId: null,
            optimistic: true,
            skill_ref: skillRef,
            resource_ref: finalResourceRef.length > 0 ? finalResourceRef : undefined,
            chips: chips && chips.length > 0 ? chips : undefined,
          },
        ],
      }));
      streamingRef.current = true;
      setStreaming(true);
      // 提交即开表。请求还没发出去、Run 还没排上队，用户也已经在等了，这段时间必须算进去。
      beginTurn();
      try {
        const connectionEpoch = connectionEpochRef.current;
        const ack = await api.sendSessionMessage(projectId, sid, content, {
          forcedCreativeSkillId: forcedSkillId,
          resourceRef,
          skillRef,
          ...(agentModelRef.current ? { model: agentModelRef.current } : {}),
        });
        if (connectionEpochRef.current !== connectionEpoch || sessionIdRef.current !== sid) return true;
        const message = ack.message;
        if (message?.message_id) commit((prev) => ({ ...prev, messages: mergeConfirmedUser(prev.messages, message) }));
        const run = ack.run;
        if (run?.run_id && !sessionRef.current.terminalRunIds.has(run.run_id)) {
          if (run.status === 'payment_required') {
            streamingRef.current = false;
            setStreaming(false);
            // 与 SSE 那条 payment_required 路径保持一致（审查 W·A8）。
            clearTurn();
            commit((prev) => ({ ...prev, runningRunId: run.run_id }));
            setPaymentRequiredMessage(
              run.failure?.message || '运行授权或余额不足，请处理后继续，或取消本次运行。',
            );
            blockIfQuotaInsufficient();
          } else if (isTerminalStatus(run.status)) {
            streamingRef.current = false;
            setStreaming(false);
            // 回执回来时 Run 已经是终态（幂等命中、或排队即失败）：这仍然是一轮结束，
            // 该按终态报账，而不是把状态行整条抹掉。
            settleTurn({
              outcome: terminalOutcomeOf(run.status),
              finishedAt: Date.now(),
              tokenUsage: null,
              contextCapacity: null,
              estimatedOutputTokens: null,
              failureText: run.failure?.message || null,
            });
            commit((prev) => ({
              ...prev,
              runningRunId: null,
              failedRunId: needsRetry(run.status) ? run.run_id : prev.failedRunId,
              terminalRunIds: new Set(prev.terminalRunIds).add(run.run_id),
            }));
            recordAccount(run, Date.now());
          } else {
            // 回执可能先于 run.queued 事件到：这一轮从这里立起来，事件到了只补字段不重建。
            commit((prev) => ({
              ...prev,
              runningRunId: run.run_id,
              live:
                prev.live && prev.live.runId === run.run_id
                  ? prev.live
                  : startLiveRun(run.run_id, run.input_batch_id ?? message?.input_batch_id ?? null, Date.now()),
            }));
          }
        }
        return true;
      } catch (e) {
        console.warn('Agent 消息发送失败:', e);
        streamingRef.current = false;
        setStreaming(false);
        // 这里刻意清空而不是写终局：请求就没发出去，这一轮从未开始，乐观消息也回滚了。
        // 下面的 sendError 会明确说发送失败且输入已保留，再挂一条「未能完成 0s」只是把同一件事说两遍。
        clearTurn();
        commit((prev) => ({ ...prev, messages: prev.messages.filter((message) => message.id !== optimisticId) }));
        if (isApiError(e) && e.code === 'capability_required') {
          setSendError('当前环境未配置 Agent 运行能力券，请联系管理员配置后重试；输入内容已保留。');
        } else if (isApiError(e) && (e.status === 402 || e.code === 'payment_required')) {
          openRechargeForQuotaError(e);
          setSendError('余额不足，请充值后重试；输入内容已保留。');
        } else {
          setSendError(`消息发送失败：${e instanceof Error ? e.message : '请稍后重试'}；输入内容已保留。`);
        }
        return false;
      }
    },
    [projectId, ensureSession, beginTurn, settleTurn, clearTurn, recordAccount, commit],
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
      // 刻意**不**把本地状态清成「已停止」：这一轮到底停没停，权威在事件流。
      // 本地能做的只有把失败说出来。
      setChatError('停止失败，这一轮可能仍在运行；可稍后重试或刷新页面。');
    });
  }, [projectId]);

  /** 重试失败运行（仅 failed 可重试） */
  const retryRun = useCallback(() => {
    const sid = sessionIdRef.current;
    const failedRunId = sessionRef.current.failedRunId;
    if (!projectId || !sid || failedRunId === null) return;
    if (blockIfQuotaInsufficient()) return;
    api.retrySessionRun(projectId, failedRunId)
      .then(() => {
        commit((prev) => ({ ...prev, failedRunId: null }));
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
  }, [projectId, commit]);

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

  /**
   * 改会话已载入的创作套路（0028）。整份替换，空数组即全部取消。
   *
   * 不做乐观更新：写回来的会话视图就带着新的 ids 与 etag，`session.updated` 事件也会到，
   * 两条路都会刷新本地状态。乐观更新在这里只会制造一个「界面上没了、库里还在」的窗口。
   */
  const changeActiveSkills = useCallback(
    async (ids: string[]) => {
      const sid = sessionIdRef.current;
      if (!projectId || !sid || !activeSkills.etag) return false;
      try {
        const next = await api.setSessionCreativeSkills(projectId, sid, ids, activeSkills.etag);
        setActiveSkills({ ids: next.active_creative_skill_ids ?? [], etag: next.etag ?? null });
        return true;
      } catch (e) {
        // 412 是并发改动：另一个端刚改过，本地这份 etag 过期了。重读会话再让用户重来一次。
        console.warn('修改会话创作套路失败:', e);
        return false;
      }
    },
    [projectId, activeSkills.etag],
  );


  /**
   * 用户点了方案卡上的「确认」（IKF3KE）。
   *
   * 这一下就是这次改动的全部意义：在此之前，开门的是模型说的一句话。请求回执里带着它起的那一
   * 轮，但这里不拿它做状态——`message.accepted` 与 `run.queued` 事件随后会到，和发消息那条路
   * 同一套。失败就把错误交给调用方，卡留在原处让他再点一次。
   */
  const confirmSolution = useCallback(
    async (understandingId: string, version: number) => {
      const sid = sessionIdRef.current;
      if (!sid) return false;
      try {
        await confirmSolutionCard(projectId, sid, understandingId, version);
        return true;
      } catch (e) {
        console.warn('确认方案卡失败:', e);
        return false;
      }
    },
    [projectId],
  );

  /** 用户点了「取消」或「补充」：这一版作废。带上 note 就是「补充」，它当下一轮的输入。 */
  const voidSolution = useCallback(
    async (understandingId: string, version: number, note?: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return false;
      try {
        await voidSolutionCard(projectId, sid, understandingId, version, note);
        return true;
      } catch (e) {
        console.warn('作废方案卡失败:', e);
        return false;
      }
    },
    [projectId],
  );

  /** 屏幕上唯一的东西：轮。历史轮与进行中的轮同一份。 */
  const turns = useMemo(
    () => buildTurns(session.messages, session.live, session.accounts, session.understandings),
    [session.messages, session.live, session.accounts, session.understandings],
  );

  return {
    turns,
    sessionId,
    sessions,
    activeSkillIds: activeSkills.ids,
    changeActiveSkills,
    streamingText,
    streaming,
    runningRunId: session.runningRunId,
    failedRunId: session.failedRunId,
    /** 最近一个活动节点（状态行文案）。 */
    liveActivity: session.live?.lastActivity ?? null,
    turnStartedAt,
    turnOutcome,
    chatError,
    retryUnavailable,
    sendError,
    paymentRequiredMessage,
    sendMessage,
    confirmSolution,
    voidSolution,
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

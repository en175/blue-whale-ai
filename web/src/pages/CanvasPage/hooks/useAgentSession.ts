/* ============================================
 * useAgentSession 钩子：画布 Agent 对话状态机（session 维度）
 * 项目维度 /api/projects/:id/conversation 服务只接纳消息不执行 Run（worker 缺失），
 * 会话维度 /api/agent/v1/projects/:id/sessions 为唯一能产出助手回复的服务：
 * - 进入页面：列表取最近会话（无则创建）→ 快照水合消息历史 → 从 event_cursor 订阅事件流
 * - message.accepted → 确认用户消息；run.queued/started → 运行态
 * - assistant.delta → 流式文本投影；run.completed → 助手消息固化
 * - run.failed → 重试；取消运行走 runs/:runId/cancel
 * ============================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { advanceReveal, hasPendingReveal } from './streamPacing';
import { toPartialCardPreview, type PartialCardPreview } from './partialCardPreview';
import {
  listSessions,
  createSession,
  deleteSession,
  fetchSessionSnapshot,
  sendSessionMessage,
  cancelSessionRun,
  retrySessionRun,
  fetchRequirementUnderstandings,
  confirmRequirementUnderstanding,
  correctRequirementUnderstanding,
  subscribeSessionEvents,
  type SessionMessage,
  type SessionRecord,
  type SessionContentBlock,
  type SseEvent,
  type PromptCardRecord,
  type RequirementUnderstanding,
} from '@/api/agentSessions';
import { cardsFromRevision } from '@/api/promptCardMapping';
import { isApiError } from '@/api/http';
import { newIdempotencyKey } from '@/api/jobs';
import { deriveAgentPhase, type DerivedAgentPhase } from './agentSessionState';

/** 数据源：真实 /api/agent/v1（经 BFF 代理到独立 agent 服务）。本地开发需起 backend:3100 + agent + SSH 隧道，见 bw-test-env。 */
const api = {
  listSessions,
  createSession,
  deleteSession,
  fetchSessionSnapshot,
  sendSessionMessage,
  cancelSessionRun,
  retrySessionRun,
  fetchRequirementUnderstandings,
  confirmRequirementUnderstanding,
  correctRequirementUnderstanding,
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

/** 侧边栏用户可见状态（对齐 04-侧边栏规范 §7） */
export type AgentPhase = DerivedAgentPhase;

/** 运行终态集合（status_changed/run.* 终态判定） */
const TERMINAL_STATUS = [
  'completed',
  'succeeded',
  'failed',
  'cancelled',
  'canceled',
  'stopped',
  'outcome_unknown',
];

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
    // 幂等：同一批次可能因重连再次水合，已挂过就整体替换而不是追加
    const kept = (next[idx]!.blocks ?? []).filter((b) => b.type !== 'card');
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
  /** 服务端会话阶段（awaiting_understanding_confirmation 等）。确认门走自然语言之后，
   * 「正在等你确认」只能由服务端告知，前端无从从消息里推断。 */
  const [sessionPhase, setSessionPhase] = useState<string>('');
  /** 当前会话ID */
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** 当前项目下的历史会话列表（新→旧，供历史会话下拉使用） */
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
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
   * 本轮开始的时刻。状态行的地板：提交那一刻就打点，不等 run.queued、不等模型吐字，
   * 这样"提交后什么都没有"的那几秒也有秒数在走。见 runStatusLine.ts。
   */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  /** 正在写入的生成卡预览（prompt_card.partial.v1）。只用于展示，终态卡片到达即让位。 */
  const [partialCard, setPartialCard] = useState<PartialCardPreview | null>(null);
  /** 运行活跃但长期无产出事件（delta/思考步）的兜底提示标志：超阈值仍无终态时给用户可诊断信息，不无限「处理中」 */
  const [longRunning, setLongRunning] = useState(false);
  /** 产出事件计数：每次 delta 文本/思考步到达 +1，用于重置兜底计时（有进度就不提示） */
  const [progressTick, setProgressTick] = useState(0);
  /** 「新对话」失败提示：创建/连接新会话失败时展示，成功/切换后清除（不静默吞掉） */
  const [chatError, setChatError] = useState<string | null>(null);
  /** 待确认需求理解（确认门结构化 UI 数据源；proposed 事件 set，确认/修改/新 run/切会话清除） */
  const [pendingUnderstanding, setPendingUnderstanding] = useState<RequirementUnderstanding | null>(null);
  /** 确认/修改动作失败提示 */
  const [confirmError, setConfirmError] = useState<string | null>(null);
  /** 确认/修改请求在途：同步 ref 防同一渲染帧双击，state 驱动按钮禁用 */
  const [confirmationPending, setConfirmationPending] = useState(false);
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
  /** 确认动作同步防重入；React state 尚未刷新时也只能发一次 action_id。 */
  const confirmationPendingRef = useRef(false);
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
    setMessages((prev) => {
      if (prev.some((m) => m.role === 'assistant' && (m.content === text || m.id.includes(runId)))) {
        return prev;
      }
      const blocks: SessionContentBlock[] =
        steps.length > 0
          ? [{ type: 'thinking', thinking: { steps } }, { type: 'text', text }]
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

      /* ---- 运行中渐进思考（run.activity：W2 U7 实时思考面，payload {stage,summary,progress}） ---- */
      if (t === 'run.activity') {
        const summary = str(payload.summary);
        if (!summary) return;
        setThinkingSteps((prev) => (prev[prev.length - 1] === summary ? prev : [...prev, summary]));
        setProgressTick((p) => p + 1);
        return;
      }

      /* ---- 需求理解确认提案（确认门结构化 UI）：payload.understanding 为 requirementUnderstandingView ---- */
      if (t === 'requirement_understanding.proposed.v1') {
        const understanding = (payload.understanding ?? null) as RequirementUnderstanding | null;
        setPendingUnderstanding(understanding);
        setConfirmError(null);
        confirmationPendingRef.current = false;
        setConfirmationPending(false);
        return;
      }

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
        setTurnStartedAt((cur) => cur ?? (Number.isNaN(queuedAt) ? Date.now() : queuedAt));
        runningRef.current = runId;
        setRunningRunId(runId);
        // 新一轮开始：清掉上一轮思考与待确认卡，等 run.activity / proposed 事件重建（含自动排队的下一轮）
        setThinkingSteps([]);
        setPartialCard(null);
        setPendingUnderstanding(null);
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
        setTurnStartedAt(null);
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
        setTurnStartedAt(null);
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
        const phase = str(payload.session_phase);
        if (phase) setSessionPhase(phase);
        // 会话标题由 agent 服务异步生成（title_generation_failed 时保持 null）：run 终态后
        // 刷新一次历史会话列表，让自动标题/失败兜底无需重开下拉即可在下拉里可见
        refreshSessions();
        // 本轮提交过生成卡：正文只在快照里，事件带的是引用，必须回查一次再挂上去
        if (runId && cardRunsRef.current.has(runId)) {
          cardRunsRef.current.delete(runId);
          const sid = sessionIdRef.current;
          if (sid) {
            api.fetchSessionSnapshot(projectId, sid)
              .then((snap) => {
                if (sessionIdRef.current !== sid) return; // 期间切走了会话，丢弃
                setMessages((prev) => attachCards(prev, snap.prompt_cards));
                if (snap.session?.phase) setSessionPhase(snap.session.phase);
              })
              .catch((e) => console.warn('回查生成卡失败:', e));
          }
        }
        return;
      }

      /* ---- 生成卡已提交：只带 card_id / revision 引用，正文等 run.completed 后回查快照 ---- */
      if (t === 'prompt_card.revision_committed.v1') {
        const runId = str(data.run_id);
        if (runId) cardRunsRef.current.add(runId);
        return;
      }

      /* ---- 会话更新（标题异步生成完成等）：就地刷新历史列表里该会话的标题/阶段 ---- */
      if (t === 'session.updated') {
        const s = (payload.session ?? null) as SessionRecord | null;
        if (s?.session_id) {
          sessionsEpochRef.current += 1;
          setSessions((prev) => prev.map((item) => (item.session_id === s.session_id ? { ...item, ...s } : item)));
        }
        return;
      }
    },
    [confirmUser, discardStream, pumpReveal, refreshSessions, settleStream, upsertAssistant, projectId],
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
    setSessionPhase('');
    setMessages([]);
    setStreamingText('');
    setStreaming(false);
    setRunningRunId(null);
    runningRef.current = null;
    setFailedRunId(null);
    setTurnStartedAt(null);
    setThinkingSteps([]);
    setPartialCard(null);
    setChatError(null);
    setPendingUnderstanding(null);
    setConfirmError(null);
    confirmationPendingRef.current = false;
    setConfirmationPending(false);
    setRetryUnavailable(false);
    setSendError(null);
    setPaymentRequiredMessage(null);
    terminalRunIdsRef.current.clear();
  }, [stopReveal]);

  /** 连接到指定会话：水合快照 + 订阅事件流（先解绑旧订阅，防止串话到上一个会话） */
  const connectSession = useCallback(
    async (session: { session_id: string }) => {
      const epoch = connectionEpochRef.current + 1;
      connectionEpochRef.current = epoch;
      unsubRef.current?.();
      unsubRef.current = null;
      sessionIdRef.current = session.session_id;
      setSessionId(session.session_id);
      const snap = await api.fetchSessionSnapshot(projectId, session.session_id);
      if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return false;
      // 历史会话里已提交的生成卡同样要还原，否则刷新一次卡就没了
      setMessages(attachCards((snap.messages ?? []).map(projectMessage), snap.prompt_cards));
      setSessionPhase(snap.session?.phase ?? '');
      setChatError(null);
      // 确认门恢复：snapshot 不带待确认 understanding，等待确认阶段单独拉一次
      if (snap.session?.phase === 'awaiting_understanding_confirmation') {
        api.fetchRequirementUnderstandings(projectId, session.session_id)
          .then(({ items }) => {
            if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return;
            const pending = (items ?? []).find((u) => u.status === 'awaiting_confirmation');
            if (pending) {
              setPendingUnderstanding(pending);
              setConfirmError(null);
            }
          })
          .catch((e) => console.warn('拉取待确认需求理解失败:', e));
      }
      if (snap.active_run?.run_id) {
        if (snap.active_run.status === 'payment_required') {
          setRunningRunId(snap.active_run.run_id);
          runningRef.current = snap.active_run.run_id;
          setStreaming(false);
          setPaymentRequiredMessage(
            snap.active_run.failure?.message || '运行授权或余额不足，请处理后继续，或取消本次运行。',
          );
        } else if (!TERMINAL_STATUS.includes(snap.active_run.status)) {
          setRunningRunId(snap.active_run.run_id);
          runningRef.current = snap.active_run.run_id;
          setStreaming(true);
        }
      } else if (
        snap.latest_terminal_run?.run_id &&
        ['failed', 'outcome_unknown'].includes(snap.latest_terminal_run.status)
      ) {
        setFailedRunId(snap.latest_terminal_run.run_id);
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
    [projectId, handleEvent],
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

  /** 删除历史会话（下拉「删除」二次确认后调用）：删的是当前会话则回退到列表中下一个，全删光则新建一个 */
  const deleteSessionById = useCallback(
    (targetId: string) => {
      if (!projectId) return;
      api.deleteSession(projectId, targetId)
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
        .catch((e) => console.warn('删除会话失败:', e));
    },
    [projectId, resetLocal, connectSession],
  );

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
      setTurnStartedAt(Date.now());
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
            runningRef.current = run.run_id;
            setRunningRunId(run.run_id);
            setPaymentRequiredMessage(
              run.failure?.message || '运行授权或余额不足，请处理后继续，或取消本次运行。',
            );
          } else if (TERMINAL_STATUS.includes(run.status)) {
            terminalRunIdsRef.current.add(run.run_id);
            streamingRef.current = false;
            setStreaming(false);
            setTurnStartedAt(null);
            runningRef.current = null;
            setRunningRunId(null);
            if (['failed', 'outcome_unknown'].includes(run.status)) setFailedRunId(run.run_id);
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
        setTurnStartedAt(null);
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
    [confirmUser, projectId, ensureSession],
  );

  /** 停止当前运行 POST runs/:runId/cancel（终态由事件流推送） */
  const stopRun = useCallback(() => {
    const sid = sessionIdRef.current;
    const runId = runningRef.current;
    if (!projectId || !sid || !runId) return;
    api.cancelSessionRun(projectId, sid, runId).catch((e) => {
      console.warn('停止 Agent 运行失败:', e);
      runningRef.current = null;
      streamingRef.current = false;
      setRunningRunId(null);
      setStreaming(false);
    });
  }, [projectId]);

  /** 重试失败运行（仅 failed 可重试） */
  const retryRun = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!projectId || !sid || failedRunId === null) return;
    api.retrySessionRun(projectId, sid, failedRunId)
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

  /** 确认需求理解（ui_action confirm 通道）：提交后由事件流驱动后续生成；成功即收起确认卡 */
  const confirmUnderstanding = useCallback(async (): Promise<boolean> => {
    const u = pendingUnderstanding;
    const sid = sessionIdRef.current;
    if (!projectId || !sid || !u || confirmationPendingRef.current) return false;
    const epoch = connectionEpochRef.current;
    confirmationPendingRef.current = true;
    setConfirmationPending(true);
    setConfirmError(null);
    try {
      await api.confirmRequirementUnderstanding(projectId, sid, u.understanding_id, u.version, newIdempotencyKey());
      if (connectionEpochRef.current === epoch) setPendingUnderstanding(null);
      return true;
    } catch (e) {
      console.warn('确认需求理解失败:', e);
      if (connectionEpochRef.current === epoch) setConfirmError('确认失败，请重试');
      return false;
    } finally {
      if (connectionEpochRef.current === epoch) {
        confirmationPendingRef.current = false;
        setConfirmationPending(false);
      }
    }
  }, [projectId, pendingUnderstanding]);

  /** 修改需求理解（ui_action correct 通道）：以用户替换文本重新提议，提交后由事件流驱动下一轮 */
  const correctUnderstanding = useCallback(async (acceptedSummary: string): Promise<boolean> => {
    const u = pendingUnderstanding;
    const sid = sessionIdRef.current;
    if (!acceptedSummary.trim()) {
      setConfirmError('请输入修改后的需求理解');
      return false;
    }
    if (!projectId || !sid || !u || confirmationPendingRef.current) return false;
    const epoch = connectionEpochRef.current;
    confirmationPendingRef.current = true;
    setConfirmationPending(true);
    setConfirmError(null);
    try {
      await api.correctRequirementUnderstanding(
        projectId,
        sid,
        u.understanding_id,
        u.version,
        newIdempotencyKey(),
        acceptedSummary.trim(),
      );
      if (connectionEpochRef.current === epoch) setPendingUnderstanding(null);
      return true;
    } catch (e) {
      console.warn('修改需求理解失败:', e);
      if (connectionEpochRef.current === epoch) setConfirmError('修改失败，请重试');
      return false;
    } finally {
      if (connectionEpochRef.current === epoch) {
        confirmationPendingRef.current = false;
        setConfirmationPending(false);
      }
    }
  }, [projectId, pendingUnderstanding]);

  /** 侧边栏状态机推导：最新助手消息的内容块类型 + 运行态 → 用户可见状态 */
  const agentPhase = useMemo<AgentPhase>(
    () =>
      deriveAgentPhase({
        messages,
        running: runningRunId !== null,
        streaming,
        failed: failedRunId !== null,
        sessionPhase,
        paymentRequired: paymentRequiredMessage !== null,
      }),
    [messages, runningRunId, streaming, failedRunId, sessionPhase, paymentRequiredMessage],
  );

  return {
    messages,
    sessionId,
    sessions,
    streamingText,
    streaming,
    runningRunId,
    failedRunId,
    thinkingSteps,
    turnStartedAt,
    partialCard,
    longRunning,
    chatError,
    pendingUnderstanding,
    confirmError,
    confirmationPending,
    confirmUnderstanding,
    correctUnderstanding,
    retryUnavailable,
    sendError,
    paymentRequiredMessage,
    agentPhase,
    sendMessage,
    stopRun,
    retryRun,
    resetChat,
    reconnectSession,
    switchSession,
    deleteSession: deleteSessionById,
    refreshSessions,
  };
}

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
import {
  listSessions,
  createSession,
  deleteSession,
  fetchSessionSnapshot,
  sendSessionMessage,
  cancelSessionRun,
  retrySessionRun,
  subscribeSessionEvents,
  type SessionMessage,
  type SessionRecord,
  type SessionContentBlock,
  type SseEvent,
  type PromptCardRecord,
} from '@/api/agentSessions';
import { cardsFromRevision } from '@/api/promptCardMapping';
import { isApiError } from '@/api/http';

/** 数据源：真实 /api/agent/v1（经 BFF 代理到独立 agent 服务）。本地开发需起 backend:3100 + agent + SSH 隧道，见 bw-test-env。 */
const api = {
  listSessions,
  createSession,
  deleteSession,
  fetchSessionSnapshot,
  sendSessionMessage,
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

/** 侧边栏用户可见状态（对齐 04-侧边栏规范 §7） */
export type AgentPhase =
  | 'idle' // 等待输入
  | 'processing' // Agent 处理中
  | 'awaiting_input' // 等待用户补充（追问后）
  | 'awaiting_confirm' // 等待用户确认理解（确认门）；确认走自然语言，阶段由服务端 phase 给出
  | 'generating_cards' // 生成卡生成中
  | 'cards_ready' // 生成卡已生成
  | 'applying' // 生成卡应用中
  | 'applied' // 生成卡已应用
  | 'failed'; // Agent 端处理失败

/** 运行终态集合（status_changed/run.* 终态判定） */
const TERMINAL_STATUS = ['completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'stopped'];

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
  /** 当前运行中的思考过程步骤（reasoning_trace.updated.v1 流式累积） */
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);

  /** 流式累积缓冲 */
  const accRef = useRef('');
  /** 当前流式交付对应的 run_id（delta stream_id 为 assistant_run_<id>） */
  const streamRunRef = useRef('');
  /** 运行态/流式态镜像（供回调内同步判断，避免闭包旧值） */
  const runningRef = useRef<string | null>(null);
  runningRef.current = runningRunId;
  const streamingRef = useRef(false);
  streamingRef.current = streaming;
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  /** 本轮提交过生成卡的 Run：revision_committed 先到、run.completed 后到，用它串起两个事件 */
  const cardRunsRef = useRef<Set<string>>(new Set());

  /** upsert 助手消息（按 message_id 幂等；与流式固化内容重复时合并） */
  const upsertAssistant = useCallback((msg: SessionMessage) => {
    const content = textOf(msg.content);
    const blocks = msg.content ?? [];
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.message_id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], content: content || next[idx].content, blocks, sequence_no: msg.sequence };
        return next;
      }
      // 与流式固化的助手消息内容一致 → 替换其 id（避免重复气泡）
      const dupIdx = content ? prev.findIndex((m) => m.role === 'assistant' && m.content === content) : -1;
      if (dupIdx >= 0) {
        const next = [...prev];
        next[dupIdx] = { ...next[dupIdx], id: msg.message_id, blocks, sequence_no: msg.sequence };
        return next;
      }
      return [
        ...prev,
        { id: msg.message_id, role: 'assistant' as const, content, blocks, sequence_no: msg.sequence },
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

  /** 固化流式缓冲为助手消息（运行终态时调用；与后续 assistant_message 按内容去重） */
  const settleStream = useCallback((runId: string) => {
    const text = accRef.current;
    accRef.current = '';
    setStreamingText('');
    setStreaming(false);
    if (!text.trim()) return;
    setMessages((prev) => {
      if (prev.some((m) => m.role === 'assistant' && (m.content === text || m.id.includes(runId)))) {
        return prev;
      }
      return [
        ...prev,
        { id: `as-${runId}`, role: 'assistant' as const, content: text, sequence_no: Number.MAX_SAFE_INTEGER },
      ];
    });
  }, []);

  /** 刷新历史会话列表（供下拉展示；新对话/切换后重拉一次即可，不做轮询） */
  const refreshSessions = useCallback(() => {
    if (!projectId) return;
    api.listSessions(projectId)
      .then(({ items }) => setSessions(items ?? []))
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
        const steps = Array.isArray(payload.steps) ? payload.steps.map((s) => str(s)).filter(Boolean) : [];
        if (steps.length > 0) setThinkingSteps(steps);
        return;
      }

      /* ---- 用户消息确认 ---- */
      if (t === 'message.accepted') {
        const msg = payload.message as SessionMessage | undefined;
        if (msg?.message_id) confirmUser(msg);
        const runId = str((payload.scheduling as Record<string, unknown> | undefined)?.run_id ?? data.run_id);
        if (runId) {
          setFailedRunId(null);
          setRunningRunId(runId);
        }
        return;
      }

      /* ---- 运行态 ---- */
      if (t === 'run.queued' || t === 'run.started') {
        const runId = str((payload.run as Record<string, unknown> | undefined)?.run_id ?? data.run_id);
        if (!runId) return;
        setFailedRunId((cur) => (cur === runId ? null : cur));
        setRunningRunId(runId);
        return;
      }

      /* ---- 助手流式增量（payload.text 为增量片段） ---- */
      if (t === 'assistant.delta') {
        const text = str(payload.text);
        if (!text) return;
        const streamId = str(payload.stream_id);
        const runId = streamId.startsWith('assistant_run_')
          ? streamId.slice('assistant_run_'.length)
          : str(data.run_id);
        // 新交付开始：复位缓冲
        if (streamRunRef.current !== runId) {
          streamRunRef.current = runId;
          accRef.current = '';
        }
        accRef.current += text;
        setStreamingText(accRef.current);
        return;
      }

      /* ---- 运行终态 ---- */
      if (t === 'run.completed' || t === 'run.failed' || t === 'run.cancelled' || t === 'run.stopped') {
        const run = (payload.run ?? {}) as Record<string, unknown>;
        const runId = str(run.run_id ?? data.run_id);
        settleStream(runId);
        setThinkingSteps([]);
        if (t === 'run.failed') {
          setFailedRunId(runId || null);
        }
        setRunningRunId((cur) => (cur === runId ? null : cur));
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
    },
    [confirmUser, refreshSessions, settleStream, upsertAssistant, projectId],
  );

  /** 复位本地对话态（切换会话/新对话） */
  const resetLocal = useCallback(() => {
    accRef.current = '';
    streamRunRef.current = '';
    cardRunsRef.current.clear();
    setSessionPhase('');
    setMessages([]);
    setStreamingText('');
    setStreaming(false);
    setRunningRunId(null);
    setFailedRunId(null);
    setThinkingSteps([]);
  }, []);

  /** 连接到指定会话：水合快照 + 订阅事件流（先解绑旧订阅，防止串话到上一个会话） */
  const connectSession = useCallback(
    async (session: { session_id: string }) => {
      unsubRef.current?.();
      unsubRef.current = null;
      setSessionId(session.session_id);
      const snap = await api.fetchSessionSnapshot(projectId, session.session_id);
      // 历史会话里已提交的生成卡同样要还原，否则刷新一次卡就没了
      setMessages(attachCards((snap.messages ?? []).map(projectMessage), snap.prompt_cards));
      setSessionPhase(snap.session?.phase ?? '');
      if (snap.active_run?.run_id && !TERMINAL_STATUS.includes(snap.active_run.status)) {
        setRunningRunId(snap.active_run.run_id);
        setStreaming(true);
      }
      unsubRef.current = api.subscribeSessionEvents(
        projectId,
        session.session_id,
        snap.event_cursor ?? '',
        handleEvent,
      );
    },
    [projectId, handleEvent],
  );

  /** 初始化：列表取最近会话（无则创建）→ 连接会话 */
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    resetLocal();
    setSessionId(null);

    (async () => {
      try {
        const { items } = await api.listSessions(projectId);
        if (!alive) return;
        setSessions(items ?? []);
        const session = items?.[0] ?? (await api.createSession(projectId));
        if (!alive || !session?.session_id) return;
        await connectSession(session);
      } catch (e) {
        if (alive) console.warn('Agent 会话初始化失败:', e);
      }
    })();

    return () => {
      alive = false;
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
      connectSession({ session_id: targetId }).catch((e) => console.warn('切换会话失败:', e));
    },
    [projectId, resetLocal, connectSession],
  );

  /** 删除历史会话（下拉「删除」二次确认后调用）：删的是当前会话则回退到列表中下一个，全删光则新建一个 */
  const deleteSessionById = useCallback(
    (targetId: string) => {
      if (!projectId) return;
      api.deleteSession(projectId, targetId)
        .then(async () => {
          const { items } = await api.listSessions(projectId);
          setSessions(items ?? []);
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
    (content: string, forcedSkillId?: string) => {
      const text = content.trim();
      const sid = sessionIdRef.current;
      if (!text || !projectId || !sid || runningRef.current !== null || streamingRef.current) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user' as const,
          content: text,
          sequence_no: Number.MAX_SAFE_INTEGER,
          optimistic: true,
        },
      ]);
      setStreaming(true);
      api.sendSessionMessage(projectId, sid, text, { forcedCreativeSkillId: forcedSkillId }).catch((e) => {
        console.warn('Agent 消息发送失败:', e);
        setStreaming(false);
      });
    },
    [projectId],
  );

  /** 停止当前运行 POST runs/:runId/cancel（终态由事件流推送） */
  const stopRun = useCallback(() => {
    const sid = sessionIdRef.current;
    const runId = runningRef.current;
    if (!projectId || !sid || !runId) return;
    api.cancelSessionRun(projectId, sid, runId).catch((e) => {
      console.warn('停止 Agent 运行失败:', e);
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
          // 后端未部署重试接口：静默降级
          setFailedRunId(null);
          return;
        }
        console.warn('重试 Agent 运行失败:', e);
      });
  }, [projectId, failedRunId]);

  /** 开启新对话：创建新会话 + 重新订阅事件流（否则新会话的回复会发到已解绑的旧订阅） */
  const resetChat = useCallback(() => {
    if (!projectId) return;
    resetLocal();
    setSessionId(null);
    api.createSession(projectId)
      .then((session) => {
        if (!session?.session_id) return;
        return connectSession(session);
      })
      .then(() => refreshSessions())
      .catch((e) => console.warn('创建新会话失败:', e));
  }, [projectId, resetLocal, connectSession, refreshSessions]);

  /** 侧边栏状态机推导：最新助手消息的内容块类型 + 运行态 → 用户可见状态 */
  const agentPhase = useMemo<AgentPhase>(() => {
    if (failedRunId !== null) return 'failed';
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const blocks = lastAssistant?.blocks ?? [];
    const hasThinking = blocks.some((b) => b.type === 'thinking');
    const hasCards = blocks.some((b) => b.type === 'card');
    // 首条助手回复即追问（grillme 式自然语言，无结构化 clarify 块）：还没给出需求理解/生成卡 → 等待用户自由文本补充
    const isFirstAssistantReply = messages.filter((m) => m.role === 'assistant').length === 1;

    // 运行中：无产出 → 处理中；已确认 → 生成卡生成中
    if (runningRunId !== null || streaming) {
      if (hasCards) return 'generating_cards';
      return 'processing';
    }
    // 非运行：按最新产出块判定
    // 确认门走自然语言，消息里没有结构化块可认，只能由服务端阶段告知
    if (sessionPhase === 'awaiting_understanding_confirmation') return 'awaiting_confirm';
    if (isFirstAssistantReply && !hasCards) return 'awaiting_input';
    if (hasCards) return 'cards_ready';
    if (messages.length === 0 && !hasThinking) return 'idle';
    return 'processing';
  }, [messages, runningRunId, streaming, failedRunId, sessionPhase]);

  return {
    messages,
    sessionId,
    sessions,
    streamingText,
    streaming,
    runningRunId,
    failedRunId,
    thinkingSteps,
    agentPhase,
    sendMessage,
    stopRun,
    retryRun,
    resetChat,
    switchSession,
    deleteSession: deleteSessionById,
    refreshSessions,
  };
}

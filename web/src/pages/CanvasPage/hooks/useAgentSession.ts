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
  fetchSessionSnapshot,
  sendSessionMessage,
  cancelSessionRun,
  retrySessionRun,
  subscribeSessionEvents,
  type SessionMessage,
  type SessionContentBlock,
  type SseEvent,
} from '@/api/agentSessions';
import * as mockAgentApi from '@/api/agentSessions.mock';
import { isApiError } from '@/api/http';

/**
 * 数据源选择：默认走 mock（后端 /api/agent/v1 尚未在线上部署，S4 补齐后切真实）。
 * 显式设 VITE_AGENT_MOCK=0 可强制走真实接口。
 */
const api =
  import.meta.env.VITE_AGENT_MOCK !== '0'
    ? mockAgentApi
    : {
        listSessions,
        createSession,
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
  /** 本地乐观上屏、尚未被服务端事件确认 */
  optimistic?: boolean;
}

/** 侧边栏用户可见状态（对齐 04-侧边栏规范 §7） */
export type AgentPhase =
  | 'idle' // 等待输入
  | 'processing' // Agent 处理中
  | 'awaiting_input' // 等待用户补充（追问后）
  | 'awaiting_confirm' // 等待用户确认理解（确认门）
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

/** 快照消息 → UI 消息 */
const projectMessage = (m: SessionMessage): ChatMessage => ({
  id: m.message_id,
  role: m.role === 'user' ? 'user' : 'assistant',
  content: textOf(m.content),
  blocks: m.content ?? [],
  sequence_no: m.sequence,
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
        return;
      }
    },
    [confirmUser, settleStream, upsertAssistant],
  );

  /** 复位本地对话态（切换会话/新对话） */
  const resetLocal = useCallback(() => {
    accRef.current = '';
    streamRunRef.current = '';
    setMessages([]);
    setStreamingText('');
    setStreaming(false);
    setRunningRunId(null);
    setFailedRunId(null);
    setThinkingSteps([]);
  }, []);

  /** 初始化：列表取最近会话（无则创建）→ 快照水合 → 订阅事件流 */
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    let unsub: (() => void) | null = null;
    resetLocal();
    setSessionId(null);

    (async () => {
      try {
        const { items } = await api.listSessions(projectId);
        const session = items?.[0] ?? (await api.createSession(projectId));
        if (!alive || !session?.session_id) return;
        setSessionId(session.session_id);
        const snap = await api.fetchSessionSnapshot(projectId, session.session_id);
        if (!alive) return;
        setMessages((snap.messages ?? []).map(projectMessage));
        if (snap.active_run?.run_id && !TERMINAL_STATUS.includes(snap.active_run.status)) {
          setRunningRunId(snap.active_run.run_id);
          setStreaming(true);
        }
        unsub = api.subscribeSessionEvents(
          projectId,
          session.session_id,
          snap.event_cursor ?? '',
          handleEvent,
        );
      } catch (e) {
        if (alive) console.warn('Agent 会话初始化失败:', e);
      }
    })();

    return () => {
      alive = false;
      unsub?.();
    };
  }, [projectId, handleEvent, resetLocal]);

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
      // forcedSkillId 暂无对应会话维度字段，保留参数签名兼容技能 Use 入口
      void forcedSkillId;
      api.sendSessionMessage(projectId, sid, text).catch((e) => {
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

  /** 开启新对话：创建新会话并重建投影 */
  const resetChat = useCallback(() => {
    if (!projectId) return;
    resetLocal();
    setSessionId(null);
    api.createSession(projectId)
      .then(async (session) => {
        if (!session?.session_id) return;
        setSessionId(session.session_id);
        const snap = await api.fetchSessionSnapshot(projectId, session.session_id);
        setMessages((snap.messages ?? []).map(projectMessage));
      })
      .catch((e) => console.warn('创建新会话失败:', e));
  }, [projectId, resetLocal]);

  /** 侧边栏状态机推导：最新助手消息的内容块类型 + 运行态 → 用户可见状态 */
  const agentPhase = useMemo<AgentPhase>(() => {
    if (failedRunId !== null) return 'failed';
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const blocks = lastAssistant?.blocks ?? [];
    const hasThinking = blocks.some((b) => b.type === 'thinking');
    const hasClarify = blocks.some((b) => b.type === 'clarify');
    const hasUnderstanding = blocks.some((b) => b.type === 'understanding');
    const hasCards = blocks.some((b) => b.type === 'card');

    // 运行中：无产出 → 处理中；已确认 → 生成卡生成中
    if (runningRunId !== null || streaming) {
      if (hasCards) return 'generating_cards';
      return 'processing';
    }
    // 非运行：按最新产出块判定
    if (hasClarify) return 'awaiting_input';
    if (hasUnderstanding) return 'awaiting_confirm';
    if (hasCards) return 'cards_ready';
    if (messages.length === 0 && !hasThinking) return 'idle';
    return 'processing';
  }, [messages, runningRunId, streaming, failedRunId]);

  return {
    messages,
    sessionId,
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
  };
}

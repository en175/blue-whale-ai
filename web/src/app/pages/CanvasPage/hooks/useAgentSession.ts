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
} from '@/app/api/agentSessions';
import { cardsFromRevision, cardsOfRevision, taskLabelsOf } from '@/app/api/promptCardMapping';
import { isApiError } from '@/shared/api/http';
import { blockIfCreditsInsufficient, openRechargeForCreditsError } from '@/app/utils/creditsGate';
import { estimateOutputTokens, parseRunContextCapacity, parseRunTokenUsage } from './runStatusLine';
import type { RunContextCapacity, RunOutcome, RunTokenUsage } from './runStatusLine';
import { collectMissingQuoteIds, mergeConfirmedUser, patchQuoteTexts, projectMessage } from './userMessageProjection';
import { listConversationQuotes } from '@/app/api/canvas';
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

export interface TurnOutcome {
  outcome: RunOutcome;
  finishedAt: number | null;
  tokenUsage: RunTokenUsage | null;
  contextCapacity: RunContextCapacity | null;
  estimatedOutputTokens: number | null;
  failureText: string | null;
}

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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: SessionContentBlock[];
  sequence_no: number;
  inputBatchId?: string | null;
  sourceRunId?: string;
  optimistic?: boolean;
  skill_ref?: import('@/app/api/agentSessions').OutboundSkillRef;
  resource_ref?: import('@/app/api/agentSessions').SessionContentBlock[];
  chips?: { id: string; label: string }[];
}

function needsRetry(status: string): boolean {
  return isTerminalStatus(status) && terminalOutcomeOf(status) === 'failed';
}

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

const DELETE_ALREADY_REPORTED = Symbol('delete-already-reported');

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

const revisionCache = new Map<string, PromptCardRevision>();

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

export function attachCards(
  messages: ChatMessage[],
  records: PromptCardRecord[] | undefined,
  cache: Map<string, PromptCardRevision> = revisionCache,
  taskLabels: ReadonlyMap<string, string> = new Map(),
): ChatMessage[] {
  let next = messages;
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
    cache.set(active.revision_id, active);
    next = placeCards(next, cardsFromRevision(record, taskLabel), active.revision_id, active.authoring_run_id, true);
  }
  return next;
}

export function useAgentSession(projectId: string) {
  const [session, setSession] = useState<SessionState>(EMPTY_SESSION_STATE);
  const sessionRef = useRef<SessionState>(EMPTY_SESSION_STATE);
  const commit = useCallback((update: (prev: SessionState) => SessionState) => {
    const next = update(sessionRef.current);
    if (next === sessionRef.current) return;
    sessionRef.current = next;
    setSession(next);
  }, []);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeSkills, setActiveSkills] = useState<{ ids: string[]; etag: string | null }>({
    ids: [],
    etag: null,
  });
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const sessionsRef = useRef<SessionRecord[]>([]);
  sessionsRef.current = sessions;
  const [deleteError, setDeleteError] = useState<{ sessionId: string; message: string } | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  streamingRef.current = streaming;
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [turnOutcome, setTurnOutcome] = useState<TurnOutcome | null>(null);
  const turnOutcomeRef = useRef<TurnOutcome | null>(null);
  const beginTurn = useCallback(() => {
    setTurnStartedAt(Date.now());
    turnOutcomeRef.current = null;
    setTurnOutcome(null);
  }, []);
  const settleTurn = useCallback((outcome: TurnOutcome) => {
    turnOutcomeRef.current = outcome;
    setTurnOutcome(outcome);
  }, []);
  const adoptTurnStart = useCallback((at: number) => {
    if (turnOutcomeRef.current !== null) {
      turnOutcomeRef.current = null;
      setTurnOutcome(null);
      setTurnStartedAt(at);
      return;
    }
    setTurnStartedAt((cur) => cur ?? at);
  }, []);
  const adoptSettledTurn = useCallback((startedAt: number, outcome: TurnOutcome) => {
    setTurnStartedAt((cur) => {
      if (cur !== null) return cur;
      turnOutcomeRef.current = outcome;
      setTurnOutcome(outcome);
      return startedAt;
    });
  }, []);
  const clearTurn = useCallback(() => {
    setTurnStartedAt(null);
    turnOutcomeRef.current = null;
    setTurnOutcome(null);
  }, []);
  const [chatError, setChatError] = useState<string | null>(null);
  const [retryUnavailable, setRetryUnavailable] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [paymentRequiredMessage, setPaymentRequiredMessage] = useState<string | null>(null);

  const revealedRef = useRef(0);
  const revealFrameRef = useRef<number | null>(null);
  const revealLastAtRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const connectionEpochRef = useRef(0);
  const sessionsEpochRef = useRef(0);
  const cardRunsRef = useRef<Set<string>>(new Set());

  const recordAccount = useCallback(
    (run: SessionRun | null | undefined, fallbackFinishedAt: number | null = null) => {
      if (!run?.run_id) return;
      const account = accountOfRun(run, fallbackFinishedAt);
      if (!account) return;
      commit((prev) => ({ ...prev, accounts: { ...prev.accounts, [run.run_id]: account } }));
    },
    [commit],
  );

  const stopReveal = useCallback(() => {
    if (revealFrameRef.current !== null) {
      cancelAnimationFrame(revealFrameRef.current);
      revealFrameRef.current = null;
    }
  }, []);

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

  useEffect(() => stopReveal, [stopReveal]);

  const endStreaming = useCallback(() => {
    stopReveal();
    revealedRef.current = 0;
    setStreamingText('');
    streamingRef.current = false;
    setStreaming(false);
  }, [stopReveal]);

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

  const handleEvent = useCallback(
    (ev: SseEvent) => {
      const data = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
      const payload = (data.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<
        string,
        unknown
      >;
      const t = ev.type;
      const occurredAt = msOf(data.occurred_at) ?? Date.now();

      const hydrateCards = async () => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        try {
          const snap = await api.fetchSessionSnapshot(projectId, sid);
          if (sessionIdRef.current !== sid) return;
          const labels = taskLabelsOf(snap.requirement_understandings);
          commit((prev) => ({ ...prev, messages: attachCards(prev.messages, snap.prompt_cards, undefined, labels) }));
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
      const bufferedText = before.live?.text ?? '';
      commit((prev) => reduceSessionEvent(prev, ev, occurredAt));
      const after = sessionRef.current;

      if (t === 'assistant.delta' && (after.live?.text ?? '') !== bufferedText) {
        pumpReveal();
        return;
      }

      if (t === 'assistant.rewind.v1') {
        const text = after.live?.text ?? '';
        revealedRef.current = Math.min(revealedRef.current, text.length);
        setStreamingText(text.slice(0, Math.floor(revealedRef.current)));
        return;
      }



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
        adoptTurnStart(occurredAt);
        setRetryUnavailable(false);
        setPaymentRequiredMessage(null);
        return;
      }

      if (t === 'run.payment_required') {
        const reason = (payload.reason ?? {}) as Record<string, unknown>;
        endStreaming();
        clearTurn();
        setPaymentRequiredMessage(str(reason.message) || '运行授权或余额不足，请处理后继续，或取消本次运行。');
        blockIfCreditsInsufficient();
        return;
      }

      if (
        t === 'run.completed' ||
        t === 'run.failed' ||
        t === 'run.cancelled' ||
        t === 'run.stopped' ||
        t === 'run.outcome_unknown'
      ) {
        const run = (payload.run ?? {}) as Record<string, unknown>;
        const runId = str(run.run_id ?? data.run_id);
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
        refreshSessions();
        if (runId && cardRunsRef.current.has(runId)) {
          cardRunsRef.current.delete(runId);
          void hydrateCards();
        }
        return;
      }

      if (t === 'prompt_card.revision_committed.v1') {
        const runId = str(data.run_id);
        if (!runId) return;
        if (after.terminalRunIds.has(runId)) void hydrateCards();
        else cardRunsRef.current.add(runId);
        return;
      }

      if (t === 'session.updated') {
        const s = (payload.session ?? null) as SessionRecord | null;
        if (s?.session_id) {
          if (s.session_id === sessionIdRef.current) {
            setActiveSkills({ ids: s.active_creative_skill_ids ?? [], etag: s.etag ?? null });
          }
          sessionsEpochRef.current += 1;
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

  const resetLocal = useCallback(() => {
    connectionEpochRef.current += 1;
    sessionsEpochRef.current += 1;
    unsubRef.current?.();
    unsubRef.current = null;
    stopReveal();
    revealedRef.current = 0;
    cardRunsRef.current.clear();
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
        if (connectionEpochRef.current === epoch && sessionIdRef.current === session.session_id) {
          sessionIdRef.current = previousSessionId;
          setSessionId(previousSessionId);
        }
        throw e;
      }
      if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return false;
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
      const restoredMessages = attachCards(
        (snap.messages ?? []).map(projectMessage),
        snap.prompt_cards,
        undefined,
        taskLabelsOf(snap.requirement_understandings),
      );
      commit(() => ({
        ...EMPTY_SESSION_STATE,
        messages: restoredMessages,
        understandings: snap.requirement_understandings ?? [],
        accounts,
        runningRunId: liveRun?.run_id ?? null,
        failedRunId: settledRun?.run_id && needsRetry(settledRun.status) ? settledRun.run_id : null,
        live:
          liveRun?.run_id && liveRun.status !== 'payment_required'
            ? startLiveRun(
                liveRun.run_id,
                liveRun.input_batch_id ?? null,
                msOf(liveRun.created_at) ?? msOf(liveRun.started_at) ?? Date.now(),
              )
            : null,
      }));
      setActiveSkills({
        ids: snap.session?.active_creative_skill_ids ?? [],
        etag: snap.session?.etag ?? null,
      });
      setChatError(null);
      const missingQuoteIds = collectMissingQuoteIds(restoredMessages);
      if (missingQuoteIds.length > 0) {
        listConversationQuotes(projectId, missingQuoteIds)
          .then(({ items }) => {
            if (connectionEpochRef.current !== epoch || sessionIdRef.current !== session.session_id) return;
            commit((prev) => ({ ...prev, messages: patchQuoteTexts(prev.messages, items) }));
          })
          .catch((e) => console.warn('回读对话引用快照失败:', e));
      }
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

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!projectId) return null;
    const { items } = await api.listSessions(projectId);
    const session = items?.[0] ?? (await api.createSession(projectId));
    if (!session?.session_id) return null;
    await connectSession(session);
    return sessionIdRef.current;
  }, [projectId, connectSession]);

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

  const deleteSessionById = useCallback(
    (targetId: string) => {
      if (!projectId) return;
      setDeleteError((prev) => (prev?.sessionId === targetId ? null : prev));
      const etag = sessionsRef.current.find((s) => s.session_id === targetId)?.etag;
      api.deleteSession(projectId, targetId, etag)
        .catch((e) => {
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

  const dismissDeleteError = useCallback(() => setDeleteError(null), []);

  const sendMessage = useCallback(
    async (
      content: import('@/app/api/agentSessions').SessionContentBlock[],
      forcedSkillId?: string,
      resourceRef?: import('@/app/api/agentSessions').SessionContentBlock[],
      skillName?: string,
      userText?: string,
      chips?: { id: string; label: string }[],
    ): Promise<boolean> => {
      const textBlocks = content
        .filter((b) => b.type === 'text' && !b.quote_id)
        .filter((b) => (b.text ?? '').trim().length > 0);
      const finalResourceRef = resourceRef ?? content.filter((b) => b.type !== 'text' || b.quote_id);
      if (textBlocks.length === 0 && finalResourceRef.length === 0) return false;
      if (!projectId) return false;
      if (blockIfCreditsInsufficient()) return false;
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
      const skillRef = forcedSkillId ? { skill_id: forcedSkillId, name: skillName ?? '' } : undefined;
      commit((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: optimisticId,
            role: 'user' as const,
            content: userText ?? '',
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
      beginTurn();
      try {
        const connectionEpoch = connectionEpochRef.current;
        const ack = await api.sendSessionMessage(projectId, sid, content, {
          forcedCreativeSkillId: forcedSkillId,
          resourceRef,
          skillRef,
        });
        if (connectionEpochRef.current !== connectionEpoch || sessionIdRef.current !== sid) return true;
        const message = ack.message;
        if (message?.message_id) commit((prev) => ({ ...prev, messages: mergeConfirmedUser(prev.messages, message) }));
        const run = ack.run;
        if (run?.run_id && !sessionRef.current.terminalRunIds.has(run.run_id)) {
          if (run.status === 'payment_required') {
            streamingRef.current = false;
            setStreaming(false);
            clearTurn();
            commit((prev) => ({ ...prev, runningRunId: run.run_id }));
            setPaymentRequiredMessage(
              run.failure?.message || '运行授权或余额不足，请处理后继续，或取消本次运行。',
            );
            blockIfCreditsInsufficient();
          } else if (isTerminalStatus(run.status)) {
            streamingRef.current = false;
            setStreaming(false);
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
        clearTurn();
        commit((prev) => ({ ...prev, messages: prev.messages.filter((message) => message.id !== optimisticId) }));
        if (isApiError(e) && e.code === 'capability_required') {
          setSendError('当前环境未配置 Agent 运行能力券，请联系管理员配置后重试；输入内容已保留。');
        } else if (isApiError(e) && (e.status === 402 || e.code === 'payment_required')) {
          openRechargeForCreditsError(e);
          setSendError('余额不足，请充值后重试；输入内容已保留。');
        } else {
          setSendError(`消息发送失败：${e instanceof Error ? e.message : '请稍后重试'}；输入内容已保留。`);
        }
        return false;
      }
    },
    [projectId, ensureSession, beginTurn, settleTurn, clearTurn, recordAccount, commit],
  );

  const stopRun = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!projectId || !sid) return;
    setChatError(null);
    api.cancelSession(projectId, sid).catch((e) => {
      console.warn('停止 Agent 运行失败:', e);
      setChatError('停止失败，这一轮可能仍在运行；可稍后重试或刷新页面。');
    });
  }, [projectId]);

  const retryRun = useCallback(() => {
    const sid = sessionIdRef.current;
    const failedRunId = sessionRef.current.failedRunId;
    if (!projectId || !sid || failedRunId === null) return;
    if (blockIfCreditsInsufficient()) return;
    api.retrySessionRun(projectId, failedRunId)
      .then(() => {
        commit((prev) => ({ ...prev, failedRunId: null }));
        setStreaming(true);
      })
      .catch((e) => {
        if (isApiError(e) && e.status === 404) {
          setRetryUnavailable(true);
          return;
        }
        console.warn('重试 Agent 运行失败:', e);
      });
  }, [projectId, commit]);

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

  const reconnectSession = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!projectId || !sid) return;
    resetLocal();
    connectSession({ session_id: sid }).catch((e) => {
      console.warn('重新连接会话失败:', e);
      setChatError('重新连接失败，请稍后重试');
    });
  }, [projectId, resetLocal, connectSession]);

  const changeActiveSkills = useCallback(
    async (ids: string[]) => {
      const sid = sessionIdRef.current;
      if (!projectId || !sid || !activeSkills.etag) return false;
      try {
        const next = await api.setSessionCreativeSkills(projectId, sid, ids, activeSkills.etag);
        setActiveSkills({ ids: next.active_creative_skill_ids ?? [], etag: next.etag ?? null });
        return true;
      } catch (e) {
        console.warn('修改会话创作套路失败:', e);
        return false;
      }
    },
    [projectId, activeSkills.etag],
  );


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

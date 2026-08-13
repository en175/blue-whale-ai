"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentClientError,
  acceptAgentMessage,
  createAgentSession,
  getAgentSnapshot,
  listAgentSessions,
  runAgentCommand,
  streamAgentEvents,
  type AgentEventEnvelope,
  type AgentMessage,
  type AgentRun,
  type AgentSessionSummary,
  type AgentSnapshot,
} from "@/lib/agent-service/client";
import type { ChatMessage } from "../types";

const preferenceKey = (projectId: string) =>
  `blue-whale:agent:last-session:${projectId}`;

function messageText(message: AgentMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function toChatMessage(message: AgentMessage): ChatMessage {
  return {
    id: message.message_id,
    type: message.role === "user" ? "user" : "agent",
    text: messageText(message),
  };
}

function upsertMessage(
  current: ChatMessage[],
  message: AgentMessage,
): ChatMessage[] {
  const next = current.filter((item) => String(item.id) !== message.message_id);
  next.push(toChatMessage(message));
  return next;
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<AgentMessage>;
  return (
    typeof message.message_id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    Array.isArray(message.content)
  );
}

function isAgentRun(value: unknown): value is AgentRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<AgentRun>;
  return typeof run.run_id === "string" && typeof run.status === "string";
}

function isSession(value: unknown): value is AgentSessionSummary {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AgentSessionSummary>;
  return (
    typeof session.session_id === "string" && typeof session.title === "string"
  );
}

export function useAgentMvpConversation(projectId: string | null) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [provisionalContent, setProvisionalContent] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [latestTerminalRun, setLatestTerminalRun] = useState<AgentRun | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedSessionRef = useRef<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const provisionalRef = useRef<{ runId: string | null; text: string }>({
    runId: null,
    text: "",
  });
  const pendingSendRef = useRef<{
    projectId: string;
    sessionId: string | null;
    content: string;
    createKey: string;
    messageKey: string;
  } | null>(null);
  const commandKeysRef = useRef(new Map<string, string>());

  const applySnapshot = useCallback((snapshot: AgentSnapshot) => {
    setMessages(snapshot.messages.map(toChatMessage));
    setStatus(
      snapshot.active_run?.status ??
        snapshot.latest_terminal_run?.status ??
        null,
    );
    setActiveRun(snapshot.active_run);
    setLatestTerminalRun(snapshot.latest_terminal_run);
    setProvisionalContent(null);
    provisionalRef.current = { runId: null, text: "" };
    cursorRef.current = snapshot.event_cursor;
    setSessions((current) => {
      const without = current.filter(
        (item) => item.session_id !== snapshot.session.session_id,
      );
      return [snapshot.session, ...without].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      );
    });
  }, []);

  const applyEvent = useCallback((event: AgentEventEnvelope) => {
    if (event.cursor === cursorRef.current) return;
    cursorRef.current = event.cursor;
    const payload = event.payload;
    if (event.type === "message.accepted" && isAgentMessage(payload.message)) {
      setMessages((current) =>
        upsertMessage(current, payload.message as AgentMessage),
      );
    }
    if (event.type === "assistant.delta") {
      const text = typeof payload.text === "string" ? payload.text : "";
      if (provisionalRef.current.runId !== event.run_id) {
        provisionalRef.current = { runId: event.run_id, text: "" };
      }
      provisionalRef.current.text += text;
      setProvisionalContent(provisionalRef.current.text);
      setStatus("running");
    }
    if (
      event.type === "assistant.committed" &&
      isAgentMessage(payload.message)
    ) {
      setMessages((current) =>
        upsertMessage(current, payload.message as AgentMessage),
      );
    }
    if (event.type === "run.queued" || event.type === "run.started") {
      if (isAgentRun(payload.run)) {
        setActiveRun(payload.run);
        setStatus(payload.run.status);
      }
    }
    if (
      event.type === "run.completed" ||
      event.type === "run.failed" ||
      event.type === "run.cancelled" ||
      event.type === "run.payment_required" ||
      event.type === "run.outcome_unknown"
    ) {
      if (isAgentMessage(payload.assistant_message)) {
        setMessages((current) =>
          upsertMessage(current, payload.assistant_message as AgentMessage),
        );
      }
      if (isAgentRun(payload.run)) {
        setStatus(payload.run.status);
        if (event.type !== "run.payment_required") {
          setLatestTerminalRun(payload.run);
        }
        setActiveRun(
          event.type === "run.payment_required" ? payload.run : null,
        );
      }
      setProvisionalContent(null);
      provisionalRef.current = { runId: null, text: "" };
    }
    const updatedSession = payload.session;
    if (event.type === "session.updated" && isSession(updatedSession)) {
      setSessions((current) =>
        current
          .map((item) =>
            item.session_id === updatedSession.session_id
              ? updatedSession
              : item,
          )
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
    }
  }, []);

  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    let cancelled = false;
    setSessions([]);
    setSelectedSessionId(null);
    setMessages([]);
    setProvisionalContent(null);
    setStatus(null);
    setActiveRun(null);
    setLatestTerminalRun(null);
    setError(null);
    cursorRef.current = null;
    provisionalRef.current = { runId: null, text: "" };
    if (!projectId) return;
    setLoading(true);
    void listAgentSessions(projectId)
      .then((items) => {
        if (cancelled) return;
        setSessions(items);
        const preferred = window.localStorage.getItem(preferenceKey(projectId));
        const selected =
          items.find((item) => item.session_id === preferred) ??
          items[0] ??
          null;
        if (preferred && selected?.session_id !== preferred) {
          window.localStorage.removeItem(preferenceKey(projectId));
        }
        setSelectedSessionId(selected?.session_id ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof Error ? caught.message : "加载 Agent 会话失败",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !selectedSessionId) return;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = async () => {
      try {
        setLoading(true);
        const snapshot = await getAgentSnapshot(projectId, selectedSessionId);
        if (controller.signal.aborted) return;
        applySnapshot(snapshot);
        setError(null);
        setLoading(false);
        while (!controller.signal.aborted) {
          try {
            await streamAgentEvents({
              projectId,
              sessionId: selectedSessionId,
              after: cursorRef.current,
              signal: controller.signal,
              onEvent: applyEvent,
            });
          } catch (caught) {
            if (controller.signal.aborted) return;
            if (
              caught instanceof AgentClientError &&
              caught.code === "event_cursor_expired"
            ) {
              const refreshed = await getAgentSnapshot(
                projectId,
                selectedSessionId,
              );
              if (controller.signal.aborted) return;
              applySnapshot(refreshed);
              continue;
            }
            throw caught;
          }
          if (controller.signal.aborted) return;
          await new Promise<void>((resolve) => {
            reconnectTimer = setTimeout(resolve, 500);
          });
        }
      } catch (caught) {
        if (!controller.signal.aborted && !stopped) {
          setError(
            caught instanceof Error ? caught.message : "Agent 会话连接失败",
          );
          setLoading(false);
        }
      }
    };

    window.localStorage.setItem(preferenceKey(projectId), selectedSessionId);
    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [applyEvent, applySnapshot, projectId, selectedSessionId]);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setMessages([]);
    setProvisionalContent(null);
    setStatus(null);
    setError(null);
    cursorRef.current = null;
  }, []);

  const newConversation = useCallback(() => {
    if (projectId) window.localStorage.removeItem(preferenceKey(projectId));
    setSelectedSessionId(null);
    setMessages([]);
    setProvisionalContent(null);
    setStatus(null);
    setActiveRun(null);
    setLatestTerminalRun(null);
    setError(null);
    cursorRef.current = null;
  }, [projectId]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!projectId || !content.trim()) return;
      const currentSessionId = selectedSessionRef.current;
      const pending = pendingSendRef.current;
      const attempt =
        pending &&
        pending.projectId === projectId &&
        pending.sessionId === currentSessionId &&
        pending.content === content
          ? pending
          : {
              projectId,
              sessionId: currentSessionId,
              content,
              createKey: crypto.randomUUID(),
              messageKey: crypto.randomUUID(),
            };
      pendingSendRef.current = attempt;
      setError(null);
      setStatus("queued");
      try {
        let sessionId = currentSessionId;
        if (!sessionId) {
          const session = await createAgentSession(
            projectId,
            attempt.createKey,
          );
          sessionId = session.session_id;
          attempt.sessionId = sessionId;
          selectedSessionRef.current = sessionId;
          setSessions((current) => [
            session,
            ...current.filter((item) => item.session_id !== sessionId),
          ]);
          setSelectedSessionId(sessionId);
          window.localStorage.setItem(preferenceKey(projectId), sessionId);
        }
        const accepted = await acceptAgentMessage({
          projectId,
          sessionId,
          message: content,
          idempotencyKey: attempt.messageKey,
        });
        setMessages((current) => upsertMessage(current, accepted.message));
        setStatus(accepted.scheduling.run_id ? "queued" : "pending");
        pendingSendRef.current = null;
      } catch (caught) {
        setStatus("failed");
        setError(
          caught instanceof Error ? caught.message : "发送 Agent 消息失败",
        );
        throw caught;
      }
    },
    [projectId],
  );

  const command = useCallback(
    async (
      operation: "cancel" | "retry" | "resume" | "skip",
      run: AgentRun | null,
    ) => {
      if (!projectId || !selectedSessionRef.current || !run) return;
      const identity = `${selectedSessionRef.current}:${run.run_id}:${operation}`;
      const idempotencyKey =
        commandKeysRef.current.get(identity) ?? crypto.randomUUID();
      commandKeysRef.current.set(identity, idempotencyKey);
      try {
        await runAgentCommand({
          projectId,
          sessionId: selectedSessionRef.current,
          runId: run.run_id,
          command: operation,
          idempotencyKey,
        });
        commandKeysRef.current.delete(identity);
        const snapshot = await getAgentSnapshot(
          projectId,
          selectedSessionRef.current,
        );
        applySnapshot(snapshot);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Agent Run 操作失败",
        );
        throw caught;
      }
    },
    [applySnapshot, projectId],
  );

  const blockingRun = activeRun ?? latestTerminalRun;
  const controls = useMemo(
    () => ({
      canCancel:
        activeRun?.status === "queued" ||
        activeRun?.status === "running" ||
        activeRun?.status === "payment_required",
      canRetry:
        latestTerminalRun?.status === "failed" ||
        latestTerminalRun?.status === "outcome_unknown",
      canResume: activeRun?.status === "payment_required",
      canSkip:
        latestTerminalRun?.status === "failed" ||
        latestTerminalRun?.status === "outcome_unknown",
    }),
    [activeRun, latestTerminalRun],
  );

  return {
    sessions,
    selectedSessionId,
    messages,
    provisionalContent,
    status,
    loading,
    error,
    controls,
    sendMessage,
    selectSession,
    newConversation,
    cancel: () => command("cancel", activeRun),
    retry: () => command("retry", latestTerminalRun),
    resume: () => command("resume", activeRun),
    skip: () => command("skip", latestTerminalRun),
    blockingRun,
  };
}

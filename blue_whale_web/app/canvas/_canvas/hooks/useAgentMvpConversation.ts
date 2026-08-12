"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createAgentSession, streamAgentMessage } from "@/lib/agent-service/client";
import type { ChatMessage } from "../types";

export function useAgentMvpConversation(projectId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [provisionalContent, setProvisionalContent] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    sessionRef.current = null;
    abortRef.current?.abort();
    setMessages([]);
    setProvisionalContent(null);
    setStatus(null);
  }, [projectId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!projectId) return;
    const userId = crypto.randomUUID();
    setMessages((current) => [...current, { id: userId, type: "user", text: content }]);
    setStatus("running");
    setProvisionalContent("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      sessionRef.current ??= await createAgentSession(projectId);
      let completed = "";
      await streamAgentMessage(
        projectId,
        sessionRef.current,
        content,
        controller.signal,
        ({ event, data }) => {
          if (event === "message.delta") {
            completed += data.delta;
            setProvisionalContent(completed);
          } else if (event === "message.completed") {
            completed = data.content;
          } else {
            throw new Error(`${data.error.message} (${data.trace_id})`);
          }
        },
      );
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), type: "agent", text: completed },
      ]);
      setStatus("completed");
    } catch (error) {
      if (controller.signal.aborted) setStatus("cancelled");
      else {
        setStatus("failed");
        throw error;
      }
    } finally {
      setProvisionalContent(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [projectId]);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  return { messages, provisionalContent, status, sendMessage, stop };
}

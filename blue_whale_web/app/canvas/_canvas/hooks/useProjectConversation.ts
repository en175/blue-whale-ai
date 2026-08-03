"use client";
/**
 * useProjectConversation —— 画布 Project 的持久化 Conversation 接线（IK67GD T02）。
 *
 * 对 active Project 建立 Snapshot + SSE 恢复循环（权威源在服务端），
 * 把已接纳的正式消息按服务端 sequence_no 投影为面板消息流；
 * sendMessage 经公开接纳 API 提交，携带 CommandId 幂等键。
 * 浏览器值与 SSE 到达顺序不作为消息身份/排序依据（CONTEXT.md）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deriveAnswerableClarification,
  projectRecoveryTransport,
  runProjectRecovery,
  type ProjectSnapshot,
} from "@/lib/project-recovery";
import { acceptConversationMessage } from "@/lib/conversation";
import { newCommandIdentity } from "@/lib/command-identity";
import type { WireInteger } from "@/lib/wire-integer";
import { projectSnapshotToChatMessages } from "../conversationRecovery";
import type { ChatMessage } from "../types";

/** 最近一次未确认成功的提交（CommandId 重试复用载体）。 */
type PendingAttempt = {
  projectId: string;
  content: string;
  /** skill_summarize 参与幂等语义（契约 §15.1）：带与不带该字段的相同文本是两个不同请求 */
  skillSummarize: boolean;
  clientMessageId: string;
  idempotencyKey: string;
};

export function useProjectConversation(
  projectId: string | null,
  backendReady: boolean,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answerableActive, setAnswerableActive] = useState(false);
  const snapshotRef = useRef<ProjectSnapshot | null>(null);
  // 网络结果未知/失败后用相同内容重试必须复用原键（CONTEXT.md CommandId 语义），
  // 防止首次请求实际已被服务端接纳时重复创建消息。
  const pendingAttemptRef = useRef<PendingAttempt | null>(null);

  useEffect(() => {
    snapshotRef.current = null;
    pendingAttemptRef.current = null;
    // 项目切换/离线时必须立即清掉上一项目的消息，防止串扰（同步清空是权威投影的一部分）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]);

    setAnswerableActive(false);
    if (!backendReady || !projectId) return;
    const controller = new AbortController();
    const pid = projectId;
    void runProjectRecovery(
      pid,
      projectRecoveryTransport,
      (state) => {
        if (controller.signal.aborted || !state.snapshot) return;
        if (state.deleted) return;
        snapshotRef.current = state.snapshot;
        setMessages(projectSnapshotToChatMessages(state.snapshot));
        setAnswerableActive(
          deriveAnswerableClarification(state.snapshot) !== null,
        );
      },
      controller.signal,
    );
    return () => {
      controller.abort();
    };
  }, [projectId, backendReady]);

  const sendMessage = useCallback(
    async (
      content: string,
      referencedAssetIds?: WireInteger[],
      forcedCreativeSkillId?: string,
      skillSummarize?: boolean,
    ) => {
      if (!projectId) return;
      // 有可回答澄清时绑定 reply_to 并屏蔽 forced（互斥，契约 §4.1/§8）
      const answerable = deriveAnswerableClarification(snapshotRef.current);
      const effectiveForced = answerable ? undefined : forcedCreativeSkillId;
      const summarize = skillSummarize === true;
      const attempt = pendingAttemptRef.current;
      const reuse =
        attempt !== null &&
        attempt.projectId === projectId &&
        attempt.content === content &&
        attempt.skillSummarize === summarize;
      const clientMessageId = reuse
        ? attempt.clientMessageId
        : newCommandIdentity();
      const idempotencyKey = reuse
        ? attempt.idempotencyKey
        : newCommandIdentity();
      pendingAttemptRef.current = {
        projectId,
        content,
        skillSummarize: summarize,
        clientMessageId,
        idempotencyKey,
      };
      await acceptConversationMessage(
        projectId,
        content,
        clientMessageId,
        idempotencyKey,
        answerable?.input_request_id,
        referencedAssetIds,
        effectiveForced,
        summarize,
      );
      // 成功即消费：下一次提交（无论内容是否相同）都用新键
      pendingAttemptRef.current = null;
    },
    [projectId],
  );

  return { messages, sendMessage, answerableActive };
}

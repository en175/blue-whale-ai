"use client";
/**
 * useProjectConversation —— 画布 Project 的持久化 Conversation 接线（IK67GD T02）。
 *
 * 对 active Project 建立 Snapshot + SSE 恢复循环（权威源在服务端），
 * 把已接纳的正式消息按服务端 sequence_no 投影为面板消息流；
 * sendMessage 经公开接纳 API 提交，携带 CommandId 幂等键。
 * 浏览器值与 SSE 到达顺序不作为消息身份/排序依据（CONTEXT.md）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deriveAnswerableClarification,
  deriveLatestAgentRunDisplay,
  deriveRunControl,
  projectRecoveryTransport,
  runProjectRecovery,
  type ProjectSnapshot,
  type AgentRunDisplay,
  type ProvisionalDeliveryView,
} from "@/lib/project-recovery";
import {
  acceptConversationMessage,
  retryAgentRun,
  stopAgentRun,
} from "@/lib/conversation";
import { newCommandIdentity } from "@/lib/command-identity";
import type { WireInteger } from "@/lib/wire-integer";
import { projectSnapshotToChatMessages } from "../conversationRecovery";
import type { ChatMessage } from "../types";

/** 最近一次未确认成功的提交（CommandId 重试复用载体）。 */
type PendingAttempt = {
  projectId: string;
  content: string;
  commandShape: string;
  clientMessageId: string;
  idempotencyKey: string;
};

/** 未确认成功的 Run 命令（stop/retry），网络未知重试复用同键（契约 §8.2/§8.3）。 */
type PendingRunCommand = {
  projectId: string;
  agentRunId: string;
  operation: "stop" | "retry";
  idempotencyKey: string;
};

export function useProjectConversation(
  projectId: string | null,
  backendReady: boolean,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answerableActive, setAnswerableActive] = useState(false);
  const [agentRunDisplay, setAgentRunDisplay] =
    useState<AgentRunDisplay | null>(null);
  const [provisionalDeliveries, setProvisionalDeliveries] = useState<
    ReadonlyArray<ProvisionalDeliveryView>
  >([]);
  const snapshotRef = useRef<ProjectSnapshot | null>(null);
  // 网络结果未知/失败后用相同内容重试必须复用原键（CONTEXT.md CommandId 语义），
  // 防止首次请求实际已被服务端接纳时重复创建消息。
  const pendingAttemptRef = useRef<PendingAttempt | null>(null);
  const pendingRunCommandRef = useRef<PendingRunCommand | null>(null);

  useEffect(() => {
    snapshotRef.current = null;
    pendingAttemptRef.current = null;
    pendingRunCommandRef.current = null;
    // 项目切换/离线时必须立即清掉上一项目的消息，防止串扰（同步清空是权威投影的一部分）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]);

    setAnswerableActive(false);
    setAgentRunDisplay(null);
    setProvisionalDeliveries([]);
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
        setAgentRunDisplay(deriveLatestAgentRunDisplay(state.snapshot));
        setProvisionalDeliveries(
          Array.from(state.provisionalDeliveries.values()),
        );
      },
      controller.signal,
    );
    return () => {
      controller.abort();
    };
  }, [projectId, backendReady]);

  const runAgentCommand = useCallback(
    async (operation: "stop" | "retry") => {
      if (!projectId || !agentRunDisplay) return;
      const target = agentRunDisplay;
      const runId = String(target.agentRunId);
      const pending = pendingRunCommandRef.current;
      const reuse =
        pending !== null &&
        pending.projectId === projectId &&
        pending.agentRunId === runId &&
        pending.operation === operation;
      const idempotencyKey = reuse
        ? pending.idempotencyKey
        : newCommandIdentity();
      pendingRunCommandRef.current = {
        projectId,
        agentRunId: runId,
        operation,
        idempotencyKey,
      };
      if (operation === "stop") {
        await stopAgentRun(projectId, target.agentRunId, idempotencyKey);
      } else {
        await retryAgentRun(projectId, target.agentRunId, idempotencyKey);
      }
      // 成功即消费：下一次命令（无论是否同 Run）都用新键
      pendingRunCommandRef.current = null;
    },
    [projectId, agentRunDisplay],
  );

  const stopRun = useCallback(() => runAgentCommand("stop"), [runAgentCommand]);
  const retryRun = useCallback(
    () => runAgentCommand("retry"),
    [runAgentCommand],
  );

  const runControl = useMemo(
    () => deriveRunControl(agentRunDisplay),
    [agentRunDisplay],
  );

  // 活动临时文本（契约 §8.1）：只投影最新 Run 的最新 streaming 交付。
  const provisionalText = useMemo(() => {
    if (!agentRunDisplay) return null;
    const runId = String(agentRunDisplay.agentRunId);
    for (let index = provisionalDeliveries.length - 1; index >= 0; index -= 1) {
      const delivery = provisionalDeliveries[index];
      if (
        delivery &&
        delivery.agentRunId === runId &&
        delivery.status === "streaming" &&
        delivery.content.length > 0
      ) {
        return delivery.content;
      }
    }
    return null;
  }, [agentRunDisplay, provisionalDeliveries]);

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
      const commandShape = JSON.stringify({
        replyToInputRequestId: answerable?.input_request_id ?? null,
        referencedAssetIds: referencedAssetIds ?? [],
        forcedCreativeSkillId: effectiveForced ?? null,
        skillSummarize: summarize,
      });
      const attempt = pendingAttemptRef.current;
      const reuse =
        attempt !== null &&
        attempt.projectId === projectId &&
        attempt.content === content &&
        attempt.commandShape === commandShape;
      const clientMessageId = reuse
        ? attempt.clientMessageId
        : newCommandIdentity();
      const idempotencyKey = reuse
        ? attempt.idempotencyKey
        : newCommandIdentity();
      pendingAttemptRef.current = {
        projectId,
        content,
        commandShape,
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

  return {
    messages,
    sendMessage,
    answerableActive,
    agentRunDisplay,
    runControl,
    provisionalText,
    stopRun,
    retryRun,
  };
}

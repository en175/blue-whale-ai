import { apiRequest } from "./api-client";
import type {
  AcceptedConversationMention,
  ConversationMentionInput,
} from "@blue-whale/core";
import type { WireInteger } from "./wire-integer";

export type AcceptedConversationMessage = {
  message_id: WireInteger;
  agent_run_id: WireInteger;
  cursor: WireInteger;
  mentions: Array<
    Omit<AcceptedConversationMention, "mention_id"> & {
      mention_id: WireInteger;
    }
  >;
};

export function acceptConversationMessage(
  projectId: WireInteger,
  content: string,
  clientMessageId: string,
  idempotencyKey: string,
  replyToInputRequestId?: number | string,
  mentions?: ConversationMentionInput[],
  forcedCreativeSkillId?: string,
  skillSummarize?: boolean,
): Promise<AcceptedConversationMessage> {
  return apiRequest<AcceptedConversationMessage>(
    `/api/projects/${projectId}/conversation/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        client_message_id: clientMessageId,
        content,
        ...(replyToInputRequestId == null
          ? {}
          : { reply_to_input_request_id: replyToInputRequestId }),
        ...(mentions?.length ? { mentions } : {}),
        ...(forcedCreativeSkillId
          ? { forced_creative_skill_id: forcedCreativeSkillId }
          : {}),
        // 对话总结意图（IK60X1，契约 §15.1）：省略或 false 即普通消息
        ...(skillSummarize ? { skill_summarize: true } : {}),
      }),
    },
  );
}

export type AgentRunCommandReceipt = {
  agent_run_id: WireInteger;
  status: string;
  cursor: WireInteger;
};

/** 用户停止（IK67GZ，契约 §8.2）：独立产品命令，不经 RunCommit。 */
export function stopAgentRun(
  projectId: WireInteger,
  agentRunId: WireInteger,
  idempotencyKey: string,
): Promise<AgentRunCommandReceipt> {
  return apiRequest<AgentRunCommandReceipt>(
    `/api/projects/${projectId}/conversation/agent-runs/${agentRunId}/stop`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({}),
    },
  );
}

/** 手动重试（IK67GZ，契约 §8.3）：仅 failed 可重试，不重复接纳用户消息。 */
export function retryAgentRun(
  projectId: WireInteger,
  agentRunId: WireInteger,
  idempotencyKey: string,
): Promise<AgentRunCommandReceipt & { retry_count: number }> {
  return apiRequest<AgentRunCommandReceipt & { retry_count: number }>(
    `/api/projects/${projectId}/conversation/agent-runs/${agentRunId}/retry`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({}),
    },
  );
}

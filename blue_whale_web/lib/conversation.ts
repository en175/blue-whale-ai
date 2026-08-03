import { apiRequest } from "./api-client";
import type { WireInteger } from "./wire-integer";

export type AcceptedConversationMessage = {
  message_id: WireInteger;
  agent_run_id: WireInteger;
  cursor: WireInteger;
};

export function acceptConversationMessage(
  projectId: WireInteger,
  content: string,
  clientMessageId: string,
  idempotencyKey: string,
  replyToInputRequestId?: number | string,
  referencedAssetIds?: WireInteger[],
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
        ...(referencedAssetIds?.length
          ? { referenced_asset_ids: referencedAssetIds }
          : {}),
        ...(forcedCreativeSkillId
          ? { forced_creative_skill_id: forcedCreativeSkillId }
          : {}),
        // 对话总结意图（IK60X1，契约 §15.1）：省略或 false 即普通消息
        ...(skillSummarize ? { skill_summarize: true } : {}),
      }),
    },
  );
}

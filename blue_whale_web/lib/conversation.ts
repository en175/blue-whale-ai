import { apiRequest } from "./api-client";

export type AcceptedConversationMessage = {
  message_id: number;
  agent_run_id: number;
  cursor: number;
};

export function acceptConversationMessage(
  projectId: number,
  content: string,
  clientMessageId: string,
  idempotencyKey: string,
  replyToInputRequestId?: number,
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
      }),
    },
  );
}

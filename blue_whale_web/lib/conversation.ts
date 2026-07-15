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
): Promise<AcceptedConversationMessage> {
  return apiRequest<AcceptedConversationMessage>(
    `/api/projects/${projectId}/conversation/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        client_message_id: clientMessageId,
        content,
      }),
    },
  );
}

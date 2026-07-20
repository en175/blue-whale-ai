/**
 * generation-inbox —— 生成收件箱 API 请求层（/generate 对话式创作页用）。
 *
 * 收件箱是一个 purpose=generation_inbox 的特殊 Project：打开页面只 GET 探测，
 * 绝不主动创建；首条消息由后端原子创建收件箱 + 对话 + 消息。
 * 恢复/实时走项目级 Snapshot + SSE（lib/project-recovery.ts），不在本文件。
 *
 * 字段全 snake_case 对齐后端 Jackson SNAKE_CASE 序列化；鉴权走 api-client。
 */
import { apiRequest } from "./api-client";

/** 收件箱 Project 摘要（purpose 固定为 generation_inbox，前端不消费故不建模枚举）。 */
export type GenerationInboxProject = {
  id: number;
  name: string;
  thumb: string | null;
  created_at: string;
  purpose: string;
};

/** GET /api/generation-inbox 的 data；无收件箱时 data=null（HTTP 200）。 */
export type GenerationInbox = {
  project: GenerationInboxProject;
  active_conversation_id: number | null;
};

/** 对话列表项（id 倒序；preview 为首条用户消息截 50 字）。 */
export type InboxConversation = {
  id: number;
  created_at: string;
  preview: string;
};

/** POST messages 的 202 受理回执；首条消息同时给回新建的 project/conversation 身份。 */
export type AcceptedInboxMessage = {
  project_id: number;
  conversation_id: number;
  message_id: number;
  agent_run_id: number;
  accepted_cursor: number;
};

/** 探测当前用户的生成收件箱；无收件箱返回 null（绝不创建）。 */
export function getGenerationInbox(): Promise<GenerationInbox | null> {
  return apiRequest<GenerationInbox | null>("/api/generation-inbox");
}

/**
 * 发送消息（Idempotency-Key 必传）。
 * 不传 conversationId 时落收件箱最新对话（无则后端新建）；首条消息原子创建收件箱。
 * 有可回答的创作澄清时经 replyToInputRequestId 绑定回答。
 */
export function postInboxMessage(params: {
  content: string;
  clientMessageId: string;
  idempotencyKey: string;
  conversationId?: number;
  replyToInputRequestId?: number;
}): Promise<AcceptedInboxMessage> {
  return apiRequest<AcceptedInboxMessage>("/api/generation-inbox/messages", {
    method: "POST",
    headers: { "Idempotency-Key": params.idempotencyKey },
    body: JSON.stringify({
      client_message_id: params.clientMessageId,
      content: params.content,
      ...(params.conversationId == null
        ? {}
        : { conversation_id: params.conversationId }),
      ...(params.replyToInputRequestId == null
        ? {}
        : { reply_to_input_request_id: params.replyToInputRequestId }),
    }),
  });
}

/** 对话列表（无收件箱时后端 404，由 apiRequest 抛错）。 */
export function listInboxConversations(): Promise<InboxConversation[]> {
  return apiRequest<InboxConversation[]>("/api/generation-inbox/conversations");
}

/** 新建空对话（Idempotency-Key 必传；重试须复用同一键。无收件箱时后端 404）。 */
export function createInboxConversation(
  idempotencyKey: string,
): Promise<InboxConversation> {
  return apiRequest<InboxConversation>("/api/generation-inbox/conversations", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

/** 永久删除收件箱及全部对话/任务/作品（无收件箱时后端 404）。 */
export function deleteGenerationInbox(): Promise<void> {
  return apiRequest<void>("/api/generation-inbox", { method: "DELETE" });
}

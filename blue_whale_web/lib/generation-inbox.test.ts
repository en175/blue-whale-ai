import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-client";
import {
  createInboxConversation,
  deleteGenerationInbox,
  getGenerationInbox,
  listInboxConversations,
  postInboxMessage,
} from "./generation-inbox";

vi.mock("./api-client", () => ({ apiRequest: vi.fn() }));

describe("Generation Inbox API", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it("探测收件箱只发 GET /api/generation-inbox（不创建）", async () => {
    vi.mocked(apiRequest).mockResolvedValue(null);

    const result = await getGenerationInbox();

    expect(apiRequest).toHaveBeenCalledWith("/api/generation-inbox");
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("首条消息提交到 messages 端点并携带 Idempotency-Key", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      project_id: 7,
      conversation_id: 3,
      message_id: 11,
      agent_run_id: 21,
      accepted_cursor: 5,
    });

    await postInboxMessage({
      content: "生成一只蓝鲸",
      clientMessageId: "client-1",
      idempotencyKey: "cmd-1",
    });

    expect(apiRequest).toHaveBeenCalledWith("/api/generation-inbox/messages", {
      method: "POST",
      headers: { "Idempotency-Key": "cmd-1" },
      body: JSON.stringify({
        client_message_id: "client-1",
        content: "生成一只蓝鲸",
      }),
    });
  });

  it("对话态消息携带 conversation_id；回答澄清时携带 reply_to_input_request_id", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      project_id: 7,
      conversation_id: 3,
      message_id: 12,
      agent_run_id: 22,
      accepted_cursor: 6,
    });

    await postInboxMessage({
      content: "水墨风格",
      clientMessageId: "client-2",
      idempotencyKey: "cmd-2",
      conversationId: 3,
      replyToInputRequestId: 42,
    });

    expect(apiRequest).toHaveBeenCalledWith("/api/generation-inbox/messages", {
      method: "POST",
      headers: { "Idempotency-Key": "cmd-2" },
      body: JSON.stringify({
        client_message_id: "client-2",
        content: "水墨风格",
        conversation_id: 3,
        reply_to_input_request_id: 42,
      }),
    });
  });

  it("对话列表走 GET /api/generation-inbox/conversations", async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);

    await listInboxConversations();

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/generation-inbox/conversations",
    );
  });

  it("新建对话走 POST /api/generation-inbox/conversations 并携带 Idempotency-Key（无 body）", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      id: 9,
      created_at: "2026-07-19T10:00:00Z",
      preview: "",
    });

    await createInboxConversation("cmd-3");

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/generation-inbox/conversations",
      { method: "POST", headers: { "Idempotency-Key": "cmd-3" } },
    );
  });

  it("删除收件箱走 DELETE /api/generation-inbox", async () => {
    vi.mocked(apiRequest).mockResolvedValue(undefined);

    await deleteGenerationInbox();

    expect(apiRequest).toHaveBeenCalledWith("/api/generation-inbox", {
      method: "DELETE",
    });
  });
});

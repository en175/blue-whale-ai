import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-client";
import { acceptConversationMessage } from "./conversation";

vi.mock("./api-client", () => ({ apiRequest: vi.fn() }));

describe("Conversation 命令 API", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it("把稳定消息身份和 Idempotency-Key 提交到公开 Project API", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      message_id: 1,
      agent_run_id: 2,
      cursor: 3,
    });

    await acceptConversationMessage(7, "生成蓝鲸", "client-1", "command-1");

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/conversation/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "command-1" }),
        body: JSON.stringify({
          client_message_id: "client-1",
          content: "生成蓝鲸",
        }),
      }),
    );
  });

  it("回答活动创作澄清请求时携带 reply_to_input_request_id", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      message_id: 4,
      agent_run_id: 5,
      cursor: 6,
    });

    await acceptConversationMessage(7, "水墨风格", "client-2", "command-2", 42);

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/conversation/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "command-2" }),
        body: JSON.stringify({
          client_message_id: "client-2",
          content: "水墨风格",
          reply_to_input_request_id: 42,
        }),
      }),
    );
  });
});

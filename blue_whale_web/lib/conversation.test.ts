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

  it("携带跨类型 mentions（snake_case、DOM 序）", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      message_id: 1,
      agent_run_id: 2,
      cursor: 3,
    });

    await acceptConversationMessage(
      7,
      "@[蓝鲸] 帮我画",
      "c-3",
      "k-3",
      undefined,
      [
        { type: "asset", asset_id: "9", display_name: "蓝鲸" },
        {
          type: "scene_card",
          scene_card_id: "3",
          scene_card_version: 2,
          display_name: "开场",
        },
      ],
    );

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/conversation/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_message_id: "c-3",
          content: "@[蓝鲸] 帮我画",
          mentions: [
            { type: "asset", asset_id: "9", display_name: "蓝鲸" },
            {
              type: "scene_card",
              scene_card_id: "3",
              scene_card_version: 2,
              display_name: "开场",
            },
          ],
        }),
      }),
    );
  });

  it("mentions 为空时不发送该字段", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      message_id: 1,
      agent_run_id: 2,
      cursor: 3,
    });

    await acceptConversationMessage(7, "纯文本", "c-4", "k-4", undefined, []);

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/conversation/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.not.stringContaining('"mentions"'),
      }),
    );
  });

  it("携带 forced_creative_skill_id（Use 一次性强制激活）", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      message_id: 1,
      agent_run_id: 2,
      cursor: 3,
    });

    await acceptConversationMessage(
      7,
      "用这个技能生成",
      "c-5",
      "k-5",
      undefined,
      undefined,
      "cs_ugc_ads_video",
    );

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/conversation/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_message_id: "c-5",
          content: "用这个技能生成",
          forced_creative_skill_id: "cs_ugc_ads_video",
        }),
      }),
    );
  });

  it("携带 skill_summarize（IK60X1 对话总结保存意图，契约 §15.1）", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      message_id: 1,
      agent_run_id: 2,
      cursor: 3,
    });

    await acceptConversationMessage(
      7,
      "总结当前对话并保存为我的个人技能",
      "c-6",
      "k-6",
      undefined,
      undefined,
      undefined,
      true,
    );

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/conversation/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_message_id: "c-6",
          content: "总结当前对话并保存为我的个人技能",
          skill_summarize: true,
        }),
      }),
    );
  });

  it("skillSummarize 缺省时不发送该字段（省略即普通消息）", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      message_id: 1,
      agent_run_id: 2,
      cursor: 3,
    });

    await acceptConversationMessage(7, "普通消息", "c-7", "k-7");

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/conversation/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.not.stringContaining("skill_summarize"),
      }),
    );
  });
});

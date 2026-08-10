import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, isApiError } from "./api/errors";
import { apiFetch, apiRequest } from "./api-client";
import { acceptConversationMessage, applyPlanMessage } from "./conversation";
import * as conversation from "./conversation";

vi.mock("./api-client", () => ({ apiFetch: vi.fn(), apiRequest: vi.fn() }));

describe("applyPlanMessage（IK6KQB 手动应用计划）", () => {
  // 注意：拒绝分支用 mockRejectedValueOnce + mockClear——vitest 2.1 中
  // mockRejectedValue（非 Once）与 reset/clear 组合会让拒绝绕过 .catch（已实测复现）。
  beforeEach(() => vi.mocked(apiRequest).mockClear());

  it("POST apply 命令到公开路由，携带 Idempotency-Key", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      receipt: {
        application_kind: "image_generate",
        scene_card_id: null,
        receipt_id: 11,
        plan_message_id: 42,
        command_id: "cmd-apply-1",
        first_generation_job_id: 55,
        content_digest: "a".repeat(64),
        applied_at: "2026-08-07T06:00:00.000Z",
      },
      first_generation_job_id: 55,
    });

    const result = await applyPlanMessage(7, 42, "cmd-apply-1");

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/plan-messages/42/apply",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "cmd-apply-1" }),
      }),
    );
    expect(result.first_generation_job_id).toBe(55);
    expect(result.receipt.applied_at).toBe("2026-08-07T06:00:00.000Z");
  });

  it("业务失败（如 100405 余额不足）透传 ApiError 稳定 code", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(
      new ApiError({
        status: 200,
        code: "100405",
        message: "余额不足",
      }),
    );

    const error = await applyPlanMessage(7, 42, "cmd-apply-2").catch(
      (e: unknown) => e,
    );

    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).code).toBe("100405");
  });
});

describe("Conversation 命令 API", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiRequest).mockReset();
  });

  it("删除场景卡先 GET 最新 ETag，再原样用于 DELETE", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 200, data: { scene_card_id: 7 } }),
          { status: 200, headers: { ETag: '"3"' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const deleteSceneCard = (
      conversation as unknown as {
        deleteSceneCard?: (
          sceneCardId: number,
          idempotencyKey: string,
        ) => Promise<void>;
      }
    ).deleteSceneCard;

    expect(deleteSceneCard).toBeTypeOf("function");
    await deleteSceneCard?.(7, "delete-1");

    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/scene-cards/7");
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/scene-cards/7", {
      method: "DELETE",
      headers: {
        "If-Match": '"3"',
        "Idempotency-Key": "delete-1",
      },
    });
  });

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

import { describe, expect, it, vi } from "vitest";

import { acceptConversationMessage } from "./accept-conversation-message.js";

describe("acceptConversationMessage", () => {
  it("normalizes the command and delegates one atomic persistence operation", async () => {
    const acceptMessage = vi.fn().mockResolvedValue({
      kind: "accepted",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: "2",
      sequence_no: 1,
    });

    const result = await acceptConversationMessage(
      {
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        body: {
          client_message_id: "client-1",
          content: "  做一张蓝鲸海报  ",
          reply_to_input_request_id: null,
        },
      },
      { acceptMessage },
    );

    expect(result.kind).toBe("accepted");
    expect(acceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        clientMessageId: "client-1",
        content: "做一张蓝鲸海报",
        forcedCreativeSkillId: null,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("rejects missing identity or invalid body before touching persistence", async () => {
    const acceptMessage = vi.fn();

    await expect(
      acceptConversationMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: null,
          body: { client_message_id: "client-1", content: "hello" },
        },
        { acceptMessage },
      ),
    ).resolves.toEqual({ kind: "invalid", message: "缺少 Idempotency-Key" });
    await expect(
      acceptConversationMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-1",
          body: { client_message_id: "", content: "" },
        },
        { acceptMessage },
      ),
    ).resolves.toEqual({ kind: "invalid", message: "消息内容无效" });
    expect(acceptMessage).not.toHaveBeenCalled();
  });

  const validBody = {
    client_message_id: "client-1",
    content: "做一张蓝鲸海报",
  };

  it("passes forced Creative Skill into the atomic persistence command", async () => {
    const acceptMessage = vi.fn().mockResolvedValue({ kind: "accepted" });

    const result = await acceptConversationMessage(
      {
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "my_skill" },
      },
      { acceptMessage },
    );

    expect(result.kind).toBe("accepted");
    expect(acceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({ forcedCreativeSkillId: "my_skill" }),
    );
  });

  it("returns the persistence Creative Skill rejection unchanged", async () => {
    const acceptMessage = vi
      .fn()
      .mockResolvedValue({ kind: "creative_skill_unavailable" });

    const result = await acceptConversationMessage(
      {
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "others_skill" },
      },
      { acceptMessage },
    );

    expect(result).toEqual({ kind: "creative_skill_unavailable" });
    expect(acceptMessage).toHaveBeenCalledTimes(1);
  });
});

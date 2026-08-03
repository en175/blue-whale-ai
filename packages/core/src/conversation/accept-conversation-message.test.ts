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

  // Creative Skill 资产边界（资产契约 §4/§7/§8）：forced 激活跨用户个人技能或未知 ID
  // 一律拒绝，不触碰持久化；official 与本人个人技能放行；无 forced 时不调守卫；
  // 携带 forced 但守卫未注入时 fail-closed 拒绝。
  const validBody = {
    client_message_id: "client-1",
    content: "做一张蓝鲸海报",
  };

  it("forced 守卫放行时正常接纳（official / 本人个人技能）", async () => {
    const acceptMessage = vi.fn().mockResolvedValue({ kind: "accepted" });

    const result = await acceptConversationMessage(
      {
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "my_skill" },
      },
      { acceptMessage },
      async () => true,
    );

    expect(result.kind).toBe("accepted");
    expect(acceptMessage).toHaveBeenCalled();
  });

  it("forced 守卫拒绝（跨用户个人技能 / 未知 ID）→ creative_skill_unavailable，不触碰持久化", async () => {
    const acceptMessage = vi.fn();
    const guard = vi.fn().mockResolvedValue(false);

    const result = await acceptConversationMessage(
      {
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "others_skill" },
      },
      { acceptMessage },
      guard,
    );

    expect(result).toEqual({ kind: "creative_skill_unavailable" });
    expect(guard).toHaveBeenCalledWith("100", "others_skill");
    expect(acceptMessage).not.toHaveBeenCalled();
  });

  it("未携带 forced_creative_skill_id 时不调守卫", async () => {
    const acceptMessage = vi.fn().mockResolvedValue({ kind: "accepted" });
    const guard = vi.fn().mockResolvedValue(false);

    await acceptConversationMessage(
      {
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        body: validBody,
      },
      { acceptMessage },
      guard,
    );
    expect(guard).not.toHaveBeenCalled();
  });

  it("携带 forced 但未注入守卫 → fail-closed 拒绝，不触碰持久化", async () => {
    const acceptMessage = vi.fn();

    const result = await acceptConversationMessage(
      {
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "my_skill" },
      },
      { acceptMessage },
    );

    expect(result).toEqual({ kind: "creative_skill_unavailable" });
    expect(acceptMessage).not.toHaveBeenCalled();
  });
});

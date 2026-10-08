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
          mentions: [
            { type: "asset", asset_id: "9", display_name: "蓝鲸参考图" },
            {
              type: "scene_card",
              scene_card_id: 12,
              scene_card_version: 3,
              display_name: "开场分镜",
            },
          ],
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
        mentions: [
          { type: "asset", asset_id: "9", display_name: "蓝鲸参考图" },
          {
            type: "scene_card",
            scene_card_id: "12",
            scene_card_version: 3,
            display_name: "开场分镜",
          },
        ],
        forcedCreativeSkillId: null,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("rejects malformed, duplicate, or legacy mention collections before persistence", async () => {
    for (const body of [
      {
        ...validBody,
        mentions: [{ type: "asset", asset_id: 9, display_name: "" }],
      },
      {
        ...validBody,
        mentions: [
          { type: "asset", asset_id: 9, display_name: "A" },
          { type: "asset", asset_id: "9", display_name: "A copy" },
        ],
      },
      { ...validBody, referenced_asset_ids: [9] },
    ]) {
      const acceptMessage = vi.fn();
      await expect(
        acceptConversationMessage(
          {
            userId: "100",
            projectId: "42",
            idempotencyKey: "cmd-mention-invalid",
            body,
          },
          { acceptMessage },
        ),
      ).resolves.toEqual({ kind: "invalid", message: "mentions 无效" });
      expect(acceptMessage).not.toHaveBeenCalled();
    }
  });

  it("includes the complete ordered mention collection in the idempotency hash", async () => {
    const hashes: string[] = [];
    for (const mentions of [
      [
        { type: "asset", asset_id: 9, display_name: "A" },
        {
          type: "scene_card",
          scene_card_id: 12,
          scene_card_version: 3,
          display_name: "B",
        },
      ],
      [
        {
          type: "scene_card",
          scene_card_id: 12,
          scene_card_version: 3,
          display_name: "B",
        },
        { type: "asset", asset_id: 9, display_name: "A" },
      ],
    ]) {
      const acceptMessage = vi.fn().mockResolvedValue({ kind: "accepted" });
      await acceptConversationMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-mention-order",
          body: { ...validBody, mentions },
        },
        { acceptMessage },
      );
      hashes.push(acceptMessage.mock.calls[0][0].requestHash);
    }
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[1]).not.toBe(hashes[0]);
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

  it("skill_summarize: true 透传为 skillSummarize 并纳入幂等哈希", async () => {
    const acceptMessage = vi.fn().mockResolvedValue({ kind: "accepted" });

    await acceptConversationMessage(
      {
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        body: { ...validBody, skill_summarize: true },
      },
      { acceptMessage },
    );

    expect(acceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({ skillSummarize: true }),
    );
  });

  it("省略或非 true 的 skill_summarize 均为普通消息", async () => {
    for (const body of [
      validBody,
      { ...validBody, skill_summarize: false },
      { ...validBody, skill_summarize: "true" },
    ]) {
      const acceptMessage = vi.fn().mockResolvedValue({ kind: "accepted" });
      await acceptConversationMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-1",
          body,
        },
        { acceptMessage },
      );
      expect(acceptMessage).toHaveBeenCalledWith(
        expect.objectContaining({ skillSummarize: false }),
      );
    }
  });

  it("带与不带 skill_summarize 的相同文本是两个不同请求（哈希不同）", async () => {
    const hashes: string[] = [];
    for (const body of [validBody, { ...validBody, skill_summarize: true }]) {
      const acceptMessage = vi.fn().mockResolvedValue({ kind: "accepted" });
      await acceptConversationMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-1",
          body,
        },
        { acceptMessage },
      );
      hashes.push(acceptMessage.mock.calls[0][0].requestHash);
    }
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[1]).not.toBe(hashes[0]);
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

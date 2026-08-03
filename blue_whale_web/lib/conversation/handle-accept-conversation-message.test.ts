import type { ConversationRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import { handleAcceptConversationMessage } from "./handle-accept-conversation-message";

type Deps = ConversationRepo;

describe("handleAcceptConversationMessage", () => {
  it("preserves database ids beyond Number.MAX_SAFE_INTEGER", async () => {
    const huge = "9007199254740993";
    const deps: Deps = {
      acceptMessage: vi.fn().mockResolvedValue({
        kind: "accepted",
        project_id: "7",
        conversation_id: huge,
        message_id: huge,
        agent_run_id: huge,
        cursor: huge,
        sequence_no: 1,
      }),
    };

    const result = await handleAcceptConversationMessage(
      "9",
      "7",
      { client_message_id: "client-1", content: "生成蓝鲸" },
      "command-1",
      deps,
    );

    expect(result.data).toEqual({
      message_id: huge,
      agent_run_id: huge,
      cursor: huge,
    });
  });

  it("持久层原子拒绝 forced Skill → 100306", async () => {
    const deps: Deps = {
      acceptMessage: vi
        .fn()
        .mockResolvedValue({ kind: "creative_skill_unavailable" }),
    };

    const result = await handleAcceptConversationMessage(
      "9",
      "7",
      {
        client_message_id: "client-1",
        content: "生成蓝鲸",
        forced_creative_skill_id: "others_skill",
      },
      "command-1",
      deps,
    );

    expect(result).toEqual({
      code: 100306,
      msg: "Creative Skill 不可用",
      data: null,
    });
    expect(deps.acceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({ forcedCreativeSkillId: "others_skill" }),
    );
  });

  it("forced 官方技能放行；forced 本人个人技能放行", async () => {
    const acceptMessage = vi.fn().mockResolvedValue({
      kind: "accepted",
      project_id: "7",
      conversation_id: "5",
      message_id: "6",
      agent_run_id: "8",
      cursor: "2",
      sequence_no: 1,
    });
    const deps: Deps = { acceptMessage };

    for (const forcedId of ["official_skill", "my_skill"]) {
      const result = await handleAcceptConversationMessage(
        "9",
        "7",
        {
          client_message_id: "client-1",
          content: "生成蓝鲸",
          forced_creative_skill_id: forcedId,
        },
        "command-1",
        deps,
      );
      expect(result.code).toBe(200);
    }
    expect(acceptMessage).toHaveBeenCalledTimes(2);
    expect(acceptMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ forcedCreativeSkillId: "official_skill" }),
    );
    expect(acceptMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ forcedCreativeSkillId: "my_skill" }),
    );
  });

  it("活动 Run 已冻结 Skill 时映射为稳定冲突", async () => {
    const deps: Deps = {
      acceptMessage: vi.fn().mockResolvedValue({
        kind: "creative_skill_conflict",
      }),
    };

    const result = await handleAcceptConversationMessage(
      "9",
      "7",
      {
        client_message_id: "client-1",
        content: "生成蓝鲸",
        forced_creative_skill_id: "official_skill",
      },
      "command-1",
      deps,
    );

    expect(result.code).toBe(100303);
  });
});

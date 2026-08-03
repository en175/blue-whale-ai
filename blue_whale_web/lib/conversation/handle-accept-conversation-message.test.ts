import type { ConversationRepo, SkillRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import { handleAcceptConversationMessage } from "./handle-accept-conversation-message";

type Deps = ConversationRepo & {
  skills: Pick<SkillRepo, "findAssetDomainInfo" | "recordActivation">;
};

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
      skills: { findAssetDomainInfo: vi.fn(), recordActivation: vi.fn() },
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

  // Creative Skill 资产边界（资产契约 §4/§7）：forced 跨用户个人技能/未知 ID → 100306，
  // 不触碰持久化；official 与本人个人技能放行。
  it("forced 他人个人技能 → 100306，不接纳消息", async () => {
    const deps: Deps = {
      acceptMessage: vi.fn(),
      skills: {
        findAssetDomainInfo: vi.fn().mockResolvedValue({
          asset_domain: "personal",
          owner_user_id: "42",
        }),
        recordActivation: vi.fn(),
      },
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
    expect(deps.acceptMessage).not.toHaveBeenCalled();
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
    const findAssetDomainInfo = vi
      .fn()
      .mockResolvedValueOnce({ asset_domain: "official", owner_user_id: "0" })
      .mockResolvedValueOnce({ asset_domain: "personal", owner_user_id: "9" });
    const deps: Deps = {
      acceptMessage,
      skills: { findAssetDomainInfo, recordActivation: vi.fn() },
    };

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
  });

  // 激活埋点（资产契约 §11.3）：接纳含 forced 激活 → 经 repo 落一条埋点记录。
  it("forced 官方技能被接纳 → recordActivation 落一条埋点（稳定 ID/用户/AgentRun/forced）", async () => {
    const recordActivation = vi.fn().mockResolvedValue(undefined);
    const deps: Deps = {
      acceptMessage: vi.fn().mockResolvedValue({
        kind: "accepted",
        project_id: "7",
        conversation_id: "5",
        message_id: "6",
        agent_run_id: "8",
        cursor: "2",
        sequence_no: 1,
      }),
      skills: {
        findAssetDomainInfo: vi
          .fn()
          .mockResolvedValue({ asset_domain: "official", owner_user_id: "0" }),
        recordActivation,
      },
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

    expect(result.code).toBe(200);
    expect(recordActivation).toHaveBeenCalledWith({
      creativeSkillId: "official_skill",
      userId: "9",
      agentRunId: "8",
      skillVersion: 1,
      activationSource: "forced",
    });
  });

  it("forced 被拒绝时不落埋点", async () => {
    const recordActivation = vi.fn();
    const deps: Deps = {
      acceptMessage: vi.fn(),
      skills: {
        findAssetDomainInfo: vi.fn().mockResolvedValue(null),
        recordActivation,
      },
    };

    const result = await handleAcceptConversationMessage(
      "9",
      "7",
      {
        client_message_id: "client-1",
        content: "生成蓝鲸",
        forced_creative_skill_id: "no_such_skill",
      },
      "command-1",
      deps,
    );

    expect(result.code).toBe(100306);
    expect(recordActivation).not.toHaveBeenCalled();
  });
});

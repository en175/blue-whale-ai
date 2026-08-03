import type { GenerationInboxRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  handleAcceptGenerationInboxMessage,
  handleCreateGenerationInboxConversation,
  handleGetGenerationInbox,
  handleListGenerationInboxConversations,
} from "./handlers";

type SkillsStub = {
  findAssetDomainInfo: ReturnType<typeof vi.fn>;
  recordActivation: ReturnType<typeof vi.fn>;
};

function makeRepo(
  overrides: Partial<GenerationInboxRepo>,
  skills: SkillsStub = {
    findAssetDomainInfo: vi.fn().mockResolvedValue(null),
    recordActivation: vi.fn().mockResolvedValue(undefined),
  },
): GenerationInboxRepo & { skills: SkillsStub } {
  return {
    get: vi.fn(),
    acceptMessage: vi.fn(),
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    delete: vi.fn(),
    ...overrides,
    skills,
  } as GenerationInboxRepo & { skills: SkillsStub };
}

const ACCEPTED = {
  kind: "accepted",
  project_id: "42",
  conversation_id: "7",
  message_id: "8",
  agent_run_id: "9",
  cursor: "2",
  sequence_no: 1,
} as const;

describe("handleAcceptGenerationInboxMessage forced skill（IK60WY）", () => {
  const body = {
    client_message_id: "client-1",
    content: "生成蓝鲸",
    forced_creative_skill_id: "official_skill",
  };

  it("forced 指向未知技能 → 100306，不触碰持久化", async () => {
    const repo = makeRepo({});
    const result = await handleAcceptGenerationInboxMessage(
      "9",
      body,
      "command-1",
      repo,
    );

    expect(result.code).toBe(100306);
    expect(repo.acceptMessage).not.toHaveBeenCalled();
  });

  it("forced 指向官方技能 → 放行接纳并落 forced 激活埋点", async () => {
    const skills: SkillsStub = {
      findAssetDomainInfo: vi
        .fn()
        .mockResolvedValue({ asset_domain: "official", owner_user_id: null }),
      recordActivation: vi.fn().mockResolvedValue(undefined),
    };
    const repo = makeRepo(
      { acceptMessage: vi.fn().mockResolvedValue(ACCEPTED) },
      skills,
    );

    const result = await handleAcceptGenerationInboxMessage(
      "9",
      body,
      "command-1",
      repo,
    );

    expect(result.code).toBe(200);
    expect(result.data?.agent_run_id).toBe(9);
    expect(skills.recordActivation).toHaveBeenCalledWith({
      creativeSkillId: "official_skill",
      userId: "9",
      agentRunId: "9",
      skillVersion: 1,
      activationSource: "forced",
    });
  });

  it("forced 指向他人个人技能 → 100306（不泄露存在性）", async () => {
    const skills: SkillsStub = {
      findAssetDomainInfo: vi
        .fn()
        .mockResolvedValue({ asset_domain: "personal", owner_user_id: "77" }),
      recordActivation: vi.fn(),
    };
    const repo = makeRepo({}, skills);

    const result = await handleAcceptGenerationInboxMessage(
      "9",
      body,
      "command-1",
      repo,
    );

    expect(result.code).toBe(100306);
    expect(skills.recordActivation).not.toHaveBeenCalled();
  });
});

describe("generation inbox wire ids", () => {
  it("preserves every database id beyond Number.MAX_SAFE_INTEGER", async () => {
    const huge = "9007199254740993";
    const repo = makeRepo({
      get: vi.fn().mockResolvedValue({
        project: {
          id: huge,
          name: "生成收件箱",
          thumb: null,
          created_at: "2026-07-29T00:00:00.000Z",
          purpose: "generation_inbox",
        },
        active_conversation_id: huge,
      }),
      acceptMessage: vi.fn().mockResolvedValue({
        kind: "accepted",
        project_id: huge,
        conversation_id: huge,
        message_id: huge,
        agent_run_id: huge,
        cursor: huge,
        sequence_no: 1,
      }),
      listConversations: vi.fn().mockResolvedValue([
        {
          id: huge,
          created_at: "2026-07-29T00:00:00.000Z",
          preview: "蓝鲸",
        },
      ]),
      createConversation: vi.fn().mockResolvedValue({
        kind: "created",
        conversation: {
          id: huge,
          created_at: "2026-07-29T00:00:00.000Z",
          preview: "",
        },
      }),
    });

    const inbox = await handleGetGenerationInbox("9", repo);
    const accepted = await handleAcceptGenerationInboxMessage(
      "9",
      { client_message_id: "client-1", content: "生成蓝鲸" },
      "command-1",
      repo,
    );
    const conversations = await handleListGenerationInboxConversations(
      "9",
      repo,
    );
    const created = await handleCreateGenerationInboxConversation(
      "9",
      "command-2",
      repo,
    );

    expect(inbox.data?.project.id).toBe(huge);
    expect(inbox.data?.active_conversation_id).toBe(huge);
    expect(accepted.data).toEqual({
      project_id: huge,
      conversation_id: huge,
      message_id: huge,
      agent_run_id: huge,
      accepted_cursor: huge,
    });
    expect(conversations.data?.[0]?.id).toBe(huge);
    expect(created.data?.id).toBe(huge);
  });
});

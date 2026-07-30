import type { GenerationInboxRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  handleAcceptGenerationInboxMessage,
  handleCreateGenerationInboxConversation,
  handleGetGenerationInbox,
  handleListGenerationInboxConversations,
} from "./handlers";

function makeRepo(
  overrides: Partial<GenerationInboxRepo>,
): GenerationInboxRepo {
  return {
    get: vi.fn(),
    acceptMessage: vi.fn(),
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as GenerationInboxRepo;
}

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

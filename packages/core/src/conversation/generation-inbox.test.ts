import { describe, expect, it, vi } from "vitest";

import { acceptGenerationInboxMessage } from "./generation-inbox.js";

const validBody = {
  client_message_id: "client-1",
  content: "做一张蓝鲸海报",
};

function acceptedStore() {
  return {
    get: vi.fn(),
    acceptMessage: vi.fn().mockResolvedValue({
      kind: "accepted",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: "2",
      sequence_no: 1,
    }),
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    delete: vi.fn(),
  };
}

describe("acceptGenerationInboxMessage", () => {
  it("passes an empty forced selection to the atomic inbox store", async () => {
    const store = acceptedStore();

    const result = await acceptGenerationInboxMessage(
      { userId: "100", idempotencyKey: "cmd-1", body: validBody },
      store,
    );

    expect(result.kind).toBe("accepted");
    expect(store.acceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "100",
        content: "做一张蓝鲸海报",
        forcedCreativeSkillId: null,
      }),
    );
  });

  it("passes a forced Creative Skill to the atomic inbox store", async () => {
    const store = acceptedStore();

    const result = await acceptGenerationInboxMessage(
      {
        userId: "100",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "official_skill" },
      },
      store,
    );

    expect(result.kind).toBe("accepted");
    expect(store.acceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({ forcedCreativeSkillId: "official_skill" }),
    );
  });
});

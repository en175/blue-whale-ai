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
  it("无 forced 时正常委派收件箱存储，不调守卫", async () => {
    const store = acceptedStore();
    const guard = vi.fn();

    const result = await acceptGenerationInboxMessage(
      { userId: "100", idempotencyKey: "cmd-1", body: validBody },
      store,
      guard,
    );

    expect(result.kind).toBe("accepted");
    expect(store.acceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "100", content: "做一张蓝鲸海报" }),
    );
    expect(guard).not.toHaveBeenCalled();
  });

  it("forced 守卫放行时正常接纳（与 conversation 路径同语义）", async () => {
    const store = acceptedStore();

    const result = await acceptGenerationInboxMessage(
      {
        userId: "100",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "official_skill" },
      },
      store,
      async () => true,
    );

    expect(result.kind).toBe("accepted");
    expect(store.acceptMessage).toHaveBeenCalled();
  });

  it("forced 守卫拒绝 → creative_skill_unavailable，不触碰持久化", async () => {
    const store = acceptedStore();
    const guard = vi.fn().mockResolvedValue(false);

    const result = await acceptGenerationInboxMessage(
      {
        userId: "100",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "others_skill" },
      },
      store,
      guard,
    );

    expect(result).toEqual({ kind: "creative_skill_unavailable" });
    expect(guard).toHaveBeenCalledWith("100", "others_skill");
    expect(store.acceptMessage).not.toHaveBeenCalled();
  });

  it("携带 forced 但未注入守卫 → fail-closed 拒绝，不触碰持久化", async () => {
    const store = acceptedStore();

    const result = await acceptGenerationInboxMessage(
      {
        userId: "100",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "official_skill" },
      },
      store,
    );

    expect(result).toEqual({ kind: "creative_skill_unavailable" });
    expect(store.acceptMessage).not.toHaveBeenCalled();
  });

  it("接纳含 forced 的消息 → 落一条 forced 激活埋点；replayed 不重复", async () => {
    const store = acceptedStore();
    const recorder = vi.fn().mockResolvedValue(undefined);

    await acceptGenerationInboxMessage(
      {
        userId: "100",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "official_skill" },
      },
      store,
      async () => true,
      recorder,
    );

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder).toHaveBeenCalledWith({
      creativeSkillId: "official_skill",
      userId: "100",
      agentRunId: "9",
      skillVersion: 1,
      activationSource: "forced",
    });

    const replayStore = {
      ...acceptedStore(),
      acceptMessage: vi.fn().mockResolvedValue({ kind: "replayed" }),
    };
    await acceptGenerationInboxMessage(
      {
        userId: "100",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "official_skill" },
      },
      replayStore,
      async () => true,
      recorder,
    );
    expect(recorder).toHaveBeenCalledTimes(1);
  });

  it("埋点写失败不影响接纳结果（best-effort）", async () => {
    const store = acceptedStore();
    const recorder = vi.fn().mockRejectedValue(new Error("no such table"));

    const result = await acceptGenerationInboxMessage(
      {
        userId: "100",
        idempotencyKey: "cmd-1",
        body: { ...validBody, forced_creative_skill_id: "official_skill" },
      },
      store,
      async () => true,
      recorder,
    );

    expect(result.kind).toBe("accepted");
  });
});

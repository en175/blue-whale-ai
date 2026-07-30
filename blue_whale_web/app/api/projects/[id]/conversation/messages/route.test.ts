import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const deps = { acceptMessage: vi.fn() };
  return {
    deps,
    withAuthenticatedUser: vi.fn(
      async (
        _request: Request,
        handler: (user: {
          userId: string;
          status: "enabled";
        }) => Response | Promise<Response>,
      ) => handler({ userId: "100", status: "enabled" }),
    ),
    createConversationDeps: vi.fn(() => deps),
    handleAcceptConversationMessage: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/conversation/deps", () => ({
  createConversationDeps: mocks.createConversationDeps,
}));
vi.mock("@/lib/conversation/handle-accept-conversation-message", () => ({
  handleAcceptConversationMessage: mocks.handleAcceptConversationMessage,
}));

import { POST } from "./route";

describe("POST /api/projects/[id]/conversation/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleAcceptConversationMessage.mockResolvedValue({
      code: 200,
      msg: null,
      data: { message_id: 8, agent_run_id: 9, cursor: 2 },
    });
  });

  it("uses the authenticated user and returns 202 after durable acceptance", async () => {
    const body = {
      client_message_id: "client-1",
      content: "做一张蓝鲸海报",
    };
    const response = await POST(
      new Request("http://localhost/api/projects/42/conversation/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "cmd-1",
          "X-User-Id": "999",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "42" }) },
    );

    expect(response.status).toBe(202);
    expect(mocks.handleAcceptConversationMessage).toHaveBeenCalledWith(
      "100",
      "42",
      body,
      "cmd-1",
      mocks.deps,
    );
  });
});

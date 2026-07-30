import { describe, expect, it, vi } from "vitest";

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
    createGenerationInboxDeps: vi.fn(() => deps),
    handleAcceptGenerationInboxMessage: vi.fn().mockResolvedValue({
      code: 200,
      msg: null,
      data: {
        project_id: 42,
        conversation_id: 7,
        message_id: 8,
        agent_run_id: 9,
        accepted_cursor: 2,
      },
    }),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/generation-inbox/deps", () => ({
  createGenerationInboxDeps: mocks.createGenerationInboxDeps,
}));
vi.mock("@/lib/generation-inbox/handlers", () => ({
  handleAcceptGenerationInboxMessage: mocks.handleAcceptGenerationInboxMessage,
}));

import { POST } from "./route";

describe("POST /api/generation-inbox/messages", () => {
  it("accepts the first message for the authenticated new-api user", async () => {
    const body = {
      client_message_id: "client-1",
      content: "生成蓝鲸海报",
    };
    const response = await POST(
      new Request("http://localhost/api/generation-inbox/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "cmd-1",
        },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.handleAcceptGenerationInboxMessage).toHaveBeenCalledWith(
      "100",
      body,
      "cmd-1",
      mocks.deps,
    );
  });
});

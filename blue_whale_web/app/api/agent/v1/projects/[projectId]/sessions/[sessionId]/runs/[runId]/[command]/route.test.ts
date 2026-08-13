import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  findOwnedById: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth/authenticated-user", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  AuthenticationError: class AuthenticationError extends Error {},
}));
vi.mock("@/lib/project/deps", () => ({
  createProjectDeps: () => ({ db: { findOwnedById: mocks.findOwnedById } }),
}));

describe("POST Agent Run command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv("AGENT_SERVICE_BASE_URL", "http://agent.test:4111");
    vi.stubEnv("AGENT_SERVICE_TOKEN", "agent-token");
    vi.stubEnv("NEW_API_BASE_URL", "http://newapi.test:3006");
    vi.stubEnv("BLUE_WHALE_INTERNAL_SERVICE_TOKEN", "broker-token");
    mocks.getAuthenticatedUser.mockResolvedValue({
      userId: "7",
      username: "member",
    });
    mocks.findOwnedById.mockResolvedValue({ id: "101" });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("obtains fresh bounded authorization before retry", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json(
          { capability: "bwcap_retry", capability_id: "runcap-retry" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ run_id: "run-2", status: "queued" }, { status: 202 }),
      );
    const { POST } = await import("./route");
    const response = await POST(
      new Request(
        "http://web.test/api/agent/v1/projects/101/sessions/session-1/runs/run-1/retry",
        {
          method: "POST",
          headers: {
            authorization: "Bearer user",
            "idempotency-key": "retry-key",
            "x-agent-action-id": "retry-action",
          },
        },
      ),
      {
        params: Promise.resolve({
          projectId: "101",
          sessionId: "session-1",
          runId: "run-1",
          command: "retry",
        }),
      },
    );
    expect(response.status).toBe(202);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
      max_model_calls: 4,
    });
    expect(mocks.fetch.mock.calls[1][0]).toBe(
      "http://agent.test:4111/v1/runs/run-1/retry",
    );
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({
      action_id: "retry-action",
    });
  });
});

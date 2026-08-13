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

describe("GET Agent Session Snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv("AGENT_SERVICE_BASE_URL", "http://agent.test:4111");
    vi.stubEnv("AGENT_SERVICE_TOKEN", "agent-token");
    mocks.getAuthenticatedUser.mockResolvedValue({
      userId: "7",
      username: "member",
    });
    mocks.findOwnedById.mockResolvedValue({ id: "101" });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("proxies the scoped Snapshot", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        session: { session_id: "session-1" },
        event_cursor: "evt-1",
      }),
    );
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://web.test/api/agent/v1/projects/101/sessions/session-1/snapshot",
        { headers: { authorization: "Bearer user" } },
      ),
      { params: Promise.resolve({ projectId: "101", sessionId: "session-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "http://agent.test:4111/v1/sessions/session-1/snapshot",
    );
  });
});

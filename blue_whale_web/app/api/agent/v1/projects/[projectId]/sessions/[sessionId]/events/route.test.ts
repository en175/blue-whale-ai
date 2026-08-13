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

describe("GET Agent Session Events", () => {
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

  it("forwards the cursor and preserves SSE content type", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("event: stream.ready\ndata: {}\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://web.test/api/agent/v1/projects/101/sessions/session-1/events?after=evt-1",
        { headers: { authorization: "Bearer user" } },
      ),
      { params: Promise.resolve({ projectId: "101", sessionId: "session-1" }) },
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "http://agent.test:4111/v1/sessions/session-1/events?after=evt-1",
    );
    expect(
      new Headers(mocks.fetch.mock.calls[0][1].headers).get("accept"),
    ).toBe("text/event-stream");
  });
});

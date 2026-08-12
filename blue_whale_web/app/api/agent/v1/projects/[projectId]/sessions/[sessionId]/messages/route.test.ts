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

describe("POST Agent session message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv("AGENT_SERVICE_BASE_URL", "http://agent.test:4111");
    vi.stubEnv("AGENT_SERVICE_TOKEN", "agent-service-token");
    vi.stubEnv("NEW_API_BASE_URL", "http://newapi.test:3006");
    vi.stubEnv("BLUE_WHALE_INTERNAL_SERVICE_TOKEN", "broker-service-token");
    mocks.getAuthenticatedUser.mockResolvedValue({ userId: "7", username: "member" });
    mocks.findOwnedById.mockResolvedValue({ id: "101" });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("issues a user-bound capability and passes only that capability to Agent", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ capability: "bwcap_once", capability_id: "runcap_1" }, { status: 201 }))
      .mockResolvedValueOnce(new Response("event: message.completed\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } }));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://web.test/api/agent/v1/projects/101/sessions/session-1/messages", {
        method: "POST",
        headers: { authorization: "Bearer browser-user-token", "content-type": "application/json" },
        body: JSON.stringify({ message: "帮我梳理需求" }),
      }),
      { params: Promise.resolve({ projectId: "101", sessionId: "session-1" }) },
    );

    expect(response.status).toBe(200);
    const [issueUrl, issueInit] = mocks.fetch.mock.calls[0];
    expect(issueUrl).toBe("http://newapi.test:3006/internal/v1/model-capabilities");
    expect(JSON.parse(issueInit.body)).toMatchObject({ subject_user_id: 7, consumer: "blue-whale-agent-runtime" });
    expect(new Headers(issueInit.headers).get("authorization")).toBe("Bearer broker-service-token");
    const [agentUrl, agentInit] = mocks.fetch.mock.calls[1];
    expect(agentUrl).toBe("http://agent.test:4111/v1/sessions/session-1/messages");
    const agentHeaders = new Headers(agentInit.headers);
    expect(agentHeaders.get("x-blue-whale-run-capability")).toBe("bwcap_once");
    expect(agentHeaders.get("x-blue-whale-user-id")).toBe("7");
    expect(agentHeaders.get("authorization")).toBe("Bearer agent-service-token");
    expect(JSON.stringify(agentInit)).not.toContain("browser-user-token");
    expect(JSON.stringify(agentInit)).not.toContain("broker-service-token");
  });

  it("does not call Agent when capability issuance is denied", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: { code: "capability_denied" } }, { status: 403 }));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://web.test/api/agent/v1/projects/101/sessions/session-1/messages", {
        method: "POST",
        headers: { authorization: "Bearer browser-user-token", "content-type": "application/json" },
        body: JSON.stringify({ message: "test" }),
      }),
      { params: Promise.resolve({ projectId: "101", sessionId: "session-1" }) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "capability_denied" } });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

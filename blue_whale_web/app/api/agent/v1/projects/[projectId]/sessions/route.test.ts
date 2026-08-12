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

describe("POST /api/agent/v1/projects/{projectId}/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv("AGENT_SERVICE_BASE_URL", "http://agent.test:4111");
    vi.stubEnv("AGENT_SERVICE_TOKEN", "service-token");
    mocks.getAuthenticatedUser.mockResolvedValue({ userId: "7", username: "root" });
    mocks.findOwnedById.mockResolvedValue({ id: "101" });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("derives trusted identity and project context before calling Agent", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ session_id: "session-1" }, { status: 201 }),
    );
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://web.test/api/agent/v1/projects/101/sessions", {
        method: "POST",
        headers: { authorization: "Bearer sk-user" },
      }),
      { params: Promise.resolve({ projectId: "101" }) },
    );
    expect(response.status).toBe(201);
    expect(mocks.findOwnedById).toHaveBeenCalledWith("101", "7");
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("http://agent.test:4111/v1/sessions");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-blue-whale-user-id")).toBe("7");
    expect(headers.get("x-blue-whale-project-id")).toBe("101");
    expect(headers.get("x-blue-whale-tenant-id")).toBe("personal:7");
  });

  it("does not reveal a project owned by another user", async () => {
    mocks.findOwnedById.mockResolvedValue(null);
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://web.test/api/agent/v1/projects/101/sessions", {
        method: "POST",
        headers: { authorization: "Bearer sk-user" },
      }),
      { params: Promise.resolve({ projectId: "101" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

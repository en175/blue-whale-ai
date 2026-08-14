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
    mocks.getAuthenticatedUser.mockResolvedValue({
      userId: "7",
      username: "member",
    });
    mocks.findOwnedById.mockResolvedValue({ id: "101" });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("issues a user-bound capability and passes only that capability to Agent", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json(
          { capability: "bwcap_once", capability_id: "runcap_1" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            message: { message_id: "msg-1" },
            scheduling: { state: "run_created", run_id: "run-1" },
          },
          { status: 202 },
        ),
      );
    const { POST } = await import("./route");
    const response = await POST(
      new Request(
        "http://web.test/api/agent/v1/projects/101/sessions/session-1/messages",
        {
          method: "POST",
          headers: {
            authorization: "Bearer browser-user-token",
            "content-type": "application/json",
            "idempotency-key": "message-key-1",
          },
          body: JSON.stringify({ message: "帮我梳理需求" }),
        },
      ),
      { params: Promise.resolve({ projectId: "101", sessionId: "session-1" }) },
    );

    expect(response.status).toBe(202);
    const [issueUrl, issueInit] = mocks.fetch.mock.calls[0];
    expect(issueUrl).toBe(
      "http://newapi.test:3006/internal/v1/model-capabilities",
    );
    expect(JSON.parse(issueInit.body)).toMatchObject({
      subject_user_id: 7,
      consumer: "blue-whale-agent-runtime",
      max_model_calls: 4,
      idempotency_key: "session-1:message-key-1",
    });
    expect(new Headers(issueInit.headers).get("authorization")).toBe(
      "Bearer broker-service-token",
    );
    const [agentUrl, agentInit] = mocks.fetch.mock.calls[1];
    expect(agentUrl).toBe(
      "http://agent.test:4111/v1/sessions/session-1/messages",
    );
    const agentHeaders = new Headers(agentInit.headers);
    expect(agentHeaders.get("x-blue-whale-run-capability")).toBe("bwcap_once");
    expect(agentHeaders.get("idempotency-key")).toBe("message-key-1");
    expect(agentHeaders.get("x-blue-whale-user-id")).toBe("7");
    expect(agentHeaders.get("authorization")).toBe(
      "Bearer agent-service-token",
    );
    expect(JSON.stringify(agentInit)).not.toContain("browser-user-token");
    expect(JSON.stringify(agentInit)).not.toContain("broker-service-token");
  });

  // IK8N1S：capability 签发失败是依赖侧故障，不是浏览器调用者的身份问题。
  // 401/403/5xx 一律映射 502，不能把上游状态码透传给浏览器（401 会触发前端登出）。
  async function postWithCapabilityFailure(status: number) {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ error: { code: "upstream_error" } }, { status }),
    );
    const { POST } = await import("./route");
    return POST(
      new Request(
        "http://web.test/api/agent/v1/projects/101/sessions/session-1/messages",
        {
          method: "POST",
          headers: {
            authorization: "Bearer browser-user-token",
            "content-type": "application/json",
            "x-trace-id": "trace-cap",
          },
          body: JSON.stringify({ message: "test" }),
        },
      ),
      { params: Promise.resolve({ projectId: "101", sessionId: "session-1" }) },
    );
  }

  it.each([401, 403, 500])(
    "maps capability issuance upstream %i to 502 without leaking the status",
    async (status) => {
      const response = await postWithCapabilityFailure(status);
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        error: {
          code: "capability_upstream_unauthorized",
          trace_id: "trace-cap",
        },
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps 402 payment_required so the recharge flow is not regressed", async () => {
    const response = await postWithCapabilityFailure(402);
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: { code: "payment_required" },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("maps Agent upstream 401 to 502 instead of passing it to the browser", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json(
          { capability: "bwcap_once", capability_id: "runcap_1" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "capability_required" } },
          { status: 401, headers: { "x-trace-id": "trace-agent" } },
        ),
      );
    const { POST } = await import("./route");
    const response = await POST(
      new Request(
        "http://web.test/api/agent/v1/projects/101/sessions/session-1/messages",
        {
          method: "POST",
          headers: {
            authorization: "Bearer browser-user-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: "test" }),
        },
      ),
      { params: Promise.resolve({ projectId: "101", sessionId: "session-1" }) },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: {
        code: "agent_upstream_unauthorized",
        trace_id: "trace-agent",
      },
    });
  });
});

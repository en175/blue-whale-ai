import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("POST internal Agent model gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv("AGENT_SERVICE_TOKEN", "agent-service-token");
    vi.stubEnv("NEW_API_BASE_URL", "http://newapi.test:3006");
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects callers without both service identity and capability", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://web.test/api/internal/agent-model/v1/chat/completions", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the short-lived capability without a root credential", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "chatcmpl-1" }));
    const { POST } = await import("./route");
    const response = await POST(new Request("http://web.test/api/internal/agent-model/v1/chat/completions", {
      method: "POST",
      headers: {
        "x-agent-service-token": "agent-service-token",
        authorization: "Bearer bwcap_once",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [] }),
    }));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://newapi.test:3006/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer bwcap_once");
  });
});

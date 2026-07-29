import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/usage/token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEW_API_BASE_URL;
  });

  it("forwards the sk token and exposes quota to the Node frontend", async () => {
    process.env.NEW_API_BASE_URL = "http://new-api.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: true,
          message: "ok",
          data: { user_quota: 500000 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://web.test/api/usage/token", {
        headers: { Authorization: "Bearer sk-user" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      msg: null,
      data: { quota: 500000 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://new-api.test/api/usage/token/",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

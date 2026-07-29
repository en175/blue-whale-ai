import { beforeEach, describe, expect, it, vi } from "vitest";

import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

import { POST } from "./route";

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: vi.fn(
    async (
      _request: Request,
      handler: (user: {
        userId: string;
        status: "enabled";
      }) => Promise<Response> | Response,
    ) => handler({ userId: "9", status: "enabled" }),
  ),
}));

describe("POST /api/agent/assets/:assetId/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns HTTP 401 before constructing DB or TOS dependencies without Bearer auth", async () => {
    vi.mocked(withAuthenticatedUser).mockResolvedValueOnce(
      Response.json(
        { code: 401, msg: "登录凭证无效", data: null },
        { status: 401 },
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/agent/assets/41/complete", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("retires authenticated pending-Asset completion in favor of the commit route", async () => {
    const response = await POST(
      new Request("http://localhost/api/agent/assets/41/complete", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-test",
          "X-User-Id": "999",
        },
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: 410,
      data: null,
    });
  });
});

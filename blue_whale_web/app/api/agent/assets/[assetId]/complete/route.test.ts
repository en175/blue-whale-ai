import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUserIdFromRequest } from "@/lib/auth/user-from-request";

import { POST } from "./route";

vi.mock("@/lib/auth/user-from-request", () => ({
  getUserIdFromRequest: vi.fn(),
}));

describe("POST /api/agent/assets/:assetId/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns HTTP 401 before constructing DB or TOS dependencies without Bearer auth", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/agent/assets/41/complete", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "41" }) },
    );

    expect(response.status).toBe(401);
  });

  it("retires authenticated pending-Asset completion in favor of the commit route", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue("9");

    const response = await POST(
      new Request("http://localhost/api/agent/assets/41/complete", {
        method: "POST",
        headers: { Authorization: "Bearer sk-test" },
      }),
      { params: Promise.resolve({ assetId: "41" }) },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: 410,
      data: null,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetsDeps } from "@/lib/assets/deps";

import { GET } from "./route";

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
vi.mock("@/lib/assets/deps", () => ({ createAssetsDeps: vi.fn() }));

describe("GET /api/assets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists Assets for the authenticated user instead of a forged request user", async () => {
    const assets = {
      listByUser: vi.fn().mockResolvedValue({
        items: [],
        page: 2,
        size: 10,
        total: 0,
      }),
    };
    vi.mocked(createAssetsDeps).mockReturnValue({ assets } as never);

    const response = await GET(
      new Request("http://localhost/api/assets?type=image&page=2&size=10", {
        headers: {
          Authorization: "Bearer sk-test",
          "X-User-Id": "999",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(assets.listByUser).toHaveBeenCalledWith("9", {
      type: "image",
      page: 2,
      size: 10,
    });
  });
});

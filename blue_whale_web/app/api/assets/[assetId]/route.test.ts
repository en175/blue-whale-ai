import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetsDeps } from "@/lib/assets/deps";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

import { DELETE } from "./route";

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

describe("DELETE /api/assets/{assetId}", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 before constructing persistence dependencies", async () => {
    vi.mocked(withAuthenticatedUser).mockResolvedValueOnce(
      Response.json(
        { code: 401, msg: "登录凭证无效", data: null },
        { status: 401 },
      ),
    );

    const response = await DELETE(
      new Request("http://localhost/api/assets/42", { method: "DELETE" }),
      { params: Promise.resolve({ assetId: "42" }) },
    );

    expect(response.status).toBe(401);
    expect(createAssetsDeps).not.toHaveBeenCalled();
  });

  it("soft-deletes the authenticated user's Asset", async () => {
    const softDeleteOwned = vi.fn().mockResolvedValue(true);
    vi.mocked(createAssetsDeps).mockReturnValue({
      assets: {
        softDeleteOwned,
      },
    } as never);

    const response = await DELETE(
      new Request("http://localhost/api/assets/42", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer sk-test",
          "X-User-Id": "999",
        },
      }),
      { params: Promise.resolve({ assetId: "42" }) },
    );

    await expect(response.json()).resolves.toEqual({
      code: 200,
      msg: null,
      data: null,
    });
    expect(softDeleteOwned).toHaveBeenCalledWith("42", "9");
  });
});

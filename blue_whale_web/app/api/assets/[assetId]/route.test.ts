import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetsDeps } from "@/lib/assets/deps";
import { getUserIdFromRequest } from "@/lib/auth/user-from-request";

import { DELETE } from "./route";

vi.mock("@/lib/auth/user-from-request", () => ({
  getUserIdFromRequest: vi.fn(),
}));
vi.mock("@/lib/assets/deps", () => ({ createAssetsDeps: vi.fn() }));

describe("DELETE /api/assets/{assetId}", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 before constructing persistence dependencies", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue(null);

    const response = await DELETE(
      new Request("http://localhost/api/assets/42", { method: "DELETE" }),
      { params: Promise.resolve({ assetId: "42" }) },
    );

    expect(response.status).toBe(401);
    expect(createAssetsDeps).not.toHaveBeenCalled();
  });

  it("soft-deletes the authenticated user's Asset", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue("9");
    vi.mocked(createAssetsDeps).mockReturnValue({
      assets: {
        softDeleteOwned: vi.fn().mockResolvedValue(true),
      },
    } as never);

    const response = await DELETE(
      new Request("http://localhost/api/assets/42", { method: "DELETE" }),
      { params: Promise.resolve({ assetId: "42" }) },
    );

    await expect(response.json()).resolves.toEqual({
      code: 200,
      msg: null,
      data: null,
    });
  });
});

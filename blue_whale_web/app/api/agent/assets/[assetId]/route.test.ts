import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetsDeps } from "@/lib/assets/deps";
import { getUserIdFromRequest } from "@/lib/auth/user-from-request";

import { GET } from "./route";

vi.mock("@/lib/auth/user-from-request", () => ({
  getUserIdFromRequest: vi.fn(),
}));
vi.mock("@/lib/assets/deps", () => ({
  createAssetsDeps: vi.fn(),
}));

describe("GET /api/agent/assets/:assetId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the authenticated owner's ready Asset for canvas hydration", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue("9");
    const assets = {
      findOwnedSource: vi.fn().mockResolvedValue({
        type: "image",
        storage_key: "uploads/9/image/fixed.png",
        url: "https://tos.test/uploads/9/image/fixed.png",
        mime: "image/png",
        size: BigInt(1024),
        width: 800,
        height: 600,
        duration: null,
        source: "uploaded",
      }),
    };
    vi.mocked(createAssetsDeps).mockReturnValue({ assets } as never);

    const response = await GET(
      new Request("http://localhost/api/agent/assets/41", {
        headers: { Authorization: "Bearer sk-test" },
      }),
      { params: Promise.resolve({ assetId: "41" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      code: 200,
      msg: null,
      data: {
        asset_id: "41",
        status: "ready",
        type: "image",
        url: "https://tos.test/uploads/9/image/fixed.png",
        width: 800,
        height: 600,
        duration: null,
        mime: "image/png",
        size: 1024,
      },
    });
    expect(assets.findOwnedSource).toHaveBeenCalledWith("41", "9");
  });
});

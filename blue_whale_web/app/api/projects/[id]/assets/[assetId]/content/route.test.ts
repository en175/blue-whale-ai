import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectAssetsDeps } from "@/lib/assets/deps";

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
vi.mock("@/lib/assets/deps", () => ({ createProjectAssetsDeps: vi.fn() }));

describe("GET /api/projects/:id/assets/:assetId/content", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads Asset content for the authenticated user instead of a forged request user", async () => {
    const project = {
      findOwnedById: vi.fn().mockResolvedValue({ id: "55" }),
    };
    const assets = {
      findAccessible: vi.fn().mockResolvedValue({
        storage_key: "uploads/9/image/fixed.png",
        mime: "image/png",
      }),
    };
    const reader = {
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(createProjectAssetsDeps).mockReturnValue({
      project,
      assets,
      reader,
      signer: null,
    } as never);

    const response = await GET(
      new Request("http://localhost/api/projects/55/assets/41/content", {
        headers: {
          Authorization: "Bearer sk-test",
          "X-User-Id": "999",
        },
      }),
      { params: Promise.resolve({ id: "55", assetId: "41" }) },
    );

    expect(response.status).toBe(200);
    expect(project.findOwnedById).toHaveBeenCalledWith("55", "9");
    expect(assets.findAccessible).toHaveBeenCalledWith("55", "41", "9");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetPresignDeps } from "@/lib/assets/deps";
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
vi.mock("@/lib/assets/deps", () => ({
  createAssetPresignDeps: vi.fn(),
}));

describe("POST /api/agent/assets/presign", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns HTTP 401 before constructing DB or TOS dependencies without Bearer auth", async () => {
    vi.mocked(withAuthenticatedUser).mockResolvedValueOnce(
      Response.json(
        { code: 401, msg: "登录凭证无效", data: null },
        { status: 401 },
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/agent/assets/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "image", mime: "image/png", size: 1024 }),
      }),
    );

    expect(response.status).toBe(401);
    expect(createAssetPresignDeps).not.toHaveBeenCalled();
  });

  it("keeps the legacy URL as a signing-only compatibility route", async () => {
    const deps = {
      storage: {
        prepareUpload: vi.fn().mockResolvedValue({
          storageKey: "uploads/9/image/fixed.png",
          publicUrl: "https://tos.test/uploads/9/image/fixed.png",
          uploadUrl: "https://tos.test/signed-put",
          headers: { "Content-Type": "image/png" },
          expiresIn: 600,
        }),
        inspectObject: vi.fn(),
        makePublic: vi.fn(),
      },
    };
    vi.mocked(createAssetPresignDeps).mockReturnValue(deps);

    const response = await POST(
      new Request("http://localhost/api/agent/assets/presign", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "image", mime: "image/png", size: 1024 }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: {
        storage_key: "uploads/9/image/fixed.png",
        upload_url: "https://tos.test/signed-put",
      },
    });
  });
});

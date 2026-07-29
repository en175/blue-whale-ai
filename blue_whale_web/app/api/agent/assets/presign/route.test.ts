import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createAssetPresignDeps } from "@/lib/assets/deps";

import { POST } from "./route";

vi.mock("@/lib/auth/user-from-request", () => ({
  getUserIdFromRequest: vi.fn(),
}));
vi.mock("@/lib/assets/deps", () => ({
  createAssetPresignDeps: vi.fn(),
}));

describe("POST /api/agent/assets/presign", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns HTTP 401 before constructing DB or TOS dependencies without Bearer auth", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue(null);

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
    vi.mocked(getUserIdFromRequest).mockResolvedValue("9");
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
        headers: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
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

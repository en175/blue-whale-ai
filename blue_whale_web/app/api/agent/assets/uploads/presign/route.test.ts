import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetPresignDeps } from "@/lib/assets/deps";
import { getUserIdFromRequest } from "@/lib/auth/user-from-request";

import { POST } from "./route";

vi.mock("@/lib/auth/user-from-request", () => ({ getUserIdFromRequest: vi.fn() }));
vi.mock("@/lib/assets/deps", () => ({ createAssetPresignDeps: vi.fn() }));

describe("POST /api/agent/assets/uploads/presign", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 before constructing TOS dependencies", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/agent/assets/uploads/presign", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(createAssetPresignDeps).not.toHaveBeenCalled();
  });

  it("signs a direct upload without constructing persistence dependencies", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue("9");
    vi.mocked(createAssetPresignDeps).mockReturnValue({
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
    });

    const response = await POST(new Request("http://localhost/api/agent/assets/uploads/presign", {
      method: "POST",
      headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "image", mime: "image/png", size: 1024 }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: {
        storage_key: "uploads/9/image/fixed.png",
        upload_url: "https://tos.test/signed-put",
      },
    });
  });
});

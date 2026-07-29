import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetCommitDeps } from "@/lib/assets/deps";
import { getUserIdFromRequest } from "@/lib/auth/user-from-request";

import { POST } from "./route";

vi.mock("@/lib/auth/user-from-request", () => ({ getUserIdFromRequest: vi.fn() }));
vi.mock("@/lib/assets/deps", () => ({ createAssetCommitDeps: vi.fn() }));

describe("POST /api/agent/assets/uploads/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 before constructing DB or TOS dependencies", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/agent/assets/uploads/complete", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(createAssetCommitDeps).not.toHaveBeenCalled();
  });

  it("verifies the upload and submits it to the project asset library", async () => {
    vi.mocked(getUserIdFromRequest).mockResolvedValue("9");
    const deps = {
      projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "55" }) },
      uploads: {
        findCommittedUpload: vi.fn().mockResolvedValue(null),
        createUploadedAsset: vi.fn().mockResolvedValue({
          id: "41",
          type: "image",
          storage_key: "uploads/9/image/fixed.png",
          url: "https://tos.test/uploads/9/image/fixed.png",
          mime: "image/png",
          size: BigInt(1024),
          width: null,
          height: null,
          duration: null,
        }),
      },
      storage: {
        prepareUpload: vi.fn(),
        inspectObject: vi.fn().mockResolvedValue({
          size: 1024,
          mime: "image/png",
          publicUrl: "https://tos.test/uploads/9/image/fixed.png",
        }),
        makePublic: vi.fn(),
      },
    };
    vi.mocked(createAssetCommitDeps).mockReturnValue(deps);

    const response = await POST(new Request("http://localhost/api/agent/assets/uploads/complete", {
      method: "POST",
      headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: "55",
        type: "image",
        mime: "image/png",
        size: 1024,
        storage_key: "uploads/9/image/fixed.png",
      }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: { asset_id: "41", status: "ready" },
    });
  });
});

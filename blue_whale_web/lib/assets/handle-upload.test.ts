import { describe, expect, it, vi } from "vitest";

import { handleCompleteAsset, handlePresignAsset } from "./handle-upload";

function makeDeps() {
  return {
    projects: {
      findOwnedById: vi.fn(),
    },
    uploads: {
      createPendingUpload: vi.fn(),
      findPendingUpload: vi.fn(),
      markUploadReady: vi.fn(),
      findCommittedUpload: vi.fn(),
      createUploadedAsset: vi.fn(),
    },
    storage: {
      prepareUpload: vi.fn(),
      objectExists: vi.fn(),
      inspectObject: vi.fn(),
      makePublic: vi.fn(),
    },
  };
}

describe("handlePresignAsset", () => {
  it("returns a direct TOS PUT contract without writing an Asset", async () => {
    const deps = makeDeps();
    deps.storage.prepareUpload.mockResolvedValue({
      storageKey: "uploads/9/image/file.png",
      publicUrl: "https://bucket.tos.test/uploads/9/image/file.png",
      uploadUrl: "https://bucket.tos.test/upload-signed",
      headers: { "Content-Type": "image/png" },
      expiresIn: 600,
    });
    const result = await handlePresignAsset(
      "9",
      { type: "image", mime: "image/png", size: 2_336_799 },
      deps,
    );

    expect(deps.uploads.createPendingUpload).not.toHaveBeenCalled();
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: {
        storage_key: "uploads/9/image/file.png",
        upload_url: "https://bucket.tos.test/upload-signed",
        headers: { "Content-Type": "image/png" },
        expires_in: 600,
      },
    });
  });

  it("rejects a mismatched mime before creating an upload", async () => {
    const deps = makeDeps();

    const result = await handlePresignAsset(
      "9",
      { type: "image", mime: "video/mp4", size: 1024 },
      deps,
    );

    expect(result.code).toBe(400);
    expect(deps.storage.prepareUpload).not.toHaveBeenCalled();
    expect(deps.uploads.createPendingUpload).not.toHaveBeenCalled();
  });
});

describe("handleCompleteAsset", () => {
  it("submits a user-global library Asset without project ownership lookup", async () => {
    const deps = makeDeps();
    deps.uploads.findCommittedUpload.mockResolvedValue(null);
    deps.storage.inspectObject.mockResolvedValue({
      size: 12,
      mime: "image/png",
      publicUrl: "https://bucket.tos.test/uploads/9/image/global.png",
    });
    deps.uploads.createUploadedAsset.mockResolvedValue({
      id: "91",
      type: "image",
      storage_key: "uploads/9/image/global.png",
      url: "https://bucket.tos.test/uploads/9/image/global.png",
      mime: "image/png",
      size: BigInt(12),
      width: null,
      height: null,
      duration: null,
    });

    const result = await handleCompleteAsset(
      "9",
      {
        type: "image",
        mime: "image/png",
        size: 12,
        storage_key: "uploads/9/image/global.png",
      },
      deps,
    );

    expect(deps.projects.findOwnedById).not.toHaveBeenCalled();
    expect(deps.uploads.createUploadedAsset).toHaveBeenCalledWith({
      userId: "9",
      projectId: "0",
      type: "image",
      mime: "image/png",
      size: 12,
      storageKey: "uploads/9/image/global.png",
      url: "https://bucket.tos.test/uploads/9/image/global.png",
    });
    expect(result.data).toMatchObject({ asset_id: "91", status: "ready" });
  });

  it("checks project ownership and TOS metadata before submitting an Asset", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.uploads.findCommittedUpload.mockResolvedValue(null);
    deps.storage.inspectObject.mockResolvedValue({
      size: 2_336_799,
      mime: "image/png",
      publicUrl: "https://bucket.tos.test/uploads/9/image/file.png",
    });
    deps.uploads.createUploadedAsset.mockResolvedValue({
      id: "41",
      type: "image",
      storage_key: "uploads/9/image/file.png",
      url: "https://bucket.tos.test/uploads/9/image/file.png",
      mime: "image/png",
      size: BigInt(2_336_799),
      width: null,
      height: null,
      duration: null,
    });

    const result = await handleCompleteAsset(
      "9",
      {
        project_id: "55",
        type: "image",
        mime: "image/png",
        size: 2_336_799,
        storage_key: "uploads/9/image/file.png",
      },
      deps,
    );

    expect(deps.projects.findOwnedById).toHaveBeenCalledWith("55", "9");
    expect(deps.storage.inspectObject).toHaveBeenCalledWith(
      "uploads/9/image/file.png",
    );
    expect(deps.storage.makePublic).toHaveBeenCalledWith(
      "uploads/9/image/file.png",
    );
    expect(deps.storage.makePublic.mock.invocationCallOrder[0]).toBeLessThan(
      deps.uploads.createUploadedAsset.mock.invocationCallOrder[0],
    );
    expect(deps.uploads.createUploadedAsset).toHaveBeenCalledWith({
      userId: "9",
      projectId: "55",
      type: "image",
      mime: "image/png",
      size: 2_336_799,
      storageKey: "uploads/9/image/file.png",
      url: "https://bucket.tos.test/uploads/9/image/file.png",
    });
    expect(result.data).toMatchObject({
      asset_id: "41",
      status: "ready",
      url: "https://bucket.tos.test/uploads/9/image/file.png",
      size: 2_336_799,
    });
  });

  it("makes an existing committed upload public when complete is retried", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.uploads.findCommittedUpload.mockResolvedValue({
      id: "41",
      type: "image",
      storage_key: "uploads/9/image/file.png",
      url: "https://bucket.tos.test/uploads/9/image/file.png",
      mime: "image/png",
      size: BigInt(2_336_799),
      width: null,
      height: null,
      duration: null,
    });

    const result = await handleCompleteAsset(
      "9",
      {
        project_id: "55",
        type: "image",
        mime: "image/png",
        size: 2_336_799,
        storage_key: "uploads/9/image/file.png",
      },
      deps,
    );

    expect(deps.storage.makePublic).toHaveBeenCalledWith(
      "uploads/9/image/file.png",
    );
    expect(deps.storage.inspectObject).not.toHaveBeenCalled();
    expect(deps.uploads.createUploadedAsset).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ asset_id: "41", status: "ready" });
  });

  it("does not inspect TOS when the project is not owned by the user", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue(null);

    const result = await handleCompleteAsset(
      "10",
      {
        project_id: "55",
        type: "image",
        mime: "image/png",
        size: 1024,
        storage_key: "uploads/10/image/file.png",
      },
      deps,
    );

    expect(result.code).toBe(100301);
    expect(deps.storage.inspectObject).not.toHaveBeenCalled();
    expect(deps.uploads.createUploadedAsset).not.toHaveBeenCalled();
  });
});

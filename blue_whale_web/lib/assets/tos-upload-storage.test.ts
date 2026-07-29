import { describe, expect, it, vi } from "vitest";

import { createTosStorage } from "./tos-storage";

const config = {
  accessKeyId: "ak-test",
  secretAccessKey: "sk-test",
  endpoint: "https://tos-cn-beijing.volces.com",
  bucket: "blue-whale-test",
  region: "cn-beijing",
  signedUrlTtlSeconds: 600,
};

describe("TOS direct upload storage", () => {
  it("marks an uploaded object as public-read before exposing its URL", async () => {
    const client = {
      getPreSignedUrl: vi.fn(),
      headObject: vi.fn(),
      putObjectAcl: vi.fn().mockResolvedValue({}),
    };
    const storage = createTosStorage(config, { client });
    const makePublic = (
      storage.uploads as typeof storage.uploads & {
        makePublic?: (storageKey: string) => Promise<void>;
      }
    ).makePublic;

    expect(makePublic).toBeTypeOf("function");
    if (!makePublic) return;
    await makePublic("uploads/9/image/file.png");

    expect(client.putObjectAcl).toHaveBeenCalledWith({
      bucket: "blue-whale-test",
      key: "uploads/9/image/file.png",
      acl: "public-read",
    });
  });

  it("signs an owner-scoped PUT and verifies the uploaded object with HEAD", async () => {
    const client = {
      getPreSignedUrl: vi.fn().mockResolvedValue("https://tos.test/signed-put"),
      headObject: vi.fn().mockResolvedValue({
        data: { contentLength: 1024, contentType: "image/png" },
      }),
      putObjectAcl: vi.fn(),
    };
    const storage = createTosStorage(config, {
      client,
      randomUUID: () => "fixed-id",
    });

    expect(storage.uploads).toBeTruthy();
    const prepared = await storage.uploads!.prepareUpload({
      userId: "9",
      type: "image",
      mime: "image/png",
    });
    const object = await storage.uploads.inspectObject(prepared.storageKey);

    expect(prepared).toEqual({
      storageKey: "uploads/9/image/fixedid.png",
      publicUrl:
        "https://blue-whale-test.tos-cn-beijing.volces.com/uploads/9/image/fixedid.png",
      uploadUrl: "https://tos.test/signed-put",
      headers: { "Content-Type": "image/png" },
      expiresIn: 600,
    });
    expect(client.getPreSignedUrl).toHaveBeenCalledWith({
      bucket: "blue-whale-test",
      key: "uploads/9/image/fixedid.png",
      method: "PUT",
      expires: 600,
    });
    expect(client.headObject).toHaveBeenCalledWith({
      bucket: "blue-whale-test",
      key: "uploads/9/image/fixedid.png",
    });
    expect(object).toEqual({
      size: 1024,
      mime: "image/png",
      publicUrl:
        "https://blue-whale-test.tos-cn-beijing.volces.com/uploads/9/image/fixedid.png",
    });
  });

  it("returns false when TOS reports a missing object", async () => {
    const client = {
      getPreSignedUrl: vi.fn(),
      headObject: vi.fn().mockRejectedValue({ statusCode: 404 }),
      putObjectAcl: vi.fn(),
    };
    const storage = createTosStorage(config, { client });

    await expect(storage.uploads.inspectObject("uploads/9/image/missing.png")).resolves.toBe(
      null,
    );
  });
});

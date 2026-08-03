import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createS3CompatStorage,
  loadS3CompatStorageConfig,
} from "./s3-compat-storage";

const config = {
  publicBase: "http://localhost:4330",
  internalBase: "http://storage-stub:4330",
  secret: "test-secret",
};

function expectedSignature(method: string, key: string, expires: number) {
  return createHmac("sha256", config.secret)
    .update(`${method}\n${key}\n${expires}`)
    .digest("hex");
}

describe("loadS3CompatStorageConfig", () => {
  it("缺少 publicBase 或 secret 时返回 null", () => {
    expect(loadS3CompatStorageConfig({})).toBeNull();
    expect(
      loadS3CompatStorageConfig({ ASSET_UPLOAD_PUBLIC_BASE: "http://x" }),
    ).toBeNull();
  });

  it("internalBase 缺省时回退 publicBase，尾斜杠剥离", () => {
    const loaded = loadS3CompatStorageConfig({
      ASSET_UPLOAD_PUBLIC_BASE: "http://localhost:4330/",
      ASSET_UPLOAD_SECRET: "s",
    });
    expect(loaded).toEqual({
      publicBase: "http://localhost:4330",
      internalBase: "http://localhost:4330",
      secret: "s",
    });
  });
});

describe("createS3CompatStorage / prepareUpload", () => {
  it("生成 owner 作用域 storageKey 与双签名 URL", async () => {
    const storage = createS3CompatStorage(config, {
      randomUUID: () => "abcd1234-abcd-1234-abcd-1234abcd5678",
    });

    const prepared = await storage.uploads.prepareUpload({
      userId: "9",
      type: "image",
      mime: "image/png",
    });

    expect(prepared.storageKey).toBe(
      "uploads/9/image/abcd1234abcd1234abcd1234abcd5678.png",
    );
    expect(prepared.headers).toEqual({ "Content-Type": "image/png" });
    expect(prepared.expiresIn).toBe(600);

    const uploadUrl = new URL(prepared.uploadUrl);
    expect(uploadUrl.origin).toBe("http://localhost:4330");
    expect(uploadUrl.pathname).toBe(
      "/objects/uploads/9/image/abcd1234abcd1234abcd1234abcd5678.png",
    );
    expect(uploadUrl.searchParams.get("bw-auth")).toBe("direct");
    const expires = Number(uploadUrl.searchParams.get("bw-expires"));
    expect(uploadUrl.searchParams.get("bw-signature")).toBe(
      expectedSignature("PUT", prepared.storageKey, expires),
    );

    const publicUrl = new URL(prepared.publicUrl);
    expect(publicUrl.origin).toBe("http://localhost:4330");
    expect(publicUrl.searchParams.get("bw-signature")).toBe(
      expectedSignature(
        "GET",
        prepared.storageKey,
        Number(publicUrl.searchParams.get("bw-expires")),
      ),
    );
  });
});

describe("createS3CompatStorage / inspectObject", () => {
  it("HEAD 命中时解析 size 与 mime，走 internalBase", async () => {
    const serverFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-length": "1234", "content-type": "image/png" },
      }),
    );
    const storage = createS3CompatStorage(config, { serverFetch });

    const object = await storage.uploads.inspectObject(
      "uploads/9/image/a1b2.png",
    );

    expect(object).toMatchObject({ size: 1234, mime: "image/png" });
    expect(object?.publicUrl.startsWith("http://localhost:4330/")).toBe(true);
    const headUrl = new URL(String(serverFetch.mock.calls[0][0]));
    expect(headUrl.origin).toBe("http://storage-stub:4330");
    const expires = Number(headUrl.searchParams.get("bw-expires"));
    expect(headUrl.searchParams.get("bw-signature")).toBe(
      expectedSignature("HEAD", "uploads/9/image/a1b2.png", expires),
    );
  });

  it("HEAD 404 返回 null（complete 判『上传对象不存在』）", async () => {
    const serverFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    const storage = createS3CompatStorage(config, { serverFetch });

    await expect(
      storage.uploads.inspectObject("uploads/9/image/missing.png"),
    ).resolves.toBeNull();
  });

  it("HEAD 其他非 2xx 抛错（不当作对象缺失）", async () => {
    const serverFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const storage = createS3CompatStorage(config, { serverFetch });

    await expect(
      storage.uploads.inspectObject("uploads/9/image/a.png"),
    ).rejects.toThrow("S3-compat HEAD failed: 500");
  });
});

describe("createS3CompatStorage / signer 与 makePublic", () => {
  it("signer 签发 publicBase 上的短期 GET URL 与过期时刻", async () => {
    const storage = createS3CompatStorage(config, {});
    const before = Math.floor(Date.now() / 1000);

    const { url, expiresAt } = await storage.signer.sign(
      "uploads/9/image/a.png",
    );

    const parsed = new URL(url);
    expect(parsed.origin).toBe("http://localhost:4330");
    const expires = Number(parsed.searchParams.get("bw-expires"));
    expect(expires).toBeGreaterThanOrEqual(before + 600);
    expect(expiresAt.getTime()).toBe(expires * 1000);
  });

  it("makePublic 是 no-op（不产生网络调用）", async () => {
    const serverFetch = vi.fn();
    const storage = createS3CompatStorage(config, { serverFetch });
    await storage.uploads.makePublic("uploads/9/image/a.png");
    expect(serverFetch).not.toHaveBeenCalled();
  });
});

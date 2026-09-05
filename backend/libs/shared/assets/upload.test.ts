import { describe, expect, it, vi } from "vitest";

import { handleDedupAsset, handlePresignAsset } from "./upload.js";

const ASSET = {
  id: "526",
  type: "video",
  url: "https://bucket.tos.test/generated/1/video/x.mp4",
  mime: "video/mp4",
  size: 100n,
  width: 854,
  height: 480,
  duration: null,
};

const VALID_MD5 = "aabbccddeeff00112233445566778899";

describe("handleDedupAsset（IKCNLS）", () => {
  it("命中：返回 dedup:true + 资产（形状同 complete），并建 project_asset 关联", async () => {
    const findOwnedByMd5 = vi.fn().mockResolvedValue(ASSET);
    const linkAssetToProject = vi.fn().mockResolvedValue(true);
    const projects = { findOwnedById: vi.fn().mockResolvedValue({ id: 313n }) };
    const uploads = { findOwnedByMd5, linkAssetToProject };

    const result = await handleDedupAsset("9", {
      type: "video",
      mime: "video/mp4",
      size: 100,
      md5: VALID_MD5,
      project_id: "313",
    }, { projects, uploads } as never);

    expect(result).toEqual({
      code: 200,
      data: {
        dedup: true,
        asset: {
          asset_id: "526",
          status: "ready",
          type: "video",
          url: ASSET.url,
          width: 854,
          height: 480,
          duration: null,
          mime: "video/mp4",
          size: 100,
        },
      },
      msg: null,
    });
    expect(linkAssetToProject).toHaveBeenCalledWith({
      userId: "9",
      assetId: "526",
      projectId: "313",
    });
  });

  it("未命中：返回 dedup:false 需上传", async () => {
    const uploads = { findOwnedByMd5: vi.fn().mockResolvedValue(null), linkAssetToProject: vi.fn() };
    const projects = { findOwnedById: vi.fn() };
    const result = await handleDedupAsset("9", {
      type: "image", mime: "image/png", size: 10, md5: VALID_MD5,
    }, { projects, uploads } as never);
    expect(result).toEqual({ code: 200, data: { dedup: false }, msg: null });
    expect(uploads.linkAssetToProject).not.toHaveBeenCalled();
  });

  it("md5 格式不标准 → fail-open 返回 dedup:false（不阻断上传）", async () => {
    const uploads = { findOwnedByMd5: vi.fn(), linkAssetToProject: vi.fn() };
    const projects = { findOwnedById: vi.fn() };
    for (const badMd5 of ["", "not-a-md5", "aabb", "AABBCCDDEEFF00112233445566778899ZZ"]) {
      const result = await handleDedupAsset("9", {
        type: "image", mime: "image/png", size: 10, md5: badMd5,
      }, { projects, uploads } as never);
      expect(result).toEqual({ code: 200, data: { dedup: false }, msg: null });
    }
    expect(uploads.findOwnedByMd5).not.toHaveBeenCalled();
  });

  it("命中但 type 不一致 → 视为未命中（不返回误标类型资产）", async () => {
    const uploads = { findOwnedByMd5: vi.fn().mockResolvedValue(ASSET), linkAssetToProject: vi.fn() };
    const projects = { findOwnedById: vi.fn() };
    const result = await handleDedupAsset("9", {
      type: "image", mime: "image/png", size: 100, md5: VALID_MD5,
    }, { projects, uploads } as never);
    expect(result).toEqual({ code: 200, data: { dedup: false }, msg: null });
    expect(uploads.linkAssetToProject).not.toHaveBeenCalled();
  });

  it("无归属项目 → 100301", async () => {
    const uploads = { findOwnedByMd5: vi.fn() };
    const projects = { findOwnedById: vi.fn().mockResolvedValue(null) };
    const result = await handleDedupAsset("9", {
      type: "video", mime: "video/mp4", size: 100, md5: VALID_MD5, project_id: "404",
    }, { projects, uploads } as never);
    expect(result).toMatchObject({ code: 100301 });
    expect(uploads.findOwnedByMd5).not.toHaveBeenCalled();
  });

  it("重链幂等：同 asset+project 再次命中，linkAssetToProject 仍被调（upsert 幂等）", async () => {
    const linkAssetToProject = vi.fn().mockResolvedValue(true);
    const uploads = { findOwnedByMd5: vi.fn().mockResolvedValue(ASSET), linkAssetToProject };
    const projects = { findOwnedById: vi.fn().mockResolvedValue({ id: 313n }) };
    await handleDedupAsset("9", { type: "video", mime: "video/mp4", size: 100, md5: VALID_MD5, project_id: "313" }, { projects, uploads } as never);
    await handleDedupAsset("9", { type: "video", mime: "video/mp4", size: 100, md5: VALID_MD5, project_id: "313" }, { projects, uploads } as never);
    expect(linkAssetToProject).toHaveBeenCalledTimes(2);
    expect(linkAssetToProject).toHaveBeenLastCalledWith({ userId: "9", assetId: "526", projectId: "313" });
  });
});

describe("presign 的格式门（2026-09-05 深度回归）", () => {
  const storage = () => ({
    prepareUpload: vi.fn().mockResolvedValue({
      storageKey: "uploads/7/image/x.jpg",
      uploadUrl: "https://bucket.tos.test/put",
      headers: {},
      expiresIn: 900,
    }),
    inspectObject: vi.fn(),
    makePublic: vi.fn(),
    deleteMultiObjects: vi.fn(),
  });

  // TOS 对 SVG 做图片处理会挂死（测试站实测 25 秒零字节），所以不让它进库。
  // 挡在上传口，用户拖文件的当下就知道要换格式。
  it("SVG 在上传口就被挡下，且没有向存储要过预签名", async () => {
    const s = storage();
    const outcome = await handlePresignAsset(
      "7",
      { type: "image", mime: "image/svg+xml", size: 4096 },
      s,
    );
    expect(outcome).toMatchObject({ code: 400 });
    expect(s.prepareUpload).not.toHaveBeenCalled();
  });

  it("放行的图片仍然照常签", async () => {
    const s = storage();
    const outcome = await handlePresignAsset(
      "7",
      { type: "image", mime: "image/jpeg", size: 4096 },
      s,
    );
    expect(outcome).toMatchObject({ code: 200 });
    expect(s.prepareUpload).toHaveBeenCalledWith({
      userId: "7",
      type: "image",
      mime: "image/jpeg",
    });
  });

  // HEIC 是 iPhone 拍照的默认格式，TOS 转得动、模型读得了，不该被挡。
  it("HEIC 放行——TOS 会把它转成 JPEG 给模型读", async () => {
    const s = storage();
    const outcome = await handlePresignAsset(
      "7",
      { type: "image", mime: "image/heic", size: 4096 },
      s,
    );
    expect(outcome).toMatchObject({ code: 200 });
  });
});

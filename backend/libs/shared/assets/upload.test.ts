import { describe, expect, it, vi } from "vitest";
import { DomainError, RESOURCE_NOT_FOUND_CODE } from "@lib/contracts";

import {
  handleCompleteAsset,
  handleDedupAsset,
  handlePresignAsset,
} from "./upload.js";

/**
 * 拒绝要**抛**，而且抛出来的错误必须同时钉住 `code` 与 `status`。
 *
 * 只断言 code 是不够的——这次修的正是「信封里 code=400，HTTP 却回 201」。少了 status 这一格，
 * 同样的 bug 明天可以原样再来一次而测试全绿。
 */
async function expectRejected(
  run: () => Promise<unknown>,
  expected: { code: number; status: number },
) {
  await expect(run()).rejects.toBeInstanceOf(DomainError);
  const error = await run().catch((e: unknown) => e as DomainError);
  expect({ code: error.code, status: error.status }).toEqual(expected);
  return error;
}

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
    await expectRejected(
      () => handleDedupAsset("9", {
        type: "video", mime: "video/mp4", size: 100, md5: VALID_MD5, project_id: "404",
      }, { projects, uploads } as never),
      { code: RESOURCE_NOT_FOUND_CODE, status: 404 },
    );
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
    // 2003 = 格式读不了。HTTP 必须也是 400——此前这里回的是 201，信封说失败、传输层说创建成功。
    await expectRejected(
      () => handlePresignAsset("7", { type: "image", mime: "image/svg+xml", size: 4096 }, s),
      { code: 2003, status: 400 },
    );
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


/**
 * IKE53U：上传口读一次文件本身。
 *
 * 此前 complete 校验的全是声明值——type、mime、size，以及对象存储上的 size 与 Content-Type
 * 是否与声明一致。而 Content-Type 正是客户端 PUT 时自己写的，两边天然自洽。测试站
 * 2026-09-08 的 asset_id=6012 就这么进了库：524 字节随机数据、声明 image/jpeg、一路畅通。
 */
describe("complete 的文件头校验（IKE53U）", () => {
  const head = (...values: number[]) => {
    const buffer = new Uint8Array(32);
    buffer.set(values);
    return buffer;
  };

  const completeDeps = (headBytes: Uint8Array | null) => ({
    projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "0" }) } as never,
    uploads: {
      findCommittedUpload: vi.fn().mockResolvedValue(null),
      createUploadedAsset: vi
        .fn()
        .mockResolvedValue({ ...ASSET, type: "image", mime: "image/jpeg" }),
    } as never,
    storage: {
      readHead: vi.fn().mockResolvedValue(headBytes),
      inspectObject: vi.fn().mockResolvedValue({
        size: 524,
        mime: "image/jpeg",
        publicUrl: "https://bucket.tos.test/uploads/7/image/x.jpg",
      }),
      makePublic: vi.fn(),
      prepareUpload: vi.fn(),
      deleteMultiObjects: vi.fn(),
    } as never,
  });

  const complete = (deps: ReturnType<typeof completeDeps>) =>
    handleCompleteAsset(
      "7",
      {
        type: "image",
        mime: "image/jpeg",
        size: 524,
        storage_key: "uploads/7/image/x.jpg",
      },
      deps,
    );

  it("拒收时把刚直传上去的那份字节删掉，不在桶里留孤儿", async () => {
    // 字节比这道门先落地：前端拿预签名地址直传对象存储，后端不在那条路上。被拒的上传如果
    // 不清理，桶里就留下一个谁也不引用的对象，而素材 GC 至今没跑。
    const deps = completeDeps(head(0xab, 0xcd, 0xef, 0x12));
    await expect(complete(deps)).rejects.toBeInstanceOf(DomainError);
    expect(
      (deps.storage as unknown as { deleteMultiObjects: ReturnType<typeof vi.fn> })
        .deleteMultiObjects,
    ).toHaveBeenCalledWith(["uploads/7/image/x.jpg"]);
  });

  it("删不掉也照样拒收——用户要看到的是「这份文件不行」，不是「清理失败」", async () => {
    const deps = completeDeps(head(0xab, 0xcd, 0xef, 0x12));
    (deps.storage as unknown as { deleteMultiObjects: ReturnType<typeof vi.fn> })
      .deleteMultiObjects.mockRejectedValue(new Error("TOS 抽风"));
    await expectRejected(() => complete(deps), { code: 2010, status: 400 });
  });

  it("字节认不出任何容器就拒收，不落库", async () => {
    // 那份坏文件的真实头：AB CD EF 12，而 JPEG 该是 FF D8 FF。
    const deps = completeDeps(head(0xab, 0xcd, 0xef, 0x12, 0x00, 0x10, 0x4a, 0x46));
    // 2010 = 文件打不开。与 2003「格式不支持」是两条不同的话，措辞和码都不许混。
    await expectRejected(() => complete(deps), { code: 2010, status: 400 });
    expect(
      (deps.uploads as unknown as { createUploadedAsset: ReturnType<typeof vi.fn> })
        .createUploadedAsset,
    ).not.toHaveBeenCalled();
  });

  it("真的 JPEG 照常入库", async () => {
    const deps = completeDeps(head(0xff, 0xd8, 0xff, 0xe0));
    await expect(complete(deps)).resolves.toMatchObject({ code: 200 });
  });

  it("认出来但不是声明的那一类也拒——按字节说的算", async () => {
    // 声明 image，字节是 MP4：ftyp 盒子的 brand 是 isom。
    const mp4 = new Uint8Array(32);
    mp4.set(new TextEncoder().encode("ftypisom"), 4);
    const deps = completeDeps(mp4);
    // 认得出、但不是声明的那一类：请求合法而内容不符语义，归 422。
    await expectRejected(() => complete(deps), { code: 2012, status: 422 });
  });

  /**
   * 读不到和认不出要分开。取字节失败（存储抖动、适配器没实现）时放行——这道门是为了挡住
   * 明显不是媒体的文件，不该因为一次网络抖动把正常上传拒掉，那是最容易让人白白重传三次的
   * 一种错话。
   */
  it("读不到文件头时放行，不把一次抖动说成「你的文件坏了」", async () => {
    await expect(complete(completeDeps(null))).resolves.toMatchObject({ code: 200 });
  });
});

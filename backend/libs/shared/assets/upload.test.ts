import { describe, expect, it, vi } from "vitest";
import { DomainError, RESOURCE_NOT_FOUND_CODE } from "@lib/contracts";

import {
  handleCompleteAsset,
  handleDedupAsset,
  handlePresignAsset,
} from "./upload.js";

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
  material_id: null,
};

const VALID_MD5 = "aabbccddeeff00112233445566778899";

const statusReader = (status: string | null = "Active") => ({
  load: vi.fn().mockResolvedValue(status),
});

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
    }, { projects, uploads, materialStatus: statusReader() } as never);

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
          material_id: null,
          material_status: null,
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
    }, { projects, uploads, materialStatus: statusReader() } as never);
    expect(result).toEqual({ code: 200, data: { dedup: false }, msg: null });
    expect(uploads.linkAssetToProject).not.toHaveBeenCalled();
  });

  it("md5 格式不标准 → fail-open 返回 dedup:false（不阻断上传）", async () => {
    const uploads = { findOwnedByMd5: vi.fn(), linkAssetToProject: vi.fn() };
    const projects = { findOwnedById: vi.fn() };
    for (const badMd5 of ["", "not-a-md5", "aabb", "AABBCCDDEEFF00112233445566778899ZZ"]) {
      const result = await handleDedupAsset("9", {
        type: "image", mime: "image/png", size: 10, md5: badMd5,
      }, { projects, uploads, materialStatus: statusReader() } as never);
      expect(result).toEqual({ code: 200, data: { dedup: false }, msg: null });
    }
    expect(uploads.findOwnedByMd5).not.toHaveBeenCalled();
  });

  it("命中但 type 不一致 → 视为未命中（不返回误标类型资产）", async () => {
    const uploads = { findOwnedByMd5: vi.fn().mockResolvedValue(ASSET), linkAssetToProject: vi.fn() };
    const projects = { findOwnedById: vi.fn() };
    const result = await handleDedupAsset("9", {
      type: "image", mime: "image/png", size: 100, md5: VALID_MD5,
    }, { projects, uploads, materialStatus: statusReader() } as never);
    expect(result).toEqual({ code: 200, data: { dedup: false }, msg: null });
    expect(uploads.linkAssetToProject).not.toHaveBeenCalled();
  });

  it("无归属项目 → 100301", async () => {
    const uploads = { findOwnedByMd5: vi.fn() };
    const projects = { findOwnedById: vi.fn().mockResolvedValue(null) };
    await expectRejected(
      () => handleDedupAsset("9", {
        type: "video", mime: "video/mp4", size: 100, md5: VALID_MD5, project_id: "404",
      }, { projects, uploads, materialStatus: statusReader() } as never),
      { code: RESOURCE_NOT_FOUND_CODE, status: 404 },
    );
    expect(uploads.findOwnedByMd5).not.toHaveBeenCalled();
  });

  it("重链幂等：同 asset+project 再次命中，linkAssetToProject 仍被调（upsert 幂等）", async () => {
    const linkAssetToProject = vi.fn().mockResolvedValue(true);
    const uploads = { findOwnedByMd5: vi.fn().mockResolvedValue(ASSET), linkAssetToProject };
    const projects = { findOwnedById: vi.fn().mockResolvedValue({ id: 313n }) };
    await handleDedupAsset("9", { type: "video", mime: "video/mp4", size: 100, md5: VALID_MD5, project_id: "313" }, { projects, uploads, materialStatus: statusReader() } as never);
    await handleDedupAsset("9", { type: "video", mime: "video/mp4", size: 100, md5: VALID_MD5, project_id: "313" }, { projects, uploads, materialStatus: statusReader() } as never);
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

  it("SVG 在上传口就被挡下，且没有向存储要过预签名", async () => {
    const s = storage();
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
    materialStatus: statusReader(),
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
    const deps = completeDeps(head(0xab, 0xcd, 0xef, 0x12, 0x00, 0x10, 0x4a, 0x46));
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

  it("complete 将上传原文件名交给资产仓库", async () => {
    const deps = completeDeps(head(0xff, 0xd8, 0xff, 0xe0));
    await handleCompleteAsset("7", {
      type: "image", mime: "image/jpeg", size: 524,
      storage_key: "uploads/7/image/x.jpg", name: "海浪.jpg",
    }, deps);
    expect((deps.uploads as unknown as { createUploadedAsset: ReturnType<typeof vi.fn> }).createUploadedAsset)
      .toHaveBeenCalledWith(expect.objectContaining({ name: "海浪.jpg" }));
  });

  it("认出来但不是声明的那一类也拒——按字节说的算", async () => {
    const mp4 = new Uint8Array(32);
    mp4.set(new TextEncoder().encode("ftypisom"), 4);
    const deps = completeDeps(mp4);
    await expectRejected(() => complete(deps), { code: 2012, status: 422 });
  });

  it("读不到文件头时放行，不把一次抖动说成「你的文件坏了」", async () => {
    await expect(complete(completeDeps(null))).resolves.toMatchObject({ code: 200 });
  });
});

describe("上传口素材闸（IKGQWR / ADR-0093）", () => {
  const MATERIAL = "asset-20260820153209-6c9z8";
  const NOT_APPROVED = "该素材未审核通过，不能用于视频生成";
  const UNAVAILABLE = "素材状态校验失败，请稍后重试";

  const DEDUP_INPUT = {
    type: "video" as const,
    mime: "video/mp4",
    size: 100,
    md5: VALID_MD5,
  };

  const allow = () => ({
    check: vi.fn().mockResolvedValue({ ok: true }),
  });
  const deny = (message: string) => ({
    check: vi.fn().mockResolvedValue({ ok: false, message }),
  });

  const completeDeps = (materialGate: unknown, overrides: Record<string, unknown> = {}) => ({
    projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "313" }) } as never,
    uploads: {
      findCommittedUpload: vi.fn().mockResolvedValue(null),
      findOwnedByMaterialId: vi.fn().mockResolvedValue(null),
      createUploadedAsset: vi.fn().mockResolvedValue(ASSET),
      bindMaterialId: vi.fn().mockResolvedValue(true),
      linkAssetToProject: vi.fn().mockResolvedValue(true),
      ...overrides,
    } as never,
    storage: {
      readHead: vi.fn().mockResolvedValue(null),
      inspectObject: vi.fn().mockResolvedValue({
        size: 100,
        mime: "video/mp4",
        publicUrl: "https://bucket.tos.test/uploads/9/video/x.mp4",
      }),
      makePublic: vi.fn(),
      prepareUpload: vi.fn(),
      deleteMultiObjects: vi.fn(),
    } as never,
    probe: vi.fn().mockResolvedValue({ sizeBytes: 100, durationMs: 6000, width: 1080, height: 1920, codec: null, container: null, fps: null }),
    materialGate,
    materialStatus: statusReader(),
  });

  const COMPLETE_INPUT = {
    type: "video" as const,
    mime: "video/mp4",
    size: 100,
    storage_key: "uploads/9/video/x.mp4",
    project_id: "313",
    materialId: MATERIAL,
  };

  it("dedup：闸不过 → 抛 2013 + 闸给的文案，且根本不去查 md5", async () => {
    const findOwnedByMd5 = vi.fn();
    const gate = deny(NOT_APPROVED);
    const error = await expectRejected(
      () =>
        handleDedupAsset(
          "9",
          { ...DEDUP_INPUT, materialId: MATERIAL },
          {
            projects: { findOwnedById: vi.fn() },
            uploads: { findOwnedByMd5 },
            materialGate: gate,
            materialStatus: statusReader(),
          } as never,
        ),
      { code: 2013, status: 400 },
    );
    expect(error.message).toBe(NOT_APPROVED);
    expect(gate.check).toHaveBeenCalledWith("9", MATERIAL);
    expect(findOwnedByMd5).not.toHaveBeenCalled();
  });

  it("dedup：闸不过且是暂时故障 → 仍是同一个码 2013，靠 msg 分流", async () => {
    const error = await expectRejected(
      () =>
        handleDedupAsset(
          "9",
          { ...DEDUP_INPUT, materialId: MATERIAL },
          {
            projects: { findOwnedById: vi.fn() },
            uploads: { findOwnedByMd5: vi.fn() },
            materialGate: deny(UNAVAILABLE),
            materialStatus: statusReader(),
          } as never,
        ),
      { code: 2013, status: 400 },
    );
    expect(error.message).toBe(UNAVAILABLE);
  });

  it("dedup：闸通过 + md5 命中 → 绑上 material_id", async () => {
    const bindMaterialId = vi.fn().mockResolvedValue(true);
    const gate = allow();
    const result = await handleDedupAsset(
      "9",
      { ...DEDUP_INPUT, materialId: MATERIAL },
      {
        projects: { findOwnedById: vi.fn().mockResolvedValue({ id: 313n }) },
        uploads: {
          findOwnedByMd5: vi.fn().mockResolvedValue(ASSET),
          linkAssetToProject: vi.fn().mockResolvedValue(true),
          bindMaterialId,
        },
        materialGate: gate,
        materialStatus: statusReader(),
      } as never,
    );
    expect(bindMaterialId).toHaveBeenCalledWith({
      userId: "9",
      assetId: "526",
      materialId: MATERIAL,
    });
    expect((result as { data: { dedup: boolean } }).data.dedup).toBe(true);
  });

  it("dedup：md5 未命中但按素材库 id 反查命中 → dedup:true，前端不必再上传一轮", async () => {
    const findOwnedByMaterialId = vi.fn().mockResolvedValue(ASSET);
    const result = await handleDedupAsset(
      "9",
      { ...DEDUP_INPUT, materialId: MATERIAL },
      {
        projects: { findOwnedById: vi.fn() },
        uploads: {
          findOwnedByMd5: vi.fn().mockResolvedValue(null),
          findOwnedByMaterialId,
          bindMaterialId: vi.fn().mockResolvedValue(true),
        },
        materialGate: allow(),
        materialStatus: statusReader(),
      } as never,
    );
    expect(findOwnedByMaterialId).toHaveBeenCalledWith("9", MATERIAL);
    expect((result as { data: { dedup: boolean } }).data.dedup).toBe(true);
  });

  it("dedup：不带 materialId → 闸完全不参与，既有路径逐字不变", async () => {
    const gate = allow();
    const result = await handleDedupAsset(
      "9",
      { type: "video", mime: "video/mp4", size: 100, md5: VALID_MD5 },
      {
        projects: { findOwnedById: vi.fn() },
        uploads: {
          findOwnedByMd5: vi.fn().mockResolvedValue(ASSET),
          linkAssetToProject: vi.fn(),
        },
        materialGate: gate,
        materialStatus: statusReader(),
      } as never,
    );
    expect(gate.check).not.toHaveBeenCalled();
    expect((result as { data: { dedup: boolean } }).data.dedup).toBe(true);
  });

  it("complete：闸不过 → 删掉刚 PUT 的字节 + 抛 2013，且不建行", async () => {
    const deps = completeDeps(deny(NOT_APPROVED));
    const error = await expectRejected(
      () => handleCompleteAsset("9", COMPLETE_INPUT, deps as never),
      { code: 2013, status: 400 },
    );
    expect(error.message).toBe(NOT_APPROVED);
    expect(
      (deps.uploads as unknown as { createUploadedAsset: ReturnType<typeof vi.fn> })
        .createUploadedAsset,
    ).not.toHaveBeenCalled();
    expect(
      (deps.storage as unknown as { deleteMultiObjects: ReturnType<typeof vi.fn> })
        .deleteMultiObjects,
    ).toHaveBeenCalledWith(["uploads/9/video/x.mp4"]);
  });

  it("complete：闸通过 → 建行时把素材组 id 一并写进去", async () => {
    const deps = completeDeps(allow());
    await handleCompleteAsset("9", COMPLETE_INPUT, deps as never);
    expect(
      (deps.uploads as unknown as { createUploadedAsset: ReturnType<typeof vi.fn> })
        .createUploadedAsset,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        materialId: MATERIAL,
      }),
    );
  });

  it("complete：闸不过时也要求 storage_key 先归属校验 —— 别人的 key 不该被我们删对象", async () => {
    const deps = completeDeps(deny(NOT_APPROVED));
    await expectRejected(
      () =>
        handleCompleteAsset(
          "9",
          { ...COMPLETE_INPUT, storage_key: "uploads/7/video/x.mp4" },
          deps as never,
        ),
      { code: 2006, status: 403 },
    );
    expect(
      (deps.storage as unknown as { deleteMultiObjects: ReturnType<typeof vi.fn> })
        .deleteMultiObjects,
    ).not.toHaveBeenCalled();
  });

  it("complete：幂等重放命中 → 返回既有资产，且不因闸不过去删既有资产引用的那份字节", async () => {
    const deps = completeDeps(deny(NOT_APPROVED), {
      findCommittedUpload: vi.fn().mockResolvedValue(ASSET),
    });
    const result = await handleCompleteAsset("9", COMPLETE_INPUT, deps as never);
    expect((result as { data: { asset_id: string } }).data.asset_id).toBe("526");
    expect(
      (deps.storage as unknown as { deleteMultiObjects: ReturnType<typeof vi.fn> })
        .deleteMultiObjects,
    ).not.toHaveBeenCalled();
  });
});

describe("complete 的来源标记（IKGOTB 遮罩中间素材不进资产列表）", () => {
  const pngHead = () => {
    const buffer = new Uint8Array(32);
    buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buffer;
  };

  const sourceDeps = () => ({
    projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "0" }) } as never,
    uploads: {
      findCommittedUpload: vi.fn().mockResolvedValue(null),
      createUploadedAsset: vi.fn().mockResolvedValue({ ...ASSET, type: "image", mime: "image/png" }),
    } as never,
    storage: {
      readHead: vi.fn().mockResolvedValue(pngHead()),
      inspectObject: vi.fn().mockResolvedValue({
        size: 100,
        mime: "image/png",
        publicUrl: "https://bucket.tos.test/uploads/7/image/mask.png",
      }),
      makePublic: vi.fn(),
      prepareUpload: vi.fn(),
      deleteMultiObjects: vi.fn(),
    } as never,
    materialStatus: statusReader(),
  });

  const completeWithSource = (deps: ReturnType<typeof sourceDeps>, source?: string) =>
    handleCompleteAsset(
      "7",
      {
        type: "image",
        mime: "image/png",
        size: 100,
        storage_key: "uploads/7/image/mask.png",
        ...(source === undefined ? {} : { source }),
      },
      deps,
    );

  it("source=mask_erase 透传落库（前端涂抹遮罩上传，资产列表按该来源排除）", async () => {
    const deps = sourceDeps();
    await expect(completeWithSource(deps, "mask_erase")).resolves.toMatchObject({ code: 200 });
    expect(
      (deps.uploads as unknown as { createUploadedAsset: ReturnType<typeof vi.fn> })
        .createUploadedAsset,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ source: "mask_erase", storageKey: "uploads/7/image/mask.png" }),
    );
  });

  it("缺省与非白名单 source 一律回落 uploaded（无鉴权语义，只是展示过滤维度）", async () => {
    const deps = sourceDeps();
    await expect(completeWithSource(deps)).resolves.toMatchObject({ code: 200 });
    expect(
      (deps.uploads as unknown as { createUploadedAsset: ReturnType<typeof vi.fn> })
        .createUploadedAsset,
    ).toHaveBeenCalledWith(expect.objectContaining({ source: "uploaded" }));

    const deps2 = sourceDeps();
    await expect(completeWithSource(deps2, "admin")).resolves.toMatchObject({ code: 200 });
    expect(
      (deps2.uploads as unknown as { createUploadedAsset: ReturnType<typeof vi.fn> })
        .createUploadedAsset,
    ).toHaveBeenCalledWith(expect.objectContaining({ source: "uploaded" }));
  });
});

describe("上传接口回显素材关联与状态（IKI65H）", () => {
  const MATERIAL = "asset-20260820153209-6c9z8";
  const OLD_MATERIAL = "asset-20260701090000-oldoldoldold";
  const NOT_APPROVED = "该素材未审核通过，不能用于视频生成";

  const boundAsset = (materialId: string = MATERIAL) => ({
    ...ASSET,
    material_id: materialId,
  });

  type MaterialFields = { material_id: string | null; material_status: string | null };

  const dedupAsset = (result: unknown) =>
    (result as { data: { asset: MaterialFields } }).data.asset;

  const completeData = (result: unknown) =>
    (result as { data: MaterialFields }).data;

  const dedupDeps = (
    asset: unknown,
    status: string | null = "Active",
    overrides: Record<string, unknown> = {},
  ) => ({
    projects: { findOwnedById: vi.fn().mockResolvedValue({ id: 313n }) },
    uploads: {
      findOwnedByMd5: vi.fn().mockResolvedValue(asset),
      linkAssetToProject: vi.fn().mockResolvedValue(true),
      bindMaterialId: vi.fn().mockResolvedValue(true),
      ...overrides,
    },
    materialGate: {
      check: vi.fn().mockResolvedValue({ ok: true }),
    },
    materialStatus: statusReader(status),
  });

  const DEDUP_INPUT = {
    type: "video" as const,
    mime: "video/mp4",
    size: 100,
    md5: VALID_MD5,
  };

  it("dedup 命中已绑素材的资产：两个字段照库里的给", async () => {
    const deps = dedupDeps(boundAsset(), "Active");
    const result = await handleDedupAsset("9", DEDUP_INPUT, deps as never);
    expect(dedupAsset(result)).toMatchObject({
      material_id: MATERIAL,
      material_status: "Active",
    });
    expect(deps.materialStatus.load).toHaveBeenCalledWith("9", MATERIAL);
  });

  it("dedup 命中未绑素材的资产：两个字段都是 null，且不去查状态", async () => {
    const deps = dedupDeps(ASSET);
    const result = await handleDedupAsset("9", DEDUP_INPUT, deps as never);
    expect(dedupAsset(result)).toMatchObject({
      material_id: null,
      material_status: null,
    });
    expect(deps.materialStatus.load).not.toHaveBeenCalled();
  });

  it("dedup 命中并当场改嫁：回显刚绑上的那个，不是行上的旧值", async () => {
    const deps = dedupDeps(boundAsset(OLD_MATERIAL));
    const result = await handleDedupAsset(
      "9",
      { ...DEDUP_INPUT, materialId: MATERIAL },
      deps as never,
    );
    expect(dedupAsset(result)).toMatchObject({
      material_id: MATERIAL,
      material_status: "Active",
    });
    expect(deps.materialStatus.load).toHaveBeenCalledWith("9", MATERIAL);
  });

  it("dedup 未命中：响应里没有 asset，也就没有这两个字段", async () => {
    const deps = dedupDeps(null, "Active", { findOwnedByMd5: vi.fn().mockResolvedValue(null) });
    const result = await handleDedupAsset("9", DEDUP_INPUT, deps as never);
    expect(result).toEqual({ code: 200, data: { dedup: false }, msg: null });
    expect(deps.materialStatus.load).not.toHaveBeenCalled();
  });

  const completeDeps = (
    status: string | null = "Active",
    overrides: Record<string, unknown> = {},
  ) => ({
    projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "313" }) },
    uploads: {
      findCommittedUpload: vi.fn().mockResolvedValue(null),
      findOwnedByMaterialId: vi.fn().mockResolvedValue(null),
      createUploadedAsset: vi.fn().mockResolvedValue(boundAsset()),
      bindMaterialId: vi.fn().mockResolvedValue(true),
      linkAssetToProject: vi.fn().mockResolvedValue(true),
      ...overrides,
    },
    storage: {
      readHead: vi.fn().mockResolvedValue(null),
      inspectObject: vi.fn().mockResolvedValue({
        size: 100,
        mime: "video/mp4",
        publicUrl: "https://bucket.tos.test/uploads/9/video/x.mp4",
      }),
      makePublic: vi.fn(),
      deleteMultiObjects: vi.fn(),
    },
    probe: vi.fn().mockResolvedValue({ sizeBytes: 100, durationMs: 6000, width: 1080, height: 1920, codec: null, container: null, fps: null }),
    materialGate: {
      check: vi.fn().mockResolvedValue({ ok: true }),
    },
    materialStatus: statusReader(status),
  });

  const COMPLETE_INPUT = {
    type: "video" as const,
    mime: "video/mp4",
    size: 100,
    storage_key: "uploads/9/video/x.mp4",
    project_id: "313",
    materialId: MATERIAL,
  };

  it("complete 新建行：带上刚写进去的素材与它的状态", async () => {
    const deps = completeDeps("Active");
    const result = await handleCompleteAsset("9", COMPLETE_INPUT, deps as never);
    expect(completeData(result)).toMatchObject({
      material_id: MATERIAL,
      material_status: "Active",
    });
  });

  it("complete 不带 materialId：两个字段都是 null，且不去查状态", async () => {
    const deps = completeDeps("Active", {
      createUploadedAsset: vi.fn().mockResolvedValue(ASSET),
    });
    const result = await handleCompleteAsset(
      "9",
      {
        type: "video",
        mime: "video/mp4",
        size: 100,
        storage_key: "uploads/9/video/x.mp4",
        project_id: "313",
      },
      deps as never,
    );
    expect(completeData(result)).toMatchObject({
      material_id: null,
      material_status: null,
    });
    expect(deps.materialStatus.load).not.toHaveBeenCalled();
  });

  it("complete 幂等重放：行上绑着已 Failed 的素材、闸也不过 → 照实回 Failed", async () => {
    const deps = completeDeps("Failed", {
      findCommittedUpload: vi.fn().mockResolvedValue(boundAsset()),
    });
    deps.materialGate = {
      check: vi.fn().mockResolvedValue({ ok: false, message: NOT_APPROVED }),
    };
    const result = await handleCompleteAsset("9", COMPLETE_INPUT, deps as never);
    expect(completeData(result)).toMatchObject({
      material_id: MATERIAL,
      material_status: "Failed",
    });
    expect(result).toMatchObject({ code: 200 });
  });

  it("complete 幂等重放且闸通过：补绑之后回显新素材", async () => {
    const deps = completeDeps("Active", {
      findCommittedUpload: vi.fn().mockResolvedValue(boundAsset(OLD_MATERIAL)),
    });
    const result = await handleCompleteAsset("9", COMPLETE_INPUT, deps as never);
    expect(completeData(result)).toMatchObject({
      material_id: MATERIAL,
      material_status: "Active",
    });
    expect(
      deps.uploads.bindMaterialId as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "526", materialId: MATERIAL }),
    );
  });

  it("complete 幂等重放：闸不过且顺手清了关联 → 回读库，不撒谎", async () => {
    const deps = completeDeps("Failed", {
      findCommittedUpload: vi
        .fn()
        .mockResolvedValueOnce(boundAsset())
        .mockResolvedValueOnce({ ...ASSET, material_id: null }),
    });
    deps.materialGate = {
      check: vi.fn().mockResolvedValue({ ok: false, message: NOT_APPROVED }),
    };
    const result = await handleCompleteAsset("9", COMPLETE_INPUT, deps as never);
    expect(completeData(result)).toMatchObject({
      material_id: null,
      material_status: null,
    });
    expect(deps.materialStatus.load).not.toHaveBeenCalled();
  });
});

describe("complete：服务端探测音视频时长（IKOSU2）", () => {
  const makeDeps = (probe: unknown) => {
    const createUploadedAsset = vi.fn().mockResolvedValue(ASSET);
    return {
      deps: {
        projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "313" }) },
        uploads: {
          findCommittedUpload: vi.fn().mockResolvedValue(null),
          createUploadedAsset,
          linkAssetToProject: vi.fn().mockResolvedValue(true),
        },
        storage: {
          readHead: vi.fn().mockResolvedValue(null),
          inspectObject: vi.fn().mockResolvedValue({
            size: 100,
            mime: "video/mp4",
            publicUrl: "https://bucket.tos.test/uploads/9/video/x.mp4",
          }),
          makePublic: vi.fn(),
          deleteMultiObjects: vi.fn(),
        },
        probe,
        materialGate: { check: vi.fn() },
        materialStatus: statusReader(),
      },
      createUploadedAsset,
    };
  };

  const input = {
    type: "video" as const,
    mime: "video/mp4",
    size: 100,
    storage_key: "uploads/9/video/x.mp4",
    project_id: "313",
    width: 1,
    height: 2,
    duration: 3,
  };

  it("探测结果覆盖客户端给的值", async () => {
    const probe = vi.fn().mockResolvedValue({
      sizeBytes: 100,
      durationMs: 6500,
      width: 1080,
      height: 1920,
      codec: "h264",
      container: "mp4",
      fps: 30,
    });
    const { deps, createUploadedAsset } = makeDeps(probe);
    await handleCompleteAsset("9", input, deps as never);
    expect(probe).toHaveBeenCalledWith("uploads/9/video/x.mp4");
    expect(createUploadedAsset).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 6.5, width: 1080, height: 1920 }),
    );
  });

  it("探测失败时拒收并删掉刚上传的字节", async () => {
    const { deps, createUploadedAsset } = makeDeps(
      vi.fn().mockRejectedValue(new Error("tos down")),
    );
    const error = await expectRejected(
      () => handleCompleteAsset("9", input, deps as never),
      { code: 2014, status: 503 },
    );
    expect(error.message).toContain("音视频时长");
    expect(createUploadedAsset).not.toHaveBeenCalled();
    expect(deps.storage.deleteMultiObjects).toHaveBeenCalledWith([
      "uploads/9/video/x.mp4",
    ]);
  });

  it("探测不到时长同样拒收", async () => {
    const { deps, createUploadedAsset } = makeDeps(
      vi.fn().mockResolvedValue({
        sizeBytes: 100,
        durationMs: null,
        width: null,
        height: null,
        codec: null,
        container: null,
        fps: null,
      }),
    );
    await expectRejected(
      () => handleCompleteAsset("9", input, deps as never),
      { code: 2014, status: 503 },
    );
    expect(createUploadedAsset).not.toHaveBeenCalled();
  });

  it("图片不探测", async () => {
    const probe = vi.fn();
    const { deps } = makeDeps(probe);
    deps.storage.inspectObject.mockResolvedValue({
      size: 100,
      mime: "image/png",
      publicUrl: "https://bucket.tos.test/uploads/9/image/x.png",
    });
    await handleCompleteAsset(
      "9",
      {
        type: "image",
        mime: "image/png",
        size: 100,
        storage_key: "uploads/9/image/x.png",
        project_id: "313",
      },
      deps as never,
    );
    expect(probe).not.toHaveBeenCalled();
  });
});

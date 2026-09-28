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
  material_id: null,
};

const VALID_MD5 = "aabbccddeeff00112233445566778899";

/**
 * IKI65H：上传接口回显素材审核状态用的只读口。默认 `Active`——绝大多数用例不关心它，
 * 关心状态的用例自己换返回值。
 */
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
          // IKI65H：两个字段恒在，这条资产没绑素材 → 都是 null。
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

describe("上传口素材闸（IKGQWR / ADR-0093）", () => {
  const MATERIAL = "asset-20260820153209-6c9z8";
  const GROUP = "group-20260827113901-cbkmf";
  const NOT_APPROVED = "该素材未审核通过，不能用于视频生成";
  const UNAVAILABLE = "素材状态校验失败，请稍后重试";

  const DEDUP_INPUT = {
    type: "video" as const,
    mime: "video/mp4",
    size: 100,
    md5: VALID_MD5,
  };

  const allow = (materialGroupId: string | null = GROUP) => ({
    check: vi.fn().mockResolvedValue({ ok: true, materialGroupId }),
  });
  const deny = (message: string) => ({
    check: vi.fn().mockResolvedValue({ ok: false, message }),
  });

  /** complete 的正常路径：对象在、文件头读不到（放行）、没有已存在的行。 */
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
    // 被拒的素材，查到可复用资产也不该关联出去——查都别查。
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
    // 一个码两条 msg 是刻意的（与生成门同款口径）；拆成两个码会让前端维护两套分流规则。
    expect(error.message).toBe(UNAVAILABLE);
  });

  it("dedup：闸通过 + md5 命中 → 两列一起绑（material_id 与 material_group_id）", async () => {
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
      materialGroupId: GROUP,
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
    // 返回 400 却把行建出来，只会留下一个前端拿不到 id、谁也引用不到的孤儿行——
    // 比桶里那份孤儿对象更脏。所以「拒绝」必须同时意味着「不落本地痕迹」。
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
        materialGroupId: GROUP,
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

/**
 * IKI65H：上传接口回显这条资产绑的素材（`material_id`）与它的审核状态（`material_status`）。
 *
 * 动因是 ADR-0093 决策 6 末句那句「改由服务端返回值决定」——前端 `toLocalAssetRecord` 至今
 * 硬编码 `material_status: 'Active'`，而服务端根本没返回过这个值。
 */
describe("上传接口回显素材关联与状态（IKI65H）", () => {
  const MATERIAL = "asset-20260820153209-6c9z8";
  const OLD_MATERIAL = "asset-20260701090000-oldoldoldold";
  const GROUP = "group-20260827113901-cbkmf";
  const NOT_APPROVED = "该素材未审核通过，不能用于视频生成";

  /** 一条已绑素材的资产行。 */
  const boundAsset = (materialId: string = MATERIAL) => ({
    ...ASSET,
    material_id: materialId,
  });

  type MaterialFields = { material_id: string | null; material_status: string | null };

  /** dedup 响应的 data.asset。 */
  const dedupAsset = (result: unknown) =>
    (result as { data: { asset: MaterialFields } }).data.asset;

  /** complete 响应的 data（它本身就是资产，不像 dedup 那样套一层）。 */
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
      check: vi.fn().mockResolvedValue({ ok: true, materialGroupId: GROUP }),
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
    // 没绑素材就没有可查的 id——不该白发一次查询。
    expect(deps.materialStatus.load).not.toHaveBeenCalled();
  });

  it("dedup 命中并当场改嫁：回显刚绑上的那个，不是行上的旧值", async () => {
    // `reusable` 是 bindMaterialId **之前**读出来的行，它的 material_id 还是旧值。
    // 照行上原值回显就会给出一个已经不成立的关联。
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
    // toEqual 而非 toMatchObject：多出任何字段都算破坏既有形状。
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
    materialGate: {
      check: vi.fn().mockResolvedValue({ ok: true, materialGroupId: GROUP }),
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

  /**
   * 这条是这个字段真正值钱的地方。
   *
   * 幂等重放分支**不重新过闸**（理由见 upload.ts 里的注释：一次重放不该按此刻的素材状态改写
   * 既有结果，何况重放命中时若因闸不过去删对象，删的正是既有资产行引用的那一份）。于是资产
   * 可能挂着一个**后来**被判 Failed 的素材，而接口照回 200——除了读响应里的 `material_status`，
   * 调用方没有别的办法知道这件事。
   */
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
    // 不被重放分支的闸结论影响：这里仍然成功返回，没有抛 2013。
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

  /**
   * 过闸这一步**带副作用**：`assertMaterialLinkable` 在「本地行非终态 + 上游判 Failed」时走
   * `handleUpstreamMaterialFailure`，那里面有一步 `clearMaterialLink`，会把这条资产上的
   * `material_id` 清成 NULL（ADR-0087 的统一处置）。而 `existing` 是**过闸之前**读的行——
   * 照它回显，响应会给出一个库里已经不存在的关联，同一资产在 `GET /api/assets` 那边却是 null。
   */
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
    // 关联没了就不该再白查一次状态。
    expect(deps.materialStatus.load).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { MaterialController } from "./material.controller.js";
import { MaterialService } from "@lib/shared/material/material.service.js";

/** 直接构造控制器单测：mock MaterialService（纯透传）与 AssetService（旁路写）。 */
function makeController(assetMock: {
  linkAssetToMaterial?: ReturnType<typeof vi.fn>;
  clearMaterialLink?: ReturnType<typeof vi.fn>;
  clearMaterialGroupLink?: ReturnType<typeof vi.fn>;
}) {
  const material = {
    callAction: vi.fn(),
    // IKDE6X：虚拟组兜底——默认返回与传入一致的组 id 以免破坏既有断言；专项用例覆盖替换逻辑。
    ensureVirtualDefaultGroup: vi.fn().mockResolvedValue("group-1"),
  } as unknown as MaterialService;
  const assets = {
    linkAssetToMaterial: assetMock.linkAssetToMaterial ?? vi.fn(),
    clearMaterialLink: assetMock.clearMaterialLink ?? vi.fn(),
    clearMaterialGroupLink: assetMock.clearMaterialGroupLink ?? vi.fn(),
  };
  const controller = new MaterialController(material, assets as never);
  return { controller, material, assets };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MaterialController IKDJNZ 关联旁路", () => {
  afterEach(() => vi.restoreAllMocks());

  it("CreateAsset 成功：剥离 SourceAssetId 后透传，并回写 asset 关联两列", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "asset-new-1" } },
    });
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    await controller.callAction(
      "CreateAsset",
      "Bearer sk-test",
      {
        GroupId: "group-1",
        URL: "https://cdn.test/a.jpg",
        Name: "a",
        AssetType: "Image",
        SourceAssetId: "10086",
      },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    // 透传：SourceAssetId 剥离，上游请求体保持原样。
    expect(material.callAction).toHaveBeenCalledWith(
      "Bearer sk-test",
      "CreateAsset",
      {
        GroupId: "group-1",
        URL: "https://cdn.test/a.jpg",
        Name: "a",
        AssetType: "Image",
      },
    );
    // 旁路：回写两列。
    expect(assets.linkAssetToMaterial).toHaveBeenCalledWith({
      userId: "9",
      assetId: "10086",
      materialId: "asset-new-1",
      materialGroupId: "group-1",
    });
    // 上游响应原样回传。
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ResponseMetadata: {},
      Result: { Id: "asset-new-1" },
    });
  });

  it("CreateAsset 缺 SourceAssetId：透传照常，旁路不绑定", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "asset-new-2" } },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "CreateAsset",
      "Bearer sk-test",
      { GroupId: "group-1", URL: "https://cdn.test/b.jpg", Name: "b", AssetType: "Video" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(material.callAction).toHaveBeenCalledTimes(1);
    expect(assets.linkAssetToMaterial).not.toHaveBeenCalled();
  });

  it("DeleteAsset 成功：清除对应 material_id 关联", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: {} },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "DeleteAsset",
      "Bearer sk-test",
      { Id: "asset-del-1" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(assets.clearMaterialLink).toHaveBeenCalledWith("9", "asset-del-1");
  });

  it("DeleteAssetGroup 成功：按组批量清除关联", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: {} },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "DeleteAssetGroup",
      "Bearer sk-test",
      { Id: "group-del-1" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(assets.clearMaterialGroupLink).toHaveBeenCalledWith("9", "group-del-1");
  });

  it("上游失败（4xx）：透传错误，旁路不执行", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 404,
      body: { ResponseError: { Code: "NotFound", Message: "nope" } },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "CreateAsset",
      "Bearer sk-test",
      { GroupId: "g", URL: "u", Name: "n", AssetType: "Image", SourceAssetId: "1" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(assets.linkAssetToMaterial).not.toHaveBeenCalled();
  });

  it("旁路写失败（DB 异常）：只告警，不阻断上游响应", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "asset-new-3" } },
    });
    assets.linkAssetToMaterial.mockRejectedValue(new Error("db down"));
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await expect(
      controller.callAction(
        "CreateAsset",
        "Bearer sk-test",
        { GroupId: "g", URL: "u", Name: "n", AssetType: "Image", SourceAssetId: "7" },
        res,
        { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
      ),
    ).resolves.toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
  });

  it("非关联 Action（ListAssetGroups）不触发旁路，请求体原样透传", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Items: [] } },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "ListAssetGroups",
      "Bearer sk-test",
      { PageNumber: 1, PageSize: 20 },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(material.callAction).toHaveBeenCalledWith(
      "Bearer sk-test",
      "ListAssetGroups",
      { PageNumber: 1, PageSize: 20 },
    );
    expect(assets.linkAssetToMaterial).not.toHaveBeenCalled();
  });

  it("CreateAsset 未传 GroupId：ensureVirtualDefaultGroup 建虚拟组并强制替换 GroupId 后透传，旁路落虚拟组关联（IKDE6X）", async () => {
    const { controller, material, assets } = makeController({});
    // 虚拟组：前端不传 GroupId，仅带 SourceAssetId。
    material.ensureVirtualDefaultGroup.mockResolvedValue("group-virt-1");
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "asset-virt-1" } },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "CreateAsset",
      "Bearer sk-test",
      { URL: "https://cdn.test/v.png", Name: "v", AssetType: "Image", SourceAssetId: "88" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    // 建组被触发（前端不传组，后端兜底建虚拟组）。
    expect(material.ensureVirtualDefaultGroup).toHaveBeenCalledWith(
      "Bearer sk-test",
      "9",
    );
    // 透传：SourceAssetId 剥离，GroupId 被强制替换为虚拟组 id。
    expect(material.callAction).toHaveBeenCalledWith(
      "Bearer sk-test",
      "CreateAsset",
      {
        GroupId: "group-virt-1",
        URL: "https://cdn.test/v.png",
        Name: "v",
        AssetType: "Image",
      },
    );
    // 旁路：落虚拟组关联。
    expect(assets.linkAssetToMaterial).toHaveBeenCalledWith({
      userId: "9",
      assetId: "88",
      materialId: "asset-virt-1",
      materialGroupId: "group-virt-1",
    });
  });

  it("CreateAsset 已传 GroupId：不触发虚拟组建组，透传原样（真人组/显式指定不受影响）", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "asset-real-1" } },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "CreateAsset",
      "Bearer sk-test",
      { GroupId: "group-real-1", URL: "https://cdn.test/r.png", Name: "r", AssetType: "Image", SourceAssetId: "77" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    // 已传 GroupId → 不建虚拟组。
    expect(material.ensureVirtualDefaultGroup).not.toHaveBeenCalled();
    expect(material.callAction).toHaveBeenCalledWith(
      "Bearer sk-test",
      "CreateAsset",
      { GroupId: "group-real-1", URL: "https://cdn.test/r.png", Name: "r", AssetType: "Image" },
    );
    expect(assets.linkAssetToMaterial).toHaveBeenCalledWith({
      userId: "9",
      assetId: "77",
      materialId: "asset-real-1",
      materialGroupId: "group-real-1",
    });
  });

  it("CreateAsset 未传 GroupId 且建组失败：抛错阻断，不透传缺组请求", async () => {
    const { controller, material } = makeController({});
    material.ensureVirtualDefaultGroup.mockRejectedValue(new Error("upstream down"));
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await expect(
      controller.callAction(
        "CreateAsset",
        "Bearer sk-test",
        { URL: "https://cdn.test/x.png", Name: "x", AssetType: "Image", SourceAssetId: "66" },
        res,
        { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
      ),
    ).rejects.toThrow("upstream down");
    // 建组失败 → 不透传（无 GroupId）。
    expect(material.callAction).not.toHaveBeenCalled();
  });
});

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
});

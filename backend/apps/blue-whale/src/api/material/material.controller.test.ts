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
    // IKEXX8：组查询分流——默认未命中（null）走透传，不破坏既有用例；专项用例覆盖命中分支。
    tryServeLocalGroupAction: vi.fn().mockResolvedValue(null),
    softDeleteLocalGroup: vi.fn().mockResolvedValue(undefined),
    // IKF YHJ：素材校验状态镜像——真实实现写 material_assets，此处只需可调用。
    trackMaterialProcessing: vi.fn().mockResolvedValue(undefined),
    mirrorMaterialStatuses: vi.fn().mockResolvedValue(undefined),
    clearMaterialStatus: vi.fn().mockResolvedValue(undefined),
    clearMaterialStatusByGroup: vi.fn().mockResolvedValue(undefined),
    // IKF YHJ：GetAsset 本地优先——默认未命中（null）走透传，不破坏既有用例；专项用例覆盖命中分支。
    tryServeLocalFailedAsset: vi.fn().mockResolvedValue(null),
    // IKF YHJ：素材失败的统一处置（删上游 + 留 Failed + 清关联）。
    handleUpstreamMaterialFailure: vi.fn().mockResolvedValue(undefined),
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
      { GroupId: "group-1", URL: "https://cdn.test/b.jpg", Name: "b", AssetType: "Video" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(material.callAction).toHaveBeenCalledTimes(1);
    expect(assets.linkAssetToMaterial).not.toHaveBeenCalled();
    // IKF YHJ：漏传 SourceAssetId 只影响本地 Asset 绑定；素材在上游仍存在，状态行照落。
    expect(material.trackMaterialProcessing).toHaveBeenCalledWith(
      "9",
      "asset-new-2",
      "group-1",
    );
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
      { Id: "group-del-1" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(assets.clearMaterialGroupLink).toHaveBeenCalledWith("9", "group-del-1");
    // IKEXX8：上游删成功后同步软删本地虚拟组行。
    expect(material.softDeleteLocalGroup).toHaveBeenCalledWith("9", "group-del-1");
  });

  it("DeleteAssetGroup 上游失败（4xx）：不透传后不软删本地组（IKEXX8 负向守卫）", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 400,
      body: { ResponseError: { Code: "BadRequest", Message: "nope" } },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "DeleteAssetGroup",
      { Id: "group-del-1" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(assets.clearMaterialGroupLink).not.toHaveBeenCalled();
    expect(material.softDeleteLocalGroup).not.toHaveBeenCalled();
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
      { PageNumber: 1, PageSize: 20 },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    expect(material.callAction).toHaveBeenCalledWith(
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
      { URL: "https://cdn.test/v.png", Name: "v", AssetType: "Image", SourceAssetId: "88" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    // 建组被触发（前端不传组，后端兜底建虚拟组）。
    expect(material.ensureVirtualDefaultGroup).toHaveBeenCalledWith(
      "9",
    );
    // 透传：SourceAssetId 剥离，GroupId 被强制替换为虚拟组 id。
    expect(material.callAction).toHaveBeenCalledWith(
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
      { GroupId: "group-real-1", URL: "https://cdn.test/r.png", Name: "r", AssetType: "Image", SourceAssetId: "77" },
      res,
      { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
    );

    // 已传 GroupId → 不建虚拟组。
    expect(material.ensureVirtualDefaultGroup).not.toHaveBeenCalled();
    expect(material.callAction).toHaveBeenCalledWith(
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
        { URL: "https://cdn.test/x.png", Name: "x", AssetType: "Image", SourceAssetId: "66" },
        res,
        { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null },
      ),
    ).rejects.toThrow("upstream down");
    // 建组失败 → 不透传（无 GroupId）。
    expect(material.callAction).not.toHaveBeenCalled();
  });
});

describe("MaterialController IKEXX8 组查询分流", () => {
  afterEach(() => vi.restoreAllMocks());

  const USER = { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null };

  it("ListAssetGroups 命中本地分流：回上游同款信封，不透传、不触发关联旁路", async () => {
    const { controller, material, assets } = makeController({});
    const localResp = {
      status: 200,
      body: {
        ResponseMetadata: { RequestId: "req_local", Action: "ListAssetGroups" },
        Result: { TotalCount: 1, Items: [{ Id: "group-virt-1", Name: "默认分组：9", GroupType: "AIGC" }], PageNumber: 1, PageSize: 10 },
      },
    };
    material.tryServeLocalGroupAction.mockResolvedValue(localResp);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction(
      "ListAssetGroups",
      { Filter: { GroupType: "AIGC" }, PageNumber: 1, PageSize: 10 },
      res,
      USER,
    );

    expect(material.tryServeLocalGroupAction).toHaveBeenCalledWith(
      "9",
      "ListAssetGroups",
      { Filter: { GroupType: "AIGC" }, PageNumber: 1, PageSize: 10 },
    );
    expect(material.callAction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(localResp.body);
    expect(assets.linkAssetToMaterial).not.toHaveBeenCalled();
  });

  it("GetAssetGroup 未命中（真人组）：分流返回 null，照常透传上游", async () => {
    const { controller, material } = makeController({});
    material.tryServeLocalGroupAction.mockResolvedValue(null);
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "group-real-1", GroupType: "LivenessFace" } },
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.callAction("GetAssetGroup", { Id: "group-real-1" }, res, USER);

    expect(material.callAction).toHaveBeenCalledWith("GetAssetGroup", {
      Id: "group-real-1",
    });
    expect(res.json).toHaveBeenCalledWith({
      ResponseMetadata: {},
      Result: { Id: "group-real-1", GroupType: "LivenessFace" },
    });
  });
});

describe("MaterialController IKF YHJ 素材校验状态镜像", () => {
  afterEach(() => vi.restoreAllMocks());

  const USER = { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null };
  const okRes = () =>
    ({ status: vi.fn().mockReturnThis(), json: vi.fn() }) as unknown as Response;

  it("CreateAsset 成功：落 Processing 状态行（与 SourceAssetId 无关）", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "asset-new-9" } },
    });

    await controller.callAction(
      "CreateAsset",
      {
        GroupId: "group-9",
        URL: "https://cdn.test/a.jpg",
        Name: "a",
        AssetType: "Image",
        SourceAssetId: "10086",
      },
      okRes(),
      USER,
    );

    expect(material.trackMaterialProcessing).toHaveBeenCalledWith(
      "9",
      "asset-new-9",
      "group-9",
    );
  });

  it("CreateAsset 上游 id 格式异常：不落状态行、不绑定，且不影响透传", async () => {
    const { controller, material, assets } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "not-an-asset-id" } },
    });
    const res = okRes();

    await controller.callAction(
      "CreateAsset",
      { GroupId: "group-9", URL: "https://cdn.test/a.jpg", Name: "a", AssetType: "Image", SourceAssetId: "10086" },
      res,
      USER,
    );

    expect(material.trackMaterialProcessing).not.toHaveBeenCalled();
    expect(assets.linkAssetToMaterial).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("DeleteAsset 成功：硬删状态行", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({ status: 200, body: { ResponseMetadata: {}, Result: {} } });

    await controller.callAction("DeleteAsset", { Id: "asset-del-1" }, okRes(), USER);

    expect(material.clearMaterialStatus).toHaveBeenCalledWith("9", "asset-del-1");
  });

  it("DeleteAssetGroup 成功：按组硬删状态行", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({ status: 200, body: { ResponseMetadata: {}, Result: {} } });

    await controller.callAction("DeleteAssetGroup", { Id: "group-del-1" }, okRes(), USER);

    expect(material.clearMaterialStatusByGroup).toHaveBeenCalledWith("9", "group-del-1");
  });

  it("ListAssets 透传成功：镜像 Items 的状态与失败原文", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: {
        ResponseMetadata: {},
        Result: {
          TotalCount: 2,
          Items: [
            { Id: "asset-ok", Status: "Active" },
            { Id: "asset-bad", Status: "Failed", Error: { Code: "Sensitive", Message: "命中审核" } },
          ],
          PageNumber: 1,
          PageSize: 10,
        },
      },
    });

    await controller.callAction(
      "ListAssets",
      { Filter: { GroupIds: ["group-9"], GroupType: "AIGC" }, PageNumber: 1, PageSize: 10 },
      okRes(),
      USER,
    );

    expect(material.mirrorMaterialStatuses).toHaveBeenCalledWith("9", [
      { materialId: "asset-ok", status: "Active", errorCode: null, errorMessage: null },
      {
        materialId: "asset-bad",
        status: "Failed",
        errorCode: "Sensitive",
        errorMessage: "命中审核",
      },
    ]);
  });

  it("GetAsset 透传成功：镜像单条（Result 本体，含 Error 原文）", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: {
        ResponseMetadata: {},
        Result: {
          Id: "asset-one",
          Status: "Failed",
          Error: { Code: "URLUnreachable", Message: "URL 不可达" },
        },
      },
    });

    await controller.callAction("GetAsset", { Id: "asset-one" }, okRes(), USER);

    expect(material.mirrorMaterialStatuses).toHaveBeenCalledWith("9", [
      {
        materialId: "asset-one",
        status: "Failed",
        errorCode: "URLUnreachable",
        errorMessage: "URL 不可达",
      },
    ]);
  });

  it("GetAsset 上游非 2xx：不镜像（旁路只在 2xx 执行）", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({
      status: 404,
      body: { ResponseError: { Code: "NotFound", Message: "not found" } },
    });

    await controller.callAction("GetAsset", { Id: "asset-missing" }, okRes(), USER);

    expect(material.mirrorMaterialStatuses).not.toHaveBeenCalled();
  });

  it("ListAssets 里的脏项被丢弃，不污染镜像", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: {
        ResponseMetadata: {},
        Result: {
          Items: [
            { Id: "not-an-asset", Status: "Active" },
            { Id: "asset-good", Status: "Processing" },
            { Id: "asset-no-status" },
            "garbage",
          ],
        },
      },
    });

    await controller.callAction(
      "ListAssets",
      { Filter: { GroupIds: ["group-9"], GroupType: "AIGC" } },
      okRes(),
      USER,
    );

    expect(material.mirrorMaterialStatuses).toHaveBeenCalledWith("9", [
      { materialId: "asset-good", status: "Processing", errorCode: null, errorMessage: null },
    ]);
  });
});

// IKF YHJ：上游判失败时的统一处置 + GetAsset 本地优先。
// 这两条是配套的：处置会删掉上游素材，删完之后再透传只会拿到 NotFound，
// 所以 GetAsset 必须先在本地短接，否则前端看到「不存在」而不是「未通过」。
describe("MaterialController —— 素材失败处置与本地优先（IKFYHJ）", () => {
  const USER = { userId: "9", status: "enabled", isAdmin: false, username: "u", email: null };
  const okRes = () =>
    ({ status: vi.fn().mockReturnThis(), json: vi.fn() }) as unknown as Response;

  it("ListAssets 里有 Failed 条目：只对失败的那条触发统一处置（带原文）", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: {
        ResponseMetadata: {},
        Result: {
          TotalCount: 2,
          Items: [
            { Id: "asset-ok", Status: "Active" },
            { Id: "asset-bad", Status: "Failed", Error: { Code: "Sensitive", Message: "命中审核" } },
          ],
        },
      },
    });

    await controller.callAction(
      "ListAssets",
      { Filter: { GroupIds: ["group-9"], GroupType: "AIGC" }, PageNumber: 1, PageSize: 10 },
      okRes(),
      USER,
    );

    expect(material.handleUpstreamMaterialFailure).toHaveBeenCalledTimes(1);
    expect(material.handleUpstreamMaterialFailure).toHaveBeenCalledWith({
      userId: "9",
      materialId: "asset-bad",
      errorCode: "Sensitive",
      errorMessage: "命中审核",
    });
  });

  it("上游全 Active：不触发处置（别把正常素材删了）", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { Result: { Items: [{ Id: "asset-ok", Status: "Active" }] } },
    });

    await controller.callAction(
      "ListAssets",
      { Filter: { GroupIds: ["group-9"], GroupType: "AIGC" }, PageNumber: 1, PageSize: 10 },
      okRes(),
      USER,
    );

    expect(material.handleUpstreamMaterialFailure).not.toHaveBeenCalled();
  });

  it("GetAsset 本地已 Failed：直接回本地结论，不透传上游", async () => {
    const { controller, material } = makeController({});
    material.tryServeLocalFailedAsset.mockResolvedValue({
      status: 200,
      body: { ResponseMetadata: {}, Result: { Id: "asset-bad", Status: "Failed" } },
    });

    const res = okRes();
    await controller.callAction(
      "GetAsset",
      { Id: "asset-bad" },
      res,
      USER,
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ Result: expect.objectContaining({ Status: "Failed" }) }),
    );
    expect(material.callAction).not.toHaveBeenCalled();
  });

  it("GetAsset 本地非 Failed：照常透传（Active/Processing 以上游为准）", async () => {
    const { controller, material } = makeController({});
    material.callAction.mockResolvedValue({
      status: 200,
      body: { Result: { Id: "asset-ok", Status: "Processing" } },
    });

    await controller.callAction("GetAsset", { Id: "asset-ok" }, okRes(), USER);

    expect(material.callAction).toHaveBeenCalledTimes(1);
  });
});

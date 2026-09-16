import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewApiError } from "@lib/core";

import { MATERIAL_ACTIONS, MaterialService } from "./material.service.js";

const AUTH = "Bearer sk-test-key";

function stubFetch(responder: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      return responder(url, init);
    }),
  );
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 构造 MaterialService：mock PrismaService（groupRepo 未用时传哑对象），隔离数据库。 */
function makeService(prisma?: unknown) {
  return new MaterialService(
    prisma as never,
  );
}

describe("MaterialService —— 纯过境调用", () => {
  const originalBaseUrl = process.env.NEW_API_BASE_URL;

  beforeEach(() => {
    process.env.NEW_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.NEW_API_BASE_URL;
    } else {
      process.env.NEW_API_BASE_URL = originalBaseUrl;
    }
    vi.unstubAllGlobals();
  });

  it("白名单共 12 个 Action（组 5 + 素材 5 + 真人会话 2）", () => {
    expect(MATERIAL_ACTIONS).toHaveLength(12);
    expect(MATERIAL_ACTIONS).toContain("ListAssetGroups");
    expect(MATERIAL_ACTIONS).not.toContain("GetModerationResult");
  });

  it("白名单外 Action 拒绝且不发起请求", async () => {
    const calls = stubFetch(() => json({}));
    const service = makeService();
    await expect(
      service.callAction(AUTH, "GetModerationResult", {}),
    ).rejects.toMatchObject({ status: 400, code: "InvalidAction" });
    expect(calls).toHaveLength(0);
  });

  it("缺少上游执行凭证拒绝（401）", async () => {
    stubFetch(() => json({}));
    const service = makeService();
    await expect(
      service.callAction(undefined, "ListAssetGroups", {}),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.callAction("Bearer not-sk", "ListAssetGroups", {}),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("上游信封与状态码原样透传（404 不抛错）", async () => {
    const errorBody = {
      ResponseMetadata: { RequestId: "req_1", Action: "GetAsset" },
      ResponseError: { Code: "NotFound", Message: "resource not found" },
    };
    stubFetch(() => json(errorBody, 404));
    const service = makeService();
    const res = await service.callAction(AUTH, "GetAsset", { Id: "Asset-x" });
    expect(res).toEqual({ status: 404, body: errorBody });
  });

  it("请求以 Bearer sk- 打网关 /api/material/{Action}", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-1" } }));
    const service = makeService();
    await service.callAction(AUTH, "CreateAssetGroup", {
      Name: "g",
      GroupType: "AIGC",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://gateway.test/api/material/CreateAssetGroup");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("Authorization")).toBe(AUTH);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "g",
      GroupType: "AIGC",
    });
  });

  it("CreateVisualValidateSession 纯透传（前端传入的 CallbackURL 原样保留）", async () => {
    const calls = stubFetch(() => json({ BytedToken: "bt-1", H5Link: "https://h5" }));
    const service = makeService();
    await service.callAction(AUTH, "CreateVisualValidateSession", {
      Name: "真人组",
      CallbackURL: "https://web.test/auth-success",
      ProjectName: "p",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "真人组",
      CallbackURL: "https://web.test/auth-success",
      ProjectName: "p",
    });
  });

  it("CreateVisualValidateSession 未传 CallbackURL 时也纯透传", async () => {
    const calls = stubFetch(() => json({ BytedToken: "bt-1", H5Link: "https://h5" }));
    const service = makeService();
    await service.callAction(AUTH, "CreateVisualValidateSession", {
      Name: "真人组",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "真人组",
    });
  });

  it("其他 Action 请求体原样透传（含任意自定义字段）", async () => {
    const calls = stubFetch(() => json({ Result: {} }));
    const service = makeService();
    await service.callAction(AUTH, "CreateAsset", {
      GroupId: "group-1",
      URL: "https://cdn.test/a.jpg",
      Name: "a",
      AssetType: "Image",
      CallbackURL: "https://keep.me",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      GroupId: "group-1",
      URL: "https://cdn.test/a.jpg",
      Name: "a",
      AssetType: "Image",
      CallbackURL: "https://keep.me",
    });
  });

  it("NEW_API_BASE_URL 未配置抛 503", async () => {
    delete process.env.NEW_API_BASE_URL;
    stubFetch(() => json({}));
    const service = makeService();
    await expect(
      service.callAction(AUTH, "ListAssetGroups", {}),
    ).rejects.toBeInstanceOf(NewApiError);
    await expect(
      service.callAction(AUTH, "ListAssetGroups", {}),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("MaterialService —— ensureVirtualDefaultGroup（IKDE6X）", () => {
  const originalBaseUrl = process.env.NEW_API_BASE_URL;

  beforeEach(() => {
    process.env.NEW_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.NEW_API_BASE_URL;
    } else {
      process.env.NEW_API_BASE_URL = originalBaseUrl;
    }
    vi.unstubAllGlobals();
  });

  /** mock 本地 material_groups 查询：findVirtualDefault / upsert。upsert 默认 vi.fn 防 undefined。 */
  function makeGroupPrisma(overrides: {
    findVirtualDefault?: unknown;
    upsert?: unknown;
  } = {}) {
    const client = {
      material_groups: {
        findFirst: overrides.findVirtualDefault ?? vi.fn().mockResolvedValue(null),
        upsert: overrides.upsert ?? vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    return { prisma: { client } };
  }

  it("无虚拟默认组：调上游 CreateAssetGroup 建组（组名 默认分组：<uid>）并落本地 virtual 默认组", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-virt-1" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({
        id: 1n,
        user_id: 9n,
        material_group_id: "group-virt-1",
        kind: "virtual",
        name: "默认分组：9",
        cover_url: null,
        is_default: true,
      }),
    });
    const service = makeService(prisma as never);

    const groupId = await service.ensureVirtualDefaultGroup(AUTH, "9");

    expect(groupId).toBe("group-virt-1");
    // 上游建组：组名 默认分组：<uid>。
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://gateway.test/api/material/CreateAssetGroup");
    // IKEXX8：网关文档 GroupType 必填——显式携带 AIGC，不赌上游默认值。
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "默认分组：9",
      GroupType: "AIGC",
    });
    // 本地落表：virtual 默认组。
    expect(prisma.client.material_groups.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id_material_group_id: { user_id: 9n, material_group_id: "group-virt-1" },
        },
        create: expect.objectContaining({
          user_id: 9n,
          material_group_id: "group-virt-1",
          kind: "virtual",
          name: "默认分组：9",
          is_default: true,
        }),
      }),
    );
  });

  it("已有虚拟默认组：直接复用，不调上游、不落表", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "never" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue({
        id: 1n,
        user_id: 9n,
        material_group_id: "group-virt-1",
        kind: "virtual",
        name: "默认分组：9",
        cover_url: null,
        is_default: true,
      }),
    });
    const service = makeService(prisma as never);

    const groupId = await service.ensureVirtualDefaultGroup(AUTH, "9");

    expect(groupId).toBe("group-virt-1");
    expect(calls).toHaveLength(0); // 未调上游
    expect(prisma.client.material_groups.upsert).not.toHaveBeenCalled(); // 未落表
  });

  it("上游建组返回非 group- 前缀 Id：抛 502，不落表", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "bad-id" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup(AUTH, "9"),
    ).rejects.toMatchObject({ status: 502, code: "create_default_material_group_failed" });
    expect(calls).toHaveLength(1);
    expect(prisma.client.material_groups.upsert).not.toHaveBeenCalled();
  });

  it("上游建组 4xx：透传错误，不落表", async () => {
    const calls = stubFetch(() => json({ ResponseError: { Message: "nope" } }, 400));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup(AUTH, "9"),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
    expect(prisma.client.material_groups.upsert).not.toHaveBeenCalled();
  });

  it("上游建组成功但本地落表失败：补偿删除上游组并透传异常（契约 §2.2）", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-virt-1" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup(AUTH, "9"),
    ).rejects.toThrow("db down");
    // 上游：先建组，再补偿删组。
    expect(calls[0].url).toBe("http://gateway.test/api/material/CreateAssetGroup");
    expect(calls[1].url).toBe("http://gateway.test/api/material/DeleteAssetGroup");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ Id: "group-virt-1" });
  });
});

describe("MaterialService —— 组查询分流 tryServeLocalGroupAction（IKEXX8）", () => {
  const upstreamRow = {
    id: 1n,
    user_id: 9n,
    material_group_id: "group-20260911103222-ps9db",
    kind: "virtual",
    name: "默认分组：9",
    cover_url: null,
    is_default: true,
    gmt_create: new Date("2026-09-11T02:32:22Z"),
    gmt_modified: new Date("2026-09-11T02:32:22Z"),
  };

  function makeGroupPrisma(overrides: {
    count?: unknown;
    findMany?: unknown;
    findFirst?: unknown;
  } = {}) {
    const client = {
      material_groups: {
        count: overrides.count ?? vi.fn().mockResolvedValue(0),
        findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
        findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    return { client };
  }

  it("ListAssetGroups GroupType=AIGC：读本地分页，返回上游同款信封（对齐 2026-09-11 实测样例），不调上游", async () => {
    const calls = stubFetch(() => json({}));
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([upstreamRow]);
    const service = makeService(makeGroupPrisma({ count, findMany }));

    const res = await service.tryServeLocalGroupAction("9", "ListAssetGroups", {
      Filter: { GroupType: "AIGC" },
      PageNumber: 1,
      PageSize: 10,
    });

    expect(calls).toHaveLength(0);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = res!.body as Record<string, any>;
    expect(body.ResponseMetadata.Action).toBe("ListAssetGroups");
    expect(body.ResponseMetadata.RequestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(body.Result).toEqual({
      TotalCount: 1,
      Items: [
        {
          Id: "group-20260911103222-ps9db",
          Name: "默认分组：9",
          GroupType: "AIGC",
          CreateTime: "2026-09-11T02:32:22Z",
          UpdateTime: "2026-09-11T02:32:22Z",
        },
      ],
      PageNumber: 1,
      PageSize: 10,
    });
  });

  it("ListAssetGroups 无 Filter / LivenessFace / 陌生值：返回 null（透传上游）", async () => {
    const service = makeService(makeGroupPrisma());
    expect(
      await service.tryServeLocalGroupAction("9", "ListAssetGroups", {
        PageNumber: 1,
        PageSize: 20,
      }),
    ).toBeNull();
    expect(
      await service.tryServeLocalGroupAction("9", "ListAssetGroups", {
        Filter: { GroupType: "LivenessFace" },
        PageNumber: 1,
        PageSize: 20,
      }),
    ).toBeNull();
    expect(
      await service.tryServeLocalGroupAction("9", "ListAssetGroups", {
        Filter: { GroupType: "Whatever" },
      }),
    ).toBeNull();
  });

  it("GetAssetGroup 命中本地虚拟组：返回详情信封；未命中返回 null（真人组透传）", async () => {
    const serviceHit = makeService(
      makeGroupPrisma({ findFirst: vi.fn().mockResolvedValue(upstreamRow) }),
    );
    const hit = await serviceHit.tryServeLocalGroupAction("9", "GetAssetGroup", {
      Id: "group-20260911103222-ps9db",
    });
    expect(hit).not.toBeNull();
    const body = hit!.body as Record<string, any>;
    expect(body.ResponseMetadata.Action).toBe("GetAssetGroup");
    expect(body.Result).toEqual({
      Id: "group-20260911103222-ps9db",
      Name: "默认分组：9",
      GroupType: "AIGC",
      CreateTime: "2026-09-11T02:32:22Z",
      UpdateTime: "2026-09-11T02:32:22Z",
    });

    const serviceMiss = makeService(makeGroupPrisma());
    expect(
      await serviceMiss.tryServeLocalGroupAction("9", "GetAssetGroup", {
        Id: "group-real-1",
      }),
    ).toBeNull();
  });

  it("非组查询 Action 不进分流：返回 null", async () => {
    const service = makeService(makeGroupPrisma());
    expect(
      await service.tryServeLocalGroupAction("9", "ListAssets", { GroupId: "group-1" }),
    ).toBeNull();
  });
});

// IKF YHJ：上游判素材失败时的统一处置 + GetAsset 本地优先。
// 两件事必须配套：处置会删掉上游素材，删完之后再打上游只会拿到 NotFound，
// 所以 GetAsset 必须先在本地短接，否则前端看到的是「不存在」而不是「未通过」。
describe("MaterialService —— 素材失败处置与 GetAsset 本地优先（IKFYHJ）", () => {
  const originalBaseUrl = process.env.NEW_API_BASE_URL;

  beforeEach(() => {
    process.env.NEW_API_BASE_URL = "http://gateway.test";
  });
  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.NEW_API_BASE_URL;
    else process.env.NEW_API_BASE_URL = originalBaseUrl;
    vi.unstubAllGlobals();
  });

  /** 造一个只提供素材状态行的 prisma 替身；返回可断言的 spy。 */
  function makePrisma(row: { status: string; errorCode?: string | null; errorMessage?: string | null } | null) {
    const mirrorStatus = vi.fn().mockResolvedValue(undefined);
    const clearMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      // 服务内部走 `this.prisma.client`（PrismaService 的约定），mock 要照这个形状给。
      client: {
        material_assets: {
          findFirst: vi.fn().mockResolvedValue(
            row === null
              ? null
              : {
                  id: 1n, material_id: "asset-a", user_id: 9n,
                  material_group_id: "group-1", status: row.status,
                  error_code: row.errorCode ?? null,
                  error_message: row.errorMessage ?? null,
                  status_checked_at: null,
                },
          ),
          updateMany: mirrorStatus,
        },
        assets: { updateMany: clearMany },
      },
    };
    return { prisma, mirrorStatus, clearMany };
  }

  it("handleUpstreamMaterialFailure：留 Failed + 清关联 + 删上游，三件都做", async () => {
    const { prisma, mirrorStatus, clearMany } = makePrisma(null);
    const calls = stubFetch(() => json({ Result: {} }));

    await new MaterialService(prisma as never).handleUpstreamMaterialFailure({
      userId: "9",
      materialId: "asset-a",
      authorization: AUTH,
      errorCode: "Sensitive",
      errorMessage: "命中审核",
    });
    // 删上游是刻意的 fire-and-forget，等一拍让它落地
    await new Promise((r) => setTimeout(r, 0));

    expect(mirrorStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { material_id: "asset-a", user_id: 9n },
        data: expect.objectContaining({ status: "Failed", error_code: "Sensitive" }),
      }),
    );
    // 关联两列一起清（只清 material_id 会留下悬空的 group 关联）
    expect(clearMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { material_id: "asset-a", user_id: 9n },
        data: expect.objectContaining({ material_id: null, material_group_id: null }),
      }),
    );
    expect(calls.map((c) => c.url)).toEqual(["http://gateway.test/api/material/DeleteAsset"]);
  });

  it("deleteUpstream=false（上游本来就没有）：不删上游，本地照常收敛", async () => {
    const { prisma, mirrorStatus, clearMany } = makePrisma(null);
    const calls = stubFetch(() => json({ Result: {} }));

    await new MaterialService(prisma as never).handleUpstreamMaterialFailure({
      userId: "9",
      materialId: "asset-gone",
      authorization: AUTH,
      deleteUpstream: false,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(mirrorStatus).toHaveBeenCalledOnce();
    expect(clearMany).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(0);
  });

  it("删上游失败不外抛（清理是副作用，不该拖挂正在被拒绝的请求）", async () => {
    const { prisma } = makePrisma(null);
    stubFetch(() => json({ ResponseError: { Code: "InternalError" } }, 500));

    await expect(
      new MaterialService(prisma as never).handleUpstreamMaterialFailure({
        userId: "9",
        materialId: "asset-a",
        authorization: AUTH,
      }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("tryServeLocalFailedAsset：本地 Failed → 回上游同款信封，且不打上游", async () => {
    const { prisma } = makePrisma({ status: "Failed", errorCode: "Sensitive", errorMessage: "命中审核" });
    const calls = stubFetch(() => json({}));

    const served = await new MaterialService(prisma as never).tryServeLocalFailedAsset(
      "9", "GetAsset", { Id: "asset-a" },
    );

    expect(calls).toHaveLength(0);
    expect(served?.status).toBe(200);
    expect(served?.body).toMatchObject({
      Result: { Id: "asset-a", Status: "Failed", Error: { Code: "Sensitive", Message: "命中审核" } },
    });
  });

  it.each(["Active", "Processing"])(
    "tryServeLocalFailedAsset：本地 %s → 不短接（那两个状态以上游为准，本地行可能陈旧）",
    async (status) => {
      const { prisma } = makePrisma({ status });
      await expect(
        new MaterialService(prisma as never).tryServeLocalFailedAsset("9", "GetAsset", { Id: "asset-a" }),
      ).resolves.toBeNull();
    },
  );

  it("tryServeLocalFailedAsset：无本地行 / 非 GetAsset / id 非法 → 都放行走透传", async () => {
    const none = makePrisma(null);
    const svc = new MaterialService(none.prisma as never);
    await expect(svc.tryServeLocalFailedAsset("9", "GetAsset", { Id: "asset-a" })).resolves.toBeNull();
    await expect(
      new MaterialService(makePrisma({ status: "Failed" }).prisma as never)
        .tryServeLocalFailedAsset("9", "ListAssets", { Id: "asset-a" }),
    ).resolves.toBeNull();
    await expect(
      new MaterialService(makePrisma({ status: "Failed" }).prisma as never)
        .tryServeLocalFailedAsset("9", "GetAsset", { Id: "not-an-asset" }),
    ).resolves.toBeNull();
  });
});

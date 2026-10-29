import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewApiError } from "@lib/core";

import { MATERIAL_ACTIONS, MaterialService } from "./material.service.js";

const UPSTREAM_KEY = "sk-test-key";
const AUTH = `Bearer ${UPSTREAM_KEY}`;

function settingsStub(key: string | null = UPSTREAM_KEY) {
  return {
    requireUpstreamKey: async () => {
      if (key === null) throw new Error("上游凭证未配置");
      return key;
    },
  } as never;
}

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

function makeService(prisma?: unknown) {
  return new MaterialService(prisma as never, settingsStub());
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
      service.callAction("GetModerationResult", {}),
    ).rejects.toMatchObject({ status: 400, code: "InvalidAction" });
    expect(calls).toHaveLength(0);
  });

  it("未配置上游凭证时 requireUpstreamKey 抛，且不发起请求", async () => {
    const calls = stubFetch(() => json({}));
    const service = new MaterialService({} as never, settingsStub(null));
    await expect(
      service.callAction("ListAssetGroups", {}),
    ).rejects.toThrow("上游凭证未配置");
    expect(calls).toHaveLength(0);
  });

  it("上游信封与状态码原样透传（404 不抛错）", async () => {
    const errorBody = {
      ResponseMetadata: { RequestId: "req_1", Action: "GetAsset" },
      ResponseError: { Code: "NotFound", Message: "resource not found" },
    };
    stubFetch(() => json(errorBody, 404));
    const service = makeService();
    const res = await service.callAction("GetAsset", { Id: "Asset-x" });
    expect(res).toEqual({ status: 404, body: errorBody });
  });

  it("请求以 Bearer sk- 打网关 /api/material/{Action}", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-1" } }));
    const service = makeService();
    await service.callAction("CreateAssetGroup", {
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
    await service.callAction("CreateVisualValidateSession", {
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
    await service.callAction("CreateVisualValidateSession", {
      Name: "真人组",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "真人组",
    });
  });

  it("其他 Action 请求体原样透传（含任意自定义字段）", async () => {
    const calls = stubFetch(() => json({ Result: {} }));
    const service = makeService();
    await service.callAction("CreateAsset", {
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
      service.callAction("ListAssetGroups", {}),
    ).rejects.toBeInstanceOf(NewApiError);
    await expect(
      service.callAction("ListAssetGroups", {}),
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

  function makeGroupPrisma(overrides: {
    findVirtualDefault?: unknown;
    upsert?: unknown;
  } = {}) {
    const client = {
      catalog_material_groups: {
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

    const groupId = await service.ensureVirtualDefaultGroup("9");

    expect(groupId).toBe("group-virt-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://gateway.test/api/material/CreateAssetGroup");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "默认分组：9",
      GroupType: "AIGC",
    });
    expect(prisma.client.catalog_material_groups.upsert).toHaveBeenCalledWith(
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

    const groupId = await service.ensureVirtualDefaultGroup("9");

    expect(groupId).toBe("group-virt-1");
    expect(calls).toHaveLength(0);
    expect(prisma.client.catalog_material_groups.upsert).not.toHaveBeenCalled();
  });

  it("上游建组返回非 group- 前缀 Id：抛 502，不落表", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "bad-id" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup("9"),
    ).rejects.toMatchObject({ status: 502, code: "create_default_material_group_failed" });
    expect(calls).toHaveLength(1);
    expect(prisma.client.catalog_material_groups.upsert).not.toHaveBeenCalled();
  });

  it("上游建组 4xx：透传错误，不落表", async () => {
    const calls = stubFetch(() => json({ ResponseError: { Message: "nope" } }, 400));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup("9"),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
    expect(prisma.client.catalog_material_groups.upsert).not.toHaveBeenCalled();
  });

  it("上游建组成功但本地落表失败：补偿删除上游组并透传异常（契约 §2.2）", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-virt-1" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup("9"),
    ).rejects.toThrow("db down");
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
      catalog_material_groups: {
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
          CoverUrl: null,
          CreateTime: "2026-09-11T02:32:22Z",
          UpdateTime: "2026-09-11T02:32:22Z",
        },
      ],
      PageNumber: 1,
      PageSize: 10,
    });
  });

  it("ListAssetGroups 无 Filter / 陌生 GroupType：返回 null（保持透传，不改变既有语义）", async () => {
    const service = makeService(makeGroupPrisma());
    expect(
      await service.tryServeLocalGroupAction("9", "ListAssetGroups", {
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

  it("ListAssetGroups LivenessFace：读本地真人组，不再透传上游（ADR-0126）", async () => {
    const realRow = {
      ...upstreamRow,
      material_group_id: "group-real-1",
      kind: "real",
      name: "我的真人组",
      cover_url: "https://cdn.test/cover.png",
      is_default: false,
    };
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([realRow]);
    const calls = stubFetch(() => json({}));
    const service = makeService(makeGroupPrisma({ count, findMany }));

    const res = await service.tryServeLocalGroupAction("9", "ListAssetGroups", {
      Filter: { GroupType: "LivenessFace" },
      PageNumber: 1,
      PageSize: 20,
    });

    expect(calls).toHaveLength(0);
    const body = res!.body as Record<string, any>;
    expect(body.ResponseMetadata.Action).toBe("ListAssetGroups");
    expect(body.Result.Items).toEqual([
      {
        Id: "group-real-1",
        Name: "我的真人组",
        GroupType: "LivenessFace",
        CoverUrl: "https://cdn.test/cover.png",
        CreateTime: "2026-09-11T02:32:22Z",
        UpdateTime: "2026-09-11T02:32:22Z",
      },
    ]);
  });

  it("GetAssetGroup 命中本地组：返回详情信封；本地无行返回 null（透传上游）", async () => {
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
      CoverUrl: null,
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

  function makePrisma(row: { status: string; errorCode?: string | null; errorMessage?: string | null } | null) {
    const mirrorStatus = vi.fn().mockResolvedValue(undefined);
    const clearMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      client: {
        catalog_material_states: {
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
        user_assets: { updateMany: clearMany },
      },
    };
    return { prisma, mirrorStatus, clearMany };
  }

  it("handleUpstreamMaterialFailure：留 Failed + 清关联 + 删上游，三件都做", async () => {
    const { prisma, mirrorStatus, clearMany } = makePrisma(null);
    const calls = stubFetch(() => json({ Result: {} }));

    await new MaterialService(prisma as never, settingsStub()).handleUpstreamMaterialFailure({
      userId: "9",
      materialId: "asset-a",
      errorCode: "Sensitive",
      errorMessage: "命中审核",
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(mirrorStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { material_id: "asset-a", user_id: 9n },
        data: expect.objectContaining({ status: "Failed", error_code: "Sensitive" }),
      }),
    );
    expect(clearMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { material_id: "asset-a", user_id: 9n },
        data: expect.objectContaining({ material_id: null }),
      }),
    );
    expect(calls.map((c) => c.url)).toEqual(["http://gateway.test/api/material/DeleteAsset"]);
  });

  it("deleteUpstream=false（上游本来就没有）：不删上游，本地照常收敛", async () => {
    const { prisma, mirrorStatus, clearMany } = makePrisma(null);
    const calls = stubFetch(() => json({ Result: {} }));

    await new MaterialService(prisma as never, settingsStub()).handleUpstreamMaterialFailure({
      userId: "9",
      materialId: "asset-gone",
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
      new MaterialService(prisma as never, settingsStub()).handleUpstreamMaterialFailure({
        userId: "9",
        materialId: "asset-a",
        }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("tryServeLocalFailedAsset：本地 Failed → 回上游同款信封，且不打上游", async () => {
    const { prisma } = makePrisma({ status: "Failed", errorCode: "Sensitive", errorMessage: "命中审核" });
    const calls = stubFetch(() => json({}));

    const served = await new MaterialService(prisma as never, settingsStub()).tryServeLocalFailedAsset(
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
        new MaterialService(prisma as never, settingsStub()).tryServeLocalFailedAsset("9", "GetAsset", { Id: "asset-a" }),
      ).resolves.toBeNull();
    },
  );

  it("tryServeLocalFailedAsset：无本地行 / 非 GetAsset / id 非法 → 都放行走透传", async () => {
    const none = makePrisma(null);
    const svc = new MaterialService(none.prisma as never, settingsStub());
    await expect(svc.tryServeLocalFailedAsset("9", "GetAsset", { Id: "asset-a" })).resolves.toBeNull();
    await expect(
      new MaterialService(makePrisma({ status: "Failed" }).prisma as never, settingsStub())
        .tryServeLocalFailedAsset("9", "ListAssets", { Id: "asset-a" }),
    ).resolves.toBeNull();
    await expect(
      new MaterialService(makePrisma({ status: "Failed" }).prisma as never, settingsStub())
        .tryServeLocalFailedAsset("9", "GetAsset", { Id: "not-an-asset" }),
    ).resolves.toBeNull();
  });
});

describe("MaterialService —— 上传口回显素材状态的读口（IKI65H）", () => {
  const makeStatusPrisma = (row: { status: string } | null, failure?: Error) => {
    const findFirst = failure
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue(
          row === null
            ? null
            : {
                id: 1n,
                material_id: "asset-a",
                user_id: 9n,
                material_group_id: "group-1",
                status: row.status,
                error_code: null,
                error_message: null,
                status_checked_at: null,
              },
        );
    return { prisma: { client: { catalog_material_states: { findFirst } } }, findFirst };
  };

  it("有状态行：原样回该行的 status（不推断、不归一）", async () => {
    const { prisma, findFirst } = makeStatusPrisma({ status: "Failed" });
    await expect(
      new MaterialService(prisma as never, settingsStub()).materialStatusReader().load("9", "asset-a"),
    ).resolves.toBe("Failed");
    expect(findFirst).toHaveBeenCalledWith({
      where: { material_id: "asset-a", user_id: 9n },
    });
  });

  it("无状态行：回 null（存量素材可能从未建过行）", async () => {
    const { prisma } = makeStatusPrisma(null);
    await expect(
      new MaterialService(prisma as never, settingsStub()).materialStatusReader().load("9", "asset-a"),
    ).resolves.toBeNull();
  });

  it("查库失败：不抛，按无状态行回 null", async () => {
    const { prisma } = makeStatusPrisma(null, new Error("db down"));
    await expect(
      new MaterialService(prisma as never, settingsStub()).materialStatusReader().load("9", "asset-a"),
    ).resolves.toBeNull();
  });
});

describe("MaterialService —— ADR-0126 新行为", () => {
  const originalBaseUrl = process.env.NEW_API_BASE_URL;
  const LINKED = "asset-20261009171413-s7hqx";

  beforeEach(() => {
    process.env.NEW_API_BASE_URL = "http://gateway.test";
  });
  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.NEW_API_BASE_URL;
    else process.env.NEW_API_BASE_URL = originalBaseUrl;
    vi.unstubAllGlobals();
  });

  function prismaStub(input: {
    linked?: string | null;
    rowStatus?: string | null;
    localRows?: Array<{ materialId: string; assetId: string; url: string }>;
  } = {}) {
    const clearMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const mirrorMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      client: {
        user_assets: {
          findMany: vi.fn().mockResolvedValue(
            (input.localRows ?? []).map((r) => ({
              id: BigInt(r.assetId),
              material_id: r.materialId,
              url: r.url,
            })),
          ),
          findFirst: vi.fn().mockResolvedValue(
            input.linked == null ? null : { material_id: input.linked },
          ),
          updateMany: clearMany,
        },
        catalog_material_states: {
          findFirst: vi.fn().mockResolvedValue(
            input.rowStatus == null
              ? null
              : {
                  id: 1n,
                  material_id: LINKED,
                  user_id: 9n,
                  material_group_id: "group-1",
                  status: input.rowStatus,
                  error_code: null,
                  error_message: null,
                  status_checked_at: null,
                },
          ),
          updateMany: mirrorMany,
          deleteMany,
        },
      },
    };
    return { prisma, clearMany, deleteMany, mirrorMany };
  }

  describe("listLibraryAssets", () => {
    it("已导入的素材补 asset_id / url，未导入的留 null；状态以上游为准", async () => {
      const { prisma } = prismaStub({
        localRows: [{ materialId: "asset-a", assetId: "526", url: "https://cdn.test/a.png" }],
      });
      stubFetch(() =>
        json({
          Result: {
            TotalCount: 2,
            Items: [
              { Id: "asset-a", Status: "Active" },
              { Id: "asset-b", Status: "Active" },
            ],
          },
        }),
      );

      const data = await makeService(prisma).listLibraryAssets({
        userId: "9",
        body: { Filter: { GroupType: "LivenessFace" } },
      });

      expect(data.TotalCount).toBe(2);
      expect(data.Items).toEqual([
        { Id: "asset-a", Status: "Active", asset_id: "526", url: "https://cdn.test/a.png" },
        { Id: "asset-b", Status: "Active", asset_id: null, url: null },
      ]);
    });

    it("上游省略 Items（合法空列表）→ 回 { TotalCount, Items: [] }，不是 {}", async () => {
      const { prisma } = prismaStub();
      stubFetch(() => json({ Result: { TotalCount: 0 } }));

      await expect(
        makeService(prisma).listLibraryAssets({ userId: "9", body: {} }),
      ).resolves.toEqual({ TotalCount: 0, Items: [] });
    });
  });

  describe("cascadeDeleteUpstreamMaterial", () => {
    it("上游 2xx → 清本地关联与状态行", async () => {
      const { prisma, clearMany, deleteMany } = prismaStub();
      const calls = stubFetch(() => json({ Result: {} }));

      await makeService(prisma).cascadeDeleteUpstreamMaterial({
        userId: "9",
        materialId: LINKED,
      });

      expect(calls.map((c) => c.url)).toEqual([
        "http://gateway.test/api/material/DeleteAsset",
      ]);
      expect(clearMany).toHaveBeenCalledOnce();
      expect(deleteMany).toHaveBeenCalledOnce();
    });

    it("上游说它已不存在（NotFound.asset）→ 视为成功，照常清本地", async () => {
      const { prisma, clearMany } = prismaStub();
      stubFetch(() => json({ ResponseError: { Code: "NotFound.asset" } }, 404));

      await expect(
        makeService(prisma).cascadeDeleteUpstreamMaterial({ userId: "9", materialId: LINKED }),
      ).resolves.toBeUndefined();
      expect(clearMany).toHaveBeenCalledOnce();
    });

    it("上游 5xx → 抛错且**不清本地**（本地一行不动）", async () => {
      const { prisma, clearMany, deleteMany } = prismaStub();
      stubFetch(() => json({ ResponseError: { Code: "InternalError" } }, 500));

      await expect(
        makeService(prisma).cascadeDeleteUpstreamMaterial({ userId: "9", materialId: LINKED }),
      ).rejects.toThrow("素材库服务不可用，删除失败，请稍后重试");
      expect(clearMany).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("preflightCreateAsset", () => {
    it("没带 SourceAssetId / 该资产没入库过 → 放行", async () => {
      const a = prismaStub({ linked: LINKED, rowStatus: "Active" });
      await expect(
        makeService(a.prisma).preflightCreateAsset({ userId: "9", sourceAssetId: undefined }),
      ).resolves.toBeNull();

      const b = prismaStub({ linked: null });
      await expect(
        makeService(b.prisma).preflightCreateAsset({ userId: "9", sourceAssetId: "996239" }),
      ).resolves.toBeNull();
    });

    it("已入库且就绪 → 幂等短路：同款信封 + AlreadyLinked，且**不打上游**", async () => {
      const { prisma, clearMany, deleteMany } = prismaStub({ linked: LINKED, rowStatus: "Active" });
      const calls = stubFetch(() => json({}));

      const short = await makeService(prisma).preflightCreateAsset({
        userId: "9",
        sourceAssetId: "996239",
      });

      expect(calls).toHaveLength(0);
      expect(short?.status).toBe(200);
      expect(short?.body).toMatchObject({
        ResponseMetadata: { Action: "CreateAsset" },
        Result: { Id: LINKED, AlreadyLinked: true },
      });
      expect(clearMany).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it("历史判失败 → 清掉它（上游 + 本地）后放行，让这次重新入库", async () => {
      const { prisma, clearMany, deleteMany } = prismaStub({ linked: LINKED, rowStatus: "Failed" });
      const calls = stubFetch(() => json({ Result: {} }));

      const short = await makeService(prisma).preflightCreateAsset({
        userId: "9",
        sourceAssetId: "996239",
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(short).toBeNull();
      expect(clearMany).toHaveBeenCalledOnce();
      expect(deleteMany).toHaveBeenCalledOnce();
      expect(calls.map((c) => c.url)).toEqual([
        "http://gateway.test/api/material/DeleteAsset",
      ]);
    });

    it("上游不可达 → 放行且**不清历史**（判不了就不拦）", async () => {
      const { prisma, clearMany, deleteMany } = prismaStub({
        linked: LINKED,
        rowStatus: "Processing",
      });
      stubFetch(() => json({ ResponseError: { Code: "InternalError" } }, 500));

      await expect(
        makeService(prisma).preflightCreateAsset({ userId: "9", sourceAssetId: "996239" }),
      ).resolves.toBeNull();
      expect(clearMany).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it("上游仍 Processing（未到终态）→ 放行且**不清历史**（别把在途素材判成失败并删掉）", async () => {
      const { prisma, clearMany, deleteMany } = prismaStub({
        linked: LINKED,
        rowStatus: "Processing",
      });
      const calls = stubFetch(() =>
        json({ Result: { Id: LINKED, Status: "Processing" } }),
      );

      await expect(
        makeService(prisma).preflightCreateAsset({ userId: "9", sourceAssetId: "996239" }),
      ).resolves.toBeNull();
      expect(clearMany).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
      expect(calls.map((c) => c.url)).toEqual([
        "http://gateway.test/api/material/GetAsset",
      ]);
    });
  });

  describe("ingestUpstreamMaterialStatuses", () => {
    it("列表逐条镜像；Failed 触发统一处置（删上游 + 清关联）", async () => {
      const { prisma, mirrorMany, clearMany } = prismaStub();
      const calls = stubFetch(() => json({ Result: {} }));

      await makeService(prisma).ingestUpstreamMaterialStatuses("9", {
        Result: {
          TotalCount: 2,
          Items: [
            { Id: "asset-ok", Status: "Active" },
            { Id: "asset-bad", Status: "Failed", Error: { Code: "Sensitive", Message: "命中审核" } },
          ],
        },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mirrorMany).toHaveBeenCalledTimes(3);
      expect(clearMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { material_id: "asset-bad", user_id: 9n } }),
      );
      expect(calls.map((c) => c.url)).toEqual([
        "http://gateway.test/api/material/DeleteAsset",
      ]);
    });

    it("脏项（非 asset- 前缀 / 缺 Status / 非对象）被丢弃，不污染镜像", async () => {
      const { prisma, mirrorMany } = prismaStub();
      stubFetch(() => json({}));

      await makeService(prisma).ingestUpstreamMaterialStatuses("9", {
        Result: {
          Items: [
            { Id: "asset-good", Status: "Processing" },
            { Id: "not-an-asset", Status: "Active" },
            { Id: "asset-no-status" },
            "garbage",
          ],
        },
      });

      expect(mirrorMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordClaimedRealGroup", () => {
    function groupPrisma(existing: unknown = null) {
      const upsert = vi.fn().mockResolvedValue({});
      return {
        prisma: {
          client: {
            catalog_material_groups: {
              findFirst: vi.fn().mockResolvedValue(existing),
              upsert,
            },
          },
        },
        upsert,
      };
    }

    it("领组时落 kind=real 行，组名取自 ListAssetGroups（GetAssetGroup 对组名回空串）", async () => {
      const { prisma, upsert } = groupPrisma();
      const calls = stubFetch(() =>
        json({
          Result: {
            TotalCount: 2,
            Items: [
              { Id: "group-other", Name: "别的组", GroupType: "LivenessFace" },
              { Id: "group-real-1", Name: "我的真人组", GroupType: "LivenessFace" },
            ],
          },
        }),
      );

      await makeService(prisma).recordClaimedRealGroup("9", "group-real-1");

      expect(calls.map((c) => c.url)).toEqual([
        "http://gateway.test/api/material/ListAssetGroups",
      ]);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            material_group_id: "group-real-1",
            kind: "real",
            name: "我的真人组",
          }),
        }),
      );
    });

    it("列表里找不到该组 → 名字回落成组 id（行照落，不丢）", async () => {
      const { prisma, upsert } = groupPrisma();
      stubFetch(() => json({ Result: { TotalCount: 0, Items: [] } }));

      await makeService(prisma).recordClaimedRealGroup("9", "group-real-1");

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ name: "group-real-1" }),
        }),
      );
    });

    it("已有本地行 → 跳过（领组后前端会继续轮询）", async () => {
      const { prisma, upsert } = groupPrisma({ id: 1n });
      const calls = stubFetch(() => json({}));

      await makeService(prisma).recordClaimedRealGroup("9", "group-real-1");

      expect(calls).toHaveLength(0);
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
